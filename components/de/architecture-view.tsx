'use client'

import { ArrowDown, CheckCircle2, CircleDashed } from 'lucide-react'
import { COLLECTION_LIST, COLLECTION_META, fmtNum, useHealth } from '@/lib/de/client'
import { cn } from '@/lib/utils'
import { PageHeader, Panel } from './ui'

const LAYERS = [
  { title: 'Simulated Event Producers', sub: 'Onboarding, DEAN registry, payment gateway, notification service' },
  { title: 'Kafka / GCP Pub/Sub Topic Simulator', sub: '5 logical topics · 6 simulated partitions · simulated offsets' },
  { title: 'Validation & Event Processing', sub: 'Zod schemas · state-machine checks · idempotency by eventId · DLQ routing' },
  { title: 'MongoDB Atlas', sub: 'digital_euro_demo database' },
]

const CAPS: { name: string; desc: string; implemented: boolean }[] = [
  { name: 'Flexible Document Model', desc: 'One audit envelope, domain-specific payloads per topic; new fields require no migration.', implemented: true },
  { name: 'Event History Persistence', desc: 'Append-only state transitions; latest state reconstructed with $sort + $group/$last.', implemented: true },
  { name: 'Cross-Collection Aggregation', desc: '$unionWith assembles the unified audit stream and Customer 360 from five collections.', implemented: true },
  { name: 'Secondary Indexes', desc: 'Unique eventId plus compound customerId/correlationId/transactionId/status + timestamp.', implemented: true },
  { name: 'MongoDB Search', desc: '$search per collection with highlighting; results merged with normalized scores.', implemented: true },
  { name: 'MongoDB Vector Search', desc: '$vectorSearch over embeddings stored inside the event documents; correlation verification.', implemented: true },
  { name: 'Change Streams', desc: 'Production option for push-based downstream processing; this Vercel demo uses polling.', implemented: false },
  { name: 'Operational Data Access', desc: 'The same cluster serves dashboards, investigation and DLQ recovery with low latency.', implemented: true },
  { name: 'Horizontal Scalability', desc: 'Sharding by customerId or hashed eventId for production volumes; not exercised by the demo.', implemented: false },
]

const MESSAGES = [
  'One operational data platform for heterogeneous events.',
  'Complete traceability of customer and transaction journeys.',
  'Fast investigation through structured, text, and semantic search.',
  'Near-real-time operational visibility.',
  'Simplified audit investigation and error recovery.',
  'Extensible document schemas for evolving Digital Euro requirements.',
]

const UNION = `db.onboardingEvents.aggregate([
  { $match: { customerId: "CUST-990001" } },
  { $addFields: { sourceCollection: "onboardingEvents" } },
  { $unionWith: { coll: "offboardingEvents",  pipeline: [{ $match: { customerId: "CUST-990001" } }, ...] } },
  { $unionWith: { coll: "deanAssignments",    pipeline: [...] } },
  { $unionWith: { coll: "notificationEvents", pipeline: [...] } },
  { $unionWith: { coll: "deadLetterEvents",   pipeline: [...] } },
  { $sort: { timestamp: 1 } }
])`

const LATEST = `db.deanAssignments.aggregate([
  { $match: { eventCategory: "PAYMENT_TRANSACTION" } },
  { $sort: { timestamp: 1 } },
  { $group: { _id: "$transactionId", state: { $last: "$status" }, history: { $push: "$status" } } },
  { $group: { _id: "$state", transactions: { $sum: 1 } } }
])`

const SEARCH = `// Executed once per selected collection, then merged
db.notificationEvents.aggregate([
  { $search: { index: "audit_text",
      text: { query: "notification delivery failed", path: ["description", "payload.lastError"], fuzzy: {} },
      highlight: { path: ["description", "payload.lastError"] } } },
  { $limit: 30 },
  { $project: { description: 1, score: { $meta: "searchScore" }, highlights: { $meta: "searchHighlights" } } }
])`

const VECTOR = `db.deanAssignments.aggregate([
  { $vectorSearch: { index: "audit_vector", path: "embedding",
      queryVector: embed("transactions that failed after authorization"),
      numCandidates: 200, limit: 20 } },
  { $project: { embedding: 0, score: { $meta: "vectorSearchScore" } } }
])
// then: deterministic $group over transactionId history verifies AUTHORIZED → FAILED`

