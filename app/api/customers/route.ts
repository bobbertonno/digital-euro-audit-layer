import { NextResponse, type NextRequest } from 'next/server'
import { listCustomers } from '@/lib/de/queries'
import { jsonError } from '@/lib/de/guard'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({ customers: await listCustomers(req.nextUrl.searchParams.get('q') ?? undefined) })
  } catch (e) {
    return jsonError(e)
  }
}
