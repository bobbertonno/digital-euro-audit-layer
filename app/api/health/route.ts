import { NextResponse } from 'next/server'
import { getCapabilities } from '@/lib/de/capabilities'
import { getStore } from '@/lib/de/seed'
import { simState, queueLength } from '@/lib/de/simulator'
import { adminRequired, jsonError } from '@/lib/de/guard'
import { COLLECTIONS } from '@/lib/de/domain'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [caps, store] = await Promise.all([getCapabilities(), getStore()])
    const counts = Object.fromEntries(await Promise.all(COLLECTIONS.map(async (c) => [c, await store.count(c)] as const)))
    const s = simState()
    return NextResponse.json({
      ...caps,
      store: store.kind,
      version: store.version(),
      counts,
      adminRequired: adminRequired(),
      simulation: { state: s.state, rate: s.rate, failureRate: s.failureRate, seed: s.seed, generated: s.generated, queued: queueLength() },
      serverTime: new Date().toISOString(),
    })
  } catch (e) {
    return jsonError(e)
  }
}
