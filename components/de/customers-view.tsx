'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Search } from 'lucide-react'
import { fetcher, fmtRel } from '@/lib/de/client'
import { SCENARIOS } from '@/lib/de/scenarios-meta'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState, LoadingBlock, PageHeader, Panel, StatusBadge, inputClass } from './ui'

type Row = { _id: string; status: string; lastTs: string; bank: string; events: number }

export function CustomersView() {
  const router = useRouter()
  const [q, setQ] = useState('')
  const { data, error, isLoading } = useSWR<{ customers?: Row[] } | Row[]>(`/api/customers?q=${encodeURIComponent(q.trim())}`, fetcher, { keepPreviousData: true })
  const rows: Row[] = Array.isArray(data) ? data : (data?.customers ?? [])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="03 · Customer 360"
        title="A single operational view per customer"
        description="Enter a customerId to assemble one chronological timeline from all five collections — onboarding, DEAN and transactions, notifications, errors and offboarding — with no separate reporting database."
      />
      <form
        className="flex max-w-xl gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (q.trim()) router.push(`/customers/${q.trim().toUpperCase()}`)
        }}
      >
        <label htmlFor="cust-q" className="sr-only">Customer ID</label>
        <input id="cust-q" className={`${inputClass} h-9 flex-1`} placeholder="CUST-000123 or prefix" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" size="lg"><Search />Open Customer 360</Button>
      </form>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Showcase customers" description="Stable IDs for reproducible demos.">
          <ul className="flex flex-col gap-1">
            {SCENARIOS.map((s) => (
              <li key={s.id}>
                <Link href={`/customers/${s.customerId}`} className="flex items-center gap-3 rounded-md p-2 hover:bg-accent/50">
                  <span className="flex size-5 items-center justify-center rounded bg-primary/15 font-mono text-[11px] text-primary">{s.id}</span>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-mono text-xs">{s.customerId}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{s.title}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel className="xl:col-span-2" title={q ? `Customers matching “${q.toUpperCase()}”` : 'Recently active customers'} description="Latest onboarding state reconstructed per customer ($sort + $group/$last)." bodyClassName="p-0">
          {error ? (
            <div className="p-4"><ErrorState error={error} /></div>
          ) : isLoading && !rows.length ? (
            <div className="p-4"><LoadingBlock rows={8} /></div>
          ) : !rows.length ? (
            <div className="p-4"><EmptyState title="No customers found" description="Customer IDs look like CUST-000123." /></div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-2 font-medium">Customer</th>
                  <th className="px-2 py-2 font-medium">Bank</th>
                  <th className="px-2 py-2 font-medium">Onboarding state</th>
                  <th className="px-2 py-2 text-right font-medium">Onb. events</th>
                  <th className="px-4 py-2 text-right font-medium">Last change</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r._id} className="cursor-pointer border-b border-border/60 hover:bg-accent/40" onClick={() => router.push(`/customers/${r._id}`)}>
                    <td className="px-4 py-2 font-mono text-info">{r._id}</td>
                    <td className="px-2 py-2 text-muted-foreground">{r.bank}</td>
                    <td className="px-2 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-2 py-2 text-right font-mono">{r.events}</td>
                    <td className="px-4 py-2 text-right font-mono text-muted-foreground">{fmtRel(r.lastTs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  )
}
