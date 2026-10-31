import 'server-only'
import { COLLECTIONS, type EventDoc } from './domain'
import {
  clock,
  deanStep,
  dlqEntry,
  DLQ_MESSAGES,
  Ids,
  malformedEvent,
  newCust,
  newNtf,
  newTx,
  notificationJourney,
  offboardingJourney,
  onboardingJourney,
  onboardingStep,
  txStep,
  transactionJourney,
  type Clock,
  type Cust,
  type Gen,
  type TxCtx,
  type TxOutcome,
} from './generator'
import { createRng, liveRng, nameUuid } from './rng'
import { ingest, resetOffsets } from './ingest'
import { rawStore, type Store } from './store'
import { isAtlasConfigured } from './config'

export const SEED = 20260101
export const SEED_TARGET = 10000
const DAY = 86400000
const HOUR = 3600000

type Ntfo = 'DELIVERED' | 'RETRY_DELIVERED' | 'FAILED' | 'FAILED_RECOVERED'

function pickNtfOutcome(g: Gen): Ntfo {
  const r = g.rng.next()
  return r < 0.8 ? 'DELIVERED' : r < 0.88 ? 'RETRY_DELIVERED' : r < 0.95 ? 'FAILED' : 'FAILED_RECOVERED'
}

function addNotification(g: Gen, out: EventDoc[], ck: Clock, cust: Cust, type: string, origin: EventDoc, until: number, outcome?: Ntfo, channel?: string) {
  const nck = clock(g, ck.t)
  const { ev, dlq } = notificationJourney(g, nck, newNtf(g, cust, type, origin, channel), outcome ?? pickNtfOutcome(g), until)
  out.push(...ev)
  if (dlq) out.push(dlq)
}

function randomValidationDlq(g: Gen, out: EventDoc[], cust: Cust, ts: number, lastDoc?: EventDoc) {
  const code = g.rng.pick(['INVALID_SCHEMA', 'MISSING_MANDATORY_FIELD', 'UNSUPPORTED_EVENT_TYPE', 'DUPLICATE_EVENT', 'INVALID_STATE_TRANSITION'] as const)
  let original: unknown
  let msg = g.rng.pick(DLQ_MESSAGES[code])
  if (code === 'DUPLICATE_EVENT' && lastDoc) original = lastDoc
  else if (code === 'INVALID_STATE_TRANSITION' && lastDoc) {
    original = { ...lastDoc, eventId: g.rng.uuid(), status: 'ACTIVATED', previousStatus: 'REQUESTED' }
    msg = `invalid state transition ${lastDoc.status} -> ACTIVATED for ${cust.customerId}`
  } else original = malformedEvent(g, code === 'DUPLICATE_EVENT' || code === 'INVALID_STATE_TRANSITION' ? 'INVALID_SCHEMA' : code, cust, ts)
  const o = original as Record<string, unknown>
  out.push(
    dlqEntry(
      g,
      {
        errorCode: code,
        errorMessage: msg,
        original,
        originalEventId: (o.eventId as string) ?? null,
        originalTopic: (o.topic as string) ?? 'onboarding-events',
        customerId: cust.customerId,
        correlationId: cust.corr,
        ts,
        repairHint: code === 'INVALID_SCHEMA' || code === 'MISSING_MANDATORY_FIELD' ? 'schema-repair' : null,
      },
      cust.bank,
    ),
  )
}

