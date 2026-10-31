import 'server-only'
import type { EventDoc } from './domain'
import { clock, newNtf, notificationJourney, ntfStep, deanStep, type Cust, type Gen, type NtfCtx } from './generator'
import { liveRng, nameUuid } from './rng'
import { ingest, type IngestResult } from './ingest'
import { getIds, getStore } from './seed'
import { allMatch, unified, type UEvent } from './queries'

const OPERATOR = 'ops.demo'
const hashPct = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return Math.abs(h) % 100
}

export async function listDlq(f: { status?: string; code?: string; q?: string; sort?: string; dir?: 'asc' | 'desc'; limit?: number }) {
  const store = await getStore()
  const m: Record<string, unknown> = {}
  if (f.status) m.status = f.status
  if (f.code) m['payload.errorCode'] = f.code
  if (f.q) {
    const q = f.q.trim().toUpperCase()
    m.$or = [{ customerId: q }, { correlationId: q }, { transactionId: q }, { 'payload.dlqId': q }]
  }
  const sortField = f.sort === 'retryCount' ? 'payload.retryCount' : f.sort === 'errorCode' ? 'payload.errorCode' : 'timestamp'
  const pipeline = [
    { $match: m },
    { $sort: { [sortField]: f.dir === 'asc' ? 1 : -1, timestamp: -1 } },
    { $limit: Math.min(f.limit ?? 100, 300) },
    { $project: { embedding: 0 } },
  ]
  const [rows, kpi] = await Promise.all([
    store.aggregate<EventDoc>('deadLetterEvents', pipeline),
    store.aggregate<{ _id: string; n: number; retries: number }>('deadLetterEvents', [
      { $group: { _id: '$status', n: { $sum: 1 }, retries: { $sum: '$payload.retryCount' } } },
    ]),
  ])
  const total = kpi.reduce((a, k) => a + k.n, 0)
  return {
    rows,
    pipeline,
    kpis: {
      ...Object.fromEntries(kpi.map((k) => [k._id, k.n])),
      total,
      avgRetryCount: total ? kpi.reduce((a, k) => a + k.retries, 0) / total : 0,
    } as Record<string, number>,
  }
}

export async function getDlqDetail(dlqId: string) {
  const store = await getStore()
  const [entry] = await store.aggregate<EventDoc>('deadLetterEvents', [{ $match: { 'payload.dlqId': dlqId } }, { $project: { embedding: 0 } }])
  if (!entry) return null
  const or: Record<string, unknown>[] = []
  if (entry.correlationId) or.push({ correlationId: entry.correlationId })
  if (entry.transactionId) or.push({ transactionId: entry.transactionId })
  const p = entry.payload as { originalEventId?: string }
  if (p.originalEventId) or.push({ eventId: p.originalEventId })
  const correlated = or.length
    ? await store.aggregate<UEvent>(unified(allMatch({ $or: or })).root, unified(allMatch({ $or: or }), [{ $sort: { timestamp: 1 } }, { $limit: 200 }]).pipeline)
    : []
  return { entry, correlated: correlated.filter((c) => c.eventId !== entry.eventId) }
}

type Plan = { events: unknown[]; note: string; forceFail?: string }

