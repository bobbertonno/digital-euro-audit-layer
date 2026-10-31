'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { useMemo, useState } from 'react'
import { ChevronDown, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COLLECTION_LIST, COLLECTION_META, fetcher, fmtDateTime, fmtEUR, fmtNum, fmtRel } from '@/lib/de/client'
import type { UEvent } from '@/lib/de/queries'
import type { CollectionName } from '@/lib/de/domain'
import { CollectionBadge, EmptyState, ErrorState, IdLink, JsonView, Kpi, LoadingBlock, PageHeader, Panel, PipelineView, StatusBadge } from './ui'

type C360 = {
  customerId: string
  summary: {
    participation: string
    onboardingState: string | null
    offboardingState: string | null
    bank: string | null
    deanId: string | null
    deanState: string | null
    transactions: number
    settledTransactions: number
    settledValueMinor: number
    notifications: number
    lastActivity: string
    openIssues: number
    countsByCollection: Record<CollectionName, number>
  }
  transactions: { transactionId: string; status: string; amountMinor: number; type: string; timestamp: string }[]
  correlations: { correlationId: string; collections: string[] }[]
  openIssues: { eventId: string; sourceCollection: string; status: string; description: string; dlqId: string | null }[]
  timeline: UEvent[]
  pipeline: unknown
  root: string
}

