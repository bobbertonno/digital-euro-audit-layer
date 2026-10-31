import 'server-only'
import { NextResponse } from 'next/server'
import { config } from './config'

const g = globalThis as unknown as { __deRate?: Map<string, { tokens: number; at: number }> }

/** Token bucket per client IP + route. */
export function rateLimit(req: Request, key: string, perMinute = 60) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const map = (g.__deRate ??= new Map())
  const id = `${key}:${ip}`
  const now = Date.now()
  const b = map.get(id) ?? { tokens: perMinute, at: now }
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60000) * perMinute)
  b.at = now
  if (b.tokens < 1) {
    map.set(id, b)
    return NextResponse.json({ error: 'Rate limit exceeded. Please slow down.' }, { status: 429 })
  }
  b.tokens -= 1
  map.set(id, b)
  return null
}

/** Admin routes (seed/reset/index creation/DLQ mutations) require DEMO_ADMIN_TOKEN when it is configured. */
export function requireAdmin(req: Request) {
  if (!config.adminToken) return null
  const token = req.headers.get('x-demo-admin-token')
  if (token && token === config.adminToken) return null
  return NextResponse.json({ error: 'Admin token required for this demo control (set the token in the header bar).' }, { status: 401 })
}

export const adminRequired = () => Boolean(config.adminToken)

export function jsonError(e: unknown, status = 500) {
  const message = e instanceof Error ? e.message : 'Unexpected error'
  return NextResponse.json({ error: message }, { status })
}
