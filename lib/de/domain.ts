import { z } from 'zod'

export const COLLECTIONS = [
  'onboardingEvents',
  'offboardingEvents',
  'deanAssignments',
  'notificationEvents',
  'deadLetterEvents',
] as const
export type CollectionName = (typeof COLLECTIONS)[number]

export const TOPICS = [
  'onboarding-events',
  'offboarding-events',
  'dean-assignment',
  'notification-outbound',
  'error-dead-letter',
] as const
export type Topic = (typeof TOPICS)[number]

export const TOPIC_TO_COLLECTION: Record<Topic, CollectionName> = {
  'onboarding-events': 'onboardingEvents',
  'offboarding-events': 'offboardingEvents',
  'dean-assignment': 'deanAssignments',
  'notification-outbound': 'notificationEvents',
  'error-dead-letter': 'deadLetterEvents',
}
export const COLLECTION_TO_TOPIC: Record<CollectionName, Topic> = {
  onboardingEvents: 'onboarding-events',
  offboardingEvents: 'offboarding-events',
  deanAssignments: 'dean-assignment',
  notificationEvents: 'notification-outbound',
  deadLetterEvents: 'error-dead-letter',
}
export const SIMULATED_PARTITIONS = 6

/* ---------------- State machines ---------------- */

export const ONBOARDING_TRANSITIONS: Record<string, string[]> = {
  __START__: ['REQUESTED'],
  REQUESTED: ['VALIDATION_PENDING', 'REJECTED', 'FAILED'],
  VALIDATION_PENDING: ['KYC_VERIFIED', 'REJECTED', 'FAILED'],
  KYC_VERIFIED: ['ELIGIBILITY_CONFIRMED', 'REJECTED', 'FAILED'],
  ELIGIBILITY_CONFIRMED: ['APPROVED', 'REJECTED'],
  APPROVED: ['ACTIVATED', 'FAILED'],
  ACTIVATED: ['SUSPENDED'],
  SUSPENDED: ['ACTIVATED'],
  REJECTED: ['REQUESTED'],
  FAILED: ['REQUESTED'],
}
export const ONBOARDING_EVENT_TYPE: Record<string, string> = {
  REQUESTED: 'ONBOARDING_REQUESTED',
  VALIDATION_PENDING: 'IDENTITY_VERIFICATION_STARTED',
  KYC_VERIFIED: 'KYC_VERIFICATION_COMPLETED',
  ELIGIBILITY_CONFIRMED: 'ELIGIBILITY_CONFIRMED',
  APPROVED: 'PARTICIPATION_APPROVED',
  ACTIVATED: 'WALLET_ACTIVATED',
  REJECTED: 'ONBOARDING_REJECTED',
  SUSPENDED: 'PARTICIPATION_SUSPENDED',
  FAILED: 'ONBOARDING_FAILED',
}
export const ONBOARDING_HAPPY_PATH = [
  'REQUESTED',
  'VALIDATION_PENDING',
  'KYC_VERIFIED',
  'ELIGIBILITY_CONFIRMED',
  'APPROVED',
  'ACTIVATED',
]

export const OFFBOARDING_TRANSITIONS: Record<string, string[]> = {
  __START__: ['OFFBOARDING_REQUESTED'],
  OFFBOARDING_REQUESTED: ['VALIDATION_PENDING', 'CANCELLED'],
  VALIDATION_PENDING: ['BALANCE_CHECK_COMPLETED', 'BLOCKED', 'FAILED'],
  BALANCE_CHECK_COMPLETED: ['WALLET_CLOSURE_PENDING', 'FAILED'],
  WALLET_CLOSURE_PENDING: ['COMPLETED', 'FAILED'],
  BLOCKED: ['VALIDATION_PENDING', 'CANCELLED'],
  FAILED: ['OFFBOARDING_REQUESTED'],
  CANCELLED: ['OFFBOARDING_REQUESTED'],
  COMPLETED: [],
}
export const OFFBOARDING_EVENT_TYPE: Record<string, string> = {
  OFFBOARDING_REQUESTED: 'OFFBOARDING_REQUESTED',
  VALIDATION_PENDING: 'OFFBOARDING_VALIDATION_STARTED',
  BALANCE_CHECK_COMPLETED: 'BALANCE_CHECK_COMPLETED',
  WALLET_CLOSURE_PENDING: 'WALLET_CLOSURE_PENDING',
  COMPLETED: 'OFFBOARDING_COMPLETED',
  BLOCKED: 'OFFBOARDING_BLOCKED',
  FAILED: 'OFFBOARDING_FAILED',
  CANCELLED: 'OFFBOARDING_CANCELLED',
}
export const OFFBOARDING_HAPPY_PATH = [
  'OFFBOARDING_REQUESTED',
  'VALIDATION_PENDING',
  'BALANCE_CHECK_COMPLETED',
  'WALLET_CLOSURE_PENDING',
  'COMPLETED',
]