export function ArchitectureView() {
  const { data: h } = useHealth()
  const modes = [
    { label: 'LOCAL DEMO', on: h?.mode === 'LOCAL_DEMO' },
    { label: 'ATLAS CONNECTED', on: !!h?.atlasConnected },
    { label: 'ATLAS SEARCH AVAILABLE', on: !!h?.atlasSearch },
    { label: 'ATLAS VECTOR SEARCH AVAILABLE', on: !!h?.atlasVectorSearch },
  ]
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Architecture & MongoDB Value"
        title="From fragmented event streams to a unified operational view."
        description="MongoDB Atlas acts as the operational Single View and audit intelligence layer: five event collections, one query language, no separate relational reporting database."
      />
      <div className="flex flex-wrap gap-2">
        {modes.map((m) => (
          <span key={m.label} className={cn('flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[11px]', m.on ? 'border-primary/40 bg-primary/10 text-primary' : 'text-muted-foreground')}>
            <span className={cn('size-1.5 rounded-full', m.on ? 'bg-primary' : 'bg-muted-foreground/40')} aria-hidden />
            {m.label}
          </span>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Panel title="Reference architecture" description="Implemented in this demo end-to-end">
          <ol className="flex flex-col items-stretch gap-1">
            {LAYERS.map((l) => (
              <li key={l.title} className="flex flex-col items-center gap-1">
                <div className={cn('w-full rounded-md border px-4 py-3 text-center', l.title === 'MongoDB Atlas' ? 'border-primary/40 bg-primary/10' : 'bg-background/40')}>
                  <div className={cn('text-sm font-medium', l.title === 'MongoDB Atlas' && 'text-primary')}>{l.title}</div>
                  <div className="text-xs text-muted-foreground">{l.sub}</div>
                </div>
                <ArrowDown className="size-4 text-muted-foreground" aria-hidden />
              </li>
            ))}
            <li className="grid grid-cols-5 gap-1.5">
              {COLLECTION_LIST.map((c) => (
                <div key={c} className="flex flex-col items-center gap-1 rounded-md border bg-background/40 px-1 py-2 text-center">
                  <span className={cn('size-2 rounded-full', COLLECTION_META[c].dot)} aria-hidden />
                  <span className="break-all font-mono text-[10px] leading-tight">{c}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{fmtNum(h?.counts?.[c])}</span>
                </div>
              ))}
            </li>
            <li className="flex justify-center"><ArrowDown className="size-4 text-muted-foreground" aria-hidden /></li>
            <li className="rounded-md border px-4 py-3 text-center">
              <div className="text-sm font-medium">Unified Audit & Single View</div>
              <div className="text-xs text-muted-foreground">$unionWith · $group/$last · $lookup · application-side correlation</div>
            </li>
            <li className="flex justify-center"><ArrowDown className="size-4 text-muted-foreground" aria-hidden /></li>
            <li className="rounded-md border px-4 py-3 text-center">
              <div className="text-sm font-medium">Operational Dashboard & Search</div>
              <div className="text-xs text-muted-foreground">Structured filters · MongoDB Search · Atlas Vector Search · DLQ recovery</div>
            </li>
          </ol>
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel title="MongoDB capabilities" description="Implemented in this demo vs. optional production architecture">
            <ul className="flex flex-col gap-2.5">
              {CAPS.map((c) => (
                <li key={c.name} className="flex gap-2.5">
                  {c.implemented ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-label="Implemented" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Production option" />}
                  <div>
                    <div className="text-sm font-medium">
                      {c.name}
                      {!c.implemented && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">production option</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">{c.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Business value">
            <ol className="flex flex-col gap-2">
              {MESSAGES.map((m, i) => (
                <li key={m} className="flex gap-3 text-sm">
                  <span className="font-mono text-primary">{String(i + 1).padStart(2, '0')}</span>
                  {m}
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <CodePanel title="Unified event stream" feature="$unionWith across five collections" code={UNION} />
        <CodePanel title="Latest-state reconstruction" feature="$sort + $group/$last over append-only history" code={LATEST} />
        <CodePanel title="Full-text retrieval" feature="MongoDB Search — collection-scoped indexes" code={SEARCH} />
        <CodePanel title="Semantic retrieval + verification" feature="Atlas Vector Search, then deterministic correlation" code={VECTOR} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="From simulator to production">
          <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
            <li>Replace the request-triggered simulator with Kafka consumers (or the MongoDB Kafka Connector) / GCP Pub/Sub subscriptions running in a long-lived worker or managed service.</li>
            <li>Keep the same ingestion contract: Zod validation, state-transition checks, idempotent upsert by eventId, and DLQ envelopes for invalid input.</li>
            <li>Use Change Streams to push newly persisted events to downstream consumers and dashboards instead of polling.</li>
            <li>Autonomous streaming on Vercel needs an external worker or managed scheduler — serverless functions do not run persistent intervals.</li>
          </ul>
        </Panel>
        <Panel title="What this demo does not claim">
          <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
            <li>It does not provide regulatory compliance on its own, nor an authoritative definition of DEAN.</li>
            <li>It does not run a real Kafka broker or Pub/Sub; partitions and offsets are simulated and labeled as such.</li>
            <li>It does not guarantee exactly-once delivery or production SLAs; latency figures are measured, not benchmarked.</li>
            <li>All customers, amounts, and identifiers are fictional; amounts are stored as integer EUR minor units.</li>
          </ul>
        </Panel>
      </div>
    </div>
  )
}

function CodePanel({ title, feature, code }: { title: string; feature: string; code: string }) {
  return (
    <Panel title={title} description={feature} bodyClassName="p-0">
      <pre className="overflow-x-auto p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">{code}</pre>
    </Panel>
  )
}