export function CustomerDetailView({ customerId }: { customerId: string }) {
  const { data, error, isLoading, mutate } = useSWR<C360>(`/api/customers/${customerId}`, fetcher, { refreshInterval: 5000, keepPreviousData: true })
  const [expanded, setExpanded] = useState<string | null>(null)
  const [hiCorr, setHiCorr] = useState<string | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const crossCorr = useMemo(() => new Set(data?.correlations.filter((c) => c.collections.length > 1).map((c) => c.correlationId)), [data])

  if (error && !data)
    return (
      <div className="flex flex-col gap-4">
        <PageHeader eyebrow="03 · Customer 360" title={customerId} />
        {String(error.message).toLowerCase().includes('not found') ? (
          <EmptyState title="No events for this customer" description="Check the ID or pick a showcase customer." action={<Link className="text-xs text-info" href="/customers">Back to search</Link>} />
        ) : (
          <ErrorState error={error} onRetry={() => mutate()} />
        )}
      </div>
    )
  if (isLoading || !data)
    return (
      <div className="flex flex-col gap-4">
        <PageHeader eyebrow="03 · Customer 360" title={customerId} />
        <LoadingBlock rows={12} />
      </div>
    )

  const s = data.summary
  const events = data.timeline.filter((e) => !hidden.has(e.sourceCollection))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="03 · Customer 360 · Single View"
        title={data.customerId}
        description={
          <>
            {s.bank ?? 'Unknown bank'} · {data.timeline.length} events from {Object.values(s.countsByCollection).filter(Boolean).length} collections, assembled by one $unionWith pipeline.
          </>
        }
        actions={
          <>
            <StatusBadge status={s.participation} className="text-xs" />
            <Link href={`/audit-search?customerId=${data.customerId}`} className="text-xs text-info hover:underline">Audit search</Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Participation" value={<span className="text-base">{s.participation}</span>} sub={`onboarding ${s.onboardingState ?? '—'}`} />
        <Kpi label="Assigned DEAN" value={<span className="text-base">{s.deanId ?? '—'}</span>} sub={s.deanState ?? 'no DEAN request'} tone={s.deanId ? 'success' : 'neutral'} />
        <Kpi label="Transactions" value={fmtNum(s.transactions)} sub={`${s.settledTransactions} settled`} />
        <Kpi label="Settled value" value={<span className="text-lg">{fmtEUR(s.settledValueMinor)}</span>} tone="success" />
        <Kpi label="Last activity" value={<span className="text-base">{fmtRel(s.lastActivity)}</span>} sub={fmtDateTime(s.lastActivity)} />
        <Kpi label="Open issues" value={fmtNum(s.openIssues)} tone={s.openIssues ? 'danger' : 'success'} sub={s.openIssues ? 'DLQ / failed notifications' : 'none'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <Panel
          title="Unified chronological timeline"
          description="Click an event to inspect the original document. Hover a correlation to highlight related events across collections."
          actions={
            <div className="flex flex-wrap gap-1">
              {COLLECTION_LIST.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={!hidden.has(c)}
                  onClick={() => setHidden((h) => { const n = new Set(h); n.has(c) ? n.delete(c) : n.add(c); return n })}
                  className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground aria-pressed:text-foreground aria-[pressed=false]:opacity-40"
                >
                  <span className={cn('size-1.5 rounded-full', COLLECTION_META[c].dot)} />
                  {COLLECTION_META[c].short} {s.countsByCollection[c]}
                </button>
              ))}
            </div>
          }
        >
          {!events.length ? (
            <EmptyState title="All collections hidden" />
          ) : (
            <ol className="relative flex flex-col">
              {events.map((e, i) => {
                const meta = COLLECTION_META[e.sourceCollection]
                const open = expanded === e.eventId
                const lit = hiCorr && e.correlationId === hiCorr
                return (
                  <li key={e.eventId} className="relative flex gap-3 pb-1">
                    <div className="flex flex-col items-center">
                      <span className="mt-3 size-2.5 shrink-0 rounded-full ring-4 ring-card" style={{ background: meta.color }} />
                      {i < events.length - 1 && <span className="w-px flex-1 bg-border" />}
                    </div>
                    <div className={cn('mb-1 min-w-0 flex-1 rounded-md border border-transparent transition-colors', lit && 'border-primary/40 bg-primary/5', open && 'border-border bg-background/40')}>
                      <button type="button" onClick={() => setExpanded(open ? null : e.eventId)} aria-expanded={open} className="flex w-full flex-col gap-1 p-2 text-left hover:bg-accent/30">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] text-muted-foreground">{fmtDateTime(e.timestamp)}</span>
                          <CollectionBadge collection={e.sourceCollection} />
                          <span className="font-mono text-[11px]">{e.eventType}</span>
                          <StatusBadge status={e.status} />
                          <ChevronDown className={cn('ml-auto size-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
                        </div>
                        <p className="text-xs text-foreground/85">{e.description}</p>
                        <div className="flex flex-wrap gap-3 font-mono text-[10.5px] text-muted-foreground">
                          {e.correlationId && (
                            <span
                              onMouseEnter={() => setHiCorr(e.correlationId!)}
                              onMouseLeave={() => setHiCorr(null)}
                              className={cn('inline-flex items-center gap-1', crossCorr.has(e.correlationId) && 'text-primary')}
                            >
                              <Link2 className="size-3" />
                              {e.correlationId}
                            </span>
                          )}
                          {e.transactionId && <IdLink kind="transaction" id={e.transactionId} />}
                          {e.deanId && <span>{e.deanId}</span>}
                        </div>
                      </button>
                      {open && (
                        <div className="p-2 pt-0">
                          <JsonView data={e} />
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="Open operational issues">
            {data.openIssues.length ? (
              <ul className="flex flex-col gap-2">
                {data.openIssues.map((i) => (
                  <li key={i.eventId} className="flex flex-col gap-1 rounded-md border border-destructive/25 bg-destructive/5 p-2">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={i.status} />
                      <CollectionBadge collection={i.sourceCollection} />
                    </div>
                    <p className="text-xs">{i.description}</p>
                    {i.dlqId && <Link href={`/dead-letter?dlqId=${i.dlqId}`} className="font-mono text-[11px] text-info hover:underline">Open {i.dlqId}</Link>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No open issues for this customer.</p>
            )}
          </Panel>
          <Panel title="Transactions" description="Latest state per transactionId." bodyClassName="p-0">
            {data.transactions.length ? (
              <ul className="divide-y">
                {data.transactions.map((t) => (
                  <li key={t.transactionId}>
                    <Link href={`/transactions/${t.transactionId}`} className="flex items-center justify-between gap-2 px-4 py-2 hover:bg-accent/40">
                      <span className="flex flex-col">
                        <span className="font-mono text-xs text-info">{t.transactionId}</span>
                        <span className="text-[11px] text-muted-foreground">{t.type}</span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <span className="font-mono text-xs">{fmtEUR(t.amountMinor)}</span>
                        <StatusBadge status={t.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-xs text-muted-foreground">No transactions.</p>
            )}
          </Panel>
          <Panel title="Correlation map" description="Correlation IDs and the collections they span.">
            <ul className="flex flex-col gap-1.5">
              {data.correlations.map((c) => (
                <li
                  key={c.correlationId}
                  onMouseEnter={() => setHiCorr(c.correlationId)}
                  onMouseLeave={() => setHiCorr(null)}
                  className="flex items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-accent/40"
                >
                  <span className={cn('font-mono text-[11px]', c.collections.length > 1 && 'text-primary')}>{c.correlationId}</span>
                  <span className="flex gap-1">
                    {c.collections.map((col) => (
                      <span key={col} title={col} className={cn('size-2 rounded-full', COLLECTION_META[col as CollectionName]?.dot)} />
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <PipelineView pipeline={data.pipeline} root={data.root} label="Customer 360 pipeline ($match by customerId in each $unionWith branch)" />
    </div>
  )
}
