import 'server-only'
import { Aggregator, Query } from 'mingo'
import { MongoClient, type Db, type Document } from 'mongodb'
import { COLLECTIONS, type CollectionName, type EventDoc } from './domain'
import { assertDemoDatabase, config, isAtlasConfigured } from './config'
import { createRng, objectIdHex } from './rng'

export type Pipeline = Document[]
export type UpdateSpec = { $set?: Record<string, unknown>; $push?: Record<string, unknown>; $inc?: Record<string, number> }

export interface Store {
  kind: 'memory' | 'atlas'
  aggregate<T = EventDoc>(coll: CollectionName, pipeline: Pipeline): Promise<T[]>
  insertMany(coll: CollectionName, docs: EventDoc[]): Promise<{ duplicateIds: string[] }>
  existingEventIds(coll: CollectionName, ids: string[]): Promise<Set<string>>
  updateOne(coll: CollectionName, filter: Document, update: UpdateSpec): Promise<boolean>
  recordLatency(coll: CollectionName, eventIds: string[], persistedAt: Date): Promise<void>
  count(coll: CollectionName): Promise<number>
  reset(): Promise<void>
  version(): number
}

/* ---------------- In-memory engine (LOCAL DEMO) ---------------- */

type MemState = {
  data: Record<CollectionName, EventDoc[]>
  ids: Record<CollectionName, Map<string, EventDoc>>
  version: number
  oidRng: ReturnType<typeof createRng>
}

const g = globalThis as unknown as { __deMem?: MemState; __deMongo?: Promise<MongoClient> }

function mem(): MemState {
  if (!g.__deMem) {
    g.__deMem = {
      data: Object.fromEntries(COLLECTIONS.map((c) => [c, []])) as unknown as MemState['data'],
      ids: Object.fromEntries(COLLECTIONS.map((c) => [c, new Map<string, EventDoc>()])) as unknown as MemState['ids'],
      version: 0,
      oidRng: createRng(42),
    }
  }
  return g.__deMem
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown, mode: 'set' | 'push' | 'inc') {
  const parts = path.split('.')
  let cur = obj
  for (const p of parts.slice(0, -1)) {
    if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {}
    cur = cur[p] as Record<string, unknown>
  }
  const last = parts.at(-1)!
  if (mode === 'set') cur[last] = value
  else if (mode === 'inc') cur[last] = ((cur[last] as number) ?? 0) + (value as number)
  else cur[last] = [...((cur[last] as unknown[]) ?? []), value]
}

const memoryStore: Store = {
  kind: 'memory',
  async aggregate<T>(coll: CollectionName, pipeline: Pipeline) {
    const m = mem()
    return new Aggregator(pipeline, {
      collectionResolver: (name: string) => m.data[name as CollectionName] ?? [],
    }).run(m.data[coll]) as T[]
  },
  async insertMany(coll, docs) {
    const m = mem()
    const duplicateIds: string[] = []
    for (const d of docs) {
      if (m.ids[coll].has(d.eventId)) {
        duplicateIds.push(d.eventId)
        continue
      }
      const stored = { _id: objectIdHex(m.oidRng), ...structuredClone(d) }
      m.ids[coll].set(d.eventId, stored)
      m.data[coll].push(stored)
    }
    m.version++
    return { duplicateIds }
  },
  async recordLatency(coll, eventIds, persistedAt) {
    const m = mem()
    for (const id of eventIds) {
      const d = m.ids[coll].get(id)
      if (d) d.audit.ingestionLatencyMs = Math.max(0, persistedAt.getTime() - (d.audit.producedAt as Date).getTime())
    }
  },
  async existingEventIds(coll, ids) {
    const s = mem().ids[coll]
    return new Set(ids.filter((i) => s.has(i)))
  },
  async updateOne(coll, filter, update) {
    const m = mem()
    const q = new Query(filter)
    const doc = m.data[coll].find((d) => q.test(d))
    if (!doc) return false
    for (const [k, v] of Object.entries(update.$set ?? {})) setPath(doc, k, v, 'set')
    for (const [k, v] of Object.entries(update.$inc ?? {})) setPath(doc, k, v, 'inc')
    for (const [k, v] of Object.entries(update.$push ?? {})) setPath(doc, k, v, 'push')
    m.version++
    return true
  },
  async count(coll) {
    return mem().data[coll].length
  },
  async reset() {
    const m = mem()
    for (const c of COLLECTIONS) {
      m.data[c] = []
      m.ids[c] = new Map()
    }
    m.version++
  },
  version: () => mem().version,
}

/* ---------------- MongoDB Atlas ---------------- */

export async function getDb(): Promise<Db> {
  if (!g.__deMongo) {
    g.__deMongo = new MongoClient(config.mongoUri, { appName: 'digital-euro-audit-intelligence', maxPoolSize: 10 }).connect()
    g.__deMongo.catch(() => {
      g.__deMongo = undefined
    })
  }
  return (await g.__deMongo).db(config.database)
}

const normalize = (d: Document) => {
  if (d && d._id && typeof d._id === 'object' && 'toHexString' in d._id) d._id = d._id.toHexString()
  return d
}

let atlasVersion = 0
const atlasStore: Store = {
  kind: 'atlas',
  async aggregate<T>(coll: CollectionName, pipeline: Pipeline) {
    const db = await getDb()
    const res = await db.collection(coll).aggregate(pipeline, { maxTimeMS: 15000 }).toArray()
    return res.map(normalize) as T[]
  },
  async insertMany(coll, docs) {
    if (!docs.length) return { duplicateIds: [] }
    const db = await getDb()
    try {
      await db.collection(coll).insertMany(docs as Document[], { ordered: false })
      atlasVersion++
      return { duplicateIds: [] }
    } catch (e: unknown) {
      const err = e as { code?: number; writeErrors?: { code: number; index: number }[] | { code: number; index: number } }
      const writeErrors = Array.isArray(err.writeErrors) ? err.writeErrors : err.writeErrors ? [err.writeErrors] : []
      const dups = writeErrors.filter((w) => w.code === 11000).map((w) => docs[w.index].eventId)
      if (dups.length === writeErrors.length && dups.length > 0) {
        atlasVersion++
        return { duplicateIds: dups }
      }
      throw e
    }
  },
  async existingEventIds(coll, ids) {
    if (!ids.length) return new Set()
    const db = await getDb()
    const found = await db
      .collection(coll)
      .find({ eventId: { $in: ids } }, { projection: { eventId: 1 } })
      .toArray()
    return new Set(found.map((f) => f.eventId as string))
  },
  async recordLatency(coll, eventIds, persistedAt) {
    if (!eventIds.length) return
    const db = await getDb()
    await db
      .collection(coll)
      .updateMany({ eventId: { $in: eventIds } }, [
        { $set: { 'audit.ingestionLatencyMs': { $max: [0, { $subtract: [persistedAt, '$audit.producedAt'] }] } } },
      ])
  },
  async updateOne(coll, filter, update) {
    const db = await getDb()
    const r = await db.collection(coll).updateOne(filter, update as Document)
    atlasVersion++
    return r.matchedCount > 0
  },
  async count(coll) {
    const db = await getDb()
    return db.collection(coll).estimatedDocumentCount()
  },
  async reset() {
    assertDemoDatabase()
    const db = await getDb()
    for (const c of COLLECTIONS) await db.collection(c).deleteMany({})
    atlasVersion++
  },
  version: () => atlasVersion,
}

export function rawStore(): Store {
  return isAtlasConfigured() ? atlasStore : memoryStore
}
