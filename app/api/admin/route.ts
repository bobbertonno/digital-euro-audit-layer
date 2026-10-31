import { NextResponse } from 'next/server'
import { z } from 'zod'
import { assertDemoDatabase, isAtlasConfigured } from '@/lib/de/config'
import { clearIds, generateSeedDataset, resetMemory, seedInto, getStore } from '@/lib/de/seed'
import { ensureIndexes } from '@/lib/de/indexes'
import { getCapabilities } from '@/lib/de/capabilities'
import { resetSimulator } from '@/lib/de/simulator'
import { resetOffsets } from '@/lib/de/ingest'
import { jsonError, rateLimit, requireAdmin } from '@/lib/de/guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const body = z.object({
  action: z.enum(['reset-seed', 'seed-batch', 'ensure-indexes']),
  confirm: z.literal('RESET').optional(),
  batch: z.number().int().min(0).optional(),
})

const g = globalThis as unknown as { __deSeedJob?: ReturnType<typeof generateSeedDataset> }
const BATCH = 1000

export async function POST(req: Request) {
  const denied = requireAdmin(req) ?? rateLimit(req, 'admin', 20)
  if (denied) return denied
  try {
    const b = body.parse(await req.json())
    if (b.action === 'ensure-indexes') {
      if (!isAtlasConfigured()) return NextResponse.json({ ok: true, note: 'LOCAL DEMO: in-memory engine needs no indexes. Configure MONGODB_URI to create Atlas indexes.' })
      const report = await ensureIndexes()
      await getCapabilities(true)
      return NextResponse.json({ ok: true, report })
    }
    assertDemoDatabase()
    if (b.action === 'reset-seed') {
      if (b.confirm !== 'RESET') return NextResponse.json({ error: 'Confirmation required' }, { status: 400 })
      resetSimulator()
      if (!isAtlasConfigured()) {
        await resetMemory()
        return NextResponse.json({ ok: true, done: true, store: 'memory' })
      }
      // Atlas: reset then seed in bounded batches driven by the client (one request per batch).
      const store = await getStore()
      await store.reset()
      resetOffsets()
      clearIds()
      g.__deSeedJob = generateSeedDataset(Math.floor(Date.now() / 60000) * 60000)
      return NextResponse.json({ ok: true, done: false, total: g.__deSeedJob.events.length, batches: Math.ceil(g.__deSeedJob.events.length / BATCH) })
    }
    // seed-batch
    const job = g.__deSeedJob
    if (!job) return NextResponse.json({ error: 'No seed job in progress on this instance; start reset again.' }, { status: 409 })
    const i = b.batch ?? 0
    const store = await getStore()
    await seedInto(store, job.events.slice(i * BATCH, (i + 1) * BATCH), BATCH)
    const done = (i + 1) * BATCH >= job.events.length
    if (done) {
      g.__deSeedJob = undefined
      clearIds()
    }
    return NextResponse.json({ ok: true, done, batch: i })
  } catch (e) {
    return jsonError(e, e instanceof z.ZodError ? 400 : 500)
  }
}
