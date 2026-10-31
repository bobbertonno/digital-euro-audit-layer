import { createHash, randomUUID } from 'node:crypto'

export type Rng = {
  next: () => number
  int: (min: number, max: number) => number
  pick: <T>(arr: readonly T[]) => T
  chance: (p: number) => boolean
  uuid: () => string
}

/** mulberry32 — deterministic PRNG so seeds and scenarios are reproducible. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min
  return {
    next,
    int,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    uuid: () => {
      const h = Array.from({ length: 16 }, () => int(0, 255))
      h[6] = (h[6] & 0x0f) | 0x40
      h[8] = (h[8] & 0x3f) | 0x80
      const s = h.map((b) => b.toString(16).padStart(2, '0')).join('')
      return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
    },
  }
}

/** Non-deterministic RNG for live simulation (seeded from crypto). */
export function liveRng(): Rng {
  const r = createRng(parseInt(randomUUID().slice(0, 8), 16))
  return { ...r, uuid: () => randomUUID() }
}

/** Deterministic UUID derived from a name — used for idempotent retry writes. */
export function nameUuid(name: string) {
  const h = createHash('sha1').update(name).digest('hex')
  const v = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export const pad = (n: number, w = 6) => String(n).padStart(w, '0')
export const objectIdHex = (rng: Rng) =>
  Array.from({ length: 24 }, () => rng.int(0, 15).toString(16)).join('')
