'use client'

import useSWR from 'swr'
import type { CollectionName } from './domain'

export const ADMIN_TOKEN_KEY = 'de-admin-token'

function adminHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  const t = window.sessionStorage.getItem(ADMIN_TOKEN_KEY)
  return t ? { 'x-demo-admin-token': t } : {}
}

export async function fetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`)
  return data as T
}

export async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...adminHeaders() },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`)
  return data as T
}

export type Health = {
  mode: 'LOCAL_DEMO' | 'ATLAS_CONNECTED'
  atlasConfigured: boolean
  atlasConnected: boolean
  atlasError?: string
  database: string
  atlasSearch: boolean
  atlasVectorSearch: boolean
  searchCollections: CollectionName[]
  vectorCollections: CollectionName[]
  embeddings: { available: boolean; model: string; dimensions: number | null; reason?: string; provider?: string }
  searchIndexName: string
  vectorIndexName: string
  store: 'memory' | 'atlas'
  version: number
  counts: Record<CollectionName, number>
  adminRequired: boolean
  simulation: { state: 'RUNNING' | 'PAUSED' | 'STOPPED'; rate: number; failureRate: number; seed: number | null; generated: number; queued: number }
  serverTime: string
}

export function useHealth() {
  return useSWR<Health>('/api/health', fetcher, { refreshInterval: 2000, keepPreviousData: true })
}

/* ---------------- Formatting ---------------- */

const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })
const num = new Intl.NumberFormat('en-US')

export const fmtEUR = (minor: number | null | undefined) => (minor == null ? '—' : eur.format(minor / 100))
export const fmtNum = (n: number | null | undefined) => (n == null ? '—' : num.format(Math.round(n)))
export const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`
export const fmtMs = (ms: number | null | undefined) => {
  if (ms == null || Number.isNaN(ms)) return '—'
  if (ms < 1) return `${ms.toFixed(2)} ms`
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 1 : 0)} ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`
  return `${(ms / 60000).toFixed(1)} min`
}
export const fmtTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
export const fmtDateTime = (d: string | Date | null | undefined) =>
  d
    ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—'
export function fmtRel(d: string | Date | null | undefined, now = Date.now()) {
  if (!d) return '—'
  const s = Math.round((now - new Date(d).getTime()) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/* ---------------- Semantic tones ---------------- */

export type Tone = 'success' | 'danger' | 'warning' | 'info' | 'neutral'

const SUCCESS = ['ACTIVATED', 'APPROVED', 'SETTLED', 'DELIVERED', 'ASSIGNED', 'COMPLETED', 'REPROCESSED', 'SUCCESS', 'KYC_VERIFIED', 'ELIGIBILITY_CONFIRMED']
const DANGER = ['FAILED', 'REJECTED', 'DEAD_LETTERED', 'BLOCKED', 'OPEN', 'SUSPENDED']
const WARNING = ['RETRY_PENDING', 'INVESTIGATING', 'REVERSED', 'DUPLICATE', 'CANCELLED', 'DISCARDED']

export function statusTone(status?: string | null): Tone {
  if (!status) return 'neutral'
  const s = status.replace(/^OFFBOARDING:/, '')
  if (SUCCESS.includes(s)) return 'success'
  if (DANGER.includes(s)) return 'danger'
  if (WARNING.includes(s)) return 'warning'
  return 'info'
}

export const TONE_CLASS: Record<Tone, string> = {
  success: 'bg-success/12 text-success border-success/25',
  danger: 'bg-destructive/12 text-destructive border-destructive/30',
  warning: 'bg-warning/12 text-warning border-warning/25',
  info: 'bg-info/12 text-info border-info/25',
  neutral: 'bg-muted text-muted-foreground border-border',
}

export const COLLECTION_META: Record<CollectionName, { label: string; topic: string; short: string; color: string; dot: string }> = {
  onboardingEvents: { label: 'Onboarding', topic: 'onboarding-events', short: 'ONB', color: 'var(--chart-1)', dot: 'bg-chart-1' },
  offboardingEvents: { label: 'Offboarding', topic: 'offboarding-events', short: 'OFF', color: 'var(--chart-4)', dot: 'bg-chart-4' },
  deanAssignments: { label: 'DEAN & Transactions', topic: 'dean-assignment', short: 'DEAN', color: 'var(--chart-2)', dot: 'bg-chart-2' },
  notificationEvents: { label: 'Notifications', topic: 'notification-outbound', short: 'NTF', color: 'var(--chart-5)', dot: 'bg-chart-5' },
  deadLetterEvents: { label: 'Dead Letter', topic: 'error-dead-letter', short: 'DLQ', color: 'var(--destructive)', dot: 'bg-destructive' },
}

export const COLLECTION_LIST = Object.keys(COLLECTION_META) as CollectionName[]
