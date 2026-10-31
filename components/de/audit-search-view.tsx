'use client'

import { useState, type ReactNode } from 'react'
import { Search, Filter, Type, Brain, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { COLLECTION_LIST, COLLECTION_META, fetcher, fmtDateTime, fmtEUR, fmtNum, postJson, useHealth } from '@/lib/de/client'
import type { UEvent } from '@/lib/de/queries'
import { cn } from '@/lib/utils'
import { CollectionBadge, EmptyState, ErrorState, Field, IdLink, LoadingBlock, PageHeader, Panel, PipelineView, Spinner, StatusBadge, inputClass, selectClass } from './ui'
import { EventDrawer } from './event-drawer'

type Filters = Record<string, string>
type FilterResp = { total: number; results: (UEvent & { notificationStatuses?: string[] })[]; byCollection?: { _id: string; n: number }[]; page: number; pageSize: number; pipeline: unknown; root: string; note?: string }
type Highlight = { path: string; texts: { value: string; type: 'hit' | 'text' }[] }
type TextHit = UEvent & { score: number; normalizedScore: number; highlights: Highlight[] }
type TextResp = { query: string; engine: string; results: TextHit[]; executed: Record<string, unknown>[]; note: string }
type VectorHit = UEvent & { score: number; matchedText: string; verified: boolean | null }
type VectorResp = { available: true; engine: string; model: string; results: VectorHit[] } | { available: false; reason: string }

const FIELDS: { key: string; label: string; placeholder?: string; type?: string }[] = [
  { key: 'customerId', label: 'Customer ID', placeholder: 'CUST-990001' },
  { key: 'correlationId', label: 'Correlation ID', placeholder: 'CORR-990001' },
  { key: 'transactionId', label: 'Transaction ID', placeholder: 'TX-2026-990004' },
  { key: 'deanId', label: 'DEAN ID', placeholder: 'DEAN-000001' },
  { key: 'eventType', label: 'Event type', placeholder: 'TRANSACTION_SETTLED' },
  { key: 'status', label: 'Status', placeholder: 'FAILED or FAILED,REJECTED' },
  { key: 'sourceSystem', label: 'Source system', placeholder: 'de-payment-gateway' },
  { key: 'errorCode', label: 'Error code', placeholder: 'NOTIFICATION_DELIVERY_FAILED' },
  { key: 'from', label: 'From', type: 'datetime-local' },
  { key: 'to', label: 'To', type: 'datetime-local' },
  { key: 'amountMin', label: 'Min amount (EUR)', placeholder: '0', type: 'number' },
  { key: 'amountMax', label: 'Max amount (EUR)', placeholder: '5000', type: 'number' },
]

const hourAgo = () => {
  const d = new Date(Date.now() - 3600_000)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

const SAVED: { id: string; label: string; filters?: () => Filters; saved?: string }[] = [
  { id: 'customer', label: 'All events for a customer', filters: () => ({ customerId: 'CUST-990001' }) },
  { id: 'failed-tx', label: 'Failed transactions in the last hour', filters: () => ({ collection: 'deanAssignments', eventType: 'TRANSACTION_FAILED,TRANSACTION_REJECTED', from: hourAgo() }) },
  { id: 'awaiting', label: 'Onboardings awaiting approval', saved: 'awaiting-approval' },
  { id: 'no-ntf', label: 'Transactions without successful notifications', saved: 'tx-without-notification' },
  { id: 'open-dlq', label: 'Open DLQ errors', filters: () => ({ collection: 'deadLetterEvents', status: 'OPEN' }) },
  { id: 'off-fail', label: 'Offboarding failures', filters: () => ({ collection: 'offboardingEvents', status: 'FAILED,BLOCKED' }) },
  { id: 'tx-corr', label: 'Events correlated to a transaction', filters: () => ({ transactionId: 'TX-2026-990004' }) },
]

function toBody(f: Filters) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(f)) {
    if (!v) continue
    if (k === 'amountMin' || k === 'amountMax') out[k] = Math.round(Number(v) * 100)
    else if (k === 'from' || k === 'to') out[k] = new Date(v).toISOString()
    else if (['customerId', 'correlationId', 'transactionId', 'deanId', 'eventType', 'status', 'errorCode'].includes(k)) out[k] = v.trim().toUpperCase()
    else out[k] = v.trim()
  }
  return out
}

function idFilter(q: string): Filters {
  const v = q.trim().toUpperCase()
  if (v.startsWith('TX-')) return { transactionId: v }
  if (v.startsWith('CUST-')) return { customerId: v }
  if (v.startsWith('CORR-')) return { correlationId: v }
  if (v.startsWith('DEAN-')) return { deanId: v }
  return { eventType: v.replace(/\s+/g, '_') }
}

