'use client'

import useSWR from 'swr'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Play, Pause, Square, RefreshCcw, Database, KeyRound, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ADMIN_TOKEN_KEY, COLLECTION_LIST, COLLECTION_META, fetcher, fmtMs, fmtNum, fmtRel, fmtTime, postJson, useHealth } from '@/lib/de/client'
import type { UEvent } from '@/lib/de/queries'
import { SCENARIOS } from '@/lib/de/scenarios-meta'
import { cn } from '@/lib/utils'
import { ErrorState, PageHeader, Panel, Spinner, StatusBadge, inputClass } from './ui'

type LogRow = { eventId: string; topic: string; collection: string; result: string; status: string; latencyMs: number; partition: number; offset: number; dlqId?: string; errorCode?: string; errorMessage?: string; action: string; at: string }
type Sim = { state: 'RUNNING' | 'PAUSED' | 'STOPPED'; rate: number; failureRate: number; seed: number | null; generated: number; ticks: number; startedAt: string | null; log: LogRow[]; queued: number }

const ACTIONS: { id: string; label: string }[] = [
  { id: 'onboarding-journey', label: 'Generate onboarding journey' },
  { id: 'offboarding-journey', label: 'Generate offboarding journey' },
  { id: 'dean-assignment', label: 'Generate DEAN assignment' },
  { id: 'successful-transaction', label: 'Generate successful transaction' },
  { id: 'failed-transaction', label: 'Generate failed transaction' },
  { id: 'notification-failure', label: 'Generate notification failure' },
  { id: 'dlq-error', label: 'Generate DLQ error' },
  { id: 'complete-journey', label: 'Generate complete customer journey' },
  { id: 'single-event', label: 'Generate single event' },
  { id: 'malformed-event', label: 'Generate malformed event' },
  { id: 'duplicate-event', label: 'Generate duplicate event' },
  { id: 'replay', label: 'Replay recent event' },
]