function customerHistory(g: Gen, out: EventDoc[], anchor: number) {
  const cust = newCust(g)
  const recent = g.rng.chance(0.4)
  const start = recent ? anchor - g.rng.int(HOUR, 23 * HOUR) : anchor - g.rng.int(DAY, 30 * DAY)
  const until = anchor - 30000
  const ck = clock(g, start)
  const r = g.rng.next()
  const outcome = r < 0.7 ? 'ACTIVATED' : r < 0.8 ? 'REJECTED' : r < 0.84 ? 'FAILED' : 'PARTIAL'
  const onb = onboardingJourney(g, ck, cust, outcome, until)
  out.push(...onb.ev)
  const last = onb.ev.at(-1)!
  if (g.rng.chance(0.22)) randomValidationDlq(g, out, cust, Math.min(ck.t + 5000, until), last)
  if (onb.final === 'REJECTED' && g.rng.chance(0.8)) addNotification(g, out, ck, cust, 'ONBOARDING_REJECTION', last, until)
  if (onb.final === 'FAILED' && g.rng.chance(0.6)) addNotification(g, out, ck, cust, 'OPERATIONAL_ALERT', last, until)
  if (onb.final !== 'ACTIVATED') return
  if (g.rng.chance(0.45)) addNotification(g, out, ck, cust, 'ONBOARDING_CONFIRMATION', last, until)
  if (!g.rng.chance(0.93)) return

  ck.step(10000, HOUR)
  if (ck.t > until) return
  out.push(deanStep(g, cust, 'REQUESTED', null, ck.t, null))
  ck.step(200, 3000)
  if (ck.t > until) return
  if (g.rng.chance(0.06)) {
    const reason = g.rng.pick(['DEAN registry unavailable', 'conflicting DEAN reservation detected'])
    const failed = deanStep(g, cust, 'FAILED', 'REQUESTED', ck.t, null, reason)
    out.push(failed)
    if (g.rng.chance(0.6))
      out.push(
        dlqEntry(
          g,
          {
            errorCode: 'DOWNSTREAM_UNAVAILABLE',
            errorMessage: 'DEAN registry service unavailable (HTTP 503)',
            original: failed,
            originalEventId: failed.eventId,
            originalTopic: 'dean-assignment',
            customerId: cust.customerId,
            correlationId: cust.corr,
            ts: ck.t + 20,
          },
          cust.bank,
        ),
      )
    ck.step(60000, HOUR)
    if (ck.t > until) return
    out.push(deanStep(g, cust, 'REQUESTED', 'FAILED', ck.t, null))
    ck.step(200, 3000)
    if (ck.t > until) return
  }
  const deanId = g.ids.dean()
  const assigned = deanStep(g, cust, 'ASSIGNED', 'REQUESTED', ck.t, deanId)
  out.push(assigned)
  if (g.rng.chance(0.3)) addNotification(g, out, ck, cust, 'DEAN_ASSIGNMENT_CONFIRMATION', assigned, until)

  const nTx = g.rng.int(0, 3)
  for (let i = 0; i < nTx; i++) {
    ck.step(60000, recent ? 2 * HOUR : 2 * DAY)
    if (ck.t > until) break
    const tx = newTx(g, cust, deanId)
    const x = g.rng.next()
    const o: TxOutcome = x < 0.8 ? 'SETTLED' : x < 0.87 ? 'REJECTED' : x < 0.92 ? 'FAILED_EARLY' : x < 0.97 ? 'FAILED_LATE' : 'REVERSED'
    const tck = clock(g, ck.t)
    const j = transactionJourney(g, tck, tx, o, until)
    out.push(...j.ev)
    const lastTx = j.ev.at(-1)!
    if (o === 'FAILED_LATE' && j.final === 'FAILED' && /timeout|unavailable/.test(j.failReason) && g.rng.chance(0.6)) {
      const code = /timeout/.test(j.failReason) ? 'PROCESSING_TIMEOUT' : 'DOWNSTREAM_UNAVAILABLE'
      out.push(
        dlqEntry(
          g,
          {
            errorCode: code,
            errorMessage: g.rng.pick(DLQ_MESSAGES[code]),
            original: lastTx,
            originalEventId: lastTx.eventId,
            originalTopic: 'dean-assignment',
            customerId: cust.customerId,
            correlationId: tx.corr,
            transactionId: tx.transactionId,
            deanId,
            ts: lastTx.timestamp.getTime() + 25,
          },
          cust.bank,
        ),
      )
    }
    if ((j.final === 'SETTLED' || j.final === 'REVERSED') && g.rng.chance(0.3))
      addNotification(g, out, tck, cust, 'TRANSACTION_CONFIRMATION', lastTx, until)
    if ((j.final === 'REJECTED' || j.final === 'FAILED') && g.rng.chance(0.6))
      addNotification(g, out, tck, cust, 'TRANSACTION_FAILURE', lastTx, until)
  }

  if (g.rng.chance(0.4)) {
    ck.step(HOUR, recent ? 3 * HOUR : 3 * DAY)
    if (ck.t > until) return
    const y = g.rng.next()
    const off = offboardingJourney(
      g,
      ck,
      { cust, corr: g.ids.corr(), initiatedBy: g.rng.chance(0.75) ? 'CUSTOMER' : 'BANK', balanceMinor: y < 0.6 ? 0 : g.rng.int(500, 90000) },
      y < 0.6 ? 'COMPLETED' : y < 0.85 ? 'BLOCKED' : y < 0.93 ? 'FAILED' : 'CANCELLED',
      until,
    )
    out.push(...off.ev)
    if (off.final === 'COMPLETED' && g.rng.chance(0.7)) addNotification(g, out, ck, cust, 'OFFBOARDING_CONFIRMATION', off.ev.at(-1)!, until)
  }
}