export const DEAN_TRANSITIONS: Record<string, string[]> = {
  __START__: ['REQUESTED'],
  REQUESTED: ['ASSIGNED', 'FAILED'],
  FAILED: ['REQUESTED'],
  ASSIGNED: [],
}
export const DEAN_EVENT_TYPE: Record<string, string> = {
  REQUESTED: 'DEAN_ASSIGNMENT_REQUESTED',
  ASSIGNED: 'DEAN_ASSIGNED',
  FAILED: 'DEAN_ASSIGNMENT_FAILED',
}

export const TX_TRANSITIONS: Record<string, string[]> = {
  __START__: ['INITIATED'],
  INITIATED: ['VALIDATED', 'REJECTED', 'FAILED'],
  VALIDATED: ['AUTHORIZED', 'REJECTED', 'FAILED'],
  AUTHORIZED: ['PROCESSING', 'FAILED'],
  PROCESSING: ['SETTLED', 'FAILED'],
  SETTLED: ['REVERSED'],
  REJECTED: [],
  FAILED: [],
  REVERSED: [],
}
export const TX_HAPPY_PATH = ['INITIATED', 'VALIDATED', 'AUTHORIZED', 'PROCESSING', 'SETTLED']
export const TX_TERMINAL = ['SETTLED', 'REJECTED', 'FAILED', 'REVERSED']

export const NOTIFICATION_TRANSITIONS: Record<string, string[]> = {
  __START__: ['CREATED'],
  CREATED: ['QUEUED', 'FAILED'],
  QUEUED: ['DISPATCHED', 'FAILED'],
  DISPATCHED: ['DELIVERED', 'RETRY_PENDING', 'FAILED'],
  RETRY_PENDING: ['DISPATCHED', 'FAILED', 'DEAD_LETTERED'],
  FAILED: ['DEAD_LETTERED', 'DISPATCHED'],
  DEAD_LETTERED: ['DISPATCHED'],
  DELIVERED: [],
}
export const NOTIFICATION_HAPPY_PATH = ['CREATED', 'QUEUED', 'DISPATCHED', 'DELIVERED']

export const NOTIFICATION_TYPES = [
  'ONBOARDING_CONFIRMATION',
  'ONBOARDING_REJECTION',
  'DEAN_ASSIGNMENT_CONFIRMATION',
  'TRANSACTION_CONFIRMATION',
  'TRANSACTION_FAILURE',
  'OFFBOARDING_CONFIRMATION',
  'OPERATIONAL_ALERT',
] as const
export const CHANNELS = ['PUSH', 'EMAIL', 'SMS', 'INTERNAL_EVENT'] as const

export const DLQ_STATES = ['OPEN', 'INVESTIGATING', 'RETRY_PENDING', 'REPROCESSED', 'DISCARDED'] as const
export const DLQ_ERROR_CODES = [
  'INVALID_SCHEMA',
  'MISSING_MANDATORY_FIELD',
  'UNSUPPORTED_EVENT_TYPE',
  'INVALID_STATE_TRANSITION',
  'DUPLICATE_EVENT',
  'NOTIFICATION_DELIVERY_FAILED',
  'PROCESSING_TIMEOUT',
  'DOWNSTREAM_UNAVAILABLE',
] as const
export type DlqErrorCode = (typeof DLQ_ERROR_CODES)[number]
export const DLQ_CLASSIFICATION: Record<DlqErrorCode, string> = {
  INVALID_SCHEMA: 'VALIDATION',
  MISSING_MANDATORY_FIELD: 'VALIDATION',
  UNSUPPORTED_EVENT_TYPE: 'VALIDATION',
  INVALID_STATE_TRANSITION: 'BUSINESS_RULE',
  DUPLICATE_EVENT: 'IDEMPOTENCY',
  NOTIFICATION_DELIVERY_FAILED: 'DELIVERY',
  PROCESSING_TIMEOUT: 'INFRASTRUCTURE',
  DOWNSTREAM_UNAVAILABLE: 'INFRASTRUCTURE',
}

