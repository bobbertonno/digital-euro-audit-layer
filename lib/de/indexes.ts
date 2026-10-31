import 'server-only'
import type { IndexDescription } from 'mongodb'
import { COLLECTIONS, type CollectionName } from './domain'
import { config } from './config'
import { getDb } from './store'

export function secondaryIndexes(coll: CollectionName): IndexDescription[] {
  const idx: IndexDescription[] = [
    { key: { eventId: 1 }, name: 'uniq_eventId', unique: true },
    { key: { customerId: 1, timestamp: 1 }, name: 'customer_ts' },
    { key: { correlationId: 1, timestamp: 1 }, name: 'correlation_ts' },
    { key: { eventType: 1, timestamp: -1 }, name: 'eventType_ts' },
    { key: { status: 1, timestamp: -1 }, name: 'status_ts' },
    { key: { ingestedAt: -1 }, name: 'ingestedAt' },
    { key: { timestamp: -1 }, name: 'ts' },
  ]
  if (coll === 'deanAssignments' || coll === 'notificationEvents' || coll === 'deadLetterEvents')
    idx.push({ key: { transactionId: 1, timestamp: 1 }, name: 'transaction_ts', sparse: true })
  if (coll === 'deanAssignments') idx.push({ key: { eventCategory: 1, transactionId: 1, timestamp: 1 }, name: 'category_tx_ts' })
  if (coll === 'notificationEvents') idx.push({ key: { 'payload.notificationId': 1, timestamp: 1 }, name: 'notification_ts' })
  if (coll === 'deadLetterEvents') {
    idx.push({ key: { 'payload.errorCode': 1, timestamp: -1 }, name: 'errorCode_ts' })
    idx.push({ key: { 'payload.dlqId': 1 }, name: 'uniq_dlqId', unique: true })
  }
  return idx
}

export const searchIndexDefinition = () => ({
  name: config.searchIndexName,
  type: 'search',
  definition: {
    mappings: {
      dynamic: false,
      fields: {
        description: { type: 'string', analyzer: 'lucene.english' },
        semanticText: { type: 'string', analyzer: 'lucene.english' },
        eventType: { type: 'token' },
        status: { type: 'token' },
        customerId: { type: 'token' },
        payload: {
          type: 'document',
          dynamic: false,
          fields: {
            errorMessage: { type: 'string', analyzer: 'lucene.english' },
            failureReason: { type: 'string', analyzer: 'lucene.english' },
            lastError: { type: 'string', analyzer: 'lucene.english' },
            transitionReason: { type: 'string', analyzer: 'lucene.english' },
          },
        },
      },
    },
  },
})

export const vectorIndexDefinition = () => ({
  name: config.vectorIndexName,
  type: 'vectorSearch',
  definition: {
    fields: [
      { type: 'vector', path: 'embedding', numDimensions: config.embeddingDimensions, similarity: 'cosine' },
      { type: 'filter', path: 'status' },
      { type: 'filter', path: 'customerId' },
    ],
  },
})

export async function ensureIndexes() {
  const db = await getDb()
  const report: Record<string, { secondary: string[]; search: string[]; errors: string[] }> = {}
  for (const coll of COLLECTIONS) {
    const r = (report[coll] = { secondary: [] as string[], search: [] as string[], errors: [] as string[] })
    try {
      await db.createCollection(coll).catch(() => undefined)
      r.secondary = await db.collection(coll).createIndexes(secondaryIndexes(coll))
    } catch (e) {
      r.errors.push(`secondary: ${(e as Error).message}`)
    }
    try {
      const existing = (await db.collection(coll).listSearchIndexes().toArray()).map((i) => i.name as string)
      for (const def of [searchIndexDefinition(), vectorIndexDefinition()]) {
        if (existing.includes(def.name)) {
          r.search.push(`${def.name} (exists)`)
          continue
        }
        await db.collection(coll).createSearchIndex(def as Parameters<ReturnType<typeof db.collection>['createSearchIndex']>[0])
        r.search.push(`${def.name} (building)`)
      }
    } catch (e) {
      r.errors.push(`search: ${(e as Error).message}`)
    }
  }
  return report
}
