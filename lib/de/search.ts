import 'server-only'
import type { Document } from 'mongodb'
import { COLLECTIONS, type CollectionName } from './domain'
import { getStore } from './seed'
import { getCapabilities } from './capabilities'
import { config } from './config'
import { cosine, embedTexts } from './embeddings'
import type { Pipeline } from './store'
import type { UEvent } from './queries'

export const TEXT_FIELDS = ['description', 'semanticText', 'payload.errorMessage', 'payload.failureReason', 'payload.lastError', 'payload.transitionReason']

export type Highlight = { path: string; texts: { value: string; type: 'hit' | 'text' }[] }
export type TextHit = UEvent & { score: number; normalizedScore: number; highlights: Highlight[] }

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'from', 'was', 'were', 'are', 'has', 'have', 'show', 'find', 'all', 'events', 'event', 'customer', 'customers'])
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const stem = (t: string) => (t.length > 5 ? t.slice(0, Math.max(4, t.length - 3)) : t)
const tokenize = (q: string) => [...new Set(q.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t)))]
const get = (d: Record<string, unknown>, path: string) =>
  path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), d)

function highlightField(text: string, stems: string[]): Highlight['texts'] {
  const re = new RegExp(`(${stems.map((s) => `${esc(s)}[a-z]*`).join('|')})`, 'gi')
  return text
    .split(re)
    .filter(Boolean)
    .map((v) => ({ value: v, type: (re.test(v) && (re.lastIndex = 0) === 0 ? 'hit' : 'text') as 'hit' | 'text' }))
}

/* ---------------- Full-text ---------------- */

export async function fullTextSearch(q: string, collections: CollectionName[] = [...COLLECTIONS], limit = 30) {
  const store = await getStore()
  const caps = await getCapabilities()
  const colls = collections.length ? collections : [...COLLECTIONS]
  const tokens = tokenize(q)
  const stems = tokens.map(stem)
  const executed: { collection: CollectionName; engine: 'ATLAS_SEARCH' | 'LOCAL_FALLBACK'; pipeline: Pipeline; hits: number }[] = []
  const all: TextHit[] = []
  if (!stems.length) return { query: q, engine: 'NONE', results: [], executed, note: 'Enter at least one keyword of 3+ characters.' }

  await Promise.all(
    colls.map(async (coll) => {
      if (store.kind === 'atlas' && caps.searchCollections.includes(coll)) {
        const pipeline: Pipeline = [
          {
            $search: {
              index: config.searchIndexName,
              text: { query: q, path: ['description', 'semanticText', { wildcard: 'payload.*' }], fuzzy: { maxEdits: 1, prefixLength: 2 } },
              highlight: { path: ['description', 'semanticText'] },
            },
          },
          { $limit: limit },
          { $addFields: { sourceCollection: coll, score: { $meta: 'searchScore' }, highlights: { $meta: 'searchHighlights' } } },
          { $project: { embedding: 0 } },
        ]
        const rows = await store.aggregate<TextHit>(coll, pipeline)
        executed.push({ collection: coll, engine: 'ATLAS_SEARCH', pipeline, hits: rows.length })
        const max = Math.max(...rows.map((r) => r.score), 1e-9)
        rows.forEach((r) => all.push({ ...r, normalizedScore: r.score / max }))
        return
      }
      // Clearly-labelled fallback: regex candidate retrieval + BM25-style scoring computed in the app.
      const or = stems.flatMap((s) => TEXT_FIELDS.map((f) => ({ [f]: { $regex: esc(s), $options: 'i' } })))
      const pipeline: Pipeline = [{ $match: { $or: or } }, { $sort: { timestamp: -1 } }, { $limit: 3000 }, { $project: { embedding: 0 } }]
      const rows = await store.aggregate<UEvent>(coll, pipeline)
      const df = stems.map((s) => rows.filter((r) => TEXT_FIELDS.some((f) => String(get(r, f) ?? '').toLowerCase().includes(s))).length)
      const N = Math.max(rows.length, 1)
      const scored = rows.map((r) => {
        const text = TEXT_FIELDS.map((f) => String(get(r, f) ?? '')).join(' ').toLowerCase()
        const len = text.split(/\s+/).length
        let score = 0
        stems.forEach((s, i) => {
          const tf = text.split(s).length - 1
          if (tf) score += ((tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * len) / 20))) * Math.log(1 + (N - df[i] + 0.5) / (df[i] + 0.5))
        })
        if (text.includes(q.toLowerCase())) score *= 1.5
        const coverage = stems.filter((s) => text.includes(s)).length / stems.length
        score *= 0.5 + coverage
        const highlights: Highlight[] = ['description', 'payload.errorMessage', 'payload.failureReason']
          .map((f) => ({ f, v: get(r, f) }))
          .filter((x) => typeof x.v === 'string' && stems.some((s) => (x.v as string).toLowerCase().includes(s)))
          .map((x) => ({ path: x.f, texts: highlightField(x.v as string, stems) }))
        return { ...r, sourceCollection: coll, score, normalizedScore: 0, highlights } as TextHit
      })
      scored.sort((a, b) => b.score - a.score)
      const top = scored.slice(0, limit)
      const max = Math.max(...top.map((r) => r.score), 1e-9)
      top.forEach((r) => all.push({ ...r, normalizedScore: r.score / max }))
      executed.push({ collection: coll, engine: 'LOCAL_FALLBACK', pipeline, hits: top.length })
    }),
  )
  all.sort((a, b) => b.normalizedScore - a.normalizedScore || b.score - a.score)
  const engines = new Set(executed.map((e) => e.engine))
  return {
    query: q,
    engine: engines.size > 1 ? 'MIXED' : ([...engines][0] ?? 'NONE'),
    results: all.slice(0, limit),
    executed,
    note:
      'MongoDB Search indexes are collection-scoped: one query runs per selected collection, scores are normalized per collection (score / top score) and merged. Raw scores are shown for transparency.',
  }
}

