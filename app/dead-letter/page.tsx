import { DeadLetterView } from '@/components/de/dead-letter-view'

export const metadata = { title: 'Dead Letter Management' }

export default async function Page({ searchParams }: { searchParams: Promise<{ scenario?: string }> }) {
  const sp = await searchParams
  return <DeadLetterView key={sp.scenario} scenario={sp.scenario} />
}
