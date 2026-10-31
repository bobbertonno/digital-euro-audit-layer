import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ACTIONS, configure, control, queueLength, runAction, simState } from '@/lib/de/simulator'
import { jsonError, rateLimit, requireAdmin } from '@/lib/de/guard'

export const dynamic = 'force-dynamic'

export async function GET() {
  const s = simState()
  return NextResponse.json({ ...s, queued: queueLength() })
}

const body = z.discriminatedUnion('type', [
  z.object({ type: z.literal('control'), command: z.enum(['start', 'pause', 'stop']) }),
  z.object({
    type: z.literal('configure'),
    rate: z.number().min(0.2).max(20).optional(),
    failureRate: z.number().min(0).max(0.9).optional(),
    seed: z.number().int().nullable().optional(),
  }),
  z.object({ type: z.literal('action'), action: z.enum(ACTIONS) }),
])

export async function POST(req: Request) {
  const denied = requireAdmin(req) ?? rateLimit(req, 'sim', 90)
  if (denied) return denied
  try {
    const b = body.parse(await req.json())
    if (b.type === 'control') return NextResponse.json(control(b.command, {}))
    if (b.type === 'configure') return NextResponse.json(configure(b))
    return NextResponse.json(await runAction(b.action))
  } catch (e) {
    return jsonError(e, e instanceof z.ZodError ? 400 : 500)
  }
}