export function transitionsFor(collection: CollectionName, category?: string) {
  if (collection === 'onboardingEvents') return ONBOARDING_TRANSITIONS
  if (collection === 'offboardingEvents') return OFFBOARDING_TRANSITIONS
  if (collection === 'notificationEvents') return NOTIFICATION_TRANSITIONS
  if (collection === 'deanAssignments') return category === 'DEAN_ASSIGNMENT' ? DEAN_TRANSITIONS : TX_TRANSITIONS
  return null
}

/* ---------------- Zod schemas ---------------- */

const ID = {
  customer: /^CUST-\d{6}$/,
  corr: /^CORR-\d{6}$/,
  tx: /^TX-\d{4}-\d{6}$/,
  dean: /^DEAN-\d{6}$/,
}

const auditSchema = z.object({
  producer: z.string().min(1),
  schemaVersion: z.literal('1.0'),
  traceId: z.string().min(1),
  processingResult: z.enum(['SUCCESS', 'FAILED', 'DUPLICATE']),
  producedAt: z.date().optional(),
  ingestionLatencyMs: z.number().optional(),
})

export const envelopeSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(1),
  topic: z.enum(TOPICS),
  eventVersion: z.literal(1),
  customerId: z.string().regex(ID.customer).nullable(),
  correlationId: z.string().regex(ID.corr).nullable(),
  transactionId: z.string().regex(ID.tx).nullable(),
  deanId: z.string().regex(ID.dean).nullable(),
  timestamp: z.date(),
  ingestedAt: z.date().optional(),
  sourceSystem: z.string().min(1),
  status: z.string().regex(/^[A-Z_]+$/),
  previousStatus: z.string().nullable(),
  description: z.string().min(1),
  semanticText: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()),
  payload: z.record(z.string(), z.unknown()),
  audit: auditSchema,
})

const onboardingSchema = envelopeSchema.extend({
  topic: z.literal('onboarding-events'),
  customerId: z.string().regex(ID.customer),
  eventType: z.enum(Object.values(ONBOARDING_EVENT_TYPE) as [string, ...string[]]),
  payload: z
    .object({
      channel: z.string(),
      bank: z.string(),
      requestSource: z.string(),
      validationOutcome: z.string().nullable(),
      transitionReason: z.string(),
      processingDurationMs: z.number().int().nonnegative(),
    })
    .passthrough(),
})

const offboardingSchema = envelopeSchema.extend({
  topic: z.literal('offboarding-events'),
  customerId: z.string().regex(ID.customer),
  eventType: z.enum(Object.values(OFFBOARDING_EVENT_TYPE) as [string, ...string[]]),
  payload: z
    .object({
      initiatedBy: z.enum(['CUSTOMER', 'BANK']),
      bank: z.string(),
      transitionReason: z.string(),
      outstandingBalanceMinor: z.number().int().nonnegative(),
      processingDurationMs: z.number().int().nonnegative(),
    })
    .passthrough(),
})

const deanSchema = envelopeSchema.extend({
  topic: z.literal('dean-assignment'),
  customerId: z.string().regex(ID.customer),
  eventCategory: z.enum(['DEAN_ASSIGNMENT', 'PAYMENT_TRANSACTION']),
  payload: z
    .object({
      processingDurationMs: z.number().int().nonnegative(),
      transactionType: z.string().optional(),
      amountMinor: z.number().int().positive().optional(),
      currency: z.literal('EUR').optional(),
      sourceSystem: z.string().optional(),
      destinationSystem: z.string().optional(),
      failureReason: z.string().nullable().optional(),
    })
    .passthrough(),
})

