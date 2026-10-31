'use client'

import useSWR from 'swr'
import Link from 'next/link'
import { useState } from 'react'
import { RotateCw, Trash2, Eye, ArrowUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { fetcher, fmtDateTime, fmtNum, postJson } from '@/lib/de/client'
import type { UEvent } from '@/lib/de/queries'
import { DLQ_ERROR_CODES, DLQ_STATES } from '@/lib/de/domain'
import { SCENARIOS } from '@/lib/de/scenarios-meta'
import { cn } from '@/lib/utils'
import { CollectionBadge, EmptyState, ErrorState, IdLink, JsonView, Kpi, LoadingBlock, PageHeader, Panel, Spinner, StatusBadge, inputClass, selectClass } from './ui'

type DlqPayload = {
  dlqId: string
  originalEventId?: string
  originalTopic?: string
  errorCode: string
  errorMessage: string
  failureClassification?: string
  retryCount: number
  lastRetryAt?: string | null
  sanitizedPayload?: unknown
  retryHistory?: { attempt: number; at: string; operator: string; result: string; note: string; recoveredEventIds: string[]; recoveredCollection: string | null }[]
  statusHistory?: { from: string; to: string; at: string; operator: string; action: string; reason?: string | null }[]
}
type DlqDoc = UEvent & { payload: DlqPayload }
type ListResp = { rows: DlqDoc[]; kpis: Record<string, number> }
type Detail = { entry: DlqDoc; correlated: UEvent[] }

export function DeadLetterView({ scenario }: { scenario?: string }) {
  const sc = SCENARIOS.find((s) => s.id === scenario)
  const [status, setStatus] = useState('')
  const [code, setCode] = useState('')
  const [q, setQ] = useState(sc?.customerId ?? '')
  const [sort, setSort] = useState('timestamp')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [openId, setOpenId] = useState<string | null>(null)

  const qs = new URLSearchParams({ sort, dir })
  if (status) qs.set('status', status)
  if (code) qs.set('code', code)
  if (q.trim()) qs.set('q', q.trim())
  const { data, error, isLoading, mutate } = useSWR<ListResp>(`/api/dlq?${qs}`, fetcher, { refreshInterval: 4000, keepPreviousData: true })

  const k = data?.kpis ?? {}
  const toggleSort = (f: string) => {
    if (sort === f) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSort(f)
      setDir('desc')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Dead Letter Management"
        title="Operational error recovery"
        description="Every failed event is preserved in deadLetterEvents with its sanitized original payload. Retries re-run the processing pipeline idempotently and keep a full audit trail."
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Open Errors" value={fmtNum((k.OPEN ?? 0) + (k.INVESTIGATING ?? 0))} sub={`${fmtNum(k.INVESTIGATING ?? 0)} investigating`} tone="danger" />
        <Kpi label="Retry Pending" value={fmtNum(k.RETRY_PENDING ?? 0)} tone="warning" />
        <Kpi label="Successfully Reprocessed" value={fmtNum(k.REPROCESSED ?? 0)} tone="success" />
        <Kpi label="Discarded" value={fmtNum(k.DISCARDED ?? 0)} />
        <Kpi label="Average Retry Count" value={(k.avgRetryCount ?? 0).toFixed(2)} sub={`${fmtNum(k.total ?? 0)} total entries`} tone="info" />
      </div>

      {sc && <ScenarioGuide />}

      <Panel
        title="Dead letter queue"
        description="Search by customer, correlation, transaction or DLQ ID"
        bodyClassName="p-0"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="dlq-q">Search</label>
            <input id="dlq-q" className={cn(inputClass, 'h-8 w-48')} placeholder="CUST-… / TX-… / DLQ-…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select aria-label="Status" className={cn(selectClass, 'h-8 w-auto')} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All states</option>
              {DLQ_STATES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select aria-label="Error code" className={cn(selectClass, 'h-8 w-auto')} value={code} onChange={(e) => setCode(e.target.value)}>
              <option value="">All error codes</option>
              {DLQ_ERROR_CODES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        }
      >
        {error ? (
          <div className="p-4"><ErrorState error={error} onRetry={() => mutate()} /></div>
        ) : isLoading && !data ? (
          <div className="p-4"><LoadingBlock rows={8} /></div>
        ) : !data?.rows.length ? (
          <div className="p-4"><EmptyState title="No DLQ entries match" description="Generate a DLQ error from the Event Simulator or clear the filters." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-2 text-left font-medium"><SortBtn label="Failed at" active={sort === 'timestamp'} onClick={() => toggleSort('timestamp')} /></th>
                  <th className="px-2 py-2 text-left font-medium">DLQ ID</th>
                  <th className="px-2 py-2 text-left font-medium"><SortBtn label="Error code" active={sort === 'errorCode'} onClick={() => toggleSort('errorCode')} /></th>
                  <th className="px-2 py-2 text-left font-medium">Original topic</th>
                  <th className="px-2 py-2 text-left font-medium">Customer</th>
                  <th className="px-2 py-2 text-left font-medium">Transaction</th>
                  <th className="px-2 py-2 text-right font-medium"><SortBtn label="Retries" active={sort === 'retryCount'} onClick={() => toggleSort('retryCount')} /></th>
                  <th className="px-4 py-2 text-left font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.payload.dlqId} onClick={() => setOpenId(r.payload.dlqId)} className="cursor-pointer border-b border-border/60 hover:bg-accent/40">
                    <td className="px-4 py-2 font-mono text-xs whitespace-nowrap text-muted-foreground">{fmtDateTime(r.timestamp as unknown as string)}</td>
                    <td className="px-2 py-2 font-mono text-xs">{r.payload.dlqId}</td>
                    <td className="max-w-[260px] px-2 py-2">
                      <div className="truncate font-mono text-xs text-destructive">{r.payload.errorCode}</div>
                      <div className="truncate text-xs text-muted-foreground">{r.payload.errorMessage}</div>
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{r.payload.originalTopic ?? '—'}</td>
                    <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}><IdLink kind="customer" id={r.customerId} /></td>
                    <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}><IdLink kind="transaction" id={r.transactionId} /></td>
                    <td className="px-2 py-2 text-right font-mono text-xs tabular-nums">{r.payload.retryCount ?? 0}</td>
                    <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <DlqDrawer dlqId={openId} onClose={() => setOpenId(null)} onChanged={() => mutate()} />
    </div>
  )
}

function SortBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn('flex items-center gap-1 hover:text-foreground', active && 'text-foreground')}>
      {label}
      <ArrowUpDown className="size-3" aria-hidden />
    </button>
  )
}

