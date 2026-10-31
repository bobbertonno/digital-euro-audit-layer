export type ScenarioMeta = {
  id: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
  title: string
  summary: string
  customerId: string
  correlationId: string
  transactionId?: string
  href: string
}

export const SCENARIOS: ScenarioMeta[] = [
  {
    id: 'A',
    title: 'Successful onboarding and DEAN assignment',
    summary: 'Full enrollment lifecycle to ACTIVATED, DEAN assigned, confirmations delivered.',
    customerId: 'CUST-990001',
    correlationId: 'CORR-990001',
    href: '/customers/CUST-990001',
  },
  {
    id: 'B',
    title: 'Successful transaction with notification',
    summary: 'Transaction INITIATED → SETTLED with a delivered confirmation.',
    customerId: 'CUST-990002',
    correlationId: 'CORR-990102',
    transactionId: 'TX-2026-990002',
    href: '/transactions/TX-2026-990002',
  },
  {
    id: 'C',
    title: 'Transaction rejected after validation',
    summary: 'Holding limit exceeded after VALIDATED; failure notification delivered.',
    customerId: 'CUST-990003',
    correlationId: 'CORR-990103',
    transactionId: 'TX-2026-990003',
    href: '/transactions/TX-2026-990003',
  },
  {
    id: 'D',
    title: 'Settled transaction, failed notification',
    summary: 'Settlement succeeds but the outbound SMS is dead-lettered. Retry it from the DLQ.',
    customerId: 'CUST-990004',
    correlationId: 'CORR-990104',
    transactionId: 'TX-2026-990004',
    href: '/dead-letter?scenario=D',
  },
  {
    id: 'E',
    title: 'Invalid event routed to DLQ and reprocessed',
    summary: 'Malformed DEAN_ASSIGNED event rejected by schema validation, repaired and reprocessed.',
    customerId: 'CUST-990005',
    correlationId: 'CORR-990005',
    href: '/customers/CUST-990005',
  },
  {
    id: 'F',
    title: 'Offboarding blocked by outstanding balance',
    summary: 'Customer-initiated exit blocked: Digital Euro balance must be defunded first.',
    customerId: 'CUST-990006',
    correlationId: 'CORR-990206',
    href: '/customers/CUST-990006',
  },
]