const MODES = [
  { id: 'filter', label: 'Structured filters', icon: Filter },
  { id: 'text', label: 'Full-text search', icon: Type },
  { id: 'compare', label: 'Compare search modes', icon: Brain },
] as const
type Mode = (typeof MODES)[number]['id']

export function AuditSearchView({ initialMode, initialQuery }: { initialMode?: string; initialQuery?: string }) {
  const [mode, setMode] = useState<Mode>((MODES.find((m) => m.id === initialMode)?.id ?? 'filter') as Mode)
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Unified Audit Search"
        title="Investigate across all five collections"
        description="Exact indexed filters, MongoDB Search relevance ranking, and side-by-side comparison with Atlas Vector Search."
      />
      <div role="tablist" aria-label="Search mode" className="flex flex-wrap gap-1 rounded-lg border bg-card p-1 self-start">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => setMode(m.id)}
            className={cn('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors', mode === m.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            <m.icon className="size-4" aria-hidden />
            {m.label}
          </button>
        ))}
      </div>
      {mode === 'filter' && <StructuredSearch initial={initialQuery ? idFilter(initialQuery) : undefined} />}
      {mode === 'text' && <TextSearch initial={initialQuery} />}
      {mode === 'compare' && <CompareSearch initial={initialQuery ?? 'TX-2026-990004'} />}
    </div>
  )
}

/* ---------------- Structured ---------------- */

