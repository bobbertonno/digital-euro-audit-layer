import 'server-only'
import {
  SCHEMA_BY_TOPIC,
  SIMULATED_PARTITIONS,
  TOPIC_TO_COLLECTION,
  TOPICS,
  transitionsFor,
  type CollectionName,
  type DlqErrorCode,
  type EventDoc,
  type Topic,
} from './domain'
import { dlqEntry, type Gen } from './generator'
import { rawStore, type Store } from './store'
import { embedTexts } from './embeddings'
import { vectorEnabledForWrites } from './capabilities'

export type IngestResult = {
  eventId: string
  topic: string
  collection: CollectionName
  result: 'SUCCESS' | 'FAILED' | 'DUPLICATE'
  status: string
  latencyMs: number
  partition: number
  offset: number
  dlqId?: string
  errorCode?: string
  errorMessage?: string
}

export type StateCache = Map<string, string>

const g = globalThis as unknown as { __deOffsets?: Partial<Record<Topic, number>> }

async function nextOffset(store: Store, topic: Topic) {
  g.__deOffsets ??= {}
  if (g.__deOffsets[topic] === undefined) g.__deOffsets[topic] = await store.count(TOPIC_TO_COLLECTION[topic])
  return g.__deOffsets[topic]!++
}
export function resetOffsets() {
  g.__deOffsets = {}
}

const hash = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function stateKey(coll: CollectionName, d: Pick<EventDoc, 'customerId' | 'transactionId' | 'payload'> & { eventCategory?: string }) {
  if (coll === 'onboardingEvents') return `on:${d.customerId}`
  if (coll === 'offboardingEvents') return `off:${d.customerId}`
  if (coll === 'deanAssignments') return d.eventCategory === 'DEAN_ASSIGNMENT' ? `dean:${d.customerId}` : `tx:${d.transactionId}`
  if (coll === 'notificationEvents') return `ntf:${(d.payload as { notificationId?: string }).notificationId}`
  return null
}

/** Latest persisted state per entity, reconstructed from append-only history. */
async function loadLatestStates(store: Store, coll: CollectionName, docs: EventDoc[], cache: StateCache) {
  const need = docs.map((d) => stateKey(coll, d)).filter((k): k is string => !!k && !cache.has(k))
  if (!need.length) return
  const groups: { prefix: string; field: string; match: Record<string, unknown> }[] = []
  const vals = (p: string) => [...new Set(need.filter((k) => k.startsWith(p)).map((k) => k.slice(p.length)))]
  if (coll === 'onboardingEvents') groups.push({ prefix: 'on:', field: 'customerId', match: {} })
  if (coll === 'offboardingEvents') groups.push({ prefix: 'off:', field: 'customerId', match: {} })
  if (coll === 'deanAssignments') {
    groups.push({ prefix: 'dean:', field: 'customerId', match: { eventCategory: 'DEAN_ASSIGNMENT' } })
    groups.push({ prefix: 'tx:', field: 'transactionId', match: { eventCategory: 'PAYMENT_TRANSACTION' } })
  }
  if (coll === 'notificationEvents') groups.push({ prefix: 'ntf:', field: 'payload.notificationId', match: {} })
  for (const gr of groups) {
    const v = vals(gr.prefix)
    if (!v.length) continue
    const rows = await store.aggregate<{ _id: string; s: string }>(coll, [
      { $match: { ...gr.match, [gr.field]: { $in: v } } },
      { $sort: { timestamp: 1 } },
      { $group: { _id: `$${gr.field}`, s: { $last: '$status' } } },
    ])
    for (const r of rows) cache.set(gr.prefix + r._id, r.s)
  }
}