function ScenarioGuide() {
  const d = SCENARIOS.find((s) => s.id === 'D')
  if (!d) return null
  const steps = [
    'Identify the failed notification (filtered below by customer).',
    'Open its DLQ entry — error NOTIFICATION_DELIVERY_FAILED.',
    'Open the associated transaction from the drawer.',
    'Verify the transaction reached SETTLED.',
    'Retry the notification from the DLQ drawer.',
    'Observe new DISPATCHED → DELIVERED notification events.',
    'See the DLQ entry transition to REPROCESSED.',
  ]
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-primary px-1.5 py-0.5 font-mono text-[11px] font-semibold text-primary-foreground">SCENARIO D</span>
        <span className="text-sm font-medium">{d.title}</span>
        <span className="font-mono text-xs text-muted-foreground">{d.customerId} · {d.transactionId}</span>
        {d.transactionId && (
          <Link href={`/transactions/${d.transactionId}`} className="ml-auto text-xs text-primary hover:underline">Open transaction</Link>
        )}
      </div>
      <ol className="grid gap-1 text-xs text-muted-foreground md:grid-cols-2">
        {steps.map((s, i) => (
          <li key={s}><span className="mr-1.5 font-mono text-primary">{i + 1}.</span>{s}</li>
        ))}
      </ol>
    </div>
  )
}