async function planRecovery(entry: EventDoc, attempt: number, gen: Gen): Promise<Plan> {
  const store = await getStore()
  const p = entry.payload as Record<string, unknown> & { errorCode: string; dlqId: string; sanitizedPayload: Record<string, unknown> }
  const orig = (p.sanitizedPayload ?? {}) as Record<string, unknown>
  const recoveryId = (n: number) => nameUuid(`${p.dlqId}:recovery:${n}`)

  switch (p.errorCode) {
    case 'NOTIFICATION_DELIVERY_FAILED': {
      const op = orig.payload as Record<string, unknown>
      const n: NtfCtx = {
        cust: { customerId: String(orig.customerId), bank: String((orig.metadata as Record<string, unknown>)?.bank ?? ''), channel: 'MOBILE_APP', corr: String(orig.correlationId) },
        notificationId: String(op.notificationId),
        type: String(op.notificationType),
        channel: String(op.channel),
        corr: String(orig.correlationId),
        transactionId: (orig.transactionId as string) ?? null,
        deanId: (orig.deanId as string) ?? null,
        originatingEventId: String(op.originatingEventId),
        maskedDestination: String(op.maskedDestination),
      }
      const [latest] = await store.aggregate<{ s: string }>('notificationEvents', [
        { $match: { 'payload.notificationId': n.notificationId } },
        { $sort: { timestamp: 1 } },
        { $group: { _id: null, s: { $last: '$status' } } },
      ])
      // Simulated provider: healthy for showcase customers, ~80% success otherwise (deterministic per attempt).
      const healthy = n.cust.customerId.startsWith('CUST-99') || hashPct(`${p.dlqId}:${attempt}`) < 80
      if (!healthy) return { events: [], note: `Provider still failing: ${String(op.lastError ?? 'gateway timeout')}`, forceFail: 'DOWNSTREAM_STILL_UNAVAILABLE' }
      const now = Date.now()
      const att = Number(op.attempts ?? 3) + 1
      const meta = { recoveredFromDlq: p.dlqId, retryAttempt: attempt }
      const d1 = ntfStep(gen, n, 'DISPATCHED', latest?.s ?? 'DEAD_LETTERED', now - 400, att, null, meta)
      const d2 = ntfStep(gen, n, 'DELIVERED', 'DISPATCHED', now, att, null, meta)
      d1.eventId = recoveryId(attempt * 10 + 1)
      d2.eventId = recoveryId(attempt * 10 + 2)
      return { events: [d1, d2], note: `Notification ${n.notificationId} re-dispatched via ${n.channel} and delivered` }
    }
    case 'INVALID_SCHEMA':
    case 'MISSING_MANDATORY_FIELD': {
      const repaired: Record<string, unknown> = { ...orig, eventVersion: 1, audit: { ...(orig.audit as object), processingResult: 'SUCCESS' } }
      if (typeof repaired.status === 'string') repaired.status = repaired.status.toUpperCase()
      if (typeof repaired.timestamp === 'string') repaired.timestamp = new Date(repaired.timestamp)
      if (!(repaired.timestamp instanceof Date)) repaired.timestamp = new Date()
      if (!repaired.eventId) repaired.eventId = recoveryId(0)
      if (!repaired.correlationId) repaired.correlationId = entry.correlationId ?? (await getIds(store)).corr()
      repaired.metadata = { ...(repaired.metadata as object), recoveredFromDlq: p.dlqId, schemaRepair: true }
      return { events: [repaired], note: 'Schema repair applied (eventVersion/status/correlationId normalized); event resubmitted through validation' }
    }
    case 'DOWNSTREAM_UNAVAILABLE':
    case 'PROCESSING_TIMEOUT': {
      if (orig.eventCategory === 'DEAN_ASSIGNMENT' && orig.status === 'FAILED') {
        const c: Cust = { customerId: String(orig.customerId), bank: '', channel: 'MOBILE_APP', corr: String(orig.correlationId) }
        const [latest] = await store.aggregate<{ s: string }>('deanAssignments', [
          { $match: { customerId: c.customerId, eventCategory: 'DEAN_ASSIGNMENT' } },
          { $sort: { timestamp: 1 } },
          { $group: { _id: null, s: { $last: '$status' } } },
        ])
        if (latest?.s === 'ASSIGNED') return { events: [], note: 'DEAN already assigned by a later request; no reprocessing required' }
        const now = Date.now()
        const r = deanStep(gen, c, 'REQUESTED', 'FAILED', now - 600, null)
        const a = deanStep(gen, c, 'ASSIGNED', 'REQUESTED', now, (await getIds(store)).dean())
        r.eventId = recoveryId(attempt * 10 + 1)
        a.eventId = recoveryId(attempt * 10 + 2)
        return { events: [r, a], note: 'DEAN registry available again; assignment re-requested and completed' }
      }
      // Payment failures are terminal: reconcile with settlement engine and inform the customer.
      const origin = orig as unknown as EventDoc
      const c: Cust = { customerId: String(orig.customerId), bank: String((orig.metadata as Record<string, unknown>)?.bank ?? ''), channel: 'MOBILE_APP', corr: String(orig.correlationId) }
      const ck = clock(gen, Date.now() - 6000)
      const ntf = newNtf(gen, c, 'TRANSACTION_FAILURE', { ...origin, eventId: String(orig.eventId) }, 'PUSH')
      ntf.notificationId = `NTF-${p.dlqId.slice(4)}${attempt}`
      const { ev } = notificationJourney(gen, ck, ntf, 'DELIVERED', Date.now() + 1)
      ev.forEach((e, i) => (e.eventId = recoveryId(attempt * 10 + i)))
      return { events: ev, note: 'Settlement reconciliation confirmed terminal FAILED state; customer failure notification dispatched' }
    }
    case 'DUPLICATE_EVENT':
      return { events: [orig], note: 'Replayed original event through idempotency check' }
    default:
      return { events: [orig], note: 'Replayed original event through validation pipeline' }
  }
}