/* ---------------- Deterministic showcase scenarios A–F ---------------- */

function activatedCustomer(g: Gen, out: EventDoc[], ck: Clock, id: string, corr: string, bank: string) {
  const c: Cust = { customerId: id, bank, channel: 'MOBILE_APP', corr }
  let prev: string | null = null
  for (const s of ['REQUESTED', 'VALIDATION_PENDING', 'KYC_VERIFIED', 'ELIGIBILITY_CONFIRMED', 'APPROVED', 'ACTIVATED']) {
    out.push(onboardingStep(g, c, s, prev, ck.step(1500, 4000)))
    prev = s
  }
  return c
}

function assignDean(g: Gen, out: EventDoc[], ck: Clock, c: Cust, deanId: string) {
  out.push(deanStep(g, c, 'REQUESTED', null, ck.step(2000, 5000), null))
  const a = deanStep(g, c, 'ASSIGNED', 'REQUESTED', ck.step(300, 900), deanId)
  out.push(a)
  return a
}

function fixedTx(c: Cust, n: string, deanId: string, type: string, amountMinor: number): TxCtx {
  return { cust: c, transactionId: `TX-2026-${n}`, corr: `CORR-${String(Number(n) + 100)}`, deanId, type, amountMinor, destination: 'de-settlement-engine' }
}

function runTx(g: Gen, out: EventDoc[], ck: Clock, t: TxCtx, path: string[], reason?: string) {
  let prev: string | null = null
  for (const s of path) {
    out.push(txStep(g, t, s, prev, ck.step(700, 1900), s === 'REJECTED' || s === 'FAILED' ? reason : undefined))
    prev = s
  }
  return out.at(-1)!
}

