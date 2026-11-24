# Architecture — Digital Euro | Operations & Audit Intelligence

Diagram: [`diagrams/architecture.mmd`](diagrams/architecture.mmd)

## Components

| Layer | Files | Responsibility |
|---|---|---|
| UI (client) | `components/de/*.tsx`, `app/*/page.tsx` | Operations console pages. They use SWR polling against the API routes and never touch MongoDB directly. |
| API (server) | `app/api/**/route.ts` | Route handlers for health, dashboard, events, customers, transactions, search (filter/text/vector), DLQ, simulator and admin. |
| Domain | `lib/de/domain.ts` | Topic-to-collection mapping, Zod event envelope schemas, and state-transition tables for onboarding, offboarding, DEAN/transaction and notification lifecycles. |
| Generator / seed | `lib/de/generator.ts`, `lib/de/seed.ts`, `lib/de/rng.ts`, `lib/de/scenarios-meta.ts` | Deterministic, seeded fictional data (~10,000 documents) and showcase scenarios A–F with stable IDs. |
| Simulator | `lib/de/simulator.ts`, `app/api/simulator/**` | Request-triggered event generation for five simulated topics. Partitions and offsets are labeled as simulated, and there is no real Kafka/Pub/Sub broker. |
| Ingestion | `lib/de/ingest.ts` | Zod validation → state-transition check → idempotent `insertMany`. Invalid input goes to `deadLetterEvents` as a sanitized envelope. Measures ingestion latency from event creation to confirmed write. |
| Store | `lib/de/store.ts` | One interface with two backends: the MongoDB Node.js driver (Atlas), or an in-memory engine that runs the same aggregation pipelines with `mingo` (LOCAL DEMO). |
| Queries | `lib/de/queries.ts` | All aggregation pipelines: dashboard, unified stream, Customer 360, transaction timeline, structured filters, saved investigations. |
| Search | `lib/de/search.ts`, `lib/de/embeddings.ts`, `lib/de/indexes.ts` | `$search` full-text, `$vectorSearch` semantic search, embedding generation, and index definitions. |
| DLQ | `lib/de/dlq.ts`, `app/api/dlq/**` | Inspect, investigate, retry (re-runs the ingest pipeline) and discard, with a retained retry history. |
| Safety | `lib/de/guard.ts`, `lib/de/config.ts` | Optional `DEMO_ADMIN_TOKEN` protection and rate limiting for mutations. Reset is restricted to a database whose name contains `demo`. |
| Capabilities | `lib/de/capabilities.ts`, `app/api/health/route.ts` | Detects LOCAL DEMO / ATLAS CONNECTED / ATLAS SEARCH AVAILABLE / ATLAS VECTOR SEARCH AVAILABLE for the header badges. |

## Data flow

1. **Produce.** The simulator (`/api/simulator/tick`), the seed (`/api/admin` `seed-batch`) or a DLQ retry creates events with the common audit envelope: `eventId`, `eventType`, `topic`, `customerId`, `correlationId`, `transactionId`, `deanId`, `timestamp`, `ingestedAt`, `status`, `previousStatus`, `description`, `metadata`, `payload` and `audit`.
2. **Validate.** `lib/de/ingest.ts` parses each event with Zod and checks the transition against the latest persisted state for that entity. Malformed or impossible events are never written to business collections. They go to `deadLetterEvents` with a sanitized payload and an error classification.
3. **Persist.** Valid events are appended with `insertMany({ ordered: false })`. The unique `eventId` index turns replays into reported duplicates rather than overwrites. Monetary amounts are integer EUR minor units.
4. **Read.** The API routes run aggregation pipelines over the five collections. The latest state is always reconstructed from event history. No customer, transaction or materialized-view collection exists.
5. **Search.** Full-text and vector queries run per collection, because Search indexes are collection-scoped. The results are merged with transparent scores.
6. **Recover.** DLQ retry re-runs the same ingest logic for the original event. If it succeeds, the recovered event is written to its destination collection and the DLQ entry moves to `REPROCESSED`, with the retry appended to its history.

