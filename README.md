# Digital Euro | Operations & Audit Intelligence

Powered by MongoDB Atlas — Unified Event Intelligence.

A Next.js demo that uses MongoDB Atlas as the operational Single View and unified audit layer for a simulated Digital Euro event-driven architecture. Five simulated Kafka topics (GCP Pub/Sub compatible architecture) map to exactly five MongoDB collections:

| Simulated topic | Collection |
|---|---|
| onboarding-events | onboardingEvents |
| offboarding-events | offboardingEvents |
| dean-assignment | deanAssignments |
| notification-outbound | notificationEvents |
| error-dead-letter | deadLetterEvents |

No customer, transaction, vector or materialized-view collection exists. Customer 360, transaction timelines and the unified audit stream are assembled with `$unionWith`, `$group`/`$last` and application-side correlation.

## Modes

| Badge | Meaning |
|---|---|
| LOCAL DEMO | No `MONGODB_URI`. An in-memory engine runs the **same aggregation pipelines** (via mingo) over a deterministic ~10,000-document seed. Resets on cold start. |
| ATLAS CONNECTED | `MONGODB_URI` is set; all reads/writes go to the five Atlas collections in `MONGODB_DATABASE`. |
| ATLAS SEARCH AVAILABLE | The `de_text` Search index exists; full-text uses `$search` per collection, merged with normalized scores. Otherwise a clearly labeled keyword fallback is used. |
| ATLAS VECTOR SEARCH AVAILABLE | The `de_vector` index exists; semantic search uses `$vectorSearch`. In local mode, exact cosine k-NN runs over the same real embeddings. If embeddings cannot be generated, vector search is disabled with an explanation — keyword matching is never presented as vector search. |

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI` | for Atlas | Atlas connection string. Server-side only. |
| `MONGODB_DATABASE` | no | Defaults to `digital_euro_demo`. Reset only ever touches the five collections in this database. |
| `DEMO_MODE` | no | `true` (default) labels the environment DEMO. |
| `DEMO_ADMIN_TOKEN` | public deployments | When set, simulator, DLQ and admin mutations require header `x-demo-admin-token`. Enter it once on the Event Simulator page. |
| `AI_GATEWAY_API_KEY` | for vector search locally | Embeddings are generated through Vercel AI Gateway. On Vercel, authentication is automatic (OIDC). On a local machine, provide a key or pull the OIDC token (see below). The gateway's embedding models need paid credits. |
| `EMBEDDING_MODEL` | no | Defaults to `openai/text-embedding-3-small`. |
| `EMBEDDING_DIMENSIONS` | no | Defaults to `256`. Must match the `numDimensions` of the Atlas vector index; re-seed and re-create indexes if you change it. |
| `ATLAS_SEARCH_INDEX` | no | Defaults to `de_text`. |
| `ATLAS_VECTOR_INDEX` | no | Defaults to `de_vector`. |

## Running on a local machine

### 1. Prerequisites

- **Node.js 20.9 or later** (Next.js 16 requirement; Node 22 or 24 LTS recommended). Check with `node -v`.
- **pnpm**. The repo pins pnpm through the `packageManager` field in `package.json`, so the simplest option is Corepack, which ships with Node:
  ```bash
  corepack enable
  ```
  Alternatively install pnpm globally: `npm install -g pnpm`.
- **Git**, to clone the repository.
- Optional: a **MongoDB Atlas** cluster (for ATLAS CONNECTED mode) and a **Vercel AI Gateway** key (for semantic search).

### 2. Get the code

Either download the ZIP from v0 (three-dot menu → Download ZIP) and unzip it, or clone the connected GitHub repository:

```bash
git clone <your-repo-url> digital-euro-demo
cd digital-euro-demo
```

### 3. Install dependencies

```bash
pnpm install
```

### 4. Configure environment variables

Create a file named `.env.local` in the project root. Next.js loads it automatically; it is git-ignored and never sent to the browser.

**Option A — LOCAL DEMO (no external services).** You can skip the file entirely, or create it with:

```bash
DEMO_MODE=true
```

**Option B — ATLAS CONNECTED.**

```bash
MONGODB_URI="mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority"
MONGODB_DATABASE=digital_euro_demo
DEMO_MODE=true
# Optional: protect mutating controls even locally
# DEMO_ADMIN_TOKEN=choose-a-long-random-string
```

In Atlas, also make sure that:
- your machine's IP address is allowed under **Network Access** (or temporarily allow `0.0.0.0/0` for a demo cluster);
- the database user in the URI has `readWrite` on `MONGODB_DATABASE` (and `dbAdmin` so the app can create search indexes).

**Optional — enable semantic (vector) search locally.** Add one of:

```bash
# a) An AI Gateway API key (Vercel dashboard → AI Gateway → API Keys)
AI_GATEWAY_API_KEY=your-key
```

or, if the project is linked to Vercel, pull a short-lived OIDC token instead of using a key:

```bash
npm i -g vercel
vercel link
vercel env pull .env.local   # writes VERCEL_OIDC_TOKEN (expires after ~12h; re-run to refresh)
```

Note: `vercel env pull` overwrites `.env.local`, so re-add any variables you wrote by hand (or pull first, then append them).

Without embedding credentials the app still runs; the Semantic Investigation page shows vector search as disabled with the reason, and never substitutes keyword matching.

### 5. Start the development server

```bash
pnpm dev
```

Open http://localhost:3000. It redirects to **Executive Overview**.

- **LOCAL DEMO:** the deterministic ~10,000-document seed loads into memory on the first request (a few seconds). Data resets whenever the dev server restarts.
- **ATLAS CONNECTED:** the collections start empty. Go to **Event Simulator → Reset and Seed Demo**, confirm, wait for the batch progress to finish, then click **Ensure indexes** (see "Connecting MongoDB Atlas" below). Data persists across restarts.

The header badges show which mode is active (LOCAL DEMO / ATLAS CONNECTED / ATLAS SEARCH AVAILABLE / ATLAS VECTOR SEARCH AVAILABLE). `GET http://localhost:3000/api/health` returns the same information as JSON.

