import {
  BANKS,
  CHANNELS,
  DEAN_EVENT_TYPE,
  DESTINATION_SYSTEMS,
  DLQ_CLASSIFICATION,
  NOTIFICATION_ERRORS,
  OFFBOARDING_BLOCK_REASONS,
  OFFBOARDING_EVENT_TYPE,
  ONBOARDING_CHANNELS,
  ONBOARDING_EVENT_TYPE,
  ONBOARDING_REJECTION_REASONS,
  SOURCE_SYSTEMS,
  TX_FAILURE_REASONS,
  TX_TYPES,
  type DlqErrorCode,
  type EventDoc,
  type Topic,
} from './domain'
import { pad, type Rng } from './rng'

export const YEAR = 2026

export class Ids {
  c: Record<'cust' | 'corr' | 'tx' | 'dean' | 'ntf' | 'dlq', number>
  constructor(start?: Partial<Ids['c']>) {
    this.c = { cust: 0, corr: 0, tx: 0, dean: 0, ntf: 0, dlq: 0, ...start }
  }
  customer = () => `CUST-${pad(++this.c.cust)}`
  corr = () => `CORR-${pad(++this.c.corr)}`
  tx = () => `TX-${YEAR}-${pad(++this.c.tx)}`
  dean = () => `DEAN-${pad(++this.c.dean)}`
  ntf = () => `NTF-${pad(++this.c.ntf)}`
  dlq = () => `DLQ-${pad(++this.c.dlq)}`
}

export type Gen = { rng: Rng; ids: Ids; producer: string }

export type Cust = { customerId: string; bank: string; channel: string; corr: string }
export type TxCtx = {
  cust: Cust
  transactionId: string
  corr: string
  deanId: string
  type: string
  amountMinor: number
  destination: string
}
export type NtfCtx = {
  cust: Cust
  notificationId: string
  type: string
  channel: string
  corr: string
  transactionId: string | null
  deanId: string | null
  originatingEventId: string
  maskedDestination: string
}

const label = (s: string) => s.toLowerCase().replace(/_/g, ' ')
export const eur = (minor: number) => `EUR ${(minor / 100).toFixed(2)}`

type BaseArgs = {
  topic: Topic
  eventType: string
  status: string
  previousStatus: string | null
  customerId: string | null
  correlationId: string | null
  transactionId?: string | null
  deanId?: string | null
  ts: number
  source: string
  semantic: string
  refs?: string
  metadata?: Record<string, unknown>
  payload: Record<string, unknown>
  eventCategory?: 'DEAN_ASSIGNMENT' | 'PAYMENT_TRANSACTION'
}

function base(g: Gen, a: BaseArgs): EventDoc {
  const refs = [a.customerId, a.transactionId, a.deanId, a.refs].filter(Boolean).join(' · ')
  const doc: EventDoc = {
    eventId: g.rng.uuid(),
    eventType: a.eventType,
    topic: a.topic,
    eventVersion: 1,
    customerId: a.customerId,
    correlationId: a.correlationId,
    transactionId: a.transactionId ?? null,
    deanId: a.deanId ?? null,
    timestamp: new Date(a.ts),
    sourceSystem: a.source,
    status: a.status,
    previousStatus: a.previousStatus,
    description: refs ? `${a.semantic} [${refs}]` : a.semantic,
    semanticText: a.semantic,
    metadata: { region: 'IT', environment: 'DEMO', ...a.metadata },
    payload: a.payload,
    audit: {
      producer: g.producer,
      schemaVersion: '1.0',
      traceId: g.rng.uuid().replace(/-/g, ''),
      processingResult: 'SUCCESS',
      producedAt: new Date(),
    },
  }
  if (a.eventCategory) doc.eventCategory = a.eventCategory
  return doc
}

/* ---------------- Onboarding ---------------- */

