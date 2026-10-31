import 'server-only'
import type { Document } from 'mongodb'
import { COLLECTIONS, COLLECTION_TO_TOPIC, TOPIC_TO_COLLECTION, type CollectionName, type EventDoc, type Topic } from './domain'
import { getStore } from './seed'
import type { Pipeline, Store } from './store'

export const FAIL_STATES = ['FAILED', 'REJECTED', 'DEAD_LETTERED', 'BLOCKED']
export type UEvent = EventDoc & { sourceCollection: CollectionName }

const HIDE = { $project: { embedding: 0 } }

/** Unified event stream over the five collections using $unionWith. */
export function unified(matches: Partial<Record<CollectionName, Document>>, tail: Pipeline = []) {
  const colls = COLLECTIONS.filter((c) => matches[c] !== undefined)
  const root = colls[0] ?? 'onboardingEvents'
  const branch = (c: CollectionName) => [{ $match: matches[c] ?? {} }, { $addFields: { sourceCollection: c } }, HIDE]
  const pipeline: Pipeline = [
    ...(colls.length ? branch(root) : [{ $match: { _never: true } }]),
    ...colls.slice(1).map((c) => ({ $unionWith: { coll: c, pipeline: branch(c) } })),
    ...tail,
  ]
  return { root, pipeline }
}

export const allMatch = (m: Document = {}) =>
  Object.fromEntries(COLLECTIONS.map((c) => [c, m])) as Record<CollectionName, Document>

async function runUnified<T = UEvent>(store: Store, matches: Partial<Record<CollectionName, Document>>, tail: Pipeline) {
  const { root, pipeline } = unified(matches, tail)
  const rows = await store.aggregate<T>(root, pipeline)
  return { rows, root, pipeline }
}

/* ---------------- Dashboard ---------------- */

const gl = globalThis as unknown as { __deDash?: { key: string; at: number; data: unknown } }