function StructuredSearch({ initial }: { initial?: Filters }) {
  const [filters, setFilters] = useState<Filters>(initial ?? {})
  const [sort, setSort] = useState<'desc' | 'asc'>('desc')
  const [data, setData] = useState<FilterResp | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<UEvent | null>(null)
  const [activeSaved, setActiveSaved] = useState<string | null>(null)

  async function run(f: Filters, page = 1, saved?: string, s = sort) {
    setLoading(true)
    setError(null)
    try {
      const body = saved ? { saved } : { filters: toBody(f), page, pageSize: 25, sort: s }
      setData(await postJson<FilterResp>('/api/search/filter', body))
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }

  const [booted, setBooted] = useState(false)
  if (!booted) {
    setBooted(true)
    if (initial) void run(initial)
  }

  const set = (k: string, v: string) => setFilters((f) => ({ ...f, [k]: v }))
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-4">
        <Panel title="Saved investigations" description="Predefined queries against live data">
          <ul className="flex flex-col gap-1">
            {SAVED.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => {
                    setActiveSaved(s.id)
                    const f = s.filters?.() ?? {}
                    setFilters(f)
                    void run(f, 1, s.saved)
                  }}
                  className={cn('w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent', activeSaved === s.id && 'bg-accent text-foreground')}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Filters" description="All filters combine with AND">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              setActiveSaved(null)
              void run(filters)
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label="Collection">
                <select className={selectClass} value={filters.collection ?? ''} onChange={(e) => set('collection', e.target.value)}>
                  <option value="">All five</option>
                  {COLLECTION_LIST.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Topic">
                <select className={selectClass} value={filters.topic ?? ''} onChange={(e) => set('topic', e.target.value)}>
                  <option value="">Any</option>
                  {COLLECTION_LIST.map((c) => (
                    <option key={c} value={COLLECTION_META[c].topic}>{COLLECTION_META[c].topic}</option>
                  ))}
                </select>
              </Field>
              {FIELDS.map((f) => (
                <Field key={f.key} label={f.label}>
                  <input
                    className={inputClass}
                    type={f.type ?? 'text'}
                    placeholder={f.placeholder}
                    value={filters[f.key] ?? ''}
                    onChange={(e) => set(f.key, e.target.value)}
                    min={f.type === 'number' ? 0 : undefined}
                    step={f.type === 'number' ? '0.01' : undefined}
                  />
                </Field>
              ))}
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={loading}>
                {loading ? <Spinner /> : <Search className="size-4" aria-hidden />}
                Search
              </Button>
              <Button type="button" variant="outline" onClick={() => { setFilters({}); setData(null); setActiveSaved(null) }}>
                Clear
              </Button>
            </div>
          </form>
        </Panel>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <Panel
          title={data ? `${fmtNum(data.total)} matching events` : 'Results'}
          description={data?.note ?? (data?.byCollection?.length ? data.byCollection.map((b) => `${b._id}: ${b.n}`).join(' · ') : 'Run a search or choose a saved investigation')}
          actions={
            data && !data.note ? (
              <select
                aria-label="Sort order"
                className={cn(selectClass, 'h-8 w-auto')}
                value={sort}
                onChange={(e) => {
                  const s = e.target.value as 'asc' | 'desc'
                  setSort(s)
                  void run(filters, 1, undefined, s)
                }}
              >
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
              </select>
            ) : null
          }
          bodyClassName="p-0"
        >
          {error ? (
            <div className="p-4"><ErrorState error={error} onRetry={() => run(filters)} /></div>
          ) : loading && !data ? (
            <div className="p-4"><LoadingBlock rows={8} /></div>
          ) : !data ? (
            <div className="p-4"><EmptyState title="No query executed yet" description="Filters run as indexed $match stages inside a $unionWith pipeline across the five collections." /></div>
          ) : data.results.length === 0 ? (
            <div className="p-4"><EmptyState title="No events match these filters" description="Try widening the time range or removing a filter." /></div>
          ) : (
            <ResultsTable rows={data.results} onSelect={setSelected} />
          )}
          {data && !data.note && data.total > data.pageSize && (
            <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
              <span>Page {data.page} of {fmtNum(pages)}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" disabled={data.page <= 1 || loading} onClick={() => run(filters, data.page - 1)} aria-label="Previous page">
                  <ChevronLeft className="size-4" />
                </Button>
                <Button size="sm" variant="outline" disabled={data.page >= pages || loading} onClick={() => run(filters, data.page + 1)} aria-label="Next page">
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </Panel>
        {data && <PipelineView pipeline={data.pipeline} root={data.root} />}
      </div>
      <EventDrawer event={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

function ResultsTable({ rows, onSelect, extra }: { rows: (UEvent & Record<string, unknown>)[]; onSelect: (e: UEvent) => void; extra?: (r: UEvent & Record<string, unknown>) => ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="px-4 py-2 text-left font-medium">Timestamp</th>
            <th className="px-2 py-2 text-left font-medium">Collection</th>
            <th className="px-2 py-2 text-left font-medium">Event</th>
            <th className="px-2 py-2 text-left font-medium">Customer</th>
            <th className="px-2 py-2 text-left font-medium">Transaction</th>
            <th className="px-2 py-2 text-left font-medium">Status</th>
            <th className="px-4 py-2 text-right font-medium">{extra ? 'Score' : 'Amount'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.sourceCollection}-${r.eventId}`} onClick={() => onSelect(r)} className="cursor-pointer border-b border-border/60 hover:bg-accent/40">
              <td className="px-4 py-2 font-mono text-xs whitespace-nowrap text-muted-foreground">{fmtDateTime(r.timestamp as unknown as string)}</td>
              <td className="px-2 py-2"><CollectionBadge collection={r.sourceCollection} /></td>
              <td className="max-w-[260px] px-2 py-2">
                <div className="truncate font-mono text-xs">{r.eventType}</div>
                <div className="truncate text-xs text-muted-foreground">{r.description}</div>
              </td>
              <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}><IdLink kind="customer" id={r.customerId} /></td>
              <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}><IdLink kind="transaction" id={r.transactionId} /></td>
              <td className="px-2 py-2"><StatusBadge status={r.status} /></td>
              <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                {extra ? extra(r) : fmtEUR((r.payload as { amountMinor?: number })?.amountMinor)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------------- Full-text ---------------- */

const TEXT_EXAMPLES = ['customer onboarding rejected', 'transaction settlement timeout', 'notification delivery failed', 'invalid state transition', 'DEAN assignment error']

function TextSearch({ initial }: { initial?: string }) {
  const { data: h } = useHealth()
  const [q, setQ] = useState(initial ?? '')
  const [colls, setColls] = useState<string[]>([...COLLECTION_LIST])
  const [data, setData] = useState<TextResp | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<UEvent | null>(null)

  async function run(query = q) {
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    try {
      setData(await fetcher<TextResp>(`/api/search/text?q=${encodeURIComponent(query)}&collections=${colls.join(',')}`))
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }

  const atlas = h?.atlasSearch
  return (
    <div className="flex flex-col gap-4">
      <div className={cn('rounded-lg border px-4 py-3 text-sm', atlas ? 'border-primary/30 bg-primary/5' : 'border-warning/30 bg-warning/5')}>
        {atlas ? (
          <span><strong className="text-primary">ATLAS SEARCH AVAILABLE.</strong> Queries run <code className="font-mono text-xs">$search</code> with index <code className="font-mono text-xs">{h?.searchIndexName}</code> per collection.</span>
        ) : (
          <span><strong className="text-warning">LIMITED FALLBACK SEARCH.</strong> MongoDB Search is not available in this environment ({h?.mode === 'LOCAL_DEMO' ? 'LOCAL DEMO' : 'search index missing'}). Results use a clearly labeled stemmed keyword matcher with term-frequency scoring — not MongoDB Search.</span>
        )}
      </div>
      <Panel title="Keyword search" description="Descriptions, error messages, failure reasons, notification errors and operational metadata">
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void run() }}>
          <div className="flex gap-2">
            <label htmlFor="text-q" className="sr-only">Keywords</label>
            <input id="text-q" className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. notification delivery failed" />
            <Button type="submit" disabled={loading || !q.trim()}>{loading ? <Spinner /> : <Search className="size-4" aria-hidden />}Search</Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TEXT_EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => { setQ(ex); void run(ex) }} className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground">
                {ex}
              </button>
            ))}
          </div>
          <fieldset className="flex flex-wrap gap-3 text-xs">
            <legend className="sr-only">Collections</legend>
            {COLLECTION_LIST.map((c) => (
              <label key={c} className="flex items-center gap-1.5">
                <input type="checkbox" className="accent-primary" checked={colls.includes(c)} onChange={(e) => setColls((s) => (e.target.checked ? [...s, c] : s.filter((x) => x !== c)))} />
                <span className="font-mono">{c}</span>
              </label>
            ))}
          </fieldset>
        </form>
      </Panel>
      {error ? <ErrorState error={error} onRetry={() => run()} /> : null}
      {data && (
        <Panel title={`${data.results.length} ranked results`} description={data.note} actions={<span className="rounded border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">{data.engine}</span>} bodyClassName="p-0">
          {data.results.length === 0 ? (
            <div className="p-4"><EmptyState title="No matching events" description="Try other keywords or include more collections." /></div>
          ) : (
            <ul className="divide-y">
              {data.results.map((r) => (
                <li key={`${r.sourceCollection}-${r.eventId}`}>
                  <button onClick={() => setSelected(r)} className="flex w-full flex-col gap-1.5 px-4 py-3 text-left hover:bg-accent/40">
                    <div className="flex flex-wrap items-center gap-2">
                      <CollectionBadge collection={r.sourceCollection} />
                      <span className="font-mono text-xs">{r.eventType}</span>
                      <StatusBadge status={r.status} />
                      <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
                        score {r.score.toFixed(3)} · norm {r.normalizedScore.toFixed(2)}
                      </span>
                    </div>
                    {r.highlights?.length ? (
                      r.highlights.slice(0, 2).map((hl, i) => (
                        <p key={i} className="text-sm text-muted-foreground">
                          <span className="mr-1.5 font-mono text-[10px] uppercase text-muted-foreground/70">{hl.path}</span>
                          {hl.texts.map((t, j) => (t.type === 'hit' ? <mark key={j} className="rounded bg-primary/20 px-0.5 text-foreground">{t.value}</mark> : <span key={j}>{t.value}</span>))}
                        </p>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">{r.description}</p>
                    )}
                    <div className="flex gap-3 font-mono text-[11px] text-muted-foreground">
                      <span>{r.customerId}</span>
                      {r.transactionId && <span>{r.transactionId}</span>}
                      <span>{fmtDateTime(r.timestamp as unknown as string)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
      {data && <PipelineView pipeline={data.executed} label="Per-collection search executions (merged client-side of the database)" />}
      <EventDrawer event={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

/* ---------------- Compare ---------------- */

function CompareSearch({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial)
  const [state, setState] = useState<{ filter?: FilterResp | Error; text?: TextResp | Error; vector?: VectorResp | Error; loading: boolean }>({ loading: false })
  const [selected, setSelected] = useState<UEvent | null>(null)

  async function run(query = q) {
    if (!query.trim()) return
    setState({ loading: true })
    const wrap = <T,>(p: Promise<T>) => p.catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))))
    const [filter, text, vector] = await Promise.all([
      wrap(postJson<FilterResp>('/api/search/filter', { filters: toBody(idFilter(query)), pageSize: 10 })),
      wrap(fetcher<TextResp>(`/api/search/text?q=${encodeURIComponent(query)}`)),
      wrap(fetcher<VectorResp>(`/api/search/vector?q=${encodeURIComponent(query)}`)),
    ])
    setState({ filter, text, vector, loading: false })
  }

  const [booted, setBooted] = useState(false)
  if (!booted) {
    setBooted(true)
    void run(initial)
  }

  const presets = ['TX-2026-990004', 'notification delivery failed', 'Find cases where a transaction succeeded but the customer notification failed']
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Run the same investigation three ways" description="Identifiers suit structured filters; keywords suit full-text; natural-language questions suit vector search.">
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void run() }}>
          <div className="flex gap-2">
            <label htmlFor="cmp-q" className="sr-only">Investigation</label>
            <input id="cmp-q" className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} />
            <Button type="submit" disabled={state.loading}>{state.loading ? <Spinner /> : <Search className="size-4" aria-hidden />}Run all</Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button key={p} type="button" onClick={() => { setQ(p); void run(p) }} className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground">{p}</button>
            ))}
          </div>
        </form>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-3">
        <CompareColumn
          title="Structured filter search"
          tech="Secondary indexes + $match / $unionWith"
          bullets={['Exact identifiers', 'Date ranges & states', 'Precise operational queries']}
          example={`{ $match: ${JSON.stringify(toBody(idFilter(q)))} }`}
          loading={state.loading}
          result={state.filter}
          render={(d: FilterResp) => ({ count: d.total, rows: d.results.slice(0, 6).map((r) => ({ r, right: r.status })) })}
          onSelect={setSelected}
        />
        <CompareColumn
          title="Full-text search"
          tech="MongoDB Search ($search)"
          bullets={['Keywords & error text', 'Relevance ranking', 'Highlighting']}
          example={`{ $search: { index: 'audit_text', text: { query: '${q.slice(0, 40)}', path: [...] } } }`}
          loading={state.loading}
          result={state.text}
          render={(d: TextResp) => ({ count: d.results.length, badge: d.engine, rows: d.results.slice(0, 6).map((r) => ({ r, right: r.score.toFixed(2) })) })}
          onSelect={setSelected}
        />
        <CompareColumn
          title="Vector search"
          tech="MongoDB Atlas Vector Search ($vectorSearch)"
          bullets={['Semantic similarity', 'Natural-language questions', 'Similar incidents']}
          example={`{ $vectorSearch: { index: 'audit_vector', path: 'embedding', queryVector: embed('${q.slice(0, 30)}…'), numCandidates: 200, limit: 20 } }`}
          loading={state.loading}
          result={state.vector}
          render={(d: VectorResp) =>
            d.available
              ? { count: d.results.length, badge: d.engine, rows: d.results.slice(0, 6).map((r) => ({ r, right: r.score.toFixed(3) })) }
              : { count: 0, unavailable: d.reason, rows: [] }
          }
          onSelect={setSelected}
        />
      </div>
      <EventDrawer event={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

function CompareColumn<T>({
  title,
  tech,
  bullets,
  example,
  loading,
  result,
  render,
  onSelect,
}: {
  title: string
  tech: string
  bullets: string[]
  example: string
  loading: boolean
  result?: T | Error
  render: (d: T) => { count: number; badge?: string; unavailable?: string; rows: { r: UEvent; right: string }[] }
  onSelect: (e: UEvent) => void
}) {
  const v = result && !(result instanceof Error) ? render(result) : null
  return (
    <Panel title={title} description={tech} actions={v?.badge ? <span className="rounded border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{v.badge}</span> : null}>
      <div className="flex flex-col gap-3">
        <ul className="flex flex-wrap gap-1.5">
          {bullets.map((b) => <li key={b} className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{b}</li>)}
        </ul>
        <pre className="overflow-x-auto rounded-md border bg-background/60 p-2 font-mono text-[11px] text-muted-foreground">{example}</pre>
        {loading ? (
          <LoadingBlock rows={4} />
        ) : result instanceof Error ? (
          <ErrorState error={result} />
        ) : v?.unavailable ? (
          <p className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-warning">{v.unavailable}</p>
        ) : v ? (
          <>
            <p className="text-xs text-muted-foreground">{fmtNum(v.count)} results</p>
            {v.rows.length === 0 ? (
              <p className="text-xs text-muted-foreground">No results — this technique is not suited to this input.</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-md border">
                {v.rows.map(({ r, right }) => (
                  <li key={`${r.sourceCollection}-${r.eventId}`}>
                    <button onClick={() => onSelect(r)} className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-accent/40">
                      <span className={cn('size-2 shrink-0 rounded-full', COLLECTION_META[r.sourceCollection]?.dot)} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-xs">{r.eventType}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{r.customerId} {r.transactionId ?? ''}</span>
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">{right}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </div>
    </Panel>
  )
}

export { ResultsTable }