const ONB_SEMANTIC: Record<string, (c: Cust, r?: string) => string> = {
  REQUESTED: (c) => `Customer submitted Digital Euro enrollment request via ${label(c.channel)}`,
  VALIDATION_PENDING: () => 'Customer identity verification started',
  KYC_VERIFIED: () => 'KYC verification completed successfully',
  ELIGIBILITY_CONFIRMED: () => 'Customer eligibility for Digital Euro participation confirmed',
  APPROVED: () => 'Digital Euro participation approved by intermediary',
  ACTIVATED: () => 'Digital Euro wallet activated and ready for use',
  REJECTED: (_c, r) => `Customer onboarding rejected: ${r}`,
  FAILED: (_c, r) => `Digital Euro onboarding failed: ${r}`,
  SUSPENDED: () => 'Digital Euro participation suspended pending compliance review',
}

export function onboardingStep(g: Gen, c: Cust, status: string, prev: string | null, ts: number, reason?: string): EventDoc {
  return base(g, {
    topic: 'onboarding-events',
    eventType: ONBOARDING_EVENT_TYPE[status],
    status,
    previousStatus: prev,
    customerId: c.customerId,
    correlationId: c.corr,
    ts,
    source: SOURCE_SYSTEMS.onboarding,
    semantic: ONB_SEMANTIC[status](c, reason),
    metadata: { bank: c.bank, channel: c.channel },
    payload: {
      channel: c.channel,
      bank: c.bank,
      requestSource: c.channel === 'BRANCH' ? 'BRANCH_OPERATOR' : 'CUSTOMER_SELF_SERVICE',
      validationOutcome:
        status === 'KYC_VERIFIED' || status === 'ELIGIBILITY_CONFIRMED'
          ? 'PASSED'
          : status === 'REJECTED' || status === 'FAILED'
            ? 'FAILED'
            : null,
      transitionReason: reason ?? `transition to ${status}`,
      processingDurationMs: g.rng.int(40, 2400),
    },
  })
}

/* ---------------- DEAN assignment ---------------- */

const DEAN_FAIL = ['DEAN registry unavailable', 'conflicting DEAN reservation detected', 'DEAN assignment error: wallet not in ACTIVATED state']

export function deanStep(g: Gen, c: Cust, status: string, prev: string | null, ts: number, deanId: string | null, reason?: string) {
  const semantic =
    status === 'REQUESTED'
      ? 'DEAN assignment requested for Digital Euro wallet'
      : status === 'ASSIGNED'
        ? 'DEAN identifier assigned to customer Digital Euro wallet'
        : `DEAN assignment error: ${reason}`
  return base(g, {
    topic: 'dean-assignment',
    eventType: DEAN_EVENT_TYPE[status],
    status,
    previousStatus: prev,
    customerId: c.customerId,
    correlationId: c.corr,
    deanId,
    ts,
    source: SOURCE_SYSTEMS.dean,
    semantic,
    eventCategory: 'DEAN_ASSIGNMENT',
    metadata: { bank: c.bank },
    payload: { processingDurationMs: g.rng.int(30, 900), failureReason: status === 'FAILED' ? reason : null },
  })
}

/* ---------------- Transactions ---------------- */

export function txSemantic(t: TxCtx, status: string, prev: string | null, reason?: string) {
  switch (status) {
    case 'INITIATED':
      return `Digital Euro ${label(t.type)} transaction initiated`
    case 'VALIDATED':
      return 'Transaction validated against holding and transaction limits'
    case 'AUTHORIZED':
      return 'Transaction authorized by payer intermediary'
    case 'PROCESSING':
      return 'Transaction submitted for settlement processing'
    case 'SETTLED':
      return 'Transaction settled successfully in Digital Euro settlement engine'
    case 'REJECTED':
      return `Transaction rejected after validation: ${reason}`
    case 'FAILED':
      return prev === 'AUTHORIZED' || prev === 'PROCESSING'
        ? `Transaction failed after authorization: ${reason}`
        : `Transaction failed during validation: ${reason}`
    case 'REVERSED':
      return 'Settled transaction reversed following customer dispute'
  }
  return `Transaction state ${status}`
}

