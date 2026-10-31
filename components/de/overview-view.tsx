'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity, AlertOctagon, CheckCircle2, Coins, Database, Gauge, Timer, Users, XCircle } from 'lucide-react'
import { COLLECTION_LIST, COLLECTION_META, fetcher, fmtEUR, fmtMs, fmtNum, fmtPct, fmtRel, fmtTime, useHealth } from '@/lib/de/client'
import type { Dashboard } from '@/lib/de/queries'
import { SCENARIOS } from '@/lib/de/scenarios-meta'
import { CollectionBadge, EmptyState, ErrorState, IdLink, Kpi, LoadingBlock, PageHeader, Panel, PipelineView, StatusBadge } from './ui'
import { EventDrawer } from './event-drawer'

const axis = { stroke: 'var(--muted-foreground)', fontSize: 10, tickLine: false, axisLine: false } as const
const grid = <CartesianGrid stroke="var(--border)" vertical={false} />
const tip = {
  contentStyle: { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 },
  labelStyle: { color: 'var(--muted-foreground)' },
  cursor: { fill: 'oklch(1 0 0 / 4%)' },
}

const TX_COLOR: Record<string, string> = {
  SETTLED: 'var(--success)',
  REJECTED: 'var(--destructive)',
  FAILED: 'var(--destructive)',
  REVERSED: 'var(--warning)',
}

