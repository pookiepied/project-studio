# API Gateway — Complete Service Reference

**Date:** 2026-06-06  
**Worker name:** `api`  
**Framework:** Hono v4  
**Entry point:** `src/index.ts`  
**Runtime:** Cloudflare Workers (compatibility date `2024-01-01`)

---

## What This Worker Is

The `api` folder is the **single public-facing gateway** for the entire STUDIO project. It is the only worker the browser frontend and Tauri desktop app communicate with directly. Everything else — the AI worker, the chats store, the studio preferences worker, the tracker — is reached via service bindings that only this worker can call.

It serves three completely distinct responsibilities in a single deployed worker:

1. **Proxy / adapter layer** — translates and forwards requests to internal workers (`ai`, `chats`, `studio`, `tracker`) via service bindings. Auth is enforced here; downstream workers trust the injected headers.
2. **Job queue** — owns the `studio-jobs` D1 database and manages the full lifecycle of async jobs (`queued → running → done/failed/cancelled`), including long-polling claim, heartbeat tracking, and result submission.
3. **Engine protocol** — a private REST contract exclusively for the local engine (the Tauri desktop daemon) to register capabilities, claim jobs, beat heartbeats, report progress, and save/load agent checkpoints.

---

## Infrastructure Bindings

| Binding | Type | Purpose |
|---------|------|---------|
| `AI` | Service Binding (`ai` worker) | AI, audio, MCP, Composio, image, PDF endpoints |
| `CHATS_SERVICE` | Service Binding (`chats` worker) | User chat history read/write |
| `STUDIO` | Service Binding (`studio` worker) | User preferences backend |
| `TRACKER` | Service Binding (`tracker` worker) | Usage and telemetry analytics proxy |
| `DB` | D1 Database (`studio-jobs`) | Job queue, agent checkpoints, system state, system clients |
| `KV` | KV Namespace | Task catalog (24-hour TTL) |
| `RELEASES_KV` | KV Namespace | Desktop app update manifest (key: `studio:latest`) |
| `RELEASES_BUCKET` | R2 Bucket (`studio-releases`) | Desktop app `.nsis.zip` update files |

---

## Global Middleware (applied to all routes)

Applied in this order on every request via `app.use('/*', ...)`:

