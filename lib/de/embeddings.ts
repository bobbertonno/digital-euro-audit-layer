import 'server-only'
import { embedMany } from 'ai'
import { config } from './config'

const g = globalThis as unknown as { __deEmb?: Map<string, number[]>; __deEmbErr?: { at: number; msg: string } }
const cache = () => (g.__deEmb ??= new Map())

export type EmbeddingStatus = { available: boolean; model: string; dimensions: number; reason?: string }

/** Real embeddings through Vercel AI Gateway, cached by text (event descriptions are template-based). */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const c = cache()
  const missing = [...new Set(texts.filter((t) => !c.has(t)))]
  for (let i = 0; i < missing.length; i += 200) {
    const chunk = missing.slice(i, i + 200)
    const { embeddings } = await embedMany({
      model: config.embeddingModel,
      values: chunk,
      dimensions: config.embeddingDimensions,
      maxRetries: 1,
    })
    chunk.forEach((t, j) => c.set(t, embeddings[j]))
  }
  return texts.map((t) => c.get(t)!)
}

export async function embeddingStatus(): Promise<EmbeddingStatus> {
  const base = { model: config.embeddingModel, dimensions: config.embeddingDimensions }
  if (g.__deEmbErr && Date.now() - g.__deEmbErr.at < 60000) return { ...base, available: false, reason: g.__deEmbErr.msg }
  try {
    await embedTexts(['Digital Euro embedding health check'])
    return { ...base, available: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    g.__deEmbErr = { at: Date.now(), msg }
    return { ...base, available: false, reason: msg }
  }
}

export function cosine(a: number[], b: number[]) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}