export async function retryDlq(dlqId: string) {
  const store = await getStore()
  const [entry] = await store.aggregate<EventDoc>('deadLetterEvents', [{ $match: { 'payload.dlqId': dlqId } }])
  if (!entry) throw new Error('DLQ entry not found')
  if (entry.status === 'REPROCESSED' || entry.status === 'DISCARDED')
    return { ok: false, idempotent: true, message: `Entry already ${entry.status}; retry is a no-op`, entry }
  const p = entry.payload as { retryCount: number; errorCode: string }
  const attempt = (p.retryCount ?? 0) + 1
  const gen: Gen = { rng: liveRng(), ids: await getIds(store), producer: 'dlq-reprocessor' }
  const plan = await planRecovery(entry, attempt, gen)
  let results: IngestResult[] = []
  if (plan.events.length) results = await ingest(plan.events, { gen, store, noDlq: true })
  const persisted = results.filter((r) => r.result === 'SUCCESS')
  const dup = results.find((r) => r.result === 'DUPLICATE')
  const failed = plan.forceFail || results.some((r) => r.result === 'FAILED')
  const success = !failed && (persisted.length > 0 || (!!dup && p.errorCode === 'DUPLICATE_EVENT') || plan.events.length === 0)
  const at = new Date()
  const record = {
    attempt,
    at,
    operator: OPERATOR,
    result: success ? 'SUCCESS' : 'FAILED',
    note: success
      ? dup && p.errorCode === 'DUPLICATE_EVENT'
        ? 'Idempotency check confirmed the original event is already persisted; no write required'
        : plan.note
      : (plan.forceFail ? plan.note : results.find((r) => r.result === 'FAILED')?.errorMessage ?? plan.note),
    recoveredEventIds: persisted.map((r) => r.eventId),
    recoveredCollection: persisted[0]?.collection ?? null,
  }
  const next = success ? 'REPROCESSED' : 'RETRY_PENDING'
  await store.updateOne(
    'deadLetterEvents',
    { 'payload.dlqId': dlqId },
    {
      $set: { status: next, previousStatus: entry.status, 'payload.lastRetryAt': at },
      $inc: { 'payload.retryCount': 1 },
      $push: { 'payload.retryHistory': record, 'payload.statusHistory': { from: entry.status, to: next, at, operator: OPERATOR, action: 'RETRY' } },
    },
  )
  return { ok: success, message: record.note, attempt, status: next, results }
}

export async function setDlqStatus(dlqId: string, action: 'INVESTIGATE' | 'DISCARD', reason?: string) {
  const store = await getStore()
  const [entry] = await store.aggregate<EventDoc>('deadLetterEvents', [{ $match: { 'payload.dlqId': dlqId } }])
  if (!entry) throw new Error('DLQ entry not found')
  if (entry.status === 'REPROCESSED' || entry.status === 'DISCARDED') return { ok: false, message: `Entry already ${entry.status}` }
  const to = action === 'DISCARD' ? 'DISCARDED' : 'INVESTIGATING'
  const at = new Date()
  await store.updateOne(
    'deadLetterEvents',
    { 'payload.dlqId': dlqId },
    {
      $set: {
        status: to,
        previousStatus: entry.status,
        ...(action === 'DISCARD' ? { 'payload.resolution': { action: 'DISCARDED', at, operator: OPERATOR, reason: reason || 'Discarded by operator' } } : {}),
      },
      $push: { 'payload.statusHistory': { from: entry.status, to, at, operator: OPERATOR, action, reason: reason ?? null } },
    },
  )
  return { ok: true, status: to }
}
