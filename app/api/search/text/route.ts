import { NextResponse, type NextRequest } from 'next/server'
import { COLLECTIONS, type CollectionName } from '@/lib/de/domain'
import { fullTextSearch } from '@/lib/de/search'
import { jsonError, rateLimit } from '@/lib/de/guard'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, 'search', 120)
  if (limited) return limited
  try {
    const sp = req.nextUrl.searchParams
    const q = (sp.get('q') ?? '').slice(0, 200)
    const colls = (sp.get('collections') ?? '').split(',').filter((c): c is CollectionName => COLLECTIONS.includes(c as CollectionName))
    return NextResponse.json(await fullTextSearch(q, colls))
  } catch (e) {
    return jsonError(e)
  }
}