export function SimulatorView({ autostart }: { autostart?: boolean }) {
  const router = useRouter()
  const { data: h, mutate: mutateHealth } = useHealth()
  const { data: sim, mutate } = useSWR<Sim>('/api/simulator', fetcher, { refreshInterval: 1500, keepPreviousData: true })
  const { data: recent } = useSWR<{ events: UEvent[] }>('/api/events?limit=200', fetcher, { refreshInterval: 2000, keepPreviousData: true })
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [lastFocus, setLastFocus] = useState<Record<string, string | null> | null>(null)
  const [rate, setRate] = useState<number | null>(null)
  const [fail, setFail] = useState<number | null>(null)
  const [seedText, setSeedText] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetProgress, setResetProgress] = useState<string | null>(null)
  const [token, setToken] = useState(() => (typeof window === 'undefined' ? '' : window.sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? ''))

  async function call<T>(key: string, body: unknown): Promise<T | undefined> {
    setBusy(key)
    setErr(null)
    try {
      const r = await postJson<T>('/api/simulator', body)
      await mutate()
      void mutateHealth()
      return r
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(null)
    }
  }

  const [booted, setBooted] = useState(false)
  if (!booted && sim) {
    setBooted(true)
    if (autostart && sim.state !== 'RUNNING') void call('start', { type: 'control', command: 'start' })
  }

  async function reset() {
    setBusy('reset')
    setErr(null)
    try {
      const r = await postJson<{ done: boolean; batches?: number; total?: number }>('/api/admin', { action: 'reset-seed', confirm: 'RESET' })
      if (!r.done && r.batches) {
        for (let i = 0; i < r.batches; i++) {
          setResetProgress(`Seeding batch ${i + 1} / ${r.batches} (${fmtNum(r.total)} documents)`)
          await postJson('/api/admin', { action: 'seed-batch', batch: i })
        }
        setResetProgress('Ensuring indexes…')
        await postJson('/api/admin', { action: 'ensure-indexes' })
      }
      setResetProgress('Reset complete — deterministic demo dataset loaded.')
      setConfirmReset(false)
      await mutate()
      void mutateHealth()
    } catch (e) {
      setErr(e)
      setResetProgress(null)
    } finally {
      setBusy(null)
    }
  }

  const s = sim
  const curRate = rate ?? s?.rate ?? 2
  const curFail = fail ?? s?.failureRate ?? 0.15
  const now = Date.now()
  const perColl = Object.fromEntries(
    COLLECTION_LIST.map((c) => {
      const evs = (recent?.events ?? []).filter((e) => e.sourceCollection === c)
      const last = evs[0]
      const lastMin = evs.filter((e) => now - new Date(e.ingestedAt as unknown as string).getTime() < 60_000).length
      return [c, { last, perSec: lastMin / 60 }]
    }),
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Event Simulator Control Center"
        title="Simulated Kafka topics → five MongoDB collections"
        description="Request-triggered, Vercel-compatible simulation: while RUNNING, the console calls a tick endpoint that releases due events through the same Zod validation and idempotent persistence pipeline. Partitions and offsets are simulated."
        actions={
          <span className="rounded border px-2 py-1 font-mono text-[11px] text-muted-foreground">Kafka · GCP Pub/Sub compatible architecture (simulated)</span>
        }
      />

      {h?.adminRequired && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
          <KeyRound className="size-4 text-warning" aria-hidden />
          <span>This deployment protects simulator and admin controls. Enter the demo admin token:</span>
          <label htmlFor="admin-token" className="sr-only">Admin token</label>
          <input id="admin-token" type="password" className={cn(inputClass, 'h-8 w-56')} value={token} onChange={(e) => setToken(e.target.value)} />
          <Button size="sm" variant="outline" onClick={() => window.sessionStorage.setItem(ADMIN_TOKEN_KEY, token)}>Save for session</Button>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-5">
        {COLLECTION_LIST.map((c) => {
          const m = COLLECTION_META[c]
          const pc = perColl[c] as { last?: UEvent; perSec: number }
          return (
            <div key={c} className="flex flex-col gap-2 rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2">
                <span className={cn('size-2 rounded-full', m.dot, s?.state === 'RUNNING' && 'animate-pulse')} aria-hidden />
                <span className="truncate font-mono text-xs">{m.topic}</span>
              </div>
              <span className="text-2xl font-semibold tabular-nums">{fmtNum(h?.counts?.[c])}</span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">→ {c}</span>
              <dl className="grid grid-cols-2 gap-1 text-[11px]">
                <dt className="text-muted-foreground">Last event</dt>
                <dd className="text-right font-mono">{pc.last ? fmtRel(pc.last.ingestedAt as unknown as string, now) : '—'}</dd>
                <dt className="text-muted-foreground">Throughput</dt>
                <dd className="text-right font-mono">{pc.perSec.toFixed(2)}/s</dd>
                <dt className="text-muted-foreground">Latest</dt>
                <dd className="flex justify-end">{pc.last ? <StatusBadge status={pc.last.audit?.processingResult ?? pc.last.status} /> : '—'}</dd>
              </dl>
            </div>
          )
        })}
      </div>

      {err ? <ErrorState error={err} /> : null}

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <div className="flex flex-col gap-4">
          <Panel title="Streaming" description={s ? `${s.state} · ${fmtNum(s.generated)} generated · ${s.queued} queued` : 'Loading…'}>
            <div className="flex flex-col gap-4">
              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => call('start', { type: 'control', command: 'start' })} disabled={!!busy || s?.state === 'RUNNING'}>
                  {busy === 'start' ? <Spinner /> : <Play className="size-4" aria-hidden />}Start
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => call('pause', { type: 'control', command: 'pause' })} disabled={!!busy || s?.state !== 'RUNNING'}>
                  <Pause className="size-4" aria-hidden />Pause
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => call('stop', { type: 'control', command: 'stop' })} disabled={!!busy || s?.state === 'STOPPED'}>
                  <Square className="size-4" aria-hidden />Stop
                </Button>
              </div>
              <Slider id="rate" label="Event generation rate" value={curRate} min={0.2} max={20} step={0.2} fmt={(v) => `${v.toFixed(1)} events/s`} onChange={setRate} onCommit={(v) => call('cfg', { type: 'configure', rate: v })} />
              <Slider id="fail" label="Failure probability" value={curFail} min={0} max={0.9} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={setFail} onCommit={(v) => call('cfg', { type: 'configure', failureRate: v })} />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="seed" className="text-xs text-muted-foreground">Deterministic seed {s?.seed != null ? <span className="font-mono text-foreground">(active: {s.seed})</span> : '(random)'}</label>
                <div className="flex gap-2">
                  <input id="seed" className={cn(inputClass, 'h-8')} inputMode="numeric" placeholder="e.g. 42" value={seedText} onChange={(e) => setSeedText(e.target.value.replace(/\D/g, ''))} />
                  <Button size="sm" variant="outline" onClick={() => call('cfg', { type: 'configure', seed: seedText ? Number(seedText) : null })}>{seedText ? 'Apply' : 'Use random'}</Button>
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Generate on demand" description="Each action persists immediately through the ingestion pipeline">
            <div className="grid grid-cols-1 gap-1.5">
              {ACTIONS.map((a) => (
                <Button
                  key={a.id}
                  variant="outline"
                  size="sm"
                  className="justify-start"
                  disabled={!!busy}
                  onClick={async () => {
                    const r = await call<{ focus: Record<string, string | null> }>(a.id, { type: 'action', action: a.id })
                    if (r) setLastFocus(r.focus)
                  }}
                >
                  {busy === a.id ? <Spinner /> : <Zap className="size-3.5 text-primary" aria-hidden />}
                  {a.label}
                </Button>
              ))}
            </div>
            {lastFocus && (lastFocus.customerId || lastFocus.transactionId) && (
              <div className="mt-3 flex flex-wrap gap-3 rounded-md border bg-background/50 p-2 text-xs">
                <span className="text-muted-foreground">Last generated:</span>
                {lastFocus.customerId && <Link className="font-mono text-primary hover:underline" href={`/customers/${lastFocus.customerId}`}>{lastFocus.customerId}</Link>}
                {lastFocus.transactionId && <Link className="font-mono text-primary hover:underline" href={`/transactions/${lastFocus.transactionId}`}>{lastFocus.transactionId}</Link>}
              </div>
            )}
          </Panel>

          <Panel title="Demo data" description={`Database: ${h?.database ?? '—'} · ${h?.mode === 'ATLAS_CONNECTED' ? 'ATLAS CONNECTED' : 'LOCAL DEMO (in-memory)'}`}>
            <div className="flex flex-col gap-2">
              {!confirmReset ? (
                <Button variant="outline" onClick={() => setConfirmReset(true)} disabled={!!busy}>
                  <RefreshCcw className="size-4" aria-hidden />Reset and Seed Demo
                </Button>
              ) : (
                <div className="flex flex-col gap-2 rounded-md border border-destructive/30 p-3">
                  <p className="text-xs">
                    Deletes all documents in the five collections of <span className="font-mono">{h?.database}</span> only, then reseeds ~10,000 deterministic events in bounded batches.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" onClick={reset} disabled={!!busy}>{busy === 'reset' ? <Spinner /> : null}Confirm reset</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)} disabled={busy === 'reset'}>Cancel</Button>
                  </div>
                </div>
              )}
              {resetProgress && <p role="status" className="text-xs text-muted-foreground">{resetProgress}</p>}
              {h?.mode === 'ATLAS_CONNECTED' && (
                <Button variant="ghost" size="sm" onClick={() => postJson('/api/admin', { action: 'ensure-indexes' }).then(() => mutateHealth()).catch(setErr)}>
                  <Database className="size-4" aria-hidden />Ensure indexes (B-tree, Search, Vector)
                </Button>
              )}
            </div>
          </Panel>

          <Panel title="Load scenario" description="Deterministic showcase journeys with stable IDs">
            <ul className="flex flex-col gap-1.5">
              {SCENARIOS.map((sc) => (
                <li key={sc.id} className="flex items-center gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded bg-muted font-mono text-xs">{sc.id}</span>
                  <span className="min-w-0 flex-1 truncate text-xs" title={sc.summary}>{sc.title}</span>
                  <Button size="sm" variant="ghost" className="h-7 text-primary" onClick={() => router.push(sc.href)}>Load</Button>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <Panel title="Activity log" description="Generated and persisted events (latest first). Offsets and partitions are simulated." bodyClassName="p-0">
          {!s?.log.length ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No events generated in this session yet. Start streaming or use an on-demand action.</p>
          ) : (
            <div className="max-h-[900px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-4 py-2 text-left font-medium">Time</th>
                    <th className="px-2 py-2 text-left font-medium">Action</th>
                    <th className="px-2 py-2 text-left font-medium">Topic</th>
                    <th className="px-2 py-2 text-left font-medium">Partition / offset (sim.)</th>
                    <th className="px-2 py-2 text-left font-medium">Status</th>
                    <th className="px-2 py-2 text-left font-medium">Result</th>
                    <th className="px-4 py-2 text-right font-medium">Persist latency</th>
                  </tr>
                </thead>
                <tbody>
                  {s.log.map((l, i) => (
                    <tr key={`${l.eventId}-${i}`} className="border-b border-border/60">
                      <td className="px-4 py-1.5 font-mono text-muted-foreground">{fmtTime(l.at)}</td>
                      <td className="px-2 py-1.5 font-mono">{l.action}</td>
                      <td className="px-2 py-1.5 font-mono">{l.topic}</td>
                      <td className="px-2 py-1.5 font-mono text-muted-foreground">p{l.partition} · #{l.offset}</td>
                      <td className="px-2 py-1.5"><StatusBadge status={l.status} /></td>
                      <td className="px-2 py-1.5">
                        <StatusBadge status={l.result} />
                        {l.errorCode && <span className="ml-1.5 font-mono text-[10px] text-destructive">{l.errorCode}</span>}
                      </td>
                      <td className="px-4 py-1.5 text-right font-mono tabular-nums">{fmtMs(l.latencyMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

function Slider({ id, label, value, min, max, step, fmt, onChange, onCommit }: { id: string; label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void; onCommit: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-xs">
        <label htmlFor={id} className="text-muted-foreground">{label}</label>
        <span className="font-mono">{fmt(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        className="accent-primary"
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
      />
    </div>
  )
}
