'use client'

import useSWR from 'swr'
import { useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { COLLECTION_LIST, COLLECTION_META, fetcher, fmtMs, fmtTime, useHealth } from '@/lib/de/client'
import type { UEvent } from '@/lib/de/queries'
import { Button } from '@/components/ui/button'
import { CollectionBadge, EmptyState, ErrorState, IdLink, LoadingBlock, PageHeader, Panel, PipelineView, StatusBadge, inputClass, selectClass } from './ui'
import { EventDrawer } from './event-drawer'

type Resp = { events: UEvent[]; pipeline: unknown; root: string; version: number }

const STATUSES = ['', 'FAILED', 'REJECTED', 'SETTLED', 'DELIVERED', 'DEAD_LETTERED', 'OPEN', 'ACTIVATED', 'REQUESTED', 'BLOCKED', 'RETRY_PENDING']

export function LiveEventsView() {
  const [paused, setPaused] = useState(false)
  const [topic, setTopic] = useState('')
  const [status, setStatus] = useState('')
  const [customer, setCustomer] = useState('')
  const [range, setRange] = useState('')
  const [selected, setSelected] = useState<UEvent | null>(null)
  const seen = useRef<Set<string> | null>(null)
  const { data: h } = useHealth()

  const qs = new URLSearchParams({ limit: '120' })
  if (topic) qs.set('topic', topic)
  if (status) qs.set('status', status)
  if (customer.trim()) qs.set('customerId', customer.trim().toUpperCase())
  if (range) qs.set('range', range)
  const { data, error, isLoading, mutate } = useSWR<Resp>(`/api/events?${qs}`, fetcher, {
    refreshInterval: paused ? 0 : 2000,
    keepPreviousData: true,
  })

  const prev = seen.current
  const fresh = new Set<string>()
  if (data) {
    if (prev) for (const e of data.events) if (!prev.has(e.eventId)) fresh.add(e.eventId)
    seen.current = new Set(data.events.map((e) => e.eventId))
  }
  const running = h?.simulation.state === 'RUNNING'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="02 · Live Event Monitor"
        title="Events as they are persisted"
        description="One $unionWith pipeline streams the five collections, sorted by ingestion time. Ingestion latency is measured from producer timestamp to successful write. Partitions and offsets are simulated."
        actions={
          <Button variant={paused ? 'default' : 'outline'} size="sm" onClick={() => setPaused((p) => !p)}>
            {paused ? <Play /> : <Pause />}
            {paused ? 'Resume live updates' : 'Pause live updates'}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {COLLECTION_LIST.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setTopic((t) => (t === COLLECTION_META[c].topic ? '' : COLLECTION_META[c].topic))}
            aria-pressed={topic === COLLECTION_META[c].topic}
            className="flex flex-col gap-1 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/40 aria-pressed:border-primary/50"
          >
            <CollectionBadge collection={c} showTopic />
            <span className="font-mono text-lg tabular-nums">{h ? h.counts[c].toLocaleString('en-US') : '—'}</span>
            <span className="font-mono text-[10.5px] text-muted-foreground">→ {c}</span>
          </button>
        ))}
      </div>

      <Panel
        bodyClassName="p-0"
        title={
          <span className="flex items-center gap-2">
            Event stream
            <span className={`inline-flex items-center gap-1 font-mono text-[10.5px] ${paused ? 'text-warning' : running ? 'text-success' : 'text-muted-foreground'}`}>
              ● {paused ? 'PAUSED' : running ? 'STREAMING · polling 2s' : 'POLLING 2s · simulator idle'}
            </span>
          </span>
        }
        description={`Transport: simulated Kafka topics (GCP Pub/Sub compatible) · Data source: ${h?.store === 'atlas' ? 'MongoDB Atlas' : 'local in-memory engine'}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="le-topic">Topic</label>
            <select id="le-topic" className={selectClass} value={topic} onChange={(e) => setTopic(e.target.value)}>
              <option value="">All topics</option>
              {COLLECTION_LIST.map((c) => (
                <option key={c} value={COLLECTION_META[c].topic}>{COLLECTION_META[c].topic}</option>
              ))}
            </select>
            <label className="sr-only" htmlFor="le-status">Status</label>
            <select id="le-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s || 'All statuses'}</option>
              ))}
            </select>
            <label className="sr-only" htmlFor="le-range">Time range</label>
            <select id="le-range" className={selectClass} value={range} onChange={(e) => setRange(e.target.value)}>
              <option value="">Any time</option>
              <option value="5">Last 5 min</option>
              <option value="60">Last hour</option>
              <option value="1440">Last 24h</option>
            </select>
            <label className="sr-only" htmlFor="le-cust">Customer ID</label>
            <input id="le-cust" className={`${inputClass} w-36`} placeholder="Customer ID" value={customer} onChange={(e) => setCustomer(e.target.value)} />
          </div>
        }
      >
        {error && !data ? (
          <div className="p-4"><ErrorState error={error} onRetry={() => mutate()} /></div>
        ) : isLoading && !data ? (
          <div className="p-4"><LoadingBlock rows={10} /></div>
        ) : !data?.events.length ? (
          <div className="p-4"><EmptyState title="No events match these filters" description="Clear filters or start the simulator to stream new events." /></div>
        ) : (
          <div className="max-h-[38rem] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-card text-left text-[11px] text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-2 font-medium">Timestamp</th>
                  <th className="px-2 py-2 font-medium">Topic</th>
                  <th className="px-2 py-2 font-medium">Event type</th>
                  <th className="px-2 py-2 font-medium">Customer</th>
                  <th className="px-2 py-2 font-medium">Transaction</th>
                  <th className="px-2 py-2 font-medium">Correlation</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Part · Offset</th>
                  <th className="px-4 py-2 text-right font-medium">Latency</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {data.events.map((e) => {
                  const a = e.audit as unknown as { partition?: number; offset?: number; ingestionLatencyMs?: number }
                  return (
                    <tr
                      key={e.eventId}
                      onClick={() => setSelected(e)}
                      className={`cursor-pointer border-b border-border/60 hover:bg-accent/40 ${fresh.has(e.eventId) ? 'row-new' : ''}`}
                    >
                      <td className="whitespace-nowrap px-4 py-1.5 text-muted-foreground">{fmtTime(e.timestamp)}</td>
                      <td className="px-2 py-1.5"><CollectionBadge collection={e.sourceCollection} showTopic /></td>
                      <td className="max-w-56 truncate px-2 py-1.5">{e.eventType}</td>
                      <td className="px-2 py-1.5"><IdLink kind="customer" id={e.customerId} /></td>
                      <td className="px-2 py-1.5"><IdLink kind="transaction" id={e.transactionId} /></td>
                      <td className="px-2 py-1.5 text-muted-foreground">{e.correlationId ?? '—'}</td>
                      <td className="px-2 py-1.5"><StatusBadge status={e.status} /></td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground" title="Simulated partition and offset">
                        {a.partition !== undefined ? `p${a.partition} · ${a.offset}` : '—'}
                      </td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{fmtMs(a.ingestionLatencyMs)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {data && <PipelineView pipeline={data.pipeline} root={data.root} label="Unified stream pipeline ($unionWith)" />}
      <EventDrawer event={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