/* ---------------- Vector ---------------- */

export type VectorHit = UEvent & { score: number; matchedText: string; verified: boolean | null; facts: Record<string, unknown> }

type Rule = { id: string; description: string; test: (f: Facts) => boolean; requires: 'tx' | 'customer' }
type Facts = { txHistory?: string[]; txState?: string; ntfStates?: string[]; onbState?: string; onbHistory?: string[] }

function pickRule(q: string): Rule | null {
  const s = q.toLowerCase()
  if (/notif/.test(s) && /(succe|settl)/.test(s))
    return {
      id: 'settled-notification-failed',
      requires: 'tx',
      description: 'Transaction latest state is SETTLED AND at least one correlated notification ended FAILED or DEAD_LETTERED.',
      test: (f) => f.txState === 'SETTLED' && !!f.ntfStates?.some((n) => n === 'FAILED' || n === 'DEAD_LETTERED'),
    }
  if (/after author/.test(s))
    return {
      id: 'failed-after-authorization',
      requires: 'tx',
      description: 'Transaction state history contains AUTHORIZED and the latest state is FAILED.',
      test: (f) => f.txState === 'FAILED' && !!f.txHistory?.includes('AUTHORIZED'),
    }
  if (/(wallet|activat)/.test(s))
    return {
      id: 'activation-problem',
      requires: 'customer',
      description: 'Customer onboarding history reached APPROVED but latest onboarding state is FAILED or SUSPENDED.',
      test: (f) => !!f.onbHistory?.includes('APPROVED') && (f.onbState === 'FAILED' || f.onbState === 'SUSPENDED'),
    }
  if (/onboard/.test(s) && /reject/.test(s))
    return { id: 'onboarding-rejected', requires: 'customer', description: 'Latest onboarding state for the customer is REJECTED.', test: (f) => f.onbState === 'REJECTED' }
  return null
}