export function generateScenarios(anchor: number): EventDoc[] {
  const g: Gen = {
    rng: createRng(SEED + 7),
    ids: new Ids({ ntf: 990000, dlq: 990000, cust: 990000, corr: 990000, tx: 990000, dean: 990000 }),
    producer: 'scenario-generator',
  }
  const out: EventDoc[] = []
  const settled = ['INITIATED', 'VALIDATED', 'AUTHORIZED', 'PROCESSING', 'SETTLED']

  // A
  let ck = clock(g, anchor - 115 * 60000)
  let c = activatedCustomer(g, out, ck, 'CUST-990001', 'CORR-990001', 'Banca Aurora Italia')
  addNotification(g, out, ck, c, 'ONBOARDING_CONFIRMATION', out.at(-1)!, anchor, 'DELIVERED', 'PUSH')
  ck.step(60000, 120000)
  const aDean = assignDean(g, out, ck, c, 'DEAN-990001')
  addNotification(g, out, ck, c, 'DEAN_ASSIGNMENT_CONFIRMATION', aDean, anchor, 'DELIVERED', 'EMAIL')

  // B
  ck = clock(g, anchor - 95 * 60000)
  c = activatedCustomer(g, out, ck, 'CUST-990002', 'CORR-990002', 'Credito Lagunare')
  assignDean(g, out, ck, c, 'DEAN-990002')
  ck.step(300000, 600000)
  let last = runTx(g, out, ck, fixedTx(c, '990002', 'DEAN-990002', 'POS_PAYMENT', 4250), settled)
  addNotification(g, out, ck, c, 'TRANSACTION_CONFIRMATION', last, anchor, 'DELIVERED', 'PUSH')

  // C
  ck = clock(g, anchor - 80 * 60000)
  c = activatedCustomer(g, out, ck, 'CUST-990003', 'CORR-990003', 'Banca del Tirreno')
  assignDean(g, out, ck, c, 'DEAN-990003')
  ck.step(300000, 600000)
  last = runTx(g, out, ck, fixedTx(c, '990003', 'DEAN-990003', 'P2P_TRANSFER', 420000), ['INITIATED', 'VALIDATED', 'REJECTED'], 'holding limit exceeded for Digital Euro wallet')
  addNotification(g, out, ck, c, 'TRANSACTION_FAILURE', last, anchor, 'DELIVERED', 'EMAIL')

  // D
  ck = clock(g, anchor - 60 * 60000)
  c = activatedCustomer(g, out, ck, 'CUST-990004', 'CORR-990004', 'Cassa Alpina')
  assignDean(g, out, ck, c, 'DEAN-990004')
  ck.step(300000, 600000)
  last = runTx(g, out, ck, fixedTx(c, '990004', 'DEAN-990004', 'ECOMMERCE_PAYMENT', 12999), settled)
  addNotification(g, out, ck, c, 'TRANSACTION_CONFIRMATION', last, anchor, 'FAILED', 'SMS')

  // E — malformed DEAN_ASSIGNED event rejected by schema validation, then repaired and reprocessed
  ck = clock(g, anchor - 45 * 60000)
  c = activatedCustomer(g, out, ck, 'CUST-990005', 'CORR-990005', 'Banca Meridiana')
  out.push(deanStep(g, c, 'REQUESTED', null, ck.step(2000, 5000), null))
  const good = deanStep(g, c, 'ASSIGNED', 'REQUESTED', ck.step(300, 900), 'DEAN-990005')
  const malformed = { ...good, eventVersion: '1' } as Record<string, unknown>
  const failedAt = good.timestamp.getTime()
  const dlqId = 'DLQ-990101'
  const recovered: EventDoc = {
    ...good,
    eventId: nameUuid(`${dlqId}:recovery:1`),
    timestamp: new Date(failedAt + 12 * 60000),
    metadata: { ...good.metadata, recoveredFromDlq: dlqId, originalEventId: good.eventId },
  }
  const entry = dlqEntry(
    g,
    {
      errorCode: 'INVALID_SCHEMA',
      errorMessage: 'field "eventVersion": Invalid input: expected 1',
      original: malformed,
      originalEventId: good.eventId,
      originalTopic: 'dean-assignment',
      customerId: c.customerId,
      correlationId: c.corr,
      deanId: 'DEAN-990005',
      ts: failedAt + 15,
      status: 'REPROCESSED',
      repairHint: 'schema-repair',
      retryHistory: [
        { attempt: 1, at: new Date(failedAt + 6 * 60000), operator: 'ops.demo', result: 'FAILED', note: 'Retried without repair: schema still invalid' },
        { attempt: 2, at: new Date(failedAt + 12 * 60000), operator: 'ops.demo', result: 'SUCCESS', recoveredEventId: recovered.eventId, note: 'Schema repair applied (eventVersion coerced to 1); event reprocessed into deanAssignments' },
      ],
    },
    c.bank,
  )
  ;(entry.payload as Record<string, unknown>).dlqId = dlqId
  out.push(entry, recovered)
  ck.t = recovered.timestamp.getTime()
  addNotification(g, out, ck, c, 'DEAN_ASSIGNMENT_CONFIRMATION', recovered, anchor, 'DELIVERED', 'PUSH')

  // F
  ck = clock(g, anchor - 35 * 60000)
  c = activatedCustomer(g, out, ck, 'CUST-990006', 'CORR-990006', 'Istituto Ligure di Credito')
  assignDean(g, out, ck, c, 'DEAN-990006')
  ck.step(120000, 240000)
  runTx(g, out, ck, fixedTx(c, '990006', 'DEAN-990006', 'FUNDING', 85000), settled)
  ck.step(300000, 600000)
  const off = offboardingJourney(g, ck, { cust: c, corr: 'CORR-990206', initiatedBy: 'CUSTOMER', balanceMinor: 85000 }, 'BLOCKED', anchor)
  ;(off.ev.at(-1)!.payload as Record<string, unknown>).transitionReason = 'outstanding Digital Euro balance must be defunded before closure'
  off.ev.at(-1)!.semanticText = 'Offboarding blocked: outstanding Digital Euro balance must be defunded before closure'
  off.ev.at(-1)!.description = `${off.ev.at(-1)!.semanticText} [CUST-990006]`
  out.push(...off.ev)
  return out
}

