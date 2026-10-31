'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

const STEPS = [
  {
    title: 'Incoming simulated Kafka events',
    href: '/simulator?autostart=1',
    capability: 'Flexible document model · idempotent ingestion',
    notes:
      'Start the simulator. Five logical topics (onboarding-events, offboarding-events, dean-assignment, notification-outbound, error-dead-letter) publish events with simulated partitions and offsets. Every event passes the same Zod validation and is upserted by eventId, so duplicates are detected, not double-written.',
  },
  {
    title: 'Five MongoDB collections receiving documents',
    href: '/live-events',
    capability: '$unionWith over five collections',
    notes:
      'The Live Event Monitor is a single $unionWith pipeline across onboardingEvents, offboardingEvents, deanAssignments, notificationEvents and deadLetterEvents. Latency shown is measured from producer timestamp to successful persistence — never fabricated.',
  },
  {
    title: 'Customer 360 across collections',
    href: '/customers/CUST-990001',
    capability: 'Single View without a reporting database',
    notes:
      'Scenario A: one customer, one chronological timeline assembled from all five collections by customerId. Each event shows its source collection; correlationIds highlight related events. No sixth collection, no materialized view.',
  },
  {
    title: 'Investigate a transaction three ways',
    href: '/audit-search?mode=compare&q=TX-2026-990004',
    capability: 'Indexes · MongoDB Search · Vector Search',
    notes:
      'Run the same investigation as an exact structured filter (indexed transactionId), as keyword full-text ($search per collection, merged with transparent scoring), and as a semantic question. Vector candidates are then verified with deterministic correlation queries.',
  },
  {
    title: 'Failed notification → DLQ → retry',
    href: '/dead-letter?scenario=D',
    capability: 'Auditable error recovery',
    notes:
      'Scenario D: TX-2026-990004 settled, but its SMS was dead-lettered. Open the DLQ entry, confirm the transaction is SETTLED, retry. The retry re-runs processing, writes DISPATCHED/DELIVERED events to notificationEvents and moves the DLQ item to REPROCESSED with a full retry audit trail.',
  },
]

export function GuidedDemo({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="inline-flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-semibold text-primary-foreground hover:bg-primary/85">
        {trigger}
        Guided Demo
      </SheetTrigger>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Guided Demo</SheetTitle>
          <SheetDescription>Five steps. Each opens a working screen with preselected scenario data.</SheetDescription>
        </SheetHeader>
        <ol className="flex flex-col gap-2 overflow-y-auto p-4">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <button
                type="button"
                onClick={() => setStep(i)}
                aria-expanded={step === i}
                className={cn('flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors', step === i ? 'border-primary/40 bg-primary/5' : 'hover:bg-accent/50')}
              >
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-xs',
                    step === i ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {i + 1}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{s.title}</span>
                  <span className="font-mono text-[11px] text-primary">{s.capability}</span>
                </span>
              </button>
              {step === i && (
                <div className="flex flex-col gap-3 px-3 pb-1 pt-3">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">Presenter notes: </span>
                    {s.notes}
                  </p>
                  <div className="flex items-center gap-2">
                    <Link
                      href={s.href}
                      onClick={() => setOpen(false)}
                      className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/85"
                    >
                      Open step {i + 1}
                    </Link>
                    {i < STEPS.length - 1 && (
                      <button type="button" onClick={() => setStep(i + 1)} className="text-xs text-muted-foreground hover:text-foreground">
                        Next step
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      </SheetContent>
    </Sheet>
  )
}
