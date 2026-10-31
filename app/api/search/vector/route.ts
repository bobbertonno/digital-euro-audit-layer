import { NextResponse, type NextRequest } from 'next/server'
import { COLLECTIONS, type CollectionName } from '@/lib/de/domain'
import { vectorSearch } from '@/lib/de/search'
import { jsonError, rateLimit } from '@/lib/de/guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, 'vector', 40)
  if (limited) return limited
  try {
    const sp = req.nextUrl.searchParams
    const q = (sp.get('q') ?? '').trim().slice(0, 300)
    if (!q) return NextResponse.json({ error: 'Query required' }, { status: 400 })
    const colls = (sp.get('collections') ?? '').split(',').filter((c): c is CollectionName => COLLECTIONS.includes(c as CollectionName))
    return NextResponse.json(await vectorSearch(q, colls))
  } catch (e) {
    return jsonError(e)
  }
}
