'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Search } from 'lucide-react'
import { fetcher, fmtEUR, fmtRel } from '@/lib/de/client'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState, LoadingBlock, PageHeader, Panel, PipelineView, StatusBadge, inputClass, selectClass } from './ui'

type Row = { _id: string; status: string; customerId: string; deanId: string; amountMinor: number; type: string; lastTs: string; transitions: number }

const EXAMPLES = [
  { id: 'TX-2026-990002', label: 'Successful transaction' },
  { id: 'TX-2026-990003', label: 'Rejected transaction' },
  { id: 'TX-2026-990004', label: 'Settled, notification failed' },
]

export function TransactionsView() {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const { data, error, isLoading } = useSWR<{ rows: Row[]; pipeline: unknown }>(
    `/api/transactions?q=${encodeURIComponent(q.trim())}&status=${status}`,
    fetcher,
    { refreshInterval: 5000, keepPreviousData: true },
  )
  const failedEx = data?.rows.find((r) => r.status === 'FAILED')
  const reversedEx = data?.rows.find((r) => r.status === 'REVERSED')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="04 · Transaction & State Explorer"
        title="Every state transition, from persisted events"
        description="Transactions are reconstructed from append-only events in deanAssignments (eventCategory = PAYMENT_TRANSACTION). One row per transactionId, latest state via $group/$last."
      />
      <form
        className="flex max-w-xl gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (q.trim()) router.push(`/transactions/${q.trim().toUpperCase()}`)
        }}
      >
        <label htmlFor="tx-q" className="sr-only">Transaction ID</label>
        <input id="tx-q" className={`${inputClass} h-9 flex-1`} placeholder="TX-2026-000184 or prefix" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" size="lg"><Search />Open transaction</Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {[...EXAMPLES, ...(failedEx ? [{ id: failedEx._id, label: 'Failed transaction' }] : []), ...(reversedEx ? [{ id: reversedEx._id, label: 'Reversed transaction' }] : [])].map((e) => (
          <Link key={e.id} href={`/transactions/${e.id}`} className="flex flex-col rounded-md border bg-card px-3 py-2 hover:bg-accent/40">
            <span className="text-xs font-medium">{e.label}</span>
            <span className="font-mono text-[11px] text-info">{e.id}</span>
          </Link>
        ))}
      </div>

      <Panel
        title="Recent transactions"
        bodyClassName="p-0"
        actions={
          <>
            <label htmlFor="tx-status" className="sr-only">Latest state</label>
            <select id="tx-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All latest states</option>
              {['SETTLED', 'REJECTED', 'FAILED', 'REVERSED', 'PROCESSING', 'AUTHORIZED', 'VALIDATED', 'INITIATED'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </>
        }
      >
        {error ? (
          <div className="p-4"><ErrorState error={error} /></div>
        ) : isLoading && !data ? (
          <div className="p-4"><LoadingBlock rows={10} /></div>
        ) : !data?.rows.length ? (
          <div className="p-4"><EmptyState title="No transactions found" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-2 font-medium">Transaction</th>
                  <th className="px-2 py-2 font-medium">Type</th>
                  <th className="px-2 py-2 font-medium">Customer</th>
                  <th className="px-2 py-2 font-medium">DEAN</th>
                  <th className="px-2 py-2 text-right font-medium">Amount</th>
                  <th className="px-2 py-2 font-medium">Latest state</th>
                  <th className="px-2 py-2 text-right font-medium">Transitions</th>
                  <th className="px-4 py-2 text-right font-medium">Last change</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {data.rows.map((r) => (
                  <tr key={r._id} className="cursor-pointer border-b border-border/60 hover:bg-accent/40" onClick={() => router.push(`/transactions/${r._id}`)}>
                    <td className="px-4 py-2 text-info">{r._id}</td>
                    <td className="px-2 py-2 text-muted-foreground">{r.type}</td>
                    <td className="px-2 py-2">{r.customerId}</td>
                    <td className="px-2 py-2 text-muted-foreground">{r.deanId}</td>
                    <td className="px-2 py-2 text-right">{fmtEUR(r.amountMinor)}</td>
                    <td className="px-2 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-2 py-2 text-right">{r.transitions}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{fmtRel(r.lastTs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {data && <PipelineView pipeline={data.pipeline} root="deanAssignments" />}
    </div>
  )
}
