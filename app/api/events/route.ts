import { NextResponse, type NextRequest } from 'next/server'
import { getEvents, type EventFilters } from '@/lib/de/queries'
import { jsonError } from '@/lib/de/guard'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const f: EventFilters = {}
    for (const k of ['topic', 'collection', 'status', 'customerId', 'transactionId', 'correlationId', 'from', 'to'] as const) {
      const v = sp.get(k)
      if (v) f[k] = v
    }
    const range = sp.get('range')
    if (range && !f.from) f.from = new Date(Date.now() - Number(range) * 60000).toISOString()
    return NextResponse.json(await getEvents(f, Number(sp.get('limit') ?? 100)))
  } catch (e) {
    return jsonError(e)
  }
}
