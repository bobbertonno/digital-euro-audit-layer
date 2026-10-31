import { NextResponse } from 'next/server'
import { tick } from '@/lib/de/simulator'
import { jsonError, rateLimit } from '@/lib/de/guard'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const limited = rateLimit(req, 'tick', 120)
  if (limited) return limited
  try {
    const r = await tick()
    return NextResponse.json({ released: r.released, queued: 'queued' in r ? r.queued : 0 })
  } catch (e) {
    return jsonError(e)
  }
}
