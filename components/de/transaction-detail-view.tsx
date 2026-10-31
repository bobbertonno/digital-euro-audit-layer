'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { useState } from 'react'
import { ArrowRight, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TX_HAPPY_PATH } from '@/lib/de/domain'
import { fetcher, fmtDateTime, fmtEUR, fmtMs, fmtTime, statusTone } from '@/lib/de/client'
import type { UEvent } from '@/lib/de/queries'
import { CollectionBadge, EmptyState, ErrorState, Field, JsonView, Kpi, LoadingBlock, PageHeader, Panel, PipelineView, StatusBadge } from './ui'
import { EventDrawer } from './event-drawer'

type H = UEvent & { nextStatus: string | null; sincePreviousMs: number }
type Tx = {
  transactionId: string
  customerId: string
  deanId: string | null
  correlationId: string | null
  currentState: string
  amountMinor: number
  type: string
  sourceSystem: string
  destinationSystem: string
  failureReason: string | null
  customerOnboardingState: string | null
  totalDurationMs: number
  history: H[]
  notifications: UEvent[]
  errors: UEvent[]
  pipeline: unknown
  relatedPipeline: unknown
}

function StateProgression({ history }: { history: H[] }) {
  const reached = history.map((h) => h.status)
  const terminal = reached.at(-1)!
  const offPath = !TX_HAPPY_PATH.includes(terminal)
  const steps = offPath
    ? [...TX_HAPPY_PATH.filter((s) => reached.includes(s)), terminal]
    : terminal === 'SETTLED'
      ? TX_HAPPY_PATH
      : TX_HAPPY_PATH
  return (
    <ol className="flex flex-wrap items-center gap-y-3" aria-label="Transaction state progression">
      {steps.map((s, i) => {
        const done = reached.includes(s)
        const tone = done ? statusTone(s) : 'neutral'
        const ev = history.find((h) => h.status === s)
        return (
          <li key={s} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={cn(
                  'flex size-8 items-center justify-center rounded-full border-2',
                  !done && 'border-dashed border-border text-muted-foreground',
                  done && tone === 'danger' && 'border-destructive bg-destructive/15 text-destructive',
                  done && tone === 'warning' && 'border-warning bg-warning/15 text-warning',
                  done && (tone === 'success' || tone === 'info') && 'border-primary bg-primary/15 text-primary',
                )}
              >
                {done && tone === 'danger' ? <X className="size-4" /> : done ? <Check className="size-4" /> : <span className="font-mono text-[10px]">{i + 1}</span>}
              </span>
              <span className={cn('font-mono text-[10.5px]', done ? 'text-foreground' : 'text-muted-foreground')}>{s}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{ev ? fmtTime(ev.timestamp) : 'not reached'}</span>
            </div>
            {i < steps.length - 1 && <span className={cn('mx-2 mb-8 h-px w-8 md:w-14', reached.includes(steps[i + 1]) ? 'bg-primary/60' : 'bg-border')} />}
          </li>
        )
      })}
    </ol>
  )
}