export async function getDashboard() {
  const store = await getStore()
  const key = `${store.kind}:${store.version()}`
  if (gl.__deDash && gl.__deDash.key === key && Date.now() - gl.__deDash.at < 15000) return gl.__deDash.data as Dashboard
  const now = Date.now()
  const since24 = new Date(now - 24 * 3600000)
  const since60 = new Date(now - 60 * 60000)

  const pipelines = {
    perCollection: [
      {
        $group: {
          _id: '$sourceCollection',
          n: { $sum: 1 },
          lastTs: { $max: '$timestamp' },
          lastIngested: { $max: '$ingestedAt' },
          avgLatency: { $avg: '$audit.ingestionLatencyMs' },
          failed: { $sum: { $cond: [{ $in: ['$status', FAIL_STATES] }, 1, 0] } },
        },
      },
    ],
    customerState: [{ $sort: { timestamp: 1 } }, { $group: { _id: '$customerId', s: { $last: '$status' } } }],
    funnel: [{ $group: { _id: { s: '$status', c: '$customerId' } } }, { $group: { _id: '$_id.s', n: { $sum: 1 } } }],
    transactions: [
      { $match: { eventCategory: 'PAYMENT_TRANSACTION' } },
      { $sort: { timestamp: 1 } },
      { $group: { _id: '$transactionId', s: { $last: '$status' }, amt: { $first: '$payload.amountMinor' } } },
      { $group: { _id: '$s', n: { $sum: 1 }, value: { $sum: '$amt' } } },
    ],
    throughput24h: [
      { $match: { timestamp: { $gte: since24 } } },
      { $group: { _id: { h: { $dateToString: { format: '%Y-%m-%dT%H:00:00Z', date: '$timestamp' } }, c: '$sourceCollection' }, n: { $sum: 1 } } },
    ],
    throughput60m: [
      { $match: { timestamp: { $gte: since60 } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%dT%H:%M:00Z', date: '$timestamp' } }, n: { $sum: 1 } } },
    ],
    notifications: [
      { $sort: { timestamp: 1 } },
      {
        $group: {
          _id: '$payload.notificationId',
          s: { $last: '$status' },
          ch: { $last: '$payload.channel' },
          att: { $max: '$payload.attempts' },
          lat: { $avg: '$payload.processingLatencyMs' },
        },
      },
      { $group: { _id: { ch: '$ch', s: '$s' }, n: { $sum: 1 }, att: { $avg: '$att' }, lat: { $avg: '$lat' } } },
    ],
    dlq: [{ $group: { _id: { code: '$payload.errorCode', s: '$status' }, n: { $sum: 1 } } }],
    critical: [
      { $match: { $or: [{ status: { $in: FAIL_STATES } }, { sourceCollection: 'deadLetterEvents', status: 'OPEN' }] } },
      { $sort: { timestamp: -1 } },
      { $limit: 8 },
    ],
  }

  const [perColl, onb, off, funnel, tx, t24, t60, ntf, dlq, critical] = await Promise.all([
    runUnified<{ _id: CollectionName; n: number; lastTs: Date; lastIngested: Date; avgLatency: number; failed: number }>(store, allMatch(), pipelines.perCollection),
    store.aggregate<{ _id: string; s: string }>('onboardingEvents', pipelines.customerState),
    store.aggregate<{ _id: string; s: string }>('offboardingEvents', pipelines.customerState),
    store.aggregate<{ _id: string; n: number }>('onboardingEvents', pipelines.funnel),
    store.aggregate<{ _id: string; n: number; value: number }>('deanAssignments', pipelines.transactions),
    runUnified<{ _id: { h: string; c: CollectionName }; n: number }>(store, allMatch({ timestamp: { $gte: since24 } }), pipelines.throughput24h.slice(1)),
    runUnified<{ _id: string; n: number }>(store, allMatch({ timestamp: { $gte: since60 } }), pipelines.throughput60m.slice(1)),
    store.aggregate<{ _id: { ch: string; s: string }; n: number; att: number; lat: number }>('notificationEvents', pipelines.notifications),
    store.aggregate<{ _id: { code: string; s: string }; n: number }>('deadLetterEvents', pipelines.dlq),
    runUnified<UEvent>(store, allMatch(), pipelines.critical),
  ])

  const offMap = new Map(off.map((o) => [o._id, o.s]))
  const customerStates: Record<string, number> = {}
  for (const c of onb) {
    const s = offMap.get(c._id) === 'COMPLETED' ? 'OFFBOARDED' : c.s
    customerStates[s] = (customerStates[s] ?? 0) + 1
  }
  const coll = Object.fromEntries(perColl.rows.map((r) => [r._id, r])) as Record<string, (typeof perColl.rows)[number]>
  const totalEvents = perColl.rows.reduce((a, r) => a + r.n, 0)
  const latW = perColl.rows.reduce((a, r) => a + (r.avgLatency ?? 0) * r.n, 0)
  const txBy = Object.fromEntries(tx.map((t) => [t._id, t]))
  const txTotal = tx.reduce((a, t) => a + t.n, 0)
  const settled = txBy.SETTLED?.n ?? 0
  const txTerminalFail = (txBy.REJECTED?.n ?? 0) + (txBy.FAILED?.n ?? 0)
  const dlqStates: Record<string, number> = {}
  const dlqCodes: Record<string, number> = {}
  for (const d of dlq) {
    dlqStates[d._id.s] = (dlqStates[d._id.s] ?? 0) + d.n
    dlqCodes[d._id.code] = (dlqCodes[d._id.code] ?? 0) + d.n
  }

  // Hourly throughput buckets (24) and minute buckets (60) — empty buckets filled with zero.
  const hours: Record<string, Record<string, number>> = {}
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now - i * 3600000)
    hours[`${d.toISOString().slice(0, 13)}:00:00Z`] = {}
  }
  for (const r of t24.rows) if (hours[r._id.h]) hours[r._id.h][r._id.c] = r.n
  const minutes: Record<string, number> = {}
  for (let i = 59; i >= 0; i--) minutes[`${new Date(now - i * 60000).toISOString().slice(0, 16)}:00Z`] = 0
  for (const r of t60.rows) if (r._id in minutes) minutes[r._id] = r.n

  const ntfByChannel: Record<string, { delivered: number; failed: number; inFlight: number; avgAttempts: number; avgLatency: number; n: number }> = {}
  for (const n of ntf) {
    const c = (ntfByChannel[n._id.ch] ??= { delivered: 0, failed: 0, inFlight: 0, avgAttempts: 0, avgLatency: 0, n: 0 })
    if (n._id.s === 'DELIVERED') c.delivered += n.n
    else if (n._id.s === 'FAILED' || n._id.s === 'DEAD_LETTERED') c.failed += n.n
    else c.inFlight += n.n
    c.avgAttempts = (c.avgAttempts * c.n + n.att * n.n) / (c.n + n.n)
    c.avgLatency = (c.avgLatency * c.n + n.lat * n.n) / (c.n + n.n)
    c.n += n.n
  }

  const data = {
    generatedAt: new Date().toISOString(),
    store: store.kind,
    kpis: {
      totalEvents,
      activeCustomers: customerStates.ACTIVATED ?? 0,
      totalCustomers: onb.length,
      completedOnboardings: funnel.find((f) => f._id === 'ACTIVATED')?.n ?? 0,
      transactions: txTotal,
      settledTransactions: settled,
      settledValueMinor: txBy.SETTLED?.value ?? 0,
      successRate: settled + txTerminalFail ? settled / (settled + txTerminalFail) : 0,
      failedEvents: perColl.rows.filter((r) => r._id !== 'deadLetterEvents').reduce((a, r) => a + r.failed, 0) + (coll.deadLetterEvents?.n ?? 0),
      openDlq: dlqStates.OPEN ?? 0,
      avgLatencyMs: totalEvents ? latW / totalEvents : 0,
    },
    collections: COLLECTIONS.map((c) => ({
      collection: c,
      topic: COLLECTION_TO_TOPIC[c],
      count: coll[c]?.n ?? 0,
      failed: coll[c]?.failed ?? 0,
      lastTs: coll[c]?.lastTs ?? null,
      lastIngested: coll[c]?.lastIngested ?? null,
      avgLatencyMs: coll[c]?.avgLatency ?? 0,
    })),
    throughput24h: Object.entries(hours).map(([h, v]) => ({ bucket: h, ...v })),
    throughput60m: Object.entries(minutes).map(([m, n]) => ({ bucket: m, n })),
    funnel: ['REQUESTED', 'VALIDATION_PENDING', 'KYC_VERIFIED', 'ELIGIBILITY_CONFIRMED', 'APPROVED', 'ACTIVATED'].map((s) => ({
      stage: s,
      customers: funnel.find((f) => f._id === s)?.n ?? 0,
    })),
    onboardingDropouts: { REJECTED: funnel.find((f) => f._id === 'REJECTED')?.n ?? 0, FAILED: funnel.find((f) => f._id === 'FAILED')?.n ?? 0 },
    customerStates,
    txStates: tx.map((t) => ({ state: t._id, count: t.n, valueMinor: t.value })).sort((a, b) => b.count - a.count),
    notifications: Object.entries(ntfByChannel).map(([channel, v]) => ({ channel, ...v })),
    dlqStates,
    dlqCodes: Object.entries(dlqCodes).map(([code, n]) => ({ code, n })).sort((a, b) => b.n - a.n),
    critical: critical.rows,
    pipelines: { unifiedThroughput: t24.pipeline, transactions: pipelines.transactions, customerState: pipelines.customerState },
  }
  gl.__deDash = { key, at: Date.now(), data }
  return data
}
export type Dashboard = Awaited<ReturnType<typeof getDashboard>>

