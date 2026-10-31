import { CustomerDetailView } from '@/components/de/customer-detail-view'

export default async function Page({ params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params
  return <CustomerDetailView customerId={decodeURIComponent(customerId).toUpperCase()} />
}