const notificationSchema = envelopeSchema.extend({
  topic: z.literal('notification-outbound'),
  customerId: z.string().regex(ID.customer),
  payload: z
    .object({
      notificationId: z.string().regex(/^NTF-\d{6,}$/),
      notificationType: z.enum(NOTIFICATION_TYPES),
      channel: z.enum(CHANNELS),
      originatingEventId: z.string().uuid(),
      attempts: z.number().int().nonnegative(),
      maskedDestination: z.string(),
      lastError: z.string().nullable(),
      processingLatencyMs: z.number().int().nonnegative(),
    })
    .passthrough(),
})

const dlqSchema = envelopeSchema.extend({
  topic: z.literal('error-dead-letter'),
  payload: z
    .object({
      dlqId: z.string(),
      originalEventId: z.string().nullable(),
      originalTopic: z.string().nullable(),
      errorCode: z.enum(DLQ_ERROR_CODES),
      errorMessage: z.string(),
      failureClassification: z.string(),
      failedAt: z.date(),
      retryCount: z.number().int().nonnegative(),
      lastRetryAt: z.date().nullable(),
      retryHistory: z.array(z.record(z.string(), z.unknown())),
      sanitizedPayload: z.unknown(),
      repairHint: z.string().nullable().optional(),
    })
    .passthrough(),
})

export const SCHEMA_BY_TOPIC = {
  'onboarding-events': onboardingSchema,
  'offboarding-events': offboardingSchema,
  'dean-assignment': deanSchema,
  'notification-outbound': notificationSchema,
  'error-dead-letter': dlqSchema,
} as const

export type EventDoc = z.infer<typeof envelopeSchema> & {
  _id?: unknown
  eventCategory?: 'DEAN_ASSIGNMENT' | 'PAYMENT_TRANSACTION'
  embedding?: number[]
  [k: string]: unknown
}

/* ---------------- Fictional reference data ---------------- */

export const BANKS = [
  'Banca Aurora Italia',
  'Credito Lagunare',
  'Banca del Tirreno',
  'Cassa Alpina',
  'Banca Meridiana',
  'Istituto Ligure di Credito',
]
export const ONBOARDING_CHANNELS = ['MOBILE_APP', 'WEB_BANKING', 'BRANCH', 'CALL_CENTER']
export const TX_TYPES = ['P2P_TRANSFER', 'POS_PAYMENT', 'ECOMMERCE_PAYMENT', 'FUNDING', 'DEFUNDING']
export const SOURCE_SYSTEMS = {
  onboarding: 'core-onboarding-svc',
  offboarding: 'wallet-lifecycle-svc',
  dean: 'dean-registry-svc',
  tx: 'de-payment-gateway',
  notification: 'notification-hub',
  dlq: 'event-validation-gw',
}
export const DESTINATION_SYSTEMS = ['de-settlement-engine', 'merchant-acquirer-sim', 'p2p-ledger-sim']

export const ONBOARDING_REJECTION_REASONS = [
  'identity document could not be validated',
  'customer failed eligibility check for residency',
  'duplicate participation detected at another intermediary',
  'KYC data mismatch between declared and verified identity',
]
export const TX_FAILURE_REASONS = {
  REJECTED: [
    'holding limit exceeded for Digital Euro wallet',
    'beneficiary wallet not eligible',
    'validation rejected: invalid DEAN reference',
    'amount exceeds per-transaction limit',
  ],
  FAILED_EARLY: ['validation service timeout', 'fraud screening unavailable'],
  FAILED_LATE: [
    'settlement timeout after authorization',
    'settlement engine unavailable after authorization',
    'liquidity reservation expired during processing',
  ],
}
export const NOTIFICATION_ERRORS = [
  'SMS carrier gateway timeout',
  'push token expired on customer device',
  'email relay rejected message: mailbox unavailable',
  'notification provider returned HTTP 503',
]
export const OFFBOARDING_BLOCK_REASONS = [
  'outstanding Digital Euro balance must be defunded before closure',
  'pending transaction still in processing',
  'open dispute on recent transaction',
]
