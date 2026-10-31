'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Brain, CheckCircle2, CircleHelp, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { COLLECTION_LIST, fetcher, fmtDateTime, useHealth } from '@/lib/de/client'
import type { UEvent } from '@/lib/de/queries'
import { cn } from '@/lib/utils'
import { CollectionBadge, EmptyState, ErrorState, LoadingBlock, PageHeader, Panel, PipelineView, Spinner, StatusBadge, inputClass } from './ui'
import { EventDrawer } from './event-drawer'

type VectorHit = UEvent & { score: number; matchedText: string; verified: boolean | null; facts: Record<string, unknown> }
type VectorResp =
  | { available: false; reason: string }
  | {
      available: true
      query: string
      model: string
      dimensions: number | null
      engine: 'ATLAS_VECTOR_SEARCH' | 'EXACT_KNN'
      results: VectorHit[]
      executed: unknown[]
      verification: { rule: string; description: string; verifiedCount: number; checked: number } | null
    }

const EXAMPLES = [
  'Find customers who experienced problems activating their Digital Euro wallet.',
  'Show transactions that failed after authorization.',
  'Find similar errors related to notification delivery.',
  'Identify onboarding requests rejected due to validation problems.',
  'Find cases where a transaction succeeded but the customer notification failed.',
]

export function SemanticSearchView({ initialQuery }: { initialQuery?: string }) {
  const { data: h } = useHealth()
  const [q, setQ] = useState(initialQuery ?? '')
  const [colls, setColls] = useState<string[]>([...COLLECTION_LIST])
  const [data, setData] = useState<VectorResp | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<UEvent | null>(null)

  async function run(query = q) {
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    try {
      setData(await fetcher<VectorResp>(`/api/search/vector?q=${encodeURIComponent(query)}&collections=${colls.join(',')}`))
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }

  const [booted, setBooted] = useState(false)
  if (!booted) {
    setBooted(true)
    if (initialQuery) void run(initialQuery)
  }

  const emb = h?.embeddings
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Semantic Investigation"
        title="Investigate operational events using meaning, not just keywords."
        description="Embeddings are stored inside the five event collections. Vector similarity retrieves candidates; deterministic correlation queries verify cross-event conditions."
      />
      <div className="grid gap-3 md:grid-cols-3">
        <CapCard label="Embedding model" value={emb?.model ?? '—'} sub={emb ? (emb.available ? `${emb.dimensions ?? '?'} dimensions · ${emb.provider ?? 'AI Gateway'}` : emb.reason ?? 'Unavailable') : 'Loading…'} ok={!!emb?.available} />
        <CapCard
          label="Retrieval engine"
          value={h?.atlasVectorSearch ? 'Atlas Vector Search' : 'Exact k-NN (cosine)'}
          sub={h?.atlasVectorSearch ? `$vectorSearch on index ${h.vectorIndexName}` : 'LOCAL DEMO: exact cosine similarity over the same stored embeddings — real vectors, no keyword substitution'}
          ok={!!h?.atlasVectorSearch}
        />
        <CapCard label="Vector-enabled collections" value={`${h?.vectorCollections?.length ?? 0} / 5`} sub={h?.vectorCollections?.join(', ') || 'Embeddings generated on ingest'} ok={(h?.vectorCollections?.length ?? 0) > 0} />
      </div>

      <Panel title="Ask a question" description="Natural-language queries are embedded with the same model used for stored events">
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void run() }}>
          <div className="flex gap-2">
            <label htmlFor="sem-q" className="sr-only">Question</label>
            <input id="sem-q" className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Describe the incident you are investigating…" />
            <Button type="submit" disabled={loading || !q.trim()}>{loading ? <Spinner /> : <Brain className="size-4" aria-hidden />}Investigate</Button>
          </div>
          <ul className="flex flex-col gap-1">
            {EXAMPLES.map((ex) => (
              <li key={ex}>
                <button type="button" onClick={() => { setQ(ex); void run(ex) }} className="text-left text-sm text-muted-foreground hover:text-primary">
                  {'→ '}{ex}
                </button>
              </li>
            ))}
          </ul>
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
      {loading && !data ? <LoadingBlock rows={6} /> : null}
      {data && !data.available && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm text-warning">
          <strong>True vector search disabled.</strong> {data.reason}
        </div>
      )}
      {data && data.available && (
        <>
          {data.verification && (
            <div className="flex flex-col gap-1 rounded-lg border border-info/30 bg-info/5 p-4 text-sm">
              <span className="font-medium text-info">Deterministic verification applied</span>
              <span className="text-muted-foreground">
                {data.verification.description} {data.verification.verifiedCount} of {data.verification.checked} semantic candidates satisfy the condition when checked against the full event histories. Vector similarity alone is not treated as proof.
              </span>
            </div>
          )}
          <Panel
            title={`${data.results.length} semantically similar events`}
            description={`Model ${data.model} · ${data.dimensions ?? '?'} dims`}
            actions={<span className="rounded border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">{data.engine}</span>}
            bodyClassName="p-0"
          >
            {data.results.length === 0 ? (
              <div className="p-4"><EmptyState title="No candidates" description="No embedded events in the selected collections." /></div>
            ) : (
              <ul className="divide-y">
                {data.results.map((r) => (
                  <li key={`${r.sourceCollection}-${r.eventId}`} className="flex flex-col gap-2 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Verified v={r.verified} />
                      <CollectionBadge collection={r.sourceCollection} />
                      <span className="font-mono text-xs">{r.eventType}</span>
                      <StatusBadge status={r.status} />
                      <div className="ml-auto flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden>
                          <div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(1, r.score)) * 100}%` }} />
                        </div>
                        <span className="font-mono text-xs tabular-nums">{r.score.toFixed(3)}</span>
                      </div>
                    </div>
                    <p className="text-sm">
                      <span className="text-muted-foreground">Matched on: </span>
                      {r.matchedText}
                    </p>
                    {Object.keys(r.facts ?? {}).length > 0 && (
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {Object.entries(r.facts).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('→') : String(v)}`).join('  ·  ')}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span className="font-mono text-muted-foreground">{fmtDateTime(r.timestamp as unknown as string)}</span>
                      <Link href={`/customers/${r.customerId}`} className="font-mono text-primary hover:underline">{r.customerId} journey</Link>
                      {r.transactionId && <Link href={`/transactions/${r.transactionId}`} className="font-mono text-primary hover:underline">{r.transactionId} timeline</Link>}
                      <button onClick={() => setSelected(r)} className="text-muted-foreground hover:text-foreground">Inspect JSON</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <PipelineView pipeline={data.executed} label="Vector search executions per collection" />
        </>
      )}
      <EventDrawer event={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

function Verified({ v }: { v: boolean | null }) {
  if (v === true) return <span className="flex items-center gap-1 text-xs text-success"><CheckCircle2 className="size-3.5" aria-hidden />Verified</span>
  if (v === false) return <span className="flex items-center gap-1 text-xs text-muted-foreground"><XCircle className="size-3.5" aria-hidden />Similar only</span>
  return <span className="flex items-center gap-1 text-xs text-muted-foreground"><CircleHelp className="size-3.5" aria-hidden />Similarity</span>
}

function CapCard({ label, value, sub, ok }: { label: string; value: string; sub: string; ok: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-4">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={cn('size-1.5 rounded-full', ok ? 'bg-success' : 'bg-warning')} aria-hidden />
        {label}
      </span>
      <span className="truncate font-mono text-sm">{value}</span>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </div>
  )
}