export function txStep(g: Gen, t: TxCtx, status: string, prev: string | null, ts: number, reason?: string) {
  return base(g, {
    topic: 'dean-assignment',
    eventType: `TRANSACTION_${status}`,
    status,
    previousStatus: prev,
    customerId: t.cust.customerId,
    correlationId: t.corr,
    transactionId: t.transactionId,
    deanId: t.deanId,
    ts,
    source: SOURCE_SYSTEMS.tx,
    semantic: txSemantic(t, status, prev, reason),
    refs: eur(t.amountMinor),
    eventCategory: 'PAYMENT_TRANSACTION',
    metadata: { bank: t.cust.bank },
    payload: {
      transactionType: t.type,
      amountMinor: t.amountMinor,
      currency: 'EUR',
      sourceSystem: SOURCE_SYSTEMS.tx,
      destinationSystem: t.destination,
      processingDurationMs: g.rng.int(120, 2600),
      failureReason: status === 'REJECTED' || status === 'FAILED' ? (reason ?? null) : null,
    },
  })
}

export function newTx(g: Gen, cust: Cust, deanId: string): TxCtx {
  const type = g.rng.pick(TX_TYPES)
  const amountMinor =
    type === 'POS_PAYMENT' ? g.rng.int(150, 12000) : type === 'FUNDING' ? g.rng.int(5000, 300000) : g.rng.int(500, 85000)
  return {
    cust,
    transactionId: g.ids.tx(),
    corr: g.ids.corr(),
    deanId,
    type,
    amountMinor,
    destination: g.rng.pick(DESTINATION_SYSTEMS),
  }
}

/* ---------------- Notifications ---------------- */

function maskDestination(g: Gen, channel: string) {
  if (channel === 'EMAIL') return `c***${g.rng.int(10, 99)}@example.invalid`
  if (channel === 'SMS') return `+39 3** *** **${g.rng.int(10, 99)}`
  if (channel === 'PUSH') return `device •••• ${g.rng.int(4096, 65535).toString(16).toUpperCase()}`
  return 'ops-console'
}

export function newNtf(
  g: Gen,
  cust: Cust,
  type: string,
  origin: EventDoc,
  channel?: string,
): NtfCtx {
  const ch = channel ?? (type === 'OPERATIONAL_ALERT' ? 'INTERNAL_EVENT' : g.rng.pick(CHANNELS.slice(0, 3)))
  return {
    cust,
    notificationId: g.ids.ntf(),
    type,
    channel: ch,
    corr: origin.correlationId ?? cust.corr,
    transactionId: origin.transactionId,
    deanId: origin.deanId,
    originatingEventId: origin.eventId,
    maskedDestination: maskDestination(g, ch),
  }
}

export function ntfSemantic(n: NtfCtx, status: string, err?: string | null) {
  const t = label(n.type)
  const ch = label(n.channel)
  switch (status) {
    case 'CREATED':
      return `${t[0].toUpperCase()}${t.slice(1)} notification created for ${ch} channel`
    case 'QUEUED':
      return `Notification queued for delivery via ${ch}`
    case 'DISPATCHED':
      return `Notification dispatched to ${ch} provider`
    case 'DELIVERED':
      return `Notification delivered to customer via ${ch}`
    case 'RETRY_PENDING':
      return `Notification delivery failed, retry scheduled: ${err}`
    case 'FAILED':
      return `Notification delivery failed via ${ch}: ${err}`
    case 'DEAD_LETTERED':
      return 'Notification routed to dead letter queue after exhausting delivery retries'
  }
  return `Notification ${status}`
}

