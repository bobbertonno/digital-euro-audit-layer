'use client'

import Link from 'next/link'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { CollectionBadge, CopyButton, Field, JsonView, StatusBadge } from './ui'
import { fmtDateTime, fmtMs } from '@/lib/de/client'
import type { UEvent } from '@/lib/de/queries'

type Ev = Partial<UEvent> & { eventId: string; [k: string]: unknown }

export function EventDrawer({ event, onClose }: { event: Ev | null; onClose: () => void }) {
  const audit = (event?.audit ?? {}) as Record<string, unknown>
  return (
    <Sheet open={!!event} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
        {event && (
          <>
            <SheetHeader className="border-b">
              <div className="flex flex-wrap items-center gap-2">
                <CollectionBadge collection={String(event.sourceCollection ?? '')} />
                <StatusBadge status={event.status} />
              </div>
              <SheetTitle className="font-mono text-base">{event.eventType}</SheetTitle>
              <SheetDescription>{event.description}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-5 p-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3">
                <Field label="Event ID">
                  <span className="flex items-center gap-1">
                    <span className="truncate">{event.eventId}</span>
                  </span>
                </Field>
                <Field label="Topic">{event.topic}</Field>
                <Field label="Timestamp">{fmtDateTime(event.timestamp as unknown as string)}</Field>
                <Field label="Customer">
                  {event.customerId ? (
                    <Link className="text-info hover:underline" href={`/customers/${event.customerId}`}>
                      {event.customerId}
                    </Link>
                  ) : null}
                </Field>
                <Field label="Transaction">
                  {event.transactionId ? (
                    <Link className="text-info hover:underline" href={`/transactions/${event.transactionId}`}>
                      {event.transactionId}
                    </Link>
                  ) : null}
                </Field>
                <Field label="Correlation">{event.correlationId}</Field>
                <Field label="DEAN">{event.deanId}</Field>
                <Field label="Previous status">{event.previousStatus}</Field>
                <Field label="Source system">{event.sourceSystem}</Field>
                <Field label="Processing result">{String(audit.processingResult ?? '—')}</Field>
                <Field label="Ingestion latency">{fmtMs(audit.ingestionLatencyMs as number)}</Field>
                <Field label="Simulated partition / offset">
                  {audit.partition !== undefined ? `p${String(audit.partition)} · ${String(audit.offset)}` : '—'}
                </Field>
              </dl>
              <div className="flex flex-wrap gap-2">
                <CopyButton value={event.eventId} label="Copy event ID" />
                {event.customerId && (
                  <Link href={`/customers/${event.customerId}`} className="rounded px-1.5 py-0.5 text-xs text-info hover:bg-accent">
                    Open customer timeline
                  </Link>
                )}
                {event.transactionId && (
                  <Link href={`/transactions/${event.transactionId}`} className="rounded px-1.5 py-0.5 text-xs text-info hover:bg-accent">
                    Open transaction timeline
                  </Link>
                )}
                {event.correlationId && (
                  <Link href={`/audit-search?correlationId=${event.correlationId}`} className="rounded px-1.5 py-0.5 text-xs text-info hover:bg-accent">
                    All events for correlation
                  </Link>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Original document</h3>
                <JsonView data={event} />
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
