import { TransactionDetailView } from '@/components/de/transaction-detail-view'

export default async function Page({ params }: { params: Promise<{ transactionId: string }> }) {
  const { transactionId } = await params
  return <TransactionDetailView transactionId={decodeURIComponent(transactionId).toUpperCase()} />
}