export function OverviewView() {
  const { data, error, isLoading, mutate } = useSWR<Dashboard>('/api/dashboard', fetcher, { refreshInterval: 4000, keepPreviousData: true })
  const { data: h } = useHealth()
  const [selected, setSelected] = useState<Dashboard['critical'][number] | null>(null)

  if (error && !data) return <ErrorState error={error} onRetry={() => mutate()} />
  if (isLoading || !data)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="01 · Executive Overview" title="Operational state of the Digital Euro ecosystem" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <LoadingBlock key={i} rows={2} />
          ))}
        </div>
        <LoadingBlock rows={8} />
      </div>
    )

  const k = data.kpis
  const funnelMax = Math.max(...data.funnel.map((f) => f.customers), 1)
  const hourData = data.throughput24h.map((r) => ({ ...r, label: r.bucket.slice(11, 16) }))
  const minuteData = data.throughput60m.map((r) => ({ ...r, label: r.bucket.slice(11, 16) }))
  const healthy = data.collections.every((c) => c.count > 0)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="01 · Executive Overview"
        title="Operational state of the Digital Euro ecosystem"
        description="Every figure below is computed live by MongoDB aggregation pipelines over the five event collections. Transactions are counted once per transactionId by latest state; customers by their latest onboarding/offboarding state."
        actions={
          <span className="font-mono text-[11px] text-muted-foreground">
            Data freshness: {fmtTime(data.generatedAt)} · {data.store === 'atlas' ? 'Atlas' : 'local in-memory engine'}
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Total events ingested" value={fmtNum(k.totalEvents)} sub="across 5 collections" icon={<Database />} />
        <Kpi label="Active DE customers" value={fmtNum(k.activeCustomers)} sub={`of ${fmtNum(k.totalCustomers)} enrolled`} tone="success" icon={<Users />} />
        <Kpi label="Completed onboardings" value={fmtNum(k.completedOnboardings)} sub="reached ACTIVATED" icon={<CheckCircle2 />} />
        <Kpi label="Digital Euro transactions" value={fmtNum(k.transactions)} sub={`${fmtEUR(k.settledValueMinor)} settled`} icon={<Coins />} />
        <Kpi label="Successful transaction rate" value={fmtPct(k.successRate)} sub="settled / (settled + rejected + failed)" tone={k.successRate > 0.85 ? 'success' : 'warning'} icon={<Gauge />} />
        <Kpi label="Failed events" value={fmtNum(k.failedEvents)} sub="failure states + DLQ entries" tone="danger" icon={<XCircle />} />
        <Kpi label="Open DLQ items" value={fmtNum(k.openDlq)} sub={<Link href="/dead-letter?status=OPEN" className="text-info hover:underline">Open console</Link>} tone={k.openDlq ? 'warning' : 'success'} icon={<AlertOctagon />} />
        <Kpi label="Avg ingestion latency" value={fmtMs(k.avgLatencyMs)} sub="produce → persisted (measured)" tone="info" icon={<Timer />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Event throughput · last 60 minutes"
          description="Events per minute, all topics. Updates automatically while the simulator runs."
          actions={
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <Activity className="size-3.5 text-primary" />
              {fmtNum(minuteData.reduce((a, m) => a + m.n, 0))} events/h
            </span>
          }
        >
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={minuteData} margin={{ left: -20, right: 4, top: 8 }}>
                <defs>
                  <linearGradient id="thr" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                {grid}
                <XAxis dataKey="label" {...axis} interval={9} />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip {...tip} />
                <Area type="monotone" dataKey="n" name="events" stroke="var(--primary)" strokeWidth={1.5} fill="url(#thr)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Operational health" description="Per-collection status from live documents.">
          <ul className="flex flex-col divide-y">
            {data.collections.map((c) => (
              <li key={c.collection} className="flex items-center justify-between gap-3 py-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <CollectionBadge collection={c.collection} />
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    last event {fmtRel(c.lastTs)} · {fmtMs(c.avgLatencyMs)}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-0.5 font-mono text-xs tabular-nums">
                  <span>{fmtNum(c.count)}</span>
                  <span className={c.failed ? 'text-destructive' : 'text-muted-foreground'}>{fmtNum(c.failed)} failed</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <StatusBadge status={healthy ? 'ALL COLLECTIONS RECEIVING' : 'DEGRADED'} className={healthy ? '' : ''} />
            <StatusBadge status={`SIM ${h?.simulation.state ?? '…'}`} />
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Event distribution by topic · last 24 hours" description="Hourly stacked counts per simulated topic ($unionWith + $group).">
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourData} margin={{ left: -20, right: 4, top: 8 }}>
                {grid}
                <XAxis dataKey="label" {...axis} interval={3} />
                <YAxis {...axis} />
                <Tooltip {...tip} />
                {COLLECTION_LIST.map((c) => (
                  <Bar key={c} dataKey={c} name={COLLECTION_META[c].topic} stackId="a" fill={COLLECTION_META[c].color} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            {COLLECTION_LIST.map((c) => (
              <CollectionBadge key={c} collection={c} showTopic />
            ))}
          </div>
        </Panel>

        <Panel title="Customer onboarding funnel" description="Distinct customers that reached each onboarding state.">
          <ol className="flex flex-col gap-2">
            {data.funnel.map((f, i) => (
              <li key={f.stage} className="flex items-center gap-3">
                <span className="w-44 shrink-0 truncate font-mono text-[11px] text-muted-foreground">{f.stage}</span>
                <div className="h-6 flex-1 rounded bg-muted/50">
                  <div
                    className="flex h-6 items-center justify-end rounded bg-primary/70 px-2 font-mono text-[11px] text-primary-foreground transition-[width] duration-500"
                    style={{ width: `${Math.max((f.customers / funnelMax) * 100, 6)}%`, opacity: 1 - i * 0.1 }}
                  >
                    {fmtNum(f.customers)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex gap-4 font-mono text-[11px] text-muted-foreground">
            <span>
              REJECTED <span className="text-destructive">{fmtNum(data.onboardingDropouts.REJECTED)}</span>
            </span>
            <span>
              FAILED <span className="text-destructive">{fmtNum(data.onboardingDropouts.FAILED)}</span>
            </span>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Transaction state distribution" description="Unique transactions by latest state.">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.txStates} layout="vertical" margin={{ left: 10, right: 16 }}>
                <XAxis type="number" {...axis} />
                <YAxis type="category" dataKey="state" {...axis} width={90} />
                <Tooltip {...tip} />
                <Bar dataKey="count" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                  {data.txStates.map((t) => (
                    <Cell key={t.state} fill={TX_COLOR[t.state] ?? 'var(--info)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Notification delivery performance" description="Latest status per notificationId, by channel.">
          {data.notifications.length ? (
            <table className="w-full text-xs">
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Channel</th>
                  <th className="pb-2 font-medium">Delivered</th>
                  <th className="pb-2 text-right font-medium">Failed</th>
                  <th className="pb-2 text-right font-medium">Avg attempts</th>
                  <th className="pb-2 text-right font-medium">Latency</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {data.notifications.map((n) => {
                  const rate = n.n ? n.delivered / n.n : 0
                  return (
                    <tr key={n.channel} className="border-t">
                      <td className="py-2">{n.channel}</td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 rounded bg-muted">
                            <div className="h-1.5 rounded bg-success" style={{ width: `${rate * 100}%` }} />
                          </div>
                          {fmtPct(rate)}
                        </div>
                      </td>
                      <td className="py-2 text-right text-destructive">{fmtNum(n.failed)}</td>
                      <td className="py-2 text-right">{n.avgAttempts.toFixed(2)}</td>
                      <td className="py-2 text-right">{fmtMs(n.avgLatency)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <EmptyState title="No notifications yet" />
          )}
        </Panel>

        <Panel title="DLQ errors by category" description="All dead-letter entries by error code.">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.dlqCodes} layout="vertical" margin={{ left: 10, right: 16 }}>
                <XAxis type="number" {...axis} />
                <YAxis type="category" dataKey="code" {...axis} width={150} tickFormatter={(v: string) => v.replaceAll('_', ' ').toLowerCase()} />
                <Tooltip {...tip} />
                <Bar dataKey="n" name="entries" fill="var(--destructive)" radius={[0, 3, 3, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Recent critical events" description="Failure states and open DLQ entries, newest first." bodyClassName="p-0">
          {data.critical.length ? (
            <ul className="divide-y">
              {data.critical.map((e) => (
                <li key={e.eventId}>
                  <button type="button" onClick={() => setSelected(e)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/40">
                    <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">{fmtTime(e.timestamp)}</span>
                    <StatusBadge status={e.status} />
                    <span className="min-w-0 flex-1 truncate text-xs">{e.description}</span>
                    <span className="hidden md:inline">
                      <IdLink kind="customer" id={e.customerId} />
                    </span>
                    <CollectionBadge collection={e.sourceCollection} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4">
              <EmptyState title="No critical events" />
            </div>
          )}
        </Panel>

        <Panel title="Showcase scenarios" description="Deterministic, reproducible investigations.">
          <ul className="flex flex-col gap-1.5">
            {SCENARIOS.map((s) => (
              <li key={s.id}>
                <Link href={s.href} className="flex items-start gap-2.5 rounded-md p-2 hover:bg-accent/50">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/15 font-mono text-[11px] font-semibold text-primary">{s.id}</span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-xs font-medium">{s.title}</span>
                    <span className="truncate font-mono text-[10.5px] text-muted-foreground">{s.transactionId ?? s.customerId}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <PipelineView
        label="How these KPIs are computed"
        root="onboardingEvents"
        pipeline={data.pipelines}
        note="unifiedThroughput uses $unionWith to stream all five collections; transactions groups deanAssignments by transactionId with $last to get the latest state; customerState reconstructs each customer's latest onboarding state from append-only history."
      />

      <EventDrawer event={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