/* ---------------- Live events ---------------- */

export type EventFilters = {
  topic?: string
  collection?: string
  status?: string
  customerId?: string
  transactionId?: string
  correlationId?: string
  deanId?: string
  eventType?: string
  sourceSystem?: string
  errorCode?: string
  from?: string
  to?: string
  amountMin?: number
  amountMax?: number
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const listOrOne = (v: string) => {
  const parts = v.split(',').map((s) => s.trim()).filter(Boolean)
  return parts.length > 1 ? { $in: parts } : parts[0]
}

export function buildMatches(f: EventFilters) {
  let colls: CollectionName[] = [...COLLECTIONS]
  if (f.collection) colls = colls.filter((c) => f.collection!.split(',').includes(c))
  if (f.topic) colls = colls.filter((c) => f.topic!.split(',').map((t) => TOPIC_TO_COLLECTION[t as Topic]).includes(c))
  if (f.errorCode) colls = colls.filter((c) => c === 'deadLetterEvents')
  if (f.amountMin !== undefined || f.amountMax !== undefined) colls = colls.filter((c) => c === 'deanAssignments')
  const m: Document = {}
  if (f.customerId) m.customerId = f.customerId.includes('*') ? { $regex: `^${esc(f.customerId.replace(/\*/g, ''))}` } : f.customerId
  if (f.transactionId) m.transactionId = f.transactionId
  if (f.correlationId) m.correlationId = f.correlationId
  if (f.deanId) m.deanId = f.deanId
  if (f.status) m.status = listOrOne(f.status)
  if (f.eventType) m.eventType = listOrOne(f.eventType)
  if (f.sourceSystem) m.sourceSystem = f.sourceSystem
  if (f.errorCode) m['payload.errorCode'] = listOrOne(f.errorCode)
  if (f.from || f.to) m.timestamp = { ...(f.from ? { $gte: new Date(f.from) } : {}), ...(f.to ? { $lte: new Date(f.to) } : {}) }
  if (f.amountMin !== undefined || f.amountMax !== undefined)
    m['payload.amountMinor'] = { ...(f.amountMin !== undefined ? { $gte: f.amountMin } : {}), ...(f.amountMax !== undefined ? { $lte: f.amountMax } : {}) }
  return Object.fromEntries(colls.map((c) => [c, m])) as Partial<Record<CollectionName, Document>>
}

export async function getEvents(f: EventFilters, limit = 100) {
  const store = await getStore()
  const { rows, pipeline, root } = await runUnified<UEvent>(store, buildMatches(f), [
    { $sort: { ingestedAt: -1, timestamp: -1 } },
    { $limit: Math.min(limit, 300) },
  ])
  return { events: rows, pipeline, root, version: store.version() }
}

/* ---------------- Unified audit search ---------------- */

export async function filterSearch(f: EventFilters, page = 1, pageSize = 25, sort: 'desc' | 'asc' = 'desc') {
  const store = await getStore()
  const size = Math.min(Math.max(pageSize, 1), 100)
  const { rows, pipeline, root } = await runUnified<{ total: { n: number }[]; results: UEvent[]; byCollection: { _id: string; n: number }[] }>(
    store,
    buildMatches(f),
    [
      {
        $facet: {
          total: [{ $count: 'n' }],
          byCollection: [{ $group: { _id: '$sourceCollection', n: { $sum: 1 } } }],
          results: [{ $sort: { timestamp: sort === 'asc' ? 1 : -1 } }, { $skip: (Math.max(page, 1) - 1) * size }, { $limit: size }],
        },
      },
    ],
  )
  const r = rows[0] ?? { total: [], results: [], byCollection: [] }
  return { total: r.total[0]?.n ?? 0, results: r.results, byCollection: r.byCollection, page, pageSize: size, pipeline, root }
}

const latestDoc: Pipeline = [{ $sort: { timestamp: 1 } }]

export async function specialSearch(id: string) {
  const store = await getStore()
  if (id === 'awaiting-approval') {
    const pipeline: Pipeline = [
      ...latestDoc,
      { $group: { _id: '$customerId', doc: { $last: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
      { $match: { status: { $in: ['VALIDATION_PENDING', 'KYC_VERIFIED', 'ELIGIBILITY_CONFIRMED'] } } },
      { $addFields: { sourceCollection: 'onboardingEvents' } },
      HIDE,
      { $sort: { timestamp: -1 } },
      { $limit: 100 },
    ]
    const results = await store.aggregate<UEvent>('onboardingEvents', pipeline)
    return { total: results.length, results, pipeline, root: 'onboardingEvents', note: 'Latest onboarding state per customer is pending approval (reconstructed with $group/$last).' }
  }
  if (id === 'tx-without-notification') {
    const pipeline: Pipeline = [
      { $match: { eventCategory: 'PAYMENT_TRANSACTION' } },
      ...latestDoc,
      { $group: { _id: '$transactionId', doc: { $last: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
      { $match: { status: 'SETTLED' } },
      { $lookup: { from: 'notificationEvents', localField: 'transactionId', foreignField: 'transactionId', as: 'ntf' } },
      { $match: { 'ntf.0': { $exists: true }, 'ntf.status': { $ne: 'DELIVERED' } } },
      { $addFields: { sourceCollection: 'deanAssignments', notificationStatuses: '$ntf.status' } },
      { $project: { ntf: 0, embedding: 0 } },
      { $sort: { timestamp: -1 } },
      { $limit: 100 },
    ]
    const results = await store.aggregate<UEvent>('deanAssignments', pipeline)
    return { total: results.length, results, pipeline, root: 'deanAssignments', note: 'Settled transactions joined ($lookup) to notificationEvents where no notification reached DELIVERED.' }
  }
  throw new Error('Unknown saved query')
}

/* ---------------- Customer 360 ---------------- */

export async function listCustomers(q?: string) {
  const store = await getStore()
  const match: Document = q ? { customerId: { $regex: `^${esc(q.toUpperCase())}` } } : {}
  return store.aggregate<{ _id: string; status: string; lastTs: Date; bank: string; events: number }>('onboardingEvents', [
    { $match: match },
    { $sort: { timestamp: 1 } },
    { $group: { _id: '$customerId', status: { $last: '$status' }, lastTs: { $last: '$timestamp' }, bank: { $first: '$payload.bank' }, events: { $sum: 1 } } },
    { $sort: { lastTs: -1 } },
    { $limit: 40 },
  ])
}

export async function getCustomer360(customerId: string) {
  const store = await getStore()
  const { rows, pipeline, root } = await runUnified<UEvent>(store, allMatch({ customerId }), [{ $sort: { timestamp: 1 } }, { $limit: 2000 }])
  if (!rows.length) return null
  const onb = rows.filter((r) => r.sourceCollection === 'onboardingEvents')
  const off = rows.filter((r) => r.sourceCollection === 'offboardingEvents')
  const dean = rows.filter((r) => r.eventCategory === 'DEAN_ASSIGNMENT')
  const txEv = rows.filter((r) => r.eventCategory === 'PAYMENT_TRANSACTION')
  const txLatest = new Map<string, UEvent>()
  for (const t of txEv) txLatest.set(t.transactionId!, t)
  const ntfLatest = new Map<string, UEvent>()
  for (const n of rows.filter((r) => r.sourceCollection === 'notificationEvents')) ntfLatest.set((n.payload as { notificationId: string }).notificationId, n)
  const dlq = rows.filter((r) => r.sourceCollection === 'deadLetterEvents')
  const offState = off.at(-1)?.status ?? null
  const participation = offState === 'COMPLETED' ? 'OFFBOARDED' : offState && offState !== 'CANCELLED' ? `OFFBOARDING:${offState}` : (onb.at(-1)?.status ?? 'UNKNOWN')
  const settled = [...txLatest.values()].filter((t) => t.status === 'SETTLED')
  const openIssues = [
    ...dlq.filter((d) => ['OPEN', 'INVESTIGATING', 'RETRY_PENDING'].includes(d.status)),
    ...[...ntfLatest.values()].filter((n) => n.status === 'FAILED' || n.status === 'DEAD_LETTERED'),
  ]
  const corrCounts: Record<string, Set<string>> = {}
  for (const r of rows) if (r.correlationId) (corrCounts[r.correlationId] ??= new Set()).add(r.sourceCollection)
  return {
    customerId,
    summary: {
      participation,
      onboardingState: onb.at(-1)?.status ?? null,
      offboardingState: offState,
      bank: (onb[0]?.payload as { bank?: string })?.bank ?? null,
      deanId: dean.filter((d) => d.status === 'ASSIGNED').at(-1)?.deanId ?? null,
      deanState: dean.at(-1)?.status ?? null,
      transactions: txLatest.size,
      settledTransactions: settled.length,
      settledValueMinor: settled.reduce((a, t) => a + ((t.payload as { amountMinor?: number }).amountMinor ?? 0), 0),
      notifications: ntfLatest.size,
      lastActivity: rows.at(-1)!.timestamp,
      openIssues: openIssues.length,
      countsByCollection: Object.fromEntries(COLLECTIONS.map((c) => [c, rows.filter((r) => r.sourceCollection === c).length])),
    },
    transactions: [...txLatest.values()].map((t) => ({ transactionId: t.transactionId, status: t.status, amountMinor: (t.payload as { amountMinor: number }).amountMinor, type: (t.payload as { transactionType: string }).transactionType, timestamp: t.timestamp })),
    correlations: Object.entries(corrCounts).map(([id, s]) => ({ correlationId: id, collections: [...s] })),
    openIssues: openIssues.map((i) => ({ eventId: i.eventId, sourceCollection: i.sourceCollection, status: i.status, description: i.description, dlqId: (i.payload as { dlqId?: string }).dlqId ?? null })),
    timeline: rows,
    pipeline,
    root,
  }
}

/* ---------------- Transactions ---------------- */

export async function listTransactions(q?: string, status?: string) {
  const store = await getStore()
  const m: Document = { eventCategory: 'PAYMENT_TRANSACTION' }
  if (q) m.transactionId = { $regex: `^${esc(q.toUpperCase())}` }
  const pipeline: Pipeline = [
    { $match: m },
    { $sort: { timestamp: 1 } },
    {
      $group: {
        _id: '$transactionId',
        status: { $last: '$status' },
        customerId: { $first: '$customerId' },
        deanId: { $first: '$deanId' },
        amountMinor: { $first: '$payload.amountMinor' },
        type: { $first: '$payload.transactionType' },
        firstTs: { $first: '$timestamp' },
        lastTs: { $last: '$timestamp' },
        transitions: { $sum: 1 },
      },
    },
    ...(status ? [{ $match: { status } }] : []),
    { $sort: { lastTs: -1 } },
    { $limit: 50 },
  ]
  return { rows: await store.aggregate<Record<string, unknown>>('deanAssignments', pipeline), pipeline }
}

export async function getTransaction(transactionId: string) {
  const store = await getStore()
  const pipeline: Pipeline = [
    { $match: { transactionId, eventCategory: 'PAYMENT_TRANSACTION' } },
    { $sort: { timestamp: 1 } },
    { $setWindowFields: { sortBy: { timestamp: 1 }, output: { nextStatus: { $shift: { output: '$status', by: 1 } } } } },
    { $addFields: { sourceCollection: 'deanAssignments' } },
    HIDE,
  ]
  const history = await store.aggregate<UEvent & { nextStatus: string | null }>('deanAssignments', pipeline)
  if (!history.length) return null
  const related = await runUnified<UEvent>(store, { notificationEvents: { transactionId }, deadLetterEvents: { transactionId } }, [{ $sort: { timestamp: 1 } }])
  const customerId = history[0].customerId!
  const onb = await store.aggregate<{ s: string }>('onboardingEvents', [
    { $match: { customerId } },
    { $sort: { timestamp: 1 } },
    { $group: { _id: null, s: { $last: '$status' } } },
  ])
  const last = history.at(-1)!
  const p = history[0].payload as { amountMinor: number; transactionType: string; destinationSystem: string; sourceSystem: string }
  const durations = history.map((h, i) => (i === 0 ? 0 : new Date(h.timestamp).getTime() - new Date(history[i - 1].timestamp).getTime()))
  return {
    transactionId,
    customerId,
    deanId: last.deanId,
    correlationId: last.correlationId,
    currentState: last.status,
    amountMinor: p.amountMinor,
    type: p.transactionType,
    sourceSystem: p.sourceSystem,
    destinationSystem: p.destinationSystem,
    failureReason: (last.payload as { failureReason?: string | null }).failureReason ?? null,
    customerOnboardingState: onb[0]?.s ?? null,
    totalDurationMs: new Date(last.timestamp).getTime() - new Date(history[0].timestamp).getTime(),
    history: history.map((h, i) => ({ ...h, sincePreviousMs: durations[i] })),
    notifications: related.rows.filter((r) => r.sourceCollection === 'notificationEvents'),
    errors: related.rows.filter((r) => r.sourceCollection === 'deadLetterEvents'),
    pipeline,
    relatedPipeline: related.pipeline,
  }
}
