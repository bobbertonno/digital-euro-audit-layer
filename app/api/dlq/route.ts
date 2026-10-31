import { NextResponse, type NextRequest } from 'next/server'
import { listDlq } from '@/lib/de/dlq'
import { jsonError } from '@/lib/de/guard'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    return NextResponse.json(
      await listDlq({
        status: sp.get('status') || undefined,
        code: sp.get('code') || undefined,
        q: sp.get('q') || undefined,
        sort: sp.get('sort') || undefined,
        dir: sp.get('dir') === 'asc' ? 'asc' : 'desc',
      }),
    )
  } catch (e) {
    return jsonError(e)
  }
}
