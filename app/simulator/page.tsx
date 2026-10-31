import { SimulatorView } from '@/components/de/simulator-view'

export const metadata = { title: 'Event Simulator' }

export default async function Page({ searchParams }: { searchParams: Promise<{ autostart?: string }> }) {
  const sp = await searchParams
  return <SimulatorView autostart={sp.autostart === '1'} />
}
