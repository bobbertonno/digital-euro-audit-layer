'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import {
  Activity,
  AlertOctagon,
  ArrowLeftRight,
  Blocks,
  Brain,
  Database,
  KeyRound,
  LayoutDashboard,
  Presentation,
  Radio,
  Search,
  SlidersHorizontal,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ADMIN_TOKEN_KEY, fmtTime, postJson, useHealth } from '@/lib/de/client'
import { GuidedDemo } from './guided-demo'

const NAV = [
  { href: '/overview', label: 'Executive Overview', icon: LayoutDashboard },
  { href: '/live-events', label: 'Live Event Monitor', icon: Activity },
  { href: '/customers', label: 'Customer 360', icon: Users },
  { href: '/transactions', label: 'Transaction & State Explorer', icon: ArrowLeftRight },
  { href: '/audit-search', label: 'Unified Audit Search', icon: Search },
  { href: '/semantic-search', label: 'Semantic Investigation', icon: Brain },
  { href: '/dead-letter', label: 'Dead Letter Management', icon: AlertOctagon },
  { href: '/simulator', label: 'Event Simulator', icon: SlidersHorizontal },
  { href: '/architecture', label: 'Architecture & MongoDB Value', icon: Blocks },
]

function Pill({ tone, children, title }: { tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; children: ReactNode; title?: string }) {
  const cls = {
    success: 'border-success/30 text-success',
    warning: 'border-warning/30 text-warning',
    danger: 'border-destructive/40 text-destructive',
    info: 'border-info/30 text-info',
    neutral: 'border-border text-muted-foreground',
  }[tone]
  return (
    <span title={title} className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-medium', cls)}>
      {children}
    </span>
  )
}

function Dot({ className, pulse }: { className: string; pulse?: boolean }) {
  return (
    <span className="relative flex size-1.5" aria-hidden>
      {pulse && <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', className)} />}
      <span className={cn('relative inline-flex size-1.5 rounded-full', className)} />
    </span>
  )
}

function Clock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!now) return <span className="w-28" />
  return (
    <time className="font-mono text-xs tabular-nums text-muted-foreground" dateTime={now.toISOString()}>
      {now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · {fmtTime(now)}
    </time>
  )
}

/** Drives request-triggered streaming: while the simulator is RUNNING, the console calls the tick endpoint. */
function useSimulationTicker(running: boolean) {
  useEffect(() => {
    if (!running) return
    let alive = true
    const t = setInterval(() => {
      if (alive && document.visibilityState === 'visible') postJson('/api/simulator/tick', {}).catch(() => {})
    }, 1500)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [running])
}

function AdminToken({ required }: { required: boolean }) {
  const [has, setHas] = useState(false)
  useEffect(() => setHas(!!sessionStorage.getItem(ADMIN_TOKEN_KEY)), [])
  if (!required) return null
  return (
    <button
      type="button"
      onClick={() => {
        const v = window.prompt('Enter DEMO_ADMIN_TOKEN to enable protected demo controls (kept in this browser session only):')
        if (v === null) return
        if (v) sessionStorage.setItem(ADMIN_TOKEN_KEY, v)
        else sessionStorage.removeItem(ADMIN_TOKEN_KEY)
        setHas(!!v)
      }}
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] text-muted-foreground hover:text-foreground"
    >
      <KeyRound className="size-3" />
      {has ? 'Admin token set' : 'Admin token'}
    </button>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { data: h, error } = useHealth()
  const running = h?.simulation.state === 'RUNNING'
  useSimulationTicker(running)
  const total = h ? Object.values(h.counts).reduce((a, b) => a + b, 0) : 0

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <div className="flex items-center gap-2.5 border-b px-4 py-4">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/15 font-mono text-sm font-bold text-primary">€D</div>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-semibold">Digital Euro</span>
            <span className="truncate text-[11px] text-muted-foreground">Ops & Audit Intelligence</span>
          </div>
        </div>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {NAV.map((n, i) => {
            const active = pathname === n.href || pathname.startsWith(`${n.href}/`)
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors',
                  active ? 'bg-sidebar-accent text-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-foreground',
                )}
              >
                <span className="w-4 font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                <n.icon className={cn('size-4', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
                <span className="truncate">{n.label}</span>
              </Link>
            )
          })}
        </nav>
        <div className="flex flex-col gap-2 border-t p-4 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <Database className="size-3.5 text-primary" />
            <span className="font-mono">{h?.database ?? 'digital_euro_demo'}</span>
          </div>
          <div className="flex items-center justify-between font-mono">
            <span>5 collections</span>
            <span className="tabular-nums text-foreground">{total.toLocaleString('en-US')} docs</span>
          </div>
          <p className="leading-relaxed">Kafka / GCP Pub/Sub compatible architecture · topics simulated</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2.5 md:px-6">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold">Digital Euro Operations & Audit Intelligence</span>
              <span className="truncate text-[11px] text-muted-foreground">
                Powered by <span className="text-primary">MongoDB Atlas</span> — Unified Event Intelligence
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill tone="neutral">ENV: DEMO</Pill>
              {error ? (
                <Pill tone="danger">DB: UNREACHABLE</Pill>
              ) : !h ? (
                <Pill tone="neutral">CONNECTING…</Pill>
              ) : h.mode === 'ATLAS_CONNECTED' ? (
                <Pill tone="success" title={`Database ${h.database}`}>
                  <Dot className="bg-success" /> ATLAS CONNECTED
                </Pill>
              ) : (
                <Pill tone="warning" title={h.atlasError ?? 'MONGODB_URI not configured — in-memory engine executing the same MongoDB pipelines'}>
                  <Dot className="bg-warning" /> LOCAL DEMO
                </Pill>
              )}
              {h && (
                <>
                  <Pill tone={h.atlasSearch ? 'success' : 'neutral'} title={h.atlasSearch ? 'MongoDB Search indexes queryable' : 'Full-text uses a labeled local fallback'}>
                    SEARCH {h.atlasSearch ? 'AVAILABLE' : 'FALLBACK'}
                  </Pill>
                  <Pill
                    tone={h.atlasVectorSearch ? 'success' : h.embeddings.available ? 'info' : 'neutral'}
                    title={h.embeddings.available ? `Embeddings: ${h.embeddings.model}` : h.embeddings.reason}
                  >
                    VECTOR {h.atlasVectorSearch ? 'AVAILABLE' : h.embeddings.available ? 'EXACT k-NN' : 'DISABLED'}
                  </Pill>
                  <Pill tone={running ? 'success' : h.simulation.state === 'PAUSED' ? 'warning' : 'neutral'}>
                    <Radio className="size-3" /> SIM {h.simulation.state}
                  </Pill>
                  <Pill tone={running ? 'success' : 'neutral'}>
                    <Dot className={running ? 'bg-success' : 'bg-muted-foreground'} pulse={running} /> {running ? 'LIVE' : 'IDLE'}
                  </Pill>
                </>
              )}
              <AdminToken required={!!h?.adminRequired} />
              <GuidedDemo trigger={<Presentation className="size-3.5" />} />
              <span className="hidden md:inline">
                <Clock />
              </span>
            </div>
          </div>
          <nav aria-label="Mobile" className="flex gap-1 overflow-x-auto border-t px-3 py-1.5 lg:hidden">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn('whitespace-nowrap rounded px-2 py-1 text-xs', pathname.startsWith(n.href) ? 'bg-accent text-foreground' : 'text-muted-foreground')}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-6 px-4 py-6 md:px-6">{children}</main>
      </div>
    </div>
  )
}