export function generateSeedDataset(anchor: number) {
  const g: Gen = { rng: createRng(SEED), ids: new Ids(), producer: 'seed-generator' }
  const out: EventDoc[] = []
  while (out.length < SEED_TARGET) customerHistory(g, out, anchor)
  // Older open DLQ items have progressed through operator triage.
  for (const d of out) {
    if (d.topic !== 'error-dead-letter' || d.status !== 'OPEN') continue
    const age = anchor - d.timestamp.getTime()
    if (age < 2 * DAY) continue
    const r = g.rng.next()
    if (r < 0.35) d.status = 'INVESTIGATING'
    else if (r < 0.55) {
      d.status = 'DISCARDED'
      ;(d.payload as Record<string, unknown>).resolution = { action: 'DISCARDED', at: new Date(d.timestamp.getTime() + 4 * HOUR), operator: 'ops.demo', reason: 'Non-recoverable producer defect acknowledged' }
    } else if (r < 0.65) d.status = 'RETRY_PENDING'
  }
  const scen = generateScenarios(anchor)
  return { events: [...out, ...scen], ids: g.ids.c }
}

/* ---------------- Readiness & seeding ---------------- */

const gl = globalThis as unknown as { __deSeed?: Promise<void>; __deIds?: Ids; __deAnchor?: number }

export async function seedInto(store: Store, events: EventDoc[], batchSize = 1000) {
  const gen: Gen = { rng: liveRng(), ids: new Ids({ dlq: 800000 }), producer: 'seed-generator' }
  const cache = new Map<string, string>()
  for (let i = 0; i < events.length; i += batchSize) {
    await ingest(events.slice(i, i + batchSize), { gen, stateCache: cache, store, skipEmbeddings: store.kind === 'memory' })
  }
}

async function seedMemory() {
  const store = rawStore()
  await store.reset()
  resetOffsets()
  const anchor = Math.floor(Date.now() / 60000) * 60000
  const { events, ids } = generateSeedDataset(anchor)
  await seedInto(store, events)
  gl.__deIds = new Ids(ids)
  gl.__deAnchor = anchor
}

export async function resetMemory() {
  gl.__deSeed = seedMemory()
  await gl.__deSeed
}

export async function getStore(): Promise<Store> {
  if (!isAtlasConfigured()) {
    gl.__deSeed ??= seedMemory()
    await gl.__deSeed
  }
  return rawStore()
}

const parseMax = (v: string | undefined, re: RegExp) => Number(v?.match(re)?.[1] ?? 0)

/** Allocator for live identifiers that continue after the seeded ranges. */
export async function getIds(store: Store): Promise<Ids> {
  if (gl.__deIds) return gl.__deIds
  const max = async (coll: (typeof COLLECTIONS)[number], field: string, lt: string) => {
    const r = await store.aggregate<{ m?: string }>(coll, [
      { $match: { [field]: { $lt: lt, $ne: null } } },
      { $group: { _id: null, m: { $max: `$${field}` } } },
    ])
    return r[0]?.m
  }
  gl.__deIds = new Ids({
    cust: parseMax(await max('onboardingEvents', 'customerId', 'CUST-900000'), /(\d{6})$/),
    corr: Math.max(
      ...(await Promise.all(COLLECTIONS.map((c) => max(c, 'correlationId', 'CORR-900000')))).map((v) => parseMax(v, /(\d{6})$/)),
    ),
    tx: parseMax(await max('deanAssignments', 'transactionId', 'TX-2026-900000'), /(\d{6})$/),
    dean: parseMax(await max('deanAssignments', 'deanId', 'DEAN-900000'), /(\d{6})$/),
    ntf: parseMax(await max('notificationEvents', 'payload.notificationId', 'NTF-900000'), /(\d{6})$/),
    dlq: Math.max(800000, parseMax(await max('deadLetterEvents', 'payload.dlqId', 'DLQ-990000'), /(\d{6})$/)),
  })
  return gl.__deIds
}

export function clearIds() {
  gl.__deIds = undefined
}
