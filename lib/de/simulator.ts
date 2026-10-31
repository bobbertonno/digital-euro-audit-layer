import 'server-only'
import type { EventDoc } from './domain'
import {
  clock,
  deanStep,
  malformedEvent,
  newCust,
  newNtf,
  newTx,
  notificationJourney,
  offboardingJourney,
  onboardingJourney,
  transactionJourney,
  type Cust,
  type Gen,
  type TxOutcome,
} from './generator'
import { createRng, liveRng } from './rng'
import { ingest, type IngestResult } from './ingest'
import { getIds, getStore } from './seed'

export const ACTIONS = [
  'single-event',
  'onboarding-journey',
  'offboarding-journey',
  'dean-assignment',
  'successful-transaction',
  'failed-transaction',
  'notification-failure',
  'dlq-error',
  'malformed-event',
  'duplicate-event',
  'complete-journey',
  'replay',
] as const
export type SimAction = (typeof ACTIONS)[number]

export type SimState = {
  state: 'RUNNING' | 'PAUSED' | 'STOPPED'
  rate: number
  failureRate: number
  seed: number | null
  startedAt: string | null
  lastTickAt: number
  generated: number
  ticks: number
  log: (IngestResult & { action: string; at: string })[]
}

const g = globalThis as unknown as { __deSim?: SimState; __deQueue?: EventDoc[] }

export function simState(): SimState {
  return (g.__deSim ??= { state: 'STOPPED', rate: 2, failureRate: 0.15, seed: null, startedAt: null, lastTickAt: 0, generated: 0, ticks: 0, log: [] })
}

const queue = () => (g.__deQueue ??= [])

function rngFor(s: SimState) {
  if (s.seed === null) return liveRng()
  const r = createRng(s.seed + s.generated)
  return r
}

async function gen(): Promise<Gen> {
  const s = simState()
  return { rng: rngFor(s), ids: await getIds(await getStore()), producer: 'event-simulator' }
}

/** Rescale a generated journey into a short live window ending at `end`, preserving order. */
function compress(events: EventDoc[], end: number, span: number) {
  if (!events.length) return events
  const ts = events.map((e) => e.timestamp.getTime())
  const min = Math.min(...ts)
  const max = Math.max(...ts)
  const f = max > min ? span / (max - min) : 0
  for (const e of events) {
    e.timestamp = new Date(end - span + (e.timestamp.getTime() - min) * f)
    e.audit.producedAt = new Date()
  }
  return events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
}

async function activeCustomer(withDean: boolean): Promise<{ cust: Cust; deanId: string | null } | null> {
  const store = await getStore()
  const pipeline = withDean
    ? [
        { $match: { eventCategory: 'DEAN_ASSIGNMENT', status: 'ASSIGNED', customerId: { $not: /^CUST-99/ } } },
        { $sort: { timestamp: -1 } },
        { $limit: 200 },
      ]
    : [
        { $match: { status: 'ACTIVATED', customerId: { $not: /^CUST-99/ } } },
        { $sort: { timestamp: -1 } },
        { $limit: 200 },
      ]
  const rows = await store.aggregate<EventDoc>(withDean ? 'deanAssignments' : 'onboardingEvents', pipeline)
  if (!rows.length) return null
  const ids = rows.map((r) => r.customerId)
  const off = await store.aggregate<{ _id: string }>('offboardingEvents', [{ $match: { customerId: { $in: ids } } }, { $group: { _id: '$customerId' } }])
  const offSet = new Set(off.map((o) => o._id))
  let candidates = rows.filter((r) => !offSet.has(r.customerId!))
  if (!withDean) {
    const deans = await store.aggregate<{ _id: string }>('deanAssignments', [
      { $match: { customerId: { $in: ids }, eventCategory: 'DEAN_ASSIGNMENT' } },
      { $group: { _id: '$customerId' } },
    ])
    const dSet = new Set(deans.map((d) => d._id))
    candidates = candidates.filter((r) => !dSet.has(r.customerId!))
  }
  if (!candidates.length) return null
  const r = candidates[Math.floor(Math.random() * Math.min(candidates.length, 50))]
  return {
    cust: { customerId: r.customerId!, bank: String(r.metadata.bank ?? ''), channel: 'MOBILE_APP', corr: r.correlationId! },
    deanId: r.deanId ?? null,
  }
}