export function TransactionDetailView({ transactionId }: { transactionId: string }) {
  const { data, error, isLoading, mutate } = useSWR<Tx>(`/api/transactions/${transactionId}`, fetcher, { refreshInterval: 5000, keepPreviousData: true })
  const [selected, setSelected] = useState<UEvent | null>(null)

  if (error && !data)
    return (
      <div className="flex flex-col gap-4">
        <PageHeader eyebrow="04 · Transaction Explorer" title={transactionId} />
        {String(error.message).toLowerCase().includes('not found') ? (
          <EmptyState title="Transaction not found" description="No PAYMENT_TRANSACTION events exist for this ID." action={<Link className="text-xs text-info" href="/transactions">Back</Link>} />
        ) : (
          <ErrorState error={error} onRetry={() => mutate()} />
        )}
      </div>
    )
  if (isLoading || !data)
    return (
      <div className="flex flex-col gap-4">
        <PageHeader eyebrow="04 · Transaction Explorer" title={transactionId} />
        <LoadingBlock rows={10} />
      </div>
    )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="04 · Transaction & State Explorer"
        title={data.transactionId}
        description={`${data.type} · ${data.sourceSystem} → ${data.destinationSystem} · ${data.history.length} persisted state transitions`}
        actions={
          <>
            <StatusBadge status={data.currentState} className="text-xs" />
            <Link href={`/customers/${data.customerId}`} className="text-xs text-info hover:underline">Customer 360</Link>
            <Link href={`/audit-search?transactionId=${data.transactionId}`} className="text-xs text-info hover:underline">All correlated events</Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Current state" value={<span className="text-lg">{data.currentState}</span>} tone={statusTone(data.currentState) === 'danger' ? 'danger' : statusTone(data.currentState) === 'success' ? 'success' : 'warning'} sub={data.failureReason ?? 'no failure'} />
        <Kpi label="Amount" value={<span className="text-lg">{fmtEUR(data.amountMinor)}</span>} sub="stored as integer minor units" />
        <Kpi label="End-to-end duration" value={<span className="text-lg">{fmtMs(data.totalDurationMs)}</span>} sub="first → latest transition" tone="info" />
        <Kpi label="Notifications / errors" value={<span className="text-lg">{data.notifications.length} / {data.errors.length}</span>} tone={data.errors.length ? 'danger' : 'neutral'} sub="correlated by transactionId" />
      </div>

      <Panel title="State progression">
        <div className="overflow-x-auto pb-1">
          <StateProgression history={data.history} />
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <Panel title="Detailed state history" description="$setWindowFields with $shift derives each transition's next state." bodyClassName="p-0">
          <table className="w-full text-xs">
            <thead className="text-left text-[11px] text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2 font-medium">Timestamp</th>
                <th className="px-2 py-2 font-medium">Transition</th>
                <th className="px-2 py-2 font-medium">Event type</th>
                <th className="px-2 py-2 text-right font-medium">Since previous</th>
                <th className="px-4 py-2 text-right font-medium">Processing</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {data.history.map((h) => (
                <tr key={h.eventId} onClick={() => setSelected(h)} className="cursor-pointer border-b border-border/60 hover:bg-accent/40">
                  <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{fmtDateTime(h.timestamp)}</td>
                  <td className="px-2 py-2">
                    <span className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">{h.previousStatus ?? '∅'}</span>
                      <ArrowRight className="size-3 text-muted-foreground" />
                      <StatusBadge status={h.status} />
                      {h.nextStatus && <span className="text-[10px] text-muted-foreground">next: {h.nextStatus}</span>}
                    </span>
                  </td>
                  <td className="px-2 py-2">{h.eventType}</td>
                  <td className="px-2 py-2 text-right">{fmtMs(h.sincePreviousMs)}</td>
                  <td className="px-4 py-2 text-right">{fmtMs((h.payload as { processingDurationMs?: number }).processingDurationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="Associations">
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Customer"><Link className="text-info hover:underline" href={`/customers/${data.customerId}`}>{data.customerId}</Link></Field>
              <Field label="Onboarding state">{data.customerOnboardingState}</Field>
              <Field label="DEAN">{data.deanId}</Field>
              <Field label="Correlation">{data.correlationId}</Field>
            </dl>
          </Panel>
          <Panel title="Related notifications" bodyClassName="p-0">
            {data.notifications.length ? (
              <ul className="divide-y">
                {data.notifications.map((n) => (
                  <li key={n.eventId}>
                    <button type="button" onClick={() => setSelected(n)} className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left hover:bg-accent/40">
                      <span className="flex flex-col">
                        <span className="font-mono text-[11px]">{(n.payload as { notificationType?: string }).notificationType} · {(n.payload as { channel?: string }).channel}</span>
                        <span className="font-mono text-[10.5px] text-muted-foreground">{fmtTime(n.timestamp)}</span>
                      </span>
                      <StatusBadge status={n.status} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-xs text-muted-foreground">No notifications for this transaction.</p>
            )}
          </Panel>
          <Panel title="Associated errors" bodyClassName="p-0">
            {data.errors.length ? (
              <ul className="divide-y">
                {data.errors.map((e) => {
                  const p = e.payload as { dlqId?: string; errorCode?: string }
                  return (
                    <li key={e.eventId} className="flex flex-col gap-1 px-4 py-2">
                      <div className="flex items-center gap-2">
                        <CollectionBadge collection="deadLetterEvents" />
                        <StatusBadge status={e.status} />
                      </div>
                      <span className="font-mono text-[11px] text-destructive">{p.errorCode}</span>
                      {p.dlqId && <Link href={`/dead-letter?dlqId=${p.dlqId}`} className="font-mono text-[11px] text-info hover:underline">Open {p.dlqId} in DLQ console</Link>}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="p-4 text-xs text-muted-foreground">No DLQ entries.</p>
            )}
          </Panel>
        </div>
      </div>

      <Panel title="Original event JSON · latest transition">
        <JsonView data={data.history.at(-1)} />
      </Panel>
      <PipelineView pipeline={data.pipeline} root="deanAssignments" label="State history pipeline ($setWindowFields)" />
      <EventDrawer event={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