### 6. Production build (optional)

To run the optimized build locally:

```bash
pnpm build
pnpm start
```

This serves on http://localhost:3000 as well. Use a different port with `pnpm start -p 4000` (or `pnpm dev -p 4000`).

### 7. Quick smoke test

1. **Executive Overview** shows non-zero KPIs and charts.
2. **Event Simulator → Start simulation**; switch to **Live Event Monitor** and watch new rows arrive (keep a browser tab open — ticks are driven by the open console).
3. **Guided Demo** (header) walks through all five presenter steps, including the Scenario D notification retry on **Dead Letter Management**.

### Troubleshooting

| Symptom | Fix |
|---|---|
| `pnpm: command not found` | Run `corepack enable`, or `npm install -g pnpm`. |
| Corepack reports a pnpm version error | Run `corepack prepare pnpm@latest --activate`, or install pnpm globally and run `pnpm install` again. |
| `Port 3000 is in use` | Next.js picks the next free port automatically; use the URL printed in the terminal, or stop the other process. |
| Header shows LOCAL DEMO although `MONGODB_URI` is set | The variable must be in `.env.local` in the project root; restart `pnpm dev` after editing env files. |
| `MongoServerSelectionError` / connection timeout | Your IP is not on the Atlas Network Access list, or a VPN/firewall blocks port 27017. |
| `bad auth` / authentication failed | Check username/password in the URI; URL-encode special characters in the password. |
| Full-text search shows "keyword fallback" | Atlas Search indexes are still building, or **Ensure indexes** was not run. Wait until the header badge turns on. |
| Vector search disabled with an auth or credits message | Set `AI_GATEWAY_API_KEY` or refresh the OIDC token with `vercel env pull`, and make sure the AI Gateway account has credits. |
| Simulator buttons return 401 | `DEMO_ADMIN_TOKEN` is set; enter the same value on the Event Simulator page. |

## Connecting MongoDB Atlas

1. Create an Atlas cluster (M10+ recommended for Search/Vector Search; M0 works for structured queries).
2. Set `MONGODB_URI` (and optionally `MONGODB_DATABASE`) in Vercel → Project → Settings → Environment Variables.
3. Open **Event Simulator → Reset and Seed Demo**. The console seeds in bounded batches (`/api/admin` `seed-batch`), so no single serverless request exceeds time limits.
4. Click **Ensure indexes**. This creates:
   - unique `eventId` per collection; `customerId+timestamp`, `correlationId+timestamp`, `transactionId+timestamp`, `eventType+timestamp`, `status+timestamp`, `payload.errorCode+timestamp`, `ingestedAt`
   - `de_text` MongoDB Search index per collection
   - `de_vector` Vector Search index per collection, with `numDimensions` taken from `EMBEDDING_DIMENSIONS`
5. Search indexes build asynchronously. The header badges update once Atlas reports them as queryable.

## Deploying to Vercel

Click **Publish** in v0, or push to GitHub and import the repository in Vercel. Set `DEMO_ADMIN_TOKEN` on any public deployment.

## Simulation model

Vercel functions cannot run persistent intervals. While the simulator is RUNNING, the open console calls `/api/simulator/tick`, which releases events that are due for the configured rate through the same Zod validation → state-transition check → idempotent persistence pipeline. Partitions and offsets are simulated and labeled as such. Ingestion latency is measured from event creation to confirmed database write. Autonomous 24/7 streaming would need an external worker or a managed scheduler; in production, real Kafka/Pub/Sub consumers replace the simulator, and Change Streams can replace polling.

## Showcase scenarios (stable IDs)

| | Scenario | Customer |
|---|---|---|
| A | Successful onboarding and DEAN assignment | CUST-990001 |
| B | Successful transaction with notification | CUST-990002 |
| C | Transaction rejected after validation | CUST-990003 |
| D | Settled transaction, failed notification → DLQ retry | CUST-990004 |
| E | Invalid event routed to DLQ and reprocessed | CUST-990005 |
| F | Offboarding blocked by outstanding balance | CUST-990006 |

Use **Guided Demo** in the header for the five-step presenter walkthrough.

## Not claimed

This demo does not provide regulatory compliance, exactly-once delivery, or production SLAs, and does not define DEAN authoritatively. All data is fictional; monetary values are stored as integer EUR minor units.