export function ntfStep(
  g: Gen,
  n: NtfCtx,
  status: string,
  prev: string | null,
  ts: number,
  attempts: number,
  err: string | null = null,
  extraMeta?: Record<string, unknown>,
) {
  return base(g, {
    topic: 'notification-outbound',
    eventType: `NOTIFICATION_${status}`,
    status,
    previousStatus: prev,
    customerId: n.cust.customerId,
    correlationId: n.corr,
    transactionId: n.transactionId,
    deanId: n.deanId,
    ts,
    source: SOURCE_SYSTEMS.notification,
    semantic: ntfSemantic(n, status, err),
    refs: n.notificationId,
    metadata: { bank: n.cust.bank, ...extraMeta },
    payload: {
      notificationId: n.notificationId,
      notificationType: n.type,
      channel: n.channel,
      originatingEventId: n.originatingEventId,
      attempts,
      maskedDestination: n.maskedDestination,
      lastError: err,
      processingLatencyMs: g.rng.int(40, status === 'DELIVERED' ? 3200 : 9000),
    },
  })
}

/* ---------------- Offboarding ---------------- */

export type OffCtx = { cust: Cust; corr: string; initiatedBy: 'CUSTOMER' | 'BANK'; balanceMinor: number }

const OFF_SEMANTIC: Record<string, (o: OffCtx, r?: string) => string> = {
  OFFBOARDING_REQUESTED: (o) =>
    o.initiatedBy === 'CUSTOMER' ? 'Customer-initiated Digital Euro offboarding requested' : 'Bank-initiated Digital Euro offboarding requested',
  VALIDATION_PENDING: () => 'Offboarding validation started',
  BALANCE_CHECK_COMPLETED: () => 'Wallet balance check completed, no outstanding balance',
  WALLET_CLOSURE_PENDING: () => 'Digital Euro wallet closure pending at intermediary',
  COMPLETED: () => 'Digital Euro wallet closed and offboarding completed',
  BLOCKED: (_o, r) => `Offboarding blocked: ${r}`,
  FAILED: (_o, r) => `Offboarding validation failure: ${r}`,
  CANCELLED: () => 'Offboarding request cancelled by customer',
}

export function offStep(g: Gen, o: OffCtx, status: string, prev: string | null, ts: number, reason?: string) {
  return base(g, {
    topic: 'offboarding-events',
    eventType: OFFBOARDING_EVENT_TYPE[status],
    status,
    previousStatus: prev,
    customerId: o.cust.customerId,
    correlationId: o.corr,
    ts,
    source: SOURCE_SYSTEMS.offboarding,
    semantic: OFF_SEMANTIC[status](o, reason),
    metadata: { bank: o.cust.bank },
    payload: {
      initiatedBy: o.initiatedBy,
      bank: o.cust.bank,
      transitionReason: reason ?? `transition to ${status}`,
      outstandingBalanceMinor: o.balanceMinor,
      processingDurationMs: g.rng.int(60, 3000),
    },
  })
}

/* ---------------- Dead letter ---------------- */

export const DLQ_MESSAGES: Record<DlqErrorCode, string[]> = {
  INVALID_SCHEMA: ['field "eventVersion" has invalid type', 'status value must be upper-case enum', 'timestamp is not a valid BSON date'],
  MISSING_MANDATORY_FIELD: ['missing mandatory field "correlationId"', 'missing mandatory field "eventId"'],
  UNSUPPORTED_EVENT_TYPE: ['unsupported event type "WALLET_UPGRADE_REQUESTED"', 'unsupported event type "LEGACY_SEPA_SYNC"'],
  INVALID_STATE_TRANSITION: ['invalid state transition REJECTED -> SETTLED', 'invalid state transition REQUESTED -> ACTIVATED'],
  DUPLICATE_EVENT: ['duplicate event detected for eventId; original already persisted'],
  NOTIFICATION_DELIVERY_FAILED: NOTIFICATION_ERRORS,
  PROCESSING_TIMEOUT: ['transaction settlement timeout after 30s', 'simulated processing timeout in settlement consumer'],
  DOWNSTREAM_UNAVAILABLE: ['simulated downstream service unavailable: settlement engine', 'DEAN registry service unavailable (HTTP 503)'],
}

export type DlqArgs = {
  errorCode: DlqErrorCode
  errorMessage: string
  original: unknown
  originalEventId: string | null
  originalTopic: string | null
  customerId: string | null
  correlationId: string | null
  transactionId?: string | null
  deanId?: string | null
  ts: number
  status?: string
  retryHistory?: Record<string, unknown>[]
  repairHint?: string | null
}

