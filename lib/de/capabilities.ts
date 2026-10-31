import 'server-only'
import { COLLECTIONS, type CollectionName } from './domain'
import { config, isAtlasConfigured } from './config'
import { getDb } from './store'
import { embeddingStatus, type EmbeddingStatus } from './embeddings'

export type Capabilities = {
  mode: 'LOCAL_DEMO' | 'ATLAS_CONNECTED'
  atlasConfigured: boolean
  atlasConnected: boolean
  atlasError?: string
  database: string
  searchCollections: CollectionName[]
  vectorCollections: CollectionName[]
  atlasSearch: boolean
  atlasVectorSearch: boolean
  embeddings: EmbeddingStatus
  searchIndexName: string
  vectorIndexName: string
  checkedAt: string
}

const g = globalThis as unknown as { __deCaps?: { at: number; caps: Capabilities } }

async function listIndexes(coll: CollectionName) {
  const db = await getDb()
  try {
    return (await db.collection(coll).listSearchIndexes().toArray()) as { name: string; type?: string; queryable?: boolean; status?: string }[]
  } catch {
    return []
  }
}

export async function getCapabilities(force = false): Promise<Capabilities> {
  if (!force && g.__deCaps && Date.now() - g.__deCaps.at < 30000) return g.__deCaps.caps
  const embeddings = await embeddingStatus()
  const caps: Capabilities = {
    mode: 'LOCAL_DEMO',
    atlasConfigured: isAtlasConfigured(),
    atlasConnected: false,
    database: config.database,
    searchCollections: [],
    vectorCollections: [],
    atlasSearch: false,
    atlasVectorSearch: false,
    embeddings,
    searchIndexName: config.searchIndexName,
    vectorIndexName: config.vectorIndexName,
    checkedAt: new Date().toISOString(),
  }
  if (caps.atlasConfigured) {
    try {
      const db = await getDb()
      await db.command({ ping: 1 })
      caps.atlasConnected = true
      caps.mode = 'ATLAS_CONNECTED'
      for (const c of COLLECTIONS) {
        const idx = await listIndexes(c)
        const ready = (i: { queryable?: boolean; status?: string }) => i.queryable !== false && (i.status ?? 'READY') === 'READY'
        if (idx.some((i) => i.name === config.searchIndexName && ready(i))) caps.searchCollections.push(c)
        if (idx.some((i) => i.name === config.vectorIndexName && ready(i))) caps.vectorCollections.push(c)
      }
      caps.atlasSearch = caps.searchCollections.length > 0
      caps.atlasVectorSearch = caps.vectorCollections.length > 0 && embeddings.available
    } catch (e) {
      caps.atlasError = e instanceof Error ? e.message : String(e)
    }
  }
  g.__deCaps = { at: Date.now(), caps }
  return caps
}

/** Embeddings are only written into documents when Atlas is the persistence layer. */
export async function vectorEnabledForWrites() {
  if (!isAtlasConfigured()) return false
  const caps = await getCapabilities()
  return caps.atlasConnected && caps.embeddings.available
}