function newActivated(G: Gen, out: EventDoc[]) {
  const c = newCust(G)
  const ck = clock(G, Date.now() - 60000)
  out.push(...onboardingJourney(G, ck, c, 'ACTIVATED', Infinity).ev)
  const deanId = G.ids.dean()
  out.push(deanStep(G, c, 'REQUESTED', 'ACTIVATED' === 'ACTIVATED' ? null : null, ck.step(1000, 3000), null))
  out.push(deanStep(G, c, 'ASSIGNED', 'REQUESTED', ck.step(300, 900), deanId))
  return { cust: c, deanId }
}

async function withDeanCustomer(G: Gen, out: EventDoc[]) {
  const existing = await activeCustomer(true)
  if (existing?.deanId) return { cust: existing.cust, deanId: existing.deanId }
  return newActivated(G, out)
}

function txEvents(G: Gen, cust: Cust, deanId: string, o: TxOutcome, out: EventDoc[], notify: 'ok' | 'fail' | 'random', failureRate: number) {
  const tx = newTx(G, cust, deanId)
  const ck = clock(G, Date.now() - 20000)
  const j = transactionJourney(G, ck, tx, o, Infinity)
  out.push(...j.ev)
  const last = j.ev.at(-1)!
  const type = j.final === 'SETTLED' || j.final === 'REVERSED' ? 'TRANSACTION_CONFIRMATION' : 'TRANSACTION_FAILURE'
  const outcome = notify === 'fail' ? 'FAILED' : notify === 'ok' ? 'DELIVERED' : G.rng.chance(failureRate / 2) ? 'FAILED' : 'DELIVERED'
  const n = notificationJourney(G, ck, newNtf(G, cust, type, last), outcome, Infinity)
  out.push(...n.ev)
  if (n.dlq) out.push(n.dlq)
  return tx.transactionId
}