| Middleware | What it does |
|-----------|-------------|
| `requestId` | Generates a UUID per request, stores it as `x-request-id` response header and in Hono context |
| `requestLogger` | Structured JSON logs for every request and response (timestamp, method, path, status, duration) |
| `corsMiddleware` | Whitelist-based CORS — allows configured origins, `tauri://` scheme, any localhost; falls back to `*` for unknown origins (security is JWT-based, not CORS-based) |
| `securityHeaders` | Adds CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`, and HSTS on HTTPS |
| `requestSizeLimit` | Rejects bodies over 10 MB with 413 |

---

## Authentication

Three middleware guards are used across routes:

### `userAuth`
**Required header:** `Authorization: Bearer <jwt>`

Verifies the JWT against `JWT_SECRET`. Rejects refresh tokens. Sets `caller = { type: "user", sub, email, role }` in Hono context.

Used on: all user-facing routes (`/run`, `/jobs`, `/tasks`, `/tracker/*`, `/adapters/openai/v1/user/*`, etc.)

### `engineAuth`
**Required header:** `x-engine-key: <secret>`

Compares directly against `ENGINE_API_KEY` env var. Sets `caller = { type: "engine" }`.

Used on: all `/internal/*` routes exclusively. No other caller can reach these.

> **Note:** `flexAuth` (which accepted either a JWT or engine key) was removed. All adapter routes now require `userAuth` (JWT only). The `x-engine-key` path no longer exists on adapter routes.

---

## Pre-Hono: WebSocket & Agent Forwarding

**Before Hono processes any request**, the `fetch()` handler checks if `pathname.startsWith("/agents/")`. If so, it forwards the request **directly** to the `ai` worker via the `AI` service binding, bypassing all middleware.

**Why:** WebSocket upgrade requests (`Upgrade: websocket`) need a raw HTTP 101 response. Hono middleware cannot intercept or proxy them transparently.

**User identity injection:** The gateway decodes the user identity from either:
1. `Authorization: Bearer <jwt>` — extracts `payload.sub` (for HTTP agent calls)
2. `cf-access-jwt-assertion` — extracts `payload.sub` or `payload.email` (present on all requests including WebSocket upgrades, where custom headers cannot be set by browsers)

The resolved `userId` is injected as `X-User-ID` before forwarding, so `ChatAgent` can scope memory and state correctly.

---

## D1 Database Schema

Database name: `studio-jobs`

### `jobs` table

Central job queue.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Format: `job_<uuid>` |
| `task_id` | TEXT | Which task to run |
| `user_id` | TEXT | Owner — scoped from JWT |
| `status` | TEXT | `queued`, `running`, `done`, `failed`, `cancelled` |
| `execution_target` | TEXT | `cloud`, `local`, or `any` |
| `inputs` | TEXT | JSON — task input payload |
| `options` | TEXT | JSON — optional run-time overrides |
| `result` | TEXT | JSON — filled by engine on completion |
| `progress` | TEXT | JSON — filled by engine mid-run |
| `error` | TEXT | Error message on failure |
| `created_at` | INTEGER | Unix epoch ms |
| `updated_at` | INTEGER | Unix epoch ms |
| `completed_at` | INTEGER | Unix epoch ms |
| `heartbeat_at` | INTEGER | Unix epoch ms — engine updates this every ~5s |

Indexes: `status`, `user_id`, `created_at DESC`, `execution_target`.

### `checkpoints` table

Serialised LangGraph agent state for async local tool resumption.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Format: `checkpoint_<uuid>` |
| `session_id` | TEXT | Groups checkpoints per conversation |
| `graph_state` | TEXT | JSON-serialised LangGraph state |
| `pending_job_id` | TEXT | `jobs.id` this checkpoint is waiting on (nullable) |
| `created_at` | INTEGER | Unix epoch ms |
| `expires_at` | INTEGER | Unix epoch ms — 30-minute TTL |

Indexes: `session_id`, `pending_job_id`, `expires_at`.

**Lifecycle:** Agent hits a local tool call → saves checkpoint → returns job ID to client → local engine claims job, executes tool, posts result → client sends checkpoint ID + result → graph resumes.

### `system_state` table

Key-value store for runtime flags.

| Key | Value | Updated by |
|-----|-------|-----------|
| `engine_last_seen` | ISO 8601 timestamp string | `POST /internal/tasks/register` |

### `system_clients` table

Pre-registered system-level API clients (bots, integrations). Auth is token-based (SHA-256 hashed). Schema exists in D1 but no active routes currently expose this table.

| Column | Description |
|--------|-------------|
| `id` | `system_<uuid>` |
| `name` | Unique client name |
| `token` | SHA-256 hash of raw token (never stored plain) |
| `enabled` | Soft-disable flag |
| `permissions` | JSON array of capability scopes |
| `last_used_at` | Audit timestamp |

---

## Complete Endpoint Reference

**Total: 58 HTTP endpoints + WebSocket forwarding + 1 cron**

---

### Pre-Hono: Agent & WebSocket Forwarding

---

#### `ANY /agents/*` → `ai` worker

Handled before Hono. All traffic whose path starts with `/agents/` is forwarded directly to the `ai` worker.

- Extracts `userId` from Bearer JWT payload (`sub`) or CF Access JWT (`sub`/`email`)
- Injects `X-User-ID: <userId>` header before forwarding
- Preserves the original request body and all headers

This is the path used for WebSocket connections to `ChatAgent` and HTTP calls to `ResearchSubAgent` RPC methods. See `ai/docs/GATEWAY_REFERENCE.md` for the full `ChatAgent` protocol.

---

### Health Routes

No authentication required.

---

#### `GET /health`

Basic liveness probe. Always returns 200.

**Response:**
```json
{
  "status": "healthy",
  "service": "api-gateway",
  "version": "1.0.0",
  "timestamp": "2026-06-06T00:00:00.000Z",
  "uptime": 0
}
```

---

#### `GET /system/status`

Deep system health check. Probes all components in parallel.

**Components checked:**
- **DB** — runs 4 concurrent job count queries; response time determines `operational` (<100ms) / `degraded` (<500ms) / `down`
- **AI worker** — calls `ai` service binding `/v1/health` and `/v1/models`; extracts `uniqueModels` count
- **Engine** — reads `engine_last_seen` from `system_state`; considered online if updated within 60 seconds

**Overall status logic:**
- `healthy` — all components operational and engine online
- `degraded` — any component degraded or engine offline
- `unhealthy` — any component down; returns HTTP 503

**Response:**
```json
{
  "status": "healthy | degraded | unhealthy",
  "timestamp": "2026-06-06T00:00:00.000Z",
  "components": {
    "api":      { "status": "operational", "message": "API gateway running" },
    "engine":   { "status": "operational | down", "message": "...", "lastCheck": "2026-06-06T..." },
    "ai":       { "status": "operational | degraded | down", "message": "...", "metadata": { "modelCount": 94 } },
    "database": { "status": "operational | degraded | down", "message": "Response time: 12ms", "metadata": { "responseTime": 12 } }
  },
  "metrics": {
    "jobs": { "queued": 0, "running": 1, "completed": 342, "failed": 3 }
  }
}
```

---

### OpenAI Adapter Routes

All forward to the `ai` worker via service binding. Auth: `userAuth` (JWT required), except `/modes` which has no auth guard.

The forwarded request carries these injected headers where applicable:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-User-JWT` | Raw Bearer token | AI worker uses this to dispatch local jobs on behalf of the user |
| `X-User-ID` | `caller.sub` | User identity scoping |
| `X-CF-Timezone` | Cloudflare `cf.timezone` | User location context for tools |
| `X-CF-City` | Cloudflare `cf.city` | User location context for tools |
| `X-CF-Country` | Cloudflare `cf.country` | User location context for tools |

---

#### `POST /adapters/openai/v1/chat/completions`

**Auth:** `userAuth`  
**Forwards to:** `ai` worker `POST /v1/chat/completions`

Main chat completions proxy. Injects all identity and location headers before forwarding. Streams the response body back verbatim — SSE stream passes through without buffering.

---

#### `GET /adapters/openai/v1/modes`

**Auth:** None  
**Forwards to:** `ai` worker `GET /v1/modes`

Returns the four user-facing AI tier configs (Auto, Fast, Standard, Advanced), merged with any admin overrides.

---

#### `ALL /adapters/openai/v1/admin/*`

**Auth:** `userAuth`  
**Forwards to:** `ai` worker — same path with `/adapters/openai` prefix stripped

Wildcard proxy for all admin routes. The `ai` worker performs role verification internally (`role === "admin"` in JWT), so adding new admin endpoints never requires a gateway change.

Strips `/adapters/openai` from the path, preserves query string, and forwards the `Authorization` header and body for `POST`, `PUT`, `PATCH` methods.

---

#### `GET /adapters/openai/v1/models`

**Auth:** `userAuth`  
**Forwards to:** `ai` worker `GET /v1/models`

Returns the full model list from KV cache. Supports `?sync=true` forwarded to the AI worker.

---

#### `POST /adapters/openai/v1/audio/transcriptions`

**Auth:** `userAuth`  
**Forwards to:** `ai` worker `POST /v1/audio/transcriptions`

Forwards the raw `multipart/form-data` body without modification.

---

#### `POST /adapters/openai/v1/audio/speech`

**Auth:** `userAuth`  
**Forwards to:** `ai` worker `POST /v1/audio/speech`

Injects `X-User-JWT` before forwarding. Returns binary audio body verbatim.

---

#### `GET /adapters/openai/v1/user/memories`

**Auth:** `userAuth`  
**Forwards to:** `ai` worker `GET /v1/user/memories`

Returns the authenticated user's STUDIO memory entries.

---

#### `PATCH /adapters/openai/v1/user/memories/:key`

**Auth:** `userAuth`  
**Forwards to:** `ai` worker `PATCH /v1/user/memories/:key`

Update a specific memory entry by key.

---

#### `DELETE /adapters/openai/v1/user/memories/:key`

**Auth:** `userAuth`  
**Forwards to:** `ai` worker `DELETE /v1/user/memories/:key`

Delete a specific memory entry by key.

---

#### `GET /adapters/openai/v1/mcp/catalog`

**Auth:** `userAuth`  
**Forwards to:** `ai` worker `GET /v1/mcp/catalog`

Browse the MCP server registry catalog stored in KV.

---

#### `GET /adapters/openai/v1/mcp/servers`

**Auth:** `userAuth`  
**Forwards to:** `ai` worker `GET /v1/mcp/servers`

List MCP servers installed by the authenticated user.

---

#### `POST /adapters/openai/v1/mcp/servers`

**Auth:** `userAuth`  
**Forwards to:** `ai` worker `POST /v1/mcp/servers`

Install a new MCP server. Body forwarded verbatim.

---

#### `POST /adapters/openai/v1/mcp/sync/:name`

**Auth:** `userAuth`  
**Forwards to:** `ai` worker `POST /v1/mcp/servers/:name/sync`

Trigger a live manifest sync from a remote MCP server. Note the path difference: the gateway uses `/mcp/sync/:name` while the AI worker uses `/mcp/servers/:name/sync`.

---

#### `PATCH /adapters/openai/v1/mcp/servers/:name`

**Auth:** `userAuth`  
**Forwards to:** `ai` worker `PATCH /v1/mcp/servers/:name`

Update an MCP server's `enabled`, `config`, or `manifest`.

---

#### `DELETE /adapters/openai/v1/mcp/servers/:name`

**Auth:** `userAuth`  
**Forwards to:** `ai` worker `DELETE /v1/mcp/servers/:name`

Uninstall an MCP server.

---

#### `GET /adapters/openai/v1/composio/apps`

**Auth:** `userAuth`  
**Forwards to:** `ai` worker `GET /v1/composio/apps`

Browse the curated Composio app catalog. Query string (including `?search=`) is forwarded verbatim.

---

#### `GET /adapters/openai/v1/composio/connections`

**Auth:** `userAuth`  
**Forwards to:** `ai` worker `GET /v1/composio/connections`

List the authenticated user's connected Composio apps.

---

#### `POST /adapters/openai/v1/composio/connect`

**Auth:** `userAuth`  
**Forwards to:** `ai` worker `POST /v1/composio/connect`

Initiate an OAuth connection for a Composio app. Returns the redirect URL.

---

#### `PATCH /adapters/openai/v1/composio/connections/:id`

**Auth:** `userAuth`  
**Forwards to:** `ai` worker `PATCH /v1/composio/connections/:id`

Toggle `enabled` flag on a Composio connection.

---

#### `DELETE /adapters/openai/v1/composio/connections/:id`

**Auth:** `userAuth`  
**Forwards to:** `ai` worker `DELETE /v1/composio/connections/:id`

Revoke and delete a Composio connection.

---

#### `DELETE /adapters/openai/v1/composio/apps/cache`

**Auth:** `userAuth`  
**Forwards to:** `ai` worker `DELETE /v1/composio/apps/cache`

Bust the logo/description KV cache. Available to any authenticated user.

---

#### `GET /adapters/openai/v1/composio/apps/config`

**Auth:** `userAuth` (AI worker enforces `role === "admin"`)  
**Forwards to:** `ai` worker `GET /v1/composio/apps/config`

Get the live curated app list from KV.

---

#### `PUT /adapters/openai/v1/composio/apps/config`

**Auth:** `userAuth` (AI worker enforces `role === "admin"`)  
**Forwards to:** `ai` worker `PUT /v1/composio/apps/config`

Replace the curated Composio app list in KV. No redeploy needed.

---

#### `DELETE /adapters/openai/v1/composio/apps/config/cache`

**Auth:** `userAuth` (AI worker enforces `role === "admin"`)  
**Forwards to:** `ai` worker `DELETE /v1/composio/apps/config/cache`

Force a fresh logo/description fetch from Composio by clearing the enrichment cache.

---

#### `GET /adapters/openai/v1/user/chats/:path`

**Auth:** `userAuth` — enforces `caller.type === "user"` additionally  
**Forwards to:** `CHATS_SERVICE` binding `GET /chats/:path`

Retrieve a chat file from the user's private storage. `:path` is the filename (e.g. `chat-index.json`, `chat-1234-abc.json`) — no directory prefix. Injects `X-User-Id` header so the chats worker can scope storage without its own JWT verification.

---

#### `HEAD /adapters/openai/v1/user/chats/:path`

**Auth:** `userAuth` — user only  
**Forwards to:** `CHATS_SERVICE` `HEAD /chats/:path`

Check if a chat file exists without fetching the body. Returns headers only.

---

#### `PUT /adapters/openai/v1/user/chats/:path`

**Auth:** `userAuth` — user only  
**Forwards to:** `CHATS_SERVICE` `PUT /chats/:path`

Write or overwrite a chat file. Body forwarded as-is (raw text/JSON).

---

#### `DELETE /adapters/openai/v1/user/chats/:path`

**Auth:** `userAuth` — user only  
**Forwards to:** `CHATS_SERVICE` `DELETE /chats/:path`

Delete a chat file from the user's storage.

---

#### `GET /adapters/openai/v1/images/:id`

**Auth:** `userAuth`  
**Forwards to:** `ai` worker `GET /v1/images/:id`

Serve a generated image from R2.

---

#### `DELETE /adapters/openai/v1/images/:id`

**Auth:** `userAuth`  
**Forwards to:** `ai` worker `DELETE /v1/images/:id`

Delete a generated image from R2.

---

### Studio Preferences Routes

Forwarded to the `studio` worker. Auth: `userAuth`.

The gateway injects `x-user-id` before forwarding. The `studio` worker trusts this header and never performs its own JWT verification.

---

#### `GET /adapters/openai/v1/user/preferences`

**Auth:** `userAuth`  
**Forwards to:** `studio` worker `GET /preferences`

Retrieve the authenticated user's preferences object.

---

#### `PUT /adapters/openai/v1/user/preferences`

**Auth:** `userAuth`  
**Forwards to:** `studio` worker `PUT /preferences`

Update the authenticated user's preferences. Body forwarded verbatim.

---

### Job Queue Routes

These routes are handled **locally** in the `api` worker — no forwarding. All write to and read from the `studio-jobs` D1 database. Auth: `userAuth`.

---

#### `POST /run`

Create a new job and enqueue it.

**Request body:**
```json
{
  "taskId": "generate-report",
  "inputs": { "topic": "Q2 sales", "format": "pdf" },
  "options": { "priority": "high" },
  "executionTarget": "local | cloud | any"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `taskId` | Yes | Which task to run |
| `inputs` | Yes | Task-specific input payload (object) |
| `options` | No | Optional overrides forwarded to the engine |
| `executionTarget` | No | `"cloud"`, `"local"`, or `"any"` (default: `"any"`) |

**Response:**
```json
{
  "jobId": "job_550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "taskId": "generate-report",
  "createdAt": "2026-06-06T00:00:00.000Z",
  "estimatedWait": "~2s"
}
```

---

#### `GET /jobs`

List all jobs for the authenticated user, newest first.

**Query params:**

| Param | Description |
|-------|-------------|
| `status` | Filter by status: `queued`, `running`, `done`, `failed`, `cancelled` |
| `limit` | Max results (default: 50, max: 100) |

**Response:**
```json
{
  "jobs": [
    {
      "id": "job_...",
      "task_id": "generate-report",
      "user_id": "user_xyz",
      "status": "done",
      "execution_target": "local",
      "inputs": { ... },
      "options": { ... },
      "result": { ... },
      "progress": null,
      "error": null,
      "created_at": 1749200000000,
      "updated_at": 1749200005000,
      "completed_at": 1749200005000,
      "heartbeat_at": 1749200004000
    }
  ]
}
```

---

#### `GET /jobs/:id`

Get a single job by ID. Must be owned by the authenticated user.

**Path param:** `id` — must match `job_<uuid>` format  
**Errors:** `400` invalid ID format, `404` not found

**Response:**
```json
{ "job": { ... } }
```

---

#### `DELETE /jobs/:id`

Cancel a **queued** job. Cannot cancel jobs that are already `running`, `done`, `failed`, or `cancelled`.

**Errors:** `409 Conflict` if job not found or not in `queued` state

**Response:**
```json
{ "success": true, "message": "Job cancelled" }
```

---

### Task Catalog Route

---

#### `GET /tasks`

**Auth:** `userAuth`

Returns the task catalog from KV (key `task_catalog`). This is the list of tasks registered by the local engine. Returns an empty array if the engine has never connected.

**Response:**
```json
{
  "tasks": [
    {
      "taskId": "generate-report",
      "name": "Generate Report",
      "description": "...",
      "workspace": "Documents",
      "icon": "file-text",
      "estimatedDuration": "~30s",
      "inputs": [
        { "name": "topic", "label": "Topic", "type": "string", "required": true }
      ],
      "tags": ["documents", "ai"]
    }
  ]
}
```

---

### Engine Protocol Routes

All routes under `/internal/` require `x-engine-key` and are exclusively for the local engine (Tauri desktop daemon). No user JWT is accepted here.

---

#### `GET /internal/jobs/next`

Claim the next available queued job. Uses an **atomic `UPDATE...WHERE...RETURNING`** to prevent race conditions when multiple engine instances poll simultaneously.

**Query params:**

| Param | Default | Description |
|-------|---------|-------------|
| `wait` | `0` | Long-poll duration in seconds (max 30). Engine blocks and polls every 1 second until a job is available or the wait expires. |
| `target` | `local` | Which jobs to claim: `local`, `cloud`, or `any`. Matches jobs whose `execution_target` equals the target or is `any`. |

**Response (job available):**
```json
{
  "job": {
    "id": "job_...",
    "task_id": "generate-report",
    "user_id": "user_xyz",
    "status": "running",
    "execution_target": "local",
    "inputs": { "topic": "Q2 sales" },
    "options": {}
  }
}
```

**Response (no job available):**
```json
{ "job": null }
```

---

#### `POST /internal/jobs/:id/result`

Submit the final result of a completed job. Only transitions jobs from `running` state.

**Request body:**
```json
{
  "status": "done | failed",
  "result": { "fileUrl": "https://...", "pageCount": 12 },
  "error": "string (only on failure)"
}
```

| Field | Required | Constraints |
|-------|----------|-------------|
| `status` | Yes | Must be `"done"` or `"failed"` |
| `result` | No | JSON object — max 1 MB serialised |
| `error` | No | Error message string |

**Errors:** `404` if job not found or not in `running` state  
**Response:** `{ "success": true }`

---

#### `POST /internal/jobs/:id/heartbeat`

Update the heartbeat timestamp for a running job. No body required.

The engine should call this every ~5 seconds while processing. Jobs whose heartbeat goes stale (absent or older than 30 seconds) are eligible for reset by the stale-job reaper cron.

**Errors:** `404` if job not found or not in `running` state  
**Response:** `{ "success": true }`

---

#### `POST /internal/jobs/:id/progress`

Update progress metadata on a running job. Visible to the user via `GET /jobs/:id`.

**Request body:**
```json
{
  "progress": {
    "percent": 42,
    "step": "Fetching data sources",
    "stepsCompleted": 3,
    "stepsTotal": 7
  }
}
```

`progress` can be any JSON object — the schema is task-specific.

**Errors:** `404` if job not found or not in `running` state  
**Response:** `{ "success": true }`

---

#### `POST /internal/checkpoints`

Save a LangGraph agent graph checkpoint. Called when an agent encounters a local tool call and must pause execution until the local engine returns a result.

**Request body:**
```json
{
  "sessionId": "conversation-uuid",
  "graphState": { "messages": [...], "toolCallsPending": [...] },
  "pendingJobId": "job_..."
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `sessionId` | Yes | Groups checkpoints for the same conversation |
| `graphState` | Yes | Full serialised LangGraph state (any JSON object) |
| `pendingJobId` | No | `jobs.id` this checkpoint is waiting on |

**Response:**
```json
{
  "checkpointId": "checkpoint_550e8400-e29b-41d4-a716-446655440000",
  "expiresAt": 1749201800000
}
```

Checkpoints expire after **30 minutes**.

---

#### `GET /internal/checkpoints/:id`

Load a previously saved checkpoint by ID.

**Path param:** `id` — must match `checkpoint_<uuid>` format  
**Errors:** `400` invalid format, `404` not found, `410 Gone` if expired

**Response:**
```json
{
  "checkpoint": {
    "id": "checkpoint_...",
    "session_id": "conversation-uuid",
    "graphState": { ... },
    "pending_job_id": "job_...",
    "created_at": 1749200000000,
    "expires_at": 1749201800000
  }
}
```

---

#### `POST /internal/tasks/register`

Register the full list of tasks the local engine is capable of handling. Stored in KV with a 24-hour TTL. Also writes the `engine_last_seen` timestamp to D1 (`system_state` table), which is used by `GET /system/status` to determine if the engine is online.

**Request body:**
```json
{
  "tasks": [
    {
      "taskId": "generate-report",
      "name": "Generate Report",
      "description": "Creates a formatted PDF report",
      "inputs": [ { "name": "topic", "label": "Topic", "type": "string", "required": true } ],
      "tags": ["documents"]
    }
  ]
}
```

**Constraints:** Array must be non-empty; max 1000 tasks.

**Response:**
```json
{ "success": true, "taskCount": 5 }
```

---

### Update Routes

No authentication required. Used by the Tauri auto-updater.

---

#### `GET /v1/updates/latest`

Desktop app update check. The Tauri updater polls this on launch.

Reads `studio:latest` from `RELEASES_KV`.

**Response — update available (200):**
```json
{
  "version": "0.1.1",
  "notes": "What changed in this release.",
  "pub_date": "2026-06-06T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<base64-sig>",
      "url": "https://releases.pookiepied.dev/STUDIO_0.1.1_x64-setup.nsis.zip"
    }
  }
}
```

**Response — no update (204):** Empty body. Tauri interprets 204 as "already up to date."

**How to stage a release:**
```bash
wrangler kv key put \
  --namespace-id=35f6ec05519142ca91278067caa2fba9 \
  "studio:latest" \
  '{"version":"0.1.1","notes":"...","pub_date":"...","platforms":{...}}'
```

**How to retract a release:**
```bash
wrangler kv key delete \
  --namespace-id=35f6ec05519142ca91278067caa2fba9 \
  "studio:latest"
```

---

#### `GET /v1/releases/*`

Stream a release file directly from `RELEASES_BUCKET` R2. The wildcard matches the full R2 key.

Example: `GET /v1/releases/STUDIO_0.1.1_x64-setup.nsis.zip` → `RELEASES_BUCKET.get("STUDIO_0.1.1_x64-setup.nsis.zip")`

**Response:** Binary file body. Headers: `Content-Type`, `Content-Length`, `Cache-Control: public, max-age=31536000, immutable`.

---

### Tracker Proxy Routes

All forwarded to the `tracker` worker via `TRACKER` service binding. Auth: `userAuth`.

The `tracker` worker has no auth of its own — it trusts the API worker to gate access. When the authenticated caller has a `sub` claim and the request doesn't already include a `userId` query param, the gateway injects one automatically.

---

#### `GET /tracker/events`

**Forwards to:** `tracker` worker `/events`

Raw telemetry events. Query string forwarded as-is.

---

#### `GET /tracker/runs`

**Forwards to:** `tracker` worker `/runs`

Agent run records. Auto-injects `?userId=<caller.sub>` if not already present.

---

#### `GET /tracker/runs/:runId`

**Forwards to:** `tracker` worker `/runs/:runId`

Single agent run detail by ID.

---

#### `GET /tracker/summary`

**Forwards to:** `tracker` worker `/summary`

Aggregated run statistics. Auto-injects `?userId=<caller.sub>`.

---

#### `GET /tracker/tail-events`

**Forwards to:** `tracker` worker `/tail-events`

Worker invocation logs forwarded by the tail consumer. Query string forwarded as-is.

---

#### `GET /tracker/usage/summary`

**Forwards to:** `tracker` worker `/usage/summary`

Token and cost summary across all usage events. Auto-injects `?userId=<caller.sub>`.

---

#### `GET /tracker/usage/data`

**Forwards to:** `tracker` worker `/usage/data`

Raw usage event rows for charting (time series). Auto-injects `?userId=<caller.sub>`.

---

#### `GET /tracker/usage/logs`

**Forwards to:** `tracker` worker `/usage/logs`

Paginated usage log entries. Auto-injects `?userId=<caller.sub>`.

---

#### `GET /tracker/usage/credits`

**Forwards to:** `tracker` worker `/usage/credits`

Provider credit balances from the credit cache.

---

### Scheduled Cron Job

---

#### `* * * * *` — Stale Job Reaper (every minute)

Source: `src/services/reaper.ts`

Runs `runStaleJobReaper(env)` on every cron tick. Two operations:

**1. Reset stale running jobs → `queued`**

A running job is considered stale if any of the following are true:
- `heartbeat_at IS NULL` — engine never sent a beat
- `heartbeat_at < now - 30s` — heartbeat threshold exceeded (engine beats every ~5s, so 6+ missed beats)
- `updated_at < now - 10min` — safety net for hung jobs regardless of heartbeat

Stale jobs are reset to `queued` so they can be reclaimed by a fresh engine instance after a crash or restart.

**2. Dead-letter stuck queued jobs → `failed`**

Any job stuck in `queued` state for over **1 hour** is moved to `failed` with the error message `"Job timed out in queued state (dead letter)"`. This prevents permanently orphaned jobs if no engine ever comes online to claim them.

**Reaper result structure:**
```typescript
{
  reset: number;        // jobs reset from running → queued
  deadLetters: number;  // jobs moved from queued → failed
  checkedAt: string;    // ISO 8601 timestamp
}
```

Reaper activity is emitted as telemetry events:
- `job.reaper.reset` (severity: `warn`) when `reset > 0`
- `job.reaper.dead_lettered` (severity: `warn`) when `deadLetters > 0`

---

## Endpoint Summary Table

| # | Method | Path | Auth | Handled By |
|---|--------|------|------|-----------|
| — | ANY | `/agents/*` | Pre-Hono | Forwarded → `ai` worker |
| 1 | GET | `/health` | None | Local |
| 2 | GET | `/system/status` | None | Local |
| 3 | POST | `/adapters/openai/v1/chat/completions` | userAuth | → `ai` worker |
| 4 | GET | `/adapters/openai/v1/modes` | None | → `ai` worker |
| 5 | ALL | `/adapters/openai/v1/admin/*` | userAuth | → `ai` worker |
| 6 | GET | `/adapters/openai/v1/models` | userAuth | → `ai` worker |
| 7 | POST | `/adapters/openai/v1/audio/transcriptions` | userAuth | → `ai` worker |
| 8 | POST | `/adapters/openai/v1/audio/speech` | userAuth | → `ai` worker |
| 9 | GET | `/adapters/openai/v1/user/memories` | userAuth | → `ai` worker |
| 10 | PATCH | `/adapters/openai/v1/user/memories/:key` | userAuth | → `ai` worker |
| 11 | DELETE | `/adapters/openai/v1/user/memories/:key` | userAuth | → `ai` worker |
| 12 | GET | `/adapters/openai/v1/mcp/catalog` | userAuth | → `ai` worker |
| 13 | GET | `/adapters/openai/v1/mcp/servers` | userAuth | → `ai` worker |
| 14 | POST | `/adapters/openai/v1/mcp/servers` | userAuth | → `ai` worker |
| 15 | POST | `/adapters/openai/v1/mcp/sync/:name` | userAuth | → `ai` worker |
| 16 | PATCH | `/adapters/openai/v1/mcp/servers/:name` | userAuth | → `ai` worker |
| 17 | DELETE | `/adapters/openai/v1/mcp/servers/:name` | userAuth | → `ai` worker |
| 18 | GET | `/adapters/openai/v1/composio/apps` | userAuth | → `ai` worker |
| 19 | GET | `/adapters/openai/v1/composio/connections` | userAuth | → `ai` worker |
| 20 | POST | `/adapters/openai/v1/composio/connect` | userAuth | → `ai` worker |
| 21 | PATCH | `/adapters/openai/v1/composio/connections/:id` | userAuth | → `ai` worker |
| 22 | DELETE | `/adapters/openai/v1/composio/connections/:id` | userAuth | → `ai` worker |
| 23 | DELETE | `/adapters/openai/v1/composio/apps/cache` | userAuth | → `ai` worker |
| 24 | GET | `/adapters/openai/v1/composio/apps/config` | userAuth | → `ai` worker |
| 25 | PUT | `/adapters/openai/v1/composio/apps/config` | userAuth | → `ai` worker |
| 26 | DELETE | `/adapters/openai/v1/composio/apps/config/cache` | userAuth | → `ai` worker |
| 27 | GET | `/adapters/openai/v1/user/chats/:path` | userAuth | → `CHATS_SERVICE` |
| 28 | HEAD | `/adapters/openai/v1/user/chats/:path` | userAuth | → `CHATS_SERVICE` |
| 29 | PUT | `/adapters/openai/v1/user/chats/:path` | userAuth | → `CHATS_SERVICE` |
| 30 | DELETE | `/adapters/openai/v1/user/chats/:path` | userAuth | → `CHATS_SERVICE` |
| 31 | GET | `/adapters/openai/v1/images/:id` | userAuth | → `ai` worker |
| 32 | DELETE | `/adapters/openai/v1/images/:id` | userAuth | → `ai` worker |
| 33 | GET | `/adapters/openai/v1/user/preferences` | userAuth | → `studio` worker |
| 34 | PUT | `/adapters/openai/v1/user/preferences` | userAuth | → `studio` worker |
| 35 | POST | `/run` | userAuth | Local — D1 |
| 36 | GET | `/jobs` | userAuth | Local — D1 |
| 37 | GET | `/jobs/:id` | userAuth | Local — D1 |
| 38 | DELETE | `/jobs/:id` | userAuth | Local — D1 |
| 39 | GET | `/tasks` | userAuth | Local — KV |
| 40 | GET | `/internal/jobs/next` | engineAuth | Local — D1 |
| 41 | POST | `/internal/jobs/:id/result` | engineAuth | Local — D1 |
| 42 | POST | `/internal/jobs/:id/heartbeat` | engineAuth | Local — D1 |
| 43 | POST | `/internal/jobs/:id/progress` | engineAuth | Local — D1 |
| 44 | POST | `/internal/checkpoints` | engineAuth | Local — D1 |
| 45 | GET | `/internal/checkpoints/:id` | engineAuth | Local — D1 |
| 46 | POST | `/internal/tasks/register` | engineAuth | Local — KV + D1 |
| 47 | GET | `/v1/updates/latest` | None | Local — `RELEASES_KV` |
| 48 | GET | `/v1/releases/*` | None | Local — `RELEASES_BUCKET` |
| 49 | GET | `/tracker/events` | userAuth | → `tracker` worker |
| 50 | GET | `/tracker/runs` | userAuth | → `tracker` worker |
| 51 | GET | `/tracker/runs/:runId` | userAuth | → `tracker` worker |
| 52 | GET | `/tracker/summary` | userAuth | → `tracker` worker |
| 53 | GET | `/tracker/tail-events` | userAuth | → `tracker` worker |
| 54 | GET | `/tracker/usage/summary` | userAuth | → `tracker` worker |
| 55 | GET | `/tracker/usage/data` | userAuth | → `tracker` worker |
| 56 | GET | `/tracker/usage/logs` | userAuth | → `tracker` worker |
| 57 | GET | `/tracker/usage/credits` | userAuth | → `tracker` worker |
| — | CRON | `* * * * *` | Scheduled | Stale job reaper |

**Total HTTP endpoints: 57** (+ WebSocket/agent forwarding pre-Hono)  
**Scheduled cron jobs: 1**