function classifyZod(raw: Record<string, unknown>, issues: { path: PropertyKey[]; code: string; message: string }[]): {
  code: DlqErrorCode
  msg: string
} {
  if (!TOPICS.includes(raw.topic as Topic)) return { code: 'UNSUPPORTED_EVENT_TYPE', msg: `unsupported topic "${String(raw.topic)}"` }
  const et = issues.find((i) => i.path[0] === 'eventType')
  if (et && raw.eventType !== undefined) return { code: 'UNSUPPORTED_EVENT_TYPE', msg: `unsupported event type "${String(raw.eventType)}"` }
  const missing = issues.find((i) => i.message.toLowerCase().includes('received undefined') || i.code === 'invalid_type' && raw[String(i.path[0])] === undefined)
  if (missing) return { code: 'MISSING_MANDATORY_FIELD', msg: `missing mandatory field "${missing.path.join('.')}"` }
  const first = issues[0]
  return { code: 'INVALID_SCHEMA', msg: `field "${first.path.join('.')}": ${first.message}` }
}

const str = (v: unknown, re: RegExp) => (typeof v === 'string' && re.test(v) ? v : null)

export type IngestOptions = { gen: Gen; stateCache?: StateCache; store?: Store; skipEmbeddings?: boolean; noDlq?: boolean }

/**
 * The single validation & persistence pipeline used by seed, simulator, scenarios and DLQ retry:
 * Zod schema validation → idempotency by eventId → state-transition validation → persist (or route to DLQ).
 */