## Collections

| Simulated topic | Collection | Content |
|---|---|---|
| `onboarding-events` | `onboardingEvents` | Enrollment lifecycle REQUESTED → … → ACTIVATED (or REJECTED / SUSPENDED / FAILED) |
| `offboarding-events` | `offboardingEvents` | Exit lifecycle OFFBOARDING_REQUESTED → … → COMPLETED (or BLOCKED / FAILED / CANCELLED) |
| `dean-assignment` | `deanAssignments` | DEAN assignment and payment transaction state history, separated by `eventCategory` |
| `notification-outbound` | `notificationEvents` | Notification lifecycle CREATED → QUEUED → DISPATCHED → DELIVERED (or RETRY_PENDING / FAILED / DEAD_LETTERED) |
| `error-dead-letter` | `deadLetterEvents` | Failed events with error code, classification, retry count, history and DLQ state |

## Indexes (`lib/de/indexes.ts`, created by Simulator → Ensure indexes)

- On every collection: unique `eventId`, `customerId+timestamp`, `correlationId+timestamp`, `eventType+timestamp`, `status+timestamp`, `ingestedAt`, `timestamp`.
- `transactionId+timestamp` on `deanAssignments`, `notificationEvents` and `deadLetterEvents`.
- `eventCategory+transactionId+timestamp` on `deanAssignments`.
- `payload.notificationId+timestamp` on `notificationEvents`.
- `payload.errorCode+timestamp` and a unique `payload.dlqId` on `deadLetterEvents`.
- `de_text` MongoDB Search index per collection: `description`, `semanticText`, `payload.errorMessage`, `payload.failureReason`, `payload.lastError` and `payload.transitionReason` (lucene.english), plus token fields `eventType`, `status` and `customerId`.
- `de_vector` Vector Search index per collection: `embedding` (cosine, `numDimensions` = `EMBEDDING_DIMENSIONS`), with filter fields `status` and `customerId`.

## Key aggregation patterns (`lib/de/queries.ts`)

- **Unified stream:** a pipeline on `onboardingEvents` that uses `$unionWith` for the other four collections, then `$sort` and pagination.
- **Latest state:** `$sort` by timestamp → `$group` by `transactionId` / `customerId` with `$last`. KPIs count unique transactions by their latest state, not by state events.
- **Customer 360:** a cross-collection timeline for one `customerId`. Each item is tagged with its source collection.
- **Transaction timeline:** `$setWindowFields` with `$shift` adds the previous and next state to every transition.
- **Settled without notification:** `$lookup` from `deanAssignments` to `notificationEvents` on `transactionId`.
- **Structured search:** combined filters with `$facet` for the total count and paged results.

## Search and AI

- **Full-text** (`lib/de/search.ts`): `$search` with highlighting on each selected collection, results merged by normalized score. If the index is not queryable, the app uses a keyword fallback that is clearly labeled as such.
- **Embeddings** (`lib/de/embeddings.ts`): `embedMany` from the AI SDK through Vercel AI Gateway (default `openai/text-embedding-3-small`, 256 dimensions). Vectors are stored in an `embedding` field inside the existing collections, so there is no separate vector collection.
- **Vector search:** `$vectorSearch` on `de_vector` per collection. In LOCAL DEMO it runs an exact cosine k-NN over the same real embeddings. Candidates for multi-event questions are confirmed with deterministic correlation queries, so similarity alone is never presented as proof. If embeddings cannot be generated, vector search is turned off and the reason is shown.

## Implemented vs. production options

| Implemented in the demo | Production option (not implemented) |
|---|---|
| Request-triggered simulator, with polling from the open console | Real Kafka / GCP Pub/Sub consumers |
| SWR polling for live updates | Change Streams for push-based downstream processing |
| Bounded-batch seeding via `/api/admin` | External worker or managed scheduler for 24/7 streaming |
