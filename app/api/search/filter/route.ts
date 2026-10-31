import { NextResponse } from 'next/server'
import { z } from 'zod'
import { filterSearch, specialSearch } from '@/lib/de/queries'
import { jsonError, rateLimit } from '@/lib/de/guard'

export const dynamic = 'force-dynamic'

const opt = z.string().trim().max(120).optional().transform((v) => v || undefined)
const body = z.object({
  saved: z.enum(['awaiting-approval', 'tx-without-notification']).optional(),
  filters: z
    .object({
      customerId: opt,
      correlationId: opt,
      transactionId: opt,
      deanId: opt,
      topic: opt,
      collection: opt,
      eventType: opt,
      status: opt,
      sourceSystem: opt,
      errorCode: opt,
      from: opt,
      to: opt,
      amountMin: z.number().int().nonnegative().optional(),
      amountMax: z.number().int().nonnegative().optional(),
    })
    .default({}),
  page: z.number().int().min(1).max(1000).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  sort: z.enum(['asc', 'desc']).default('desc'),
})

export async function POST(req: Request) {
  const limited = rateLimit(req, 'search', 120)
  if (limited) return limited
  try {
    const b = body.parse(await req.json())
    if (b.saved) return NextResponse.json({ ...(await specialSearch(b.saved)), page: 1, pageSize: 100 })
    return NextResponse.json(await filterSearch(b.filters, b.page, b.pageSize, b.sort))
  } catch (e) {
    return jsonError(e, e instanceof z.ZodError ? 400 : 500)
  }
}
