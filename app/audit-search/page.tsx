import { AuditSearchView } from '@/components/de/audit-search-view'

export const metadata = { title: 'Unified Audit Search' }

export default async function Page({ searchParams }: { searchParams: Promise<{ mode?: string; q?: string }> }) {
  const sp = await searchParams
  return <AuditSearchView key={`${sp.mode}-${sp.q}`} initialMode={sp.mode} initialQuery={sp.q} />
}