export function sanitize(v: unknown, depth = 0): unknown {
  if (depth > 5) return '[truncated]'
  if (v instanceof Date) return v
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => sanitize(x, depth + 1))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v)) {
      if (k === 'embedding' || k === '_id') continue
      if (/destination|email|phone/i.test(k) && typeof val === 'string' && !val.includes('*')) out[k] = '***masked***'
      else out[k] = sanitize(val, depth + 1)
    }
    return out
  }
  if (typeof v === 'string' && v.length > 500) return v.slice(0, 500) + '…'
  return v
}

export function dlqEntry(g: Gen, a: DlqArgs, bank?: string): EventDoc {
  const status = a.status ?? 'OPEN'
  const semantic = `${label(a.errorCode)}: ${a.errorMessage}`
  const doc = base(g, {
    topic: 'error-dead-letter',
    eventType: 'DEAD_LETTER_RECORDED',
    status,
    previousStatus: null,
    customerId: a.customerId,
    correlationId: a.correlationId,
    transactionId: a.transactionId ?? null,
    deanId: a.deanId ?? null,
    ts: a.ts,
    source: SOURCE_SYSTEMS.dlq,
    semantic: semantic[0].toUpperCase() + semantic.slice(1),
    metadata: { bank: bank ?? null },
    payload: {
      dlqId: g.ids.dlq(),
      originalEventId: a.originalEventId,
      originalTopic: a.originalTopic,
      errorCode: a.errorCode,
      errorMessage: a.errorMessage,
      failureClassification: DLQ_CLASSIFICATION[a.errorCode],
      failedAt: new Date(a.ts),
      retryCount: a.retryHistory?.length ?? 0,
      lastRetryAt: (a.retryHistory?.at(-1)?.at as Date | undefined) ?? null,
      retryHistory: a.retryHistory ?? [],
      sanitizedPayload: sanitize(a.original),
      repairHint: a.repairHint ?? null,
    },
  })
  doc.audit.processingResult = a.errorCode === 'DUPLICATE_EVENT' ? 'DUPLICATE' : 'FAILED'
  return doc
}

/* ---------------- Composite journeys ---------------- */

export type Clock = { t: number; step: (min: number, max: number) => number }
export const clock = (g: Gen, t: number): Clock => {
  const c: Clock = {
    t,
    step: (min, max) => {
      c.t += g.rng.int(min, max)
      return c.t
    },
  }
  return c
}

export function newCust(g: Gen, customerId?: string, corr?: string): Cust {
  return {
    customerId: customerId ?? g.ids.customer(),
    bank: g.rng.pick(BANKS),
    channel: g.rng.pick(ONBOARDING_CHANNELS),
    corr: corr ?? g.ids.corr(),
  }
}