export async function vectorSearch(q: string, collections: CollectionName[] = [...COLLECTIONS], limit = 20) {
  const store = await getStore()
  const caps = await getCapabilities()
  const colls = collections.length ? collections : [...COLLECTIONS]
  if (!caps.embeddings.available)
    return { available: false as const, reason: `Embedding model ${caps.embeddings.model} unavailable: ${caps.embeddings.reason}. True vector search is disabled rather than substituted with keyword matching.` }

  const [qv] = await embedTexts([q])
  const executed: { collection: CollectionName; engine: 'ATLAS_VECTOR_SEARCH' | 'EXACT_KNN'; pipeline: Pipeline; hits: number }[] = []
  const hits: VectorHit[] = []

  await Promise.all(
    colls.map(async (coll) => {
      if (store.kind === 'atlas' && caps.vectorCollections.includes(coll)) {
        const pipeline: Pipeline = [
          { $vectorSearch: { index: config.vectorIndexName, path: 'embedding', queryVector: qv, numCandidates: 200, limit: 25 } },
          { $addFields: { sourceCollection: coll, score: { $meta: 'vectorSearchScore' } } },
          { $project: { embedding: 0 } },
        ]
        const rows = await store.aggregate<VectorHit>(coll, pipeline)
        executed.push({ collection: coll, engine: 'ATLAS_VECTOR_SEARCH', pipeline: [{ $vectorSearch: { ...(pipeline[0].$vectorSearch as Document), queryVector: `[${qv.length} floats]` } }, ...pipeline.slice(1)], hits: rows.length })
        rows.forEach((r) => hits.push({ ...r, matchedText: r.semanticText, verified: null, facts: {} }))
        return
      }
      // Exact k-NN in the app over real model embeddings of each distinct semanticText.
      const groupPipeline: Pipeline = [{ $group: { _id: '$semanticText', n: { $sum: 1 } } }, { $limit: 4000 }]
      const texts = await store.aggregate<{ _id: string; n: number }>(coll, groupPipeline)
      const vecs = await embedTexts(texts.map((t) => t._id))
      const ranked = texts.map((t, i) => ({ text: t._id, score: (cosine(qv, vecs[i]) + 1) / 2 })).sort((a, b) => b.score - a.score).slice(0, 8)
      const docPipeline: Pipeline = [
        { $match: { semanticText: { $in: ranked.map((r) => r.text) } } },
        { $sort: { timestamp: -1 } },
        { $limit: 400 },
        { $project: { embedding: 0 } },
      ]
      const docs = await store.aggregate<UEvent>(coll, docPipeline)
      const per = new Map<string, number>()
      for (const d of docs) {
        const r = ranked.find((x) => x.text === d.semanticText)!
        const n = per.get(d.semanticText) ?? 0
        if (n >= 4) continue
        per.set(d.semanticText, n + 1)
        hits.push({ ...d, sourceCollection: coll, score: r.score, matchedText: d.semanticText, verified: null, facts: {} })
      }
      executed.push({ collection: coll, engine: 'EXACT_KNN', pipeline: [...groupPipeline, ...docPipeline], hits: per.size })
    }),
  )
  hits.sort((a, b) => b.score - a.score || new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  const top = hits.slice(0, limit)

  // Deterministic verification of cross-event conditions (vector similarity alone is not proof).
  const rule = pickRule(q)
  let verifiedCount = 0
  if (rule) {
    const txIds = [...new Set(top.map((h) => h.transactionId).filter(Boolean))] as string[]
    const custIds = [...new Set(top.map((h) => h.customerId).filter(Boolean))] as string[]
    const [txs, ntfs, onbs] = await Promise.all([
      store.aggregate<{ _id: string; h: string[] }>('deanAssignments', [
        { $match: { transactionId: { $in: txIds }, eventCategory: 'PAYMENT_TRANSACTION' } },
        { $sort: { timestamp: 1 } },
        { $group: { _id: '$transactionId', h: { $push: '$status' } } },
      ]),
      store.aggregate<{ _id: { t: string; n: string }; s: string }>('notificationEvents', [
        { $match: { transactionId: { $in: txIds } } },
        { $sort: { timestamp: 1 } },
        { $group: { _id: { t: '$transactionId', n: '$payload.notificationId' }, s: { $last: '$status' } } },
      ]),
      store.aggregate<{ _id: string; h: string[] }>('onboardingEvents', [
        { $match: { customerId: { $in: custIds } } },
        { $sort: { timestamp: 1 } },
        { $group: { _id: '$customerId', h: { $push: '$status' } } },
      ]),
    ])
    for (const h of top) {
      const tx = txs.find((t) => t._id === h.transactionId)
      const onb = onbs.find((o) => o._id === h.customerId)
      const f: Facts = {
        txHistory: tx?.h,
        txState: tx?.h.at(-1),
        ntfStates: ntfs.filter((n) => n._id.t === h.transactionId).map((n) => n.s),
        onbHistory: onb?.h,
        onbState: onb?.h.at(-1),
      }
      h.facts = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)))
      if (rule.requires === 'tx' && !h.transactionId) h.verified = false
      else h.verified = rule.test(f)
      if (h.verified) verifiedCount++
    }
  }
  return {
    available: true as const,
    query: q,
    model: caps.embeddings.model,
    dimensions: caps.embeddings.dimensions,
    engine: executed.some((e) => e.engine === 'ATLAS_VECTOR_SEARCH') ? 'ATLAS_VECTOR_SEARCH' : 'EXACT_KNN',
    results: top,
    executed,
    verification: rule ? { rule: rule.id, description: rule.description, verifiedCount, checked: top.length } : null,
  }
}
