import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDlqDetail, retryDlq, setDlqStatus } from '@/lib/de/dlq'
import { jsonError, rateLimit, requireAdmin } from '@/lib/de/guard'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ dlqId: string }> }) {
  try {
    const { dlqId } = await ctx.params
    const d = await getDlqDetail(dlqId)
    if (!d) return NextResponse.json({ error: 'DLQ entry not found' }, { status: 404 })
    return NextResponse.json(d)
  } catch (e) {
    return jsonError(e)
  }
}

const body = z.object({ action: z.enum(['RETRY', 'INVESTIGATE', 'DISCARD']), reason: z.string().max(300).optional() })

export async function POST(req: Request, ctx: { params: Promise<{ dlqId: string }> }) {
  const denied = requireAdmin(req) ?? rateLimit(req, 'dlq', 30)
  if (denied) return denied
  try {
    const { dlqId } = await ctx.params
    const b = body.parse(await req.json())
    if (b.action === 'RETRY') return NextResponse.json(await retryDlq(dlqId))
    return NextResponse.json(await setDlqStatus(dlqId, b.action, b.reason))
  } catch (e) {
    return jsonError(e, e instanceof z.ZodError ? 400 : 500)
  }
}