/** Notification with lifecycle outcome. Returns events + optional DLQ entry. */
export function notificationJourney(
  g: Gen,
  ck: Clock,
  n: NtfCtx,
  outcome: 'DELIVERED' | 'RETRY_DELIVERED' | 'FAILED' | 'FAILED_RECOVERED',
  until: number,
) {
  const ev: EventDoc[] = []
  let dlq: EventDoc | null = null
  let prev: string | null = null
  const push = (s: string, attempts: number, err: string | null = null, meta?: Record<string, unknown>) => {
    if (ck.t > until) return false
    ev.push(ntfStep(g, n, s, prev, ck.t, attempts, err, meta))
    prev = s
    return true
  }
  ck.step(400, 4000)
  if (!push('CREATED', 0)) return { ev, dlq }
  ck.step(50, 900)
  if (!push('QUEUED', 0)) return { ev, dlq }
  ck.step(50, 1500)
  if (!push('DISPATCHED', 1)) return { ev, dlq }
  const err = g.rng.pick(NOTIFICATION_ERRORS)
  if (outcome === 'DELIVERED') {
    ck.step(300, 4000)
    push('DELIVERED', 1)
  } else if (outcome === 'RETRY_DELIVERED') {
    ck.step(1000, 5000)
    if (!push('RETRY_PENDING', 1, err)) return { ev, dlq }
    ck.step(30000, 120000)
    if (!push('DISPATCHED', 2, err)) return { ev, dlq }
    ck.step(300, 4000)
    push('DELIVERED', 2, err)
  } else {
    ck.step(1000, 5000)
    if (!push('RETRY_PENDING', 1, err)) return { ev, dlq }
    ck.step(30000, 90000)
    if (!push('DISPATCHED', 2, err)) return { ev, dlq }
    ck.step(1000, 5000)
    if (!push('FAILED', 2, err)) return { ev, dlq }
    ck.step(100, 900)
    if (!push('DEAD_LETTERED', 3, err)) return { ev, dlq }
    const deadLettered = ev.at(-1)!
    const retryHistory: Record<string, unknown>[] = []
    let status = 'OPEN'
    if (outcome === 'FAILED_RECOVERED') {
      const retryAt = ck.t + g.rng.int(600000, 7200000)
      if (retryAt < until) {
        ck.t = retryAt
        push('DISPATCHED', 4, err, { recoveredFromDlq: true })
        ck.step(300, 3000)
        push('DELIVERED', 4, err, { recoveredFromDlq: true })
        retryHistory.push({
          attempt: 1,
          at: new Date(retryAt),
          operator: 'ops.demo',
          result: 'SUCCESS',
          recoveredEventId: ev.at(-1)!.eventId,
          note: 'Notification re-dispatched and delivered',
        })
        status = 'REPROCESSED'
      }
    }
    dlq = dlqEntry(
      g,
      {
        errorCode: 'NOTIFICATION_DELIVERY_FAILED',
        errorMessage: err,
        original: deadLettered,
        originalEventId: deadLettered.eventId,
        originalTopic: 'notification-outbound',
        customerId: n.cust.customerId,
        correlationId: n.corr,
        transactionId: n.transactionId,
        deanId: n.deanId,
        ts: deadLettered.timestamp.getTime() + 50,
        status,
        retryHistory,
      },
      n.cust.bank,
    )
  }
  return { ev, dlq }
}

export type TxOutcome = 'SETTLED' | 'REJECTED' | 'FAILED_EARLY' | 'FAILED_LATE' | 'REVERSED'

export function transactionJourney(g: Gen, ck: Clock, t: TxCtx, outcome: TxOutcome, until: number) {
  const ev: EventDoc[] = []
  let prev: string | null = null
  const push = (s: string, reason?: string) => {
    if (ck.t > until) return false
    ev.push(txStep(g, t, s, prev, ck.t, reason))
    prev = s
    return true
  }
  const path =
    outcome === 'REJECTED'
      ? g.rng.chance(0.5)
        ? ['INITIATED', 'REJECTED']
        : ['INITIATED', 'VALIDATED', 'REJECTED']
      : outcome === 'FAILED_EARLY'
        ? ['INITIATED', 'FAILED']
        : outcome === 'FAILED_LATE'
          ? g.rng.chance(0.5)
            ? ['INITIATED', 'VALIDATED', 'AUTHORIZED', 'FAILED']
            : ['INITIATED', 'VALIDATED', 'AUTHORIZED', 'PROCESSING', 'FAILED']
          : outcome === 'REVERSED'
            ? ['INITIATED', 'VALIDATED', 'AUTHORIZED', 'PROCESSING', 'SETTLED', 'REVERSED']
            : ['INITIATED', 'VALIDATED', 'AUTHORIZED', 'PROCESSING', 'SETTLED']
  const failReason =
    outcome === 'REJECTED'
      ? g.rng.pick(TX_FAILURE_REASONS.REJECTED)
      : outcome === 'FAILED_EARLY'
        ? g.rng.pick(TX_FAILURE_REASONS.FAILED_EARLY)
        : g.rng.pick(TX_FAILURE_REASONS.FAILED_LATE)
  for (const [i, s] of path.entries()) {
    if (i > 0) ck.step(s === 'REVERSED' ? 3600000 : 300, s === 'REVERSED' ? 86400000 : 2500)
    if (!push(s, s === 'REJECTED' || s === 'FAILED' ? failReason : undefined)) break
  }
  return { ev, final: prev, failReason }
}

