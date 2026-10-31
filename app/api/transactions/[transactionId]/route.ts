import { NextResponse } from 'next/server'
import { getTransaction } from '@/lib/de/queries'
import { jsonError } from '@/lib/de/guard'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ transactionId: string }> }) {
  try {
    const { transactionId } = await ctx.params
    const data = await getTransaction(decodeURIComponent(transactionId).toUpperCase())
    if (!data) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    return NextResponse.json(data)
  } catch (e) {
    return jsonError(e)
  }
}
