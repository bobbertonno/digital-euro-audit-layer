import { SemanticSearchView } from '@/components/de/semantic-search-view'

export const metadata = { title: 'Semantic Investigation' }

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams
  return <SemanticSearchView key={sp.q} initialQuery={sp.q} />
}