/** Builds events for an action. Raw (possibly invalid) events are fine: the ingest pipeline routes them to the DLQ. */
export async function buildAction(action: SimAction, failureRate: number): Promise<{ events: unknown[]; focus: Record<string, string | null> }> {
  const G = await gen()
  const out: EventDoc[] = []
  const now = Date.now()
  const fail = () => G.rng.chance(failureRate)
  switch (action) {
    case 'single-event': {
      const c = newCust(G)
      const ev = onboardingJourney(G, clock(G, now), c, 'PARTIAL', Infinity).ev.slice(0, 1)
      return { events: ev, focus: { customerId: c.customerId } }
    }
    case 'onboarding-journey': {
      const c = newCust(G)
      const r = G.rng.next()
      const outcome = r < failureRate * 0.6 ? 'REJECTED' : r < failureRate ? 'FAILED' : 'ACTIVATED'
      const ck = clock(G, now - 60000)
      const j = onboardingJourney(G, ck, c, outcome, Infinity)
      out.push(...j.ev)
      const n = notificationJourney(G, ck, newNtf(G, c, outcome === 'ACTIVATED' ? 'ONBOARDING_CONFIRMATION' : 'ONBOARDING_REJECTION', j.ev.at(-1)!), 'DELIVERED', Infinity)
      out.push(...n.ev)
      return { events: compress(out, now, 15000), focus: { customerId: c.customerId } }
    }
    case 'dean-assignment': {
      const target = (await activeCustomer(false)) ?? null
      let cust: Cust
      if (target) cust = target.cust
      else {
        cust = newCust(G)
        out.push(...onboardingJourney(G, clock(G, now - 60000), cust, 'ACTIVATED', Infinity).ev)
      }
      const ck = clock(G, now - 4000)
      out.push(deanStep(G, cust, 'REQUESTED', null, ck.t, null))
      if (fail()) out.push(deanStep(G, cust, 'FAILED', 'REQUESTED', ck.step(300, 900), null, 'DEAN registry unavailable'))
      else {
        const a = deanStep(G, cust, 'ASSIGNED', 'REQUESTED', ck.step(300, 900), G.ids.dean())
        out.push(a)
        out.push(...notificationJourney(G, ck, newNtf(G, cust, 'DEAN_ASSIGNMENT_CONFIRMATION', a), 'DELIVERED', Infinity).ev)
      }
      return { events: compress(out, now, 8000), focus: { customerId: cust.customerId } }
    }
    case 'successful-transaction':
    case 'failed-transaction':
    case 'notification-failure': {
      const { cust, deanId } = await withDeanCustomer(G, out)
      const o: TxOutcome = action === 'failed-transaction' ? G.rng.pick(['REJECTED', 'FAILED_EARLY', 'FAILED_LATE'] as const) : 'SETTLED'
      const before = out.length
      const txId = txEvents(G, cust, deanId, o, out, action === 'notification-failure' ? 'fail' : 'ok', failureRate)
      compress(out.slice(before), now, 10000)
      return { events: out, focus: { customerId: cust.customerId, transactionId: txId } }
    }
    case 'offboarding-journey': {
      const target = await activeCustomer(true)
      if (!target) return { events: [], focus: {} }
      const r = G.rng.next()
      const balance = r < failureRate ? G.rng.int(1000, 50000) : 0
      const outcome = balance ? 'BLOCKED' : r < failureRate * 1.5 ? 'FAILED' : 'COMPLETED'
      const ck = clock(G, now - 60000)
      const j = offboardingJourney(G, ck, { cust: target.cust, corr: G.ids.corr(), initiatedBy: G.rng.chance(0.7) ? 'CUSTOMER' : 'BANK', balanceMinor: balance }, outcome, Infinity)
      out.push(...j.ev)
      if (outcome === 'COMPLETED') out.push(...notificationJourney(G, ck, newNtf(G, target.cust, 'OFFBOARDING_CONFIRMATION', j.ev.at(-1)!), 'DELIVERED', Infinity).ev)
      return { events: compress(out, now, 12000), focus: { customerId: target.cust.customerId } }
    }
    case 'dlq-error':
    case 'malformed-event': {
      const c = newCust(G)
      const kind = action === 'malformed-event' ? G.rng.pick(['INVALID_SCHEMA', 'MISSING_MANDATORY_FIELD'] as const) : G.rng.pick(['INVALID_SCHEMA', 'MISSING_MANDATORY_FIELD', 'UNSUPPORTED_EVENT_TYPE'] as const)
      return { events: [malformedEvent(G, kind, c, now)], focus: { customerId: c.customerId } }
    }
    case 'duplicate-event':
    case 'replay': {
      const store = await getStore()
      const recent = await store.aggregate<EventDoc>('deanAssignments', [
        { $match: { eventCategory: 'PAYMENT_TRANSACTION' } },
        { $sort: { ingestedAt: -1 } },
        { $limit: action === 'replay' ? 5 : 1 },
        { $project: { _id: 0, embedding: 0 } },
      ])
      const replay = recent.map((e) => ({ ...e, metadata: { ...e.metadata, replayed: true } }))
      return { events: replay, focus: { transactionId: recent[0]?.transactionId ?? null } }
    }
    case 'complete-journey': {
      const { cust, deanId } = newActivated(G, out)
      const ck = clock(G, now)
      out.push(...notificationJourney(G, ck, newNtf(G, cust, 'ONBOARDING_CONFIRMATION', out[5]), 'DELIVERED', Infinity).ev)
      const n = G.rng.int(2, 3)
      for (let i = 0; i < n; i++) txEvents(G, cust, deanId, fail() ? 'FAILED_LATE' : 'SETTLED', out, 'random', failureRate)
      return { events: compress(out, now, 25000), focus: { customerId: cust.customerId } }
    }
  }
}

export async function runAction(action: SimAction) {
  const s = simState()
  const store = await getStore()
  const { events, focus } = await buildAction(action, s.failureRate)
  const results = events.length ? await ingest(events, { gen: await gen(), store }) : []
  s.generated += results.length
  record(action, results)
  return { action, focus, results }
}

