import { NextResponse, type NextRequest } from 'next/server'
import { listTransactions } from '@/lib/de/queries'
import { jsonError } from '@/lib/de/guard'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    return NextResponse.json(await listTransactions(sp.get('q') ?? undefined, sp.get('status') ?? undefined))
  } catch (e) {
    return jsonError(e)
  }
}
