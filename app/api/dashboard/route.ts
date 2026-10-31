import { NextResponse } from 'next/server'
import { getDashboard } from '@/lib/de/queries'
import { jsonError } from '@/lib/de/guard'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(await getDashboard())
  } catch (e) {
    return jsonError(e)
  }
}
