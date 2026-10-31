'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { AlertTriangle, Check, ChevronRight, Code2, Copy, Inbox, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { COLLECTION_META, TONE_CLASS, statusTone, type Tone } from '@/lib/de/client'
import type { CollectionName } from '@/lib/de/domain'
import { Skeleton } from '@/components/ui/skeleton'

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="flex flex-col gap-1.5">
        {eyebrow && <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">{eyebrow}</p>}
        <h1 className="text-balance text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="max-w-3xl text-pretty text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn('flex min-w-0 flex-col rounded-lg border bg-card', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title && <h2 className="text-sm font-medium">{title}</h2>}
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('min-w-0 flex-1 p-4', bodyClassName)}>{children}</div>
    </section>
  )
}

const KPI_TONE: Record<Tone, string> = {
  success: 'text-success',
  danger: 'text-destructive',
  warning: 'text-warning',
  info: 'text-info',
  neutral: 'text-foreground',
}

export function Kpi({ label, value, sub, tone = 'neutral', icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; icon?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2 text-muted-foreground">
        <span className="truncate text-xs font-medium uppercase tracking-wide">{label}</span>
        {icon && <span className="[&_svg]:size-4">{icon}</span>}
      </div>
      <div className={cn('font-mono text-2xl font-semibold tabular-nums tracking-tight', KPI_TONE[tone])}>{value}</div>
      {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

export function StatusBadge({ status, className }: { status?: string | null; className?: string }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[10.5px] font-medium', TONE_CLASS[statusTone(status)], className)}>
      {status}
    </span>
  )
}

export function CollectionBadge({ collection, showTopic }: { collection: CollectionName | string; showTopic?: boolean }) {
  const m = COLLECTION_META[collection as CollectionName]
  if (!m) return <span className="font-mono text-xs">{collection}</span>
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[11px] text-muted-foreground">
      <span className={cn('size-1.5 rounded-full', m.dot)} aria-hidden />
      {showTopic ? m.topic : collection}
    </span>
  )
}

export function IdLink({ kind, id }: { kind: 'customer' | 'transaction'; id?: string | null }) {
  if (!id) return <span className="text-muted-foreground">—</span>
  return (
    <Link
      href={kind === 'customer' ? `/customers/${id}` : `/transactions/${id}`}
      className="font-mono text-xs text-info underline-offset-2 hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {id}
    </Link>
  )
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation()
        await navigator.clipboard.writeText(value)
        setDone(true)
        toast.success('Copied to clipboard', { description: value })
        setTimeout(() => setDone(false), 1200)
      }}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {done ? <Check className="size-3" /> : <Copy className="size-3" />}
      {label}
    </button>
  )
}

function JsonNode({ value, depth }: { value: unknown; depth: number }): ReactNode {
  const pad = '  '.repeat(depth)
  if (value === null) return <span className="text-muted-foreground">null</span>
  if (typeof value === 'string') {
    const isDate = /^\d{4}-\d{2}-\d{2}T/.test(value)
    return <span className={isDate ? 'text-info' : 'text-success'}>{isDate ? `ISODate("${value}")` : JSON.stringify(value)}</span>
  }
  if (typeof value === 'number') return <span className="text-warning">{value}</span>
  if (typeof value === 'boolean') return <span className="text-chart-4">{String(value)}</span>
  if (Array.isArray(value)) {
    if (!value.length) return '[]'
    return (
      <>
        {'[\n'}
        {value.map((v, i) => (
          <span key={i}>
            {pad}
            {'  '}
            <JsonNode value={v} depth={depth + 1} />
            {i < value.length - 1 ? ',' : ''}
            {'\n'}
          </span>
        ))}
        {pad}
        {']'}
      </>
    )
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (!entries.length) return '{}'
    return (
      <>
        {'{\n'}
        {entries.map(([k, v], i) => (
          <span key={k}>
            {pad}
            {'  '}
            <span className="text-foreground/90">{k}</span>
            {': '}
            <JsonNode value={v} depth={depth + 1} />
            {i < entries.length - 1 ? ',' : ''}
            {'\n'}
          </span>
        ))}
        {pad}
        {'}'}
      </>
    )
  }
  return String(value)
}

export function JsonView({ data, className }: { data: unknown; className?: string }) {
  return (
    <div className={cn('relative rounded-md border bg-background/60', className)}>
      <div className="absolute right-2 top-2">
        <CopyButton value={JSON.stringify(data, null, 2)} label="JSON" />
      </div>
      <pre className="max-h-[28rem] overflow-auto p-3 pr-16 font-mono text-[11.5px] leading-relaxed text-muted-foreground">
        <JsonNode value={data} depth={0} />
      </pre>
    </div>
  )
}

export function PipelineView({ pipeline, root, label = 'MongoDB aggregation pipeline', note }: { pipeline: unknown; root?: string; label?: string; note?: ReactNode }) {
  return (
    <details className="group rounded-md border bg-background/40">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        <Code2 className="size-3.5 text-primary" />
        <span>{label}</span>
        {root && <span className="font-mono text-[11px]">db.{root}.aggregate(…)</span>}
      </summary>
      <div className="flex flex-col gap-2 border-t p-3">
        {note && <p className="text-xs leading-relaxed text-muted-foreground">{note}</p>}
        <JsonView data={pipeline} className="border-0 bg-transparent" />
      </div>
    </details>
  )
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-6 py-10 text-center">
      <Inbox className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{description}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="flex flex-col gap-1">
        <p className="font-medium text-destructive">Could not load data</p>
        <p className="text-xs text-muted-foreground">{error instanceof Error ? error.message : String(error)}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="w-fit text-xs text-info hover:underline">
            Retry
          </button>
        )}
      </div>
    </div>
  )
}

export function LoadingBlock({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full bg-muted/60" />
      ))}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin', className)} aria-hidden />
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate font-mono text-xs">{children ?? '—'}</dd>
    </div>
  )
}

export const selectClass =
  'h-8 rounded-md border border-input bg-background/60 px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring'
export const inputClass =
  'h-8 rounded-md border border-input bg-background/60 px-2.5 font-mono text-xs text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring'
