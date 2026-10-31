import { NextResponse } from 'next/server'
import { getCustomer360 } from '@/lib/de/queries'
import { jsonError } from '@/lib/de/guard'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ customerId: string }> }) {
  try {
    const { customerId } = await ctx.params
    const data = await getCustomer360(decodeURIComponent(customerId).toUpperCase())
    if (!data) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    return NextResponse.json(data)
  } catch (e) {
    return jsonError(e)
  }
}