export async function ingest(rawEvents: unknown[], opts: IngestOptions): Promise<IngestResult[]> {
  const store = opts.store ?? rawStore()
  const cache: StateCache = opts.stateCache ?? new Map()
  const results: IngestResult[] = []
  const accepted: Record<CollectionName, EventDoc[]> = {
    onboardingEvents: [],
    offboardingEvents: [],
    deanAssignments: [],
    notificationEvents: [],
    deadLetterEvents: [],
  }
  const rejected: { raw: Record<string, unknown>; code: DlqErrorCode; msg: string }[] = []

  const parsed: { doc: EventDoc; coll: CollectionName }[] = []
  for (const r of rawEvents) {
    const raw = (r ?? {}) as Record<string, unknown>
    const schema = SCHEMA_BY_TOPIC[raw.topic as Topic]
    if (!schema) {
      rejected.push({ raw, ...{ code: 'UNSUPPORTED_EVENT_TYPE', msg: `unsupported topic "${String(raw.topic)}"` } })
      continue
    }
    const res = schema.safeParse(raw)
    if (!res.success) {
      const c = classifyZod(raw, res.error.issues)
      rejected.push({ raw, code: c.code, msg: c.msg })
      continue
    }
    parsed.push({ doc: { ...raw, ...res.data } as EventDoc, coll: TOPIC_TO_COLLECTION[raw.topic as Topic] })
  }

  // Idempotency: existing eventIds per collection plus duplicates inside the batch.
  const byColl = new Map<CollectionName, EventDoc[]>()
  for (const p of parsed) byColl.set(p.coll, [...(byColl.get(p.coll) ?? []), p.doc])
  const existing = new Map<CollectionName, Set<string>>()
  for (const [coll, docs] of byColl) {
    existing.set(coll, await store.existingEventIds(coll, docs.map((d) => d.eventId)))
    await loadLatestStates(store, coll, docs, cache)
  }
  const seen = new Set<string>()
  for (const { doc, coll } of parsed) {
    if (existing.get(coll)!.has(doc.eventId) || seen.has(`${coll}:${doc.eventId}`)) {
      rejected.push({ raw: doc, code: 'DUPLICATE_EVENT', msg: `duplicate event ${doc.eventId}; original already persisted in ${coll}` })
      continue
    }
    const key = stateKey(coll, doc)
    const machine = transitionsFor(coll, doc.eventCategory)
    if (key && machine) {
      const current = cache.get(key) ?? null
      const allowed = machine[current ?? '__START__'] ?? []
      if (!allowed.includes(doc.status) || (doc.previousStatus ?? null) !== current) {
        rejected.push({
          raw: doc,
          code: 'INVALID_STATE_TRANSITION',
          msg: `invalid state transition ${current ?? 'NONE'} -> ${doc.status} for ${key.split(':')[1]}`,
        })
        continue
      }
      cache.set(key, doc.status)
    }
    seen.add(`${coll}:${doc.eventId}`)
    accepted[coll].push(doc)
  }

  if (opts.noDlq) {
    for (const rj of rejected)
      results.push({
        eventId: String(rj.raw.eventId ?? ''),
        topic: String(rj.raw.topic ?? ''),
        collection: 'deadLetterEvents',
        result: rj.code === 'DUPLICATE_EVENT' ? 'DUPLICATE' : 'FAILED',
        status: 'REJECTED',
        latencyMs: 0,
        partition: -1,
        offset: -1,
        errorCode: rj.code,
        errorMessage: rj.msg,
      })
    rejected.length = 0
  }
  for (const rj of rejected) {
    const raw = rj.raw
    const topic = typeof raw.topic === 'string' ? raw.topic : null
    const dlq = dlqEntry(
      opts.gen,
      {
        errorCode: rj.code,
        errorMessage: rj.msg,
        original: raw,
        originalEventId: typeof raw.eventId === 'string' ? raw.eventId : null,
        originalTopic: topic,
        customerId: str(raw.customerId, /^CUST-\d{6}$/),
        correlationId: str(raw.correlationId, /^CORR-\d{6}$/),
        transactionId: str(raw.transactionId, /^TX-\d{4}-\d{6}$/),
        deanId: str(raw.deanId, /^DEAN-\d{6}$/),
        ts: Date.now(),
        repairHint: rj.code === 'INVALID_SCHEMA' || rj.code === 'MISSING_MANDATORY_FIELD' ? 'schema-repair' : null,
      },
      (raw.metadata as { bank?: string } | undefined)?.bank,
    )
    accepted.deadLetterEvents.push(dlq)
    ;(dlq as EventDoc & { __rejected?: Record<string, unknown> }).__rejected = raw
  }

  const withEmbeddings = !opts.skipEmbeddings && (await vectorEnabledForWrites())
  for (const coll of Object.keys(accepted) as CollectionName[]) {
    const docs = accepted[coll]
    if (!docs.length) continue
    if (withEmbeddings) {
      try {
        const vecs = await embedTexts(docs.map((d) => d.semanticText))
        docs.forEach((d, i) => (d.embedding = vecs[i]))
      } catch {
        /* embeddings are optional; documents persist without them */
      }
    }
    const ingestedAt = new Date()
    for (const d of docs) {
      const topic = d.topic as Topic
      const partition = hash(d.customerId ?? d.eventId) % SIMULATED_PARTITIONS
      d.metadata = { ...d.metadata, kafka: { topic, partition, offset: await nextOffset(store, topic), simulated: true } }
      d.ingestedAt = ingestedAt
      d.audit = { ...d.audit, producedAt: d.audit.producedAt ?? ingestedAt }
    }
    const rej = docs.map((d) => (d as EventDoc & { __rejected?: unknown }).__rejected)
    docs.forEach((d) => delete (d as EventDoc & { __rejected?: unknown }).__rejected)
    const { duplicateIds } = await store.insertMany(coll, docs)
    const persistedAt = new Date()
    // Measured: wall-clock from producer creation to acknowledged persistence.
    const latencies = docs.map((d) => Math.max(0, persistedAt.getTime() - (d.audit.producedAt as Date).getTime()))
    await store.recordLatency(
      coll,
      docs.filter((d) => !duplicateIds.includes(d.eventId)).map((d) => d.eventId),
      persistedAt,
    )
    docs.forEach((d, i) => {
      const k = d.metadata.kafka as { partition: number; offset: number }
      const r = rej[i] as Record<string, unknown> | undefined
      const p = d.payload as { dlqId?: string; errorCode?: string; errorMessage?: string }
      results.push({
        eventId: r && typeof r.eventId === 'string' ? r.eventId : d.eventId,
        topic: r && typeof r.topic === 'string' ? r.topic : d.topic,
        collection: coll,
        result: duplicateIds.includes(d.eventId) ? 'DUPLICATE' : coll === 'deadLetterEvents' && r ? (p.errorCode === 'DUPLICATE_EVENT' ? 'DUPLICATE' : 'FAILED') : 'SUCCESS',
        status: d.status,
        latencyMs: latencies[i],
        partition: k.partition,
        offset: k.offset,
        ...(r ? { dlqId: p.dlqId, errorCode: p.errorCode, errorMessage: p.errorMessage } : {}),
      })
    })
  }
  return results
}