export function onboardingJourney(
  g: Gen,
  ck: Clock,
  c: Cust,
  outcome: 'ACTIVATED' | 'REJECTED' | 'FAILED' | 'PARTIAL',
  until: number,
) {
  const ev: EventDoc[] = []
  let prev: string | null = null
  const stopIdx = outcome === 'PARTIAL' ? g.rng.int(1, 4) : 6
  const failIdx = outcome === 'REJECTED' ? g.rng.int(1, 4) : outcome === 'FAILED' ? g.rng.pick([2, 3, 5]) : -1
  const happy = ['REQUESTED', 'VALIDATION_PENDING', 'KYC_VERIFIED', 'ELIGIBILITY_CONFIRMED', 'APPROVED', 'ACTIVATED']
  for (let i = 0; i < stopIdx; i++) {
    if (i > 0) ck.step(2000, i === 1 ? 600000 : 3 * 3600000)
    if (ck.t > until) break
    if (i === failIdx) {
      const reason =
        outcome === 'REJECTED'
          ? g.rng.pick(ONBOARDING_REJECTION_REASONS)
          : i === 5
            ? 'wallet activation failed: provisioning service timeout'
            : 'identity provider returned an unexpected error'
      ev.push(onboardingStep(g, c, outcome, prev, ck.t, reason))
      prev = outcome
      break
    }
    ev.push(onboardingStep(g, c, happy[i], prev, ck.t))
    prev = happy[i]
  }
  return { ev, final: prev }
}

export function offboardingJourney(
  g: Gen,
  ck: Clock,
  o: OffCtx,
  outcome: 'COMPLETED' | 'BLOCKED' | 'FAILED' | 'CANCELLED',
  until: number,
) {
  const ev: EventDoc[] = []
  let prev: string | null = null
  const path =
    outcome === 'BLOCKED'
      ? ['OFFBOARDING_REQUESTED', 'VALIDATION_PENDING', 'BLOCKED']
      : outcome === 'FAILED'
        ? ['OFFBOARDING_REQUESTED', 'VALIDATION_PENDING', 'FAILED']
        : outcome === 'CANCELLED'
          ? ['OFFBOARDING_REQUESTED', 'CANCELLED']
          : ['OFFBOARDING_REQUESTED', 'VALIDATION_PENDING', 'BALANCE_CHECK_COMPLETED', 'WALLET_CLOSURE_PENDING', 'COMPLETED']
  for (const [i, s] of path.entries()) {
    if (i > 0) ck.step(5000, 3600000)
    if (ck.t > until) break
    const reason =
      s === 'BLOCKED'
        ? g.rng.pick(OFFBOARDING_BLOCK_REASONS)
        : s === 'FAILED'
          ? 'offboarding validation failure: customer record locked by compliance hold'
          : undefined
    ev.push(offStep(g, o, s, prev, ck.t, reason))
    prev = s
  }
  return { ev, final: prev }
}

/** Builds a deliberately malformed producer event (never persisted to business collections). */
export function malformedEvent(g: Gen, kind: 'INVALID_SCHEMA' | 'MISSING_MANDATORY_FIELD' | 'UNSUPPORTED_EVENT_TYPE', c: Cust, ts: number) {
  const valid = onboardingStep(g, c, 'REQUESTED', null, ts) as Record<string, unknown>
  const raw: Record<string, unknown> = { ...valid, audit: { ...(valid.audit as object) } }
  if (kind === 'INVALID_SCHEMA') {
    raw.eventVersion = '1'
    raw.status = 'requested'
  } else if (kind === 'MISSING_MANDATORY_FIELD') {
    delete raw.correlationId
  } else {
    raw.eventType = 'WALLET_UPGRADE_REQUESTED'
  }
  return raw
}