function DlqDrawer({ dlqId, onClose, onChanged }: { dlqId: string | null; onClose: () => void; onChanged: () => void }) {
  const { data, error, isLoading, mutate } = useSWR<Detail>(dlqId ? `/api/dlq/${dlqId}` : null, fetcher)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [reason, setReason] = useState('')
  const [lastId, setLastId] = useState(dlqId)
  if (lastId !== dlqId) {
    setLastId(dlqId)
    setMsg(null)
    setConfirmDiscard(false)
    setReason('')
  }

  async function act(action: 'RETRY' | 'INVESTIGATE' | 'DISCARD') {
    if (!dlqId) return
    setBusy(action)
    setMsg(null)
    try {
      const r = await postJson<{ ok: boolean; message?: string; status?: string }>(`/api/dlq/${dlqId}`, { action, reason: reason || undefined })
      setMsg({ ok: r.ok, text: r.message ?? `Status → ${r.status}` })
      setConfirmDiscard(false)
      await mutate()
      onChanged()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  const e = data?.entry
  const p = e?.payload
  const terminal = e?.status === 'REPROCESSED' || e?.status === 'DISCARDED'
  return (
    <Sheet open={!!dlqId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle className="font-mono">{dlqId}</SheetTitle>
          <SheetDescription>{p ? `${p.errorCode} · ${p.failureClassification ?? 'classified failure'}` : 'Loading entry…'}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 p-4">
          {error ? <ErrorState error={error} onRetry={() => mutate()} /> : isLoading || !e || !p ? <LoadingBlock rows={8} /> : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={e.status} />
                <span className="text-xs text-muted-foreground">Failed {fmtDateTime(e.timestamp as unknown as string)}</span>
                <span className="text-xs text-muted-foreground">· {p.retryCount ?? 0} retries</span>
                {p.lastRetryAt && <span className="text-xs text-muted-foreground">· last {fmtDateTime(p.lastRetryAt)}</span>}
              </div>
              <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{p.errorMessage}</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <Dt k="Original event ID" v={p.originalEventId} />
                <Dt k="Original topic" v={p.originalTopic} />
                <Dt k="Customer" v={e.customerId} href={e.customerId ? `/customers/${e.customerId}` : undefined} />
                <Dt k="Correlation" v={e.correlationId} />
                <Dt k="Transaction" v={e.transactionId} href={e.transactionId ? `/transactions/${e.transactionId}` : undefined} />
                <Dt k="DEAN" v={e.deanId} />
              </dl>

              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => act('RETRY')} disabled={!!busy || terminal}>
                    {busy === 'RETRY' ? <Spinner /> : <RotateCw className="size-4" aria-hidden />}Retry event
                  </Button>
                  <Button variant="outline" onClick={() => act('INVESTIGATE')} disabled={!!busy || terminal || e.status === 'INVESTIGATING'}>
                    {busy === 'INVESTIGATE' ? <Spinner /> : <Eye className="size-4" aria-hidden />}Mark investigating
                  </Button>
                  <Button variant="outline" className="text-destructive" onClick={() => setConfirmDiscard(true)} disabled={!!busy || terminal}>
                    <Trash2 className="size-4" aria-hidden />Discard
                  </Button>
                </div>
                {confirmDiscard && (
                  <div className="flex flex-col gap-2 rounded-md border border-destructive/30 p-3">
                    <p className="text-xs">Discarding keeps the entry and its history but stops further retries. This cannot be undone.</p>
                    <label htmlFor="discard-reason" className="sr-only">Reason</label>
                    <input id="discard-reason" className={inputClass} placeholder="Reason (optional)" value={reason} onChange={(ev) => setReason(ev.target.value)} />
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" onClick={() => act('DISCARD')} disabled={!!busy}>{busy === 'DISCARD' ? <Spinner /> : null}Confirm discard</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(false)}>Cancel</Button>
                    </div>
                  </div>
                )}
                {msg && <p role="status" className={cn('rounded-md border p-2 text-xs', msg.ok ? 'border-success/30 bg-success/5 text-success' : 'border-warning/30 bg-warning/5 text-warning')}>{msg.text}</p>}
              </div>

              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Retry history</h3>
                {p.retryHistory?.length ? (
                  <ol className="flex flex-col gap-2">
                    {p.retryHistory.map((r) => (
                      <li key={r.attempt} className="rounded-md border p-2.5 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-mono">#{r.attempt}</span>
                          <StatusBadge status={r.result} />
                          <span className="text-muted-foreground">{fmtDateTime(r.at)} · {r.operator}</span>
                        </div>
                        <p className="mt-1 text-muted-foreground">{r.note}</p>
                        {r.recoveredEventIds?.length > 0 && (
                          <p className="mt-1 font-mono text-[11px] text-success">
                            {'Wrote '}{r.recoveredEventIds.length}{' event(s) → '}{r.recoveredCollection}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : <p className="text-xs text-muted-foreground">No retries yet.</p>}
              </section>

              {p.statusHistory?.length ? (
                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">Status audit trail</h3>
                  <ol className="flex flex-col gap-1 font-mono text-[11px] text-muted-foreground">
                    {p.statusHistory.map((s, i) => (
                      <li key={i}>{fmtDateTime(s.at)} {s.action}: {s.from} → {s.to} by {s.operator}{s.reason ? ` (${s.reason})` : ''}</li>
                    ))}
                  </ol>
                </section>
              ) : null}

              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Correlated events ({data.correlated.length})</h3>
                {data.correlated.length ? (
                  <ol className="flex flex-col divide-y rounded-md border">
                    {data.correlated.map((c) => (
                      <li key={`${c.sourceCollection}-${c.eventId}`} className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
                        <span className="w-24 shrink-0 font-mono text-muted-foreground">{fmtDateTime(c.timestamp as unknown as string).split(', ').pop()}</span>
                        <CollectionBadge collection={c.sourceCollection} />
                        <span className="min-w-0 flex-1 truncate font-mono">{c.eventType}</span>
                        <StatusBadge status={c.status} />
                      </li>
                    ))}
                  </ol>
                ) : <p className="text-xs text-muted-foreground">No correlated events found.</p>}
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Sanitized original payload</h3>
                <JsonView data={p.sanitizedPayload ?? {}} />
              </section>
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">DLQ document</h3>
                <JsonView data={e} />
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Dt({ k, v, href }: { k: string; v?: string | null; href?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="truncate font-mono">{v ? (href ? <Link href={href} className="text-primary hover:underline">{v}</Link> : v) : '—'}</dd>
    </div>
  )
}