function record(action: string, results: IngestResult[]) {
  const s = simState()
  const at = new Date().toISOString()
  s.log = [...results.map((r) => ({ ...r, action, at })).reverse(), ...s.log].slice(0, 150)
}

/** Request-triggered streaming: generate journeys at the configured rate and release due events. */
export async function tick() {
  const s = simState()
  if (s.state !== 'RUNNING') return { released: 0, results: [] as IngestResult[] }
  const now = Date.now()
  const elapsed = Math.min(now - (s.lastTickAt || now - 1000), 5000)
  if (elapsed < 700) return { released: 0, results: [] as IngestResult[] }
  s.lastTickAt = now
  s.ticks++
  const q = queue()
  // Start roughly (rate × elapsed) events' worth of new journeys; each journey streams over ~10–30s.
  let budget = (s.rate * elapsed) / 1000 - q.length / 15
  const G = await gen()
  while (budget > 0) {
    const r = G.rng.next()
    const action: SimAction =
      r < 0.25 ? 'onboarding-journey' : r < 0.35 ? 'dean-assignment' : r < 0.85 ? 'successful-transaction' : r < 0.92 ? 'failed-transaction' : r < 0.96 ? 'offboarding-journey' : 'malformed-event'
    const effective: SimAction = action === 'successful-transaction' && G.rng.chance(s.failureRate) ? 'failed-transaction' : action
    const { events } = await buildAction(effective, s.failureRate)
    const evs = events as EventDoc[]
    const span = G.rng.int(8000, 30000)
    const ts = evs.map((e) => (e.timestamp instanceof Date ? e.timestamp.getTime() : now))
    const min = Math.min(...ts)
    const max = Math.max(...ts)
    for (const [i, e] of evs.entries()) {
      const at = now + (max > min ? ((ts[i] - min) / (max - min)) * span : 0)
      if (e.timestamp instanceof Date) e.timestamp = new Date(at)
      ;(e as EventDoc & { __due?: number }).__due = at
    }
    q.push(...evs)
    budget -= Math.max(evs.length, 1)
  }
  q.sort((a, b) => ((a as { __due?: number }).__due ?? 0) - ((b as { __due?: number }).__due ?? 0))
  const due: EventDoc[] = []
  while (q.length && ((q[0] as { __due?: number }).__due ?? 0) <= now) {
    const e = q.shift()!
    delete (e as { __due?: number }).__due
    if (e.audit) e.audit.producedAt = new Date()
    due.push(e)
  }
  const results = due.length ? await ingest(due, { gen: G, store: await getStore() }) : []
  s.generated += results.length
  record('stream', results)
  return { released: results.length, results, queued: q.length }
}

export function control(cmd: 'start' | 'pause' | 'stop', opts: { rate?: number; failureRate?: number; seed?: number | null }) {
  const s = simState()
  if (opts.rate !== undefined) s.rate = Math.min(Math.max(opts.rate, 0.2), 20)
  if (opts.failureRate !== undefined) s.failureRate = Math.min(Math.max(opts.failureRate, 0), 0.9)
  if (opts.seed !== undefined) s.seed = opts.seed
  if (cmd === 'start') {
    if (s.state !== 'RUNNING') s.lastTickAt = Date.now()
    s.state = 'RUNNING'
    s.startedAt ??= new Date().toISOString()
  } else if (cmd === 'pause') s.state = 'PAUSED'
  else {
    s.state = 'STOPPED'
    s.startedAt = null
    g.__deQueue = []
  }
  return s
}

export function configure(opts: { rate?: number; failureRate?: number; seed?: number | null }) {
  const s = simState()
  if (opts.rate !== undefined) s.rate = Math.min(Math.max(opts.rate, 0.2), 20)
  if (opts.failureRate !== undefined) s.failureRate = Math.min(Math.max(opts.failureRate, 0), 0.9)
  if (opts.seed !== undefined) s.seed = opts.seed
  return s
}

export function resetSimulator() {
  g.__deSim = undefined
  g.__deQueue = []
}

export const queueLength = () => queue().length
