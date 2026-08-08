# API Gateway

The public-facing entry point for Project Studio. All frontend requests go through here first. Handles auth, routes AI requests to `studio-chat`, manages a job queue for local inference, delivers app updates, and proxies analytics.

**Worker name:** `api`  
**Runtime:** Cloudflare Workers (Hono)  
**Language:** TypeScript  
**Database:** D1 (`studio-jobs`) — job queue  
**KV:** `KV` (general cache), `RELEASES_KV` (update manifests)  
**R2:** `RELEASES_BUCKET` (installer files)  
**Cron:** Every minute — stale job reaper

---

## What It Does

### 1. Authentication

All requests are validated here. Two accepted token types:
- **User JWT** — issued by `cloud/services/auth/` after Google OAuth login. 1-hour lifetime.
- Engine key auth was removed — JWT-only for all routes.

### 2. AI Request Routing

Forwards chat and AI requests to `studio-chat` via a service binding. Enriches the request with the authenticated user's ID so `studio-chat` doesn't need to re-verify the JWT.

### 3. Job Queue (Local Inference)

When STUDIO uses a local model (Ollama, LM Studio), the inference becomes a queued job:

```
STUDIO submits job → stored in D1 as 'queued'
  → Local daemon polls GET /internal/jobs/next (atomic claim)
  → Daemon runs inference locally, POSTs result back
  → STUDIO receives result via the WebSocket conversation
```

Atomic `UPDATE...WHERE...RETURNING` prevents two daemon instances claiming the same job. Cron every minute resets stale jobs (engine crashed mid-run or heartbeat expired >30s).

### 4. App Auto-Updates

Delivers STUDIO desktop app updates:
- Release manifests stored in `RELEASES_KV`
- Installer files in `RELEASES_BUCKET` (R2)
- Desktop app checks `GET /updates/manifest` on startup

To stage a release: build + sign with `npx tauri build`, upload installer to R2, push manifest JSON to `RELEASES_KV`.

### 5. Proxies

Forwards requests to internal-only workers that have no public routes:
- **User preferences** -> `cloud/services/studio-worker/` (injecting authenticated user ID as trusted header)
- **Analytics/usage** -> `cloud/services/tracker/` worker
- **AI requests** → `studio-chat` (WebSocket upgrade + HTTP)

### 6. OpenAI Adapter

Exposes an OpenAI-compatible API surface (`/adapters/openai/v1/*`) so the STUDIO frontend and external tools can use a consistent API shape regardless of which underlying provider is used.

---

## Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | None | Liveness check |
| POST | `/adapters/openai/v1/chat/completions` | JWT | Chat → `studio-chat` |
| GET | `/adapters/openai/v1/models` | JWT | Model list → `studio-chat` |
| GET/PUT | `/adapters/openai/v1/user/preferences` | JWT | Prefs → Studio worker |
| GET | `/adapters/openai/v1/tracking/*` | JWT | Usage analytics → Tracker |
| GET | `/adapters/openai/v1/user/memories` | JWT | Memory list → MCP memory |
| DELETE | `/adapters/openai/v1/user/memories/:id` | JWT | Delete memory → MCP memory |
| POST | `/adapters/openai/v1/docs/index` | JWT | RAG doc indexing → `studio-chat` |
| POST | `/adapters/openai/v1/local/chat/save` | JWT | Persist local inference result |
| POST | `/adapters/openai/v1/local/tool/execute` | flexAuth | Local tool callback from daemon |
| GET | `/updates/manifest` | None | App update manifest |
| GET | `/internal/jobs/next` | flexAuth | Claim next queued job (daemon) |
| POST | `/internal/jobs/:id/result` | flexAuth | Submit job result (daemon) |
| GET | `/internal/jobs/:id` | flexAuth | Job status (daemon) |
| POST | `/jobs` | JWT | Submit a new inference job |

---

## Bindings

| Name | Type | Purpose |
|------|------|---------|
| `AI` | Service | `studio-chat` — AI + WebSocket |
| `CHATS_SERVICE` | Service | Chat storage worker |
| `STUDIO` | Service | User preferences worker |
| `TRACKER` | Service | Telemetry + analytics |
| `MEMORY` | Service | `studio-mcp-library` (studio-memory service) — memory management |
| `DB` | D1 | Job queue database |
| `KV` | KV | General key-value cache |
| `RELEASES_KV` | KV | App update manifests |
| `RELEASES_BUCKET` | R2 | App installer files |

---

## Setup (First Time)

```bash
# 1. Create the database
wrangler d1 create studio-jobs
# Paste the database_id into wrangler.toml [[d1_databases]]

# 2. Initialize schema
wrangler d1 execute studio-jobs --remote --file=./schema.sql

# 3. Create KV namespaces
wrangler kv namespace create "API_KV"
wrangler kv namespace create "API_KV" --preview
# Paste IDs into wrangler.toml [[kv_namespaces]]

# 4. Set secrets
wrangler secret put JWT_SECRET

# 5. Deploy
npm run deploy
```

---

## Notes

- `flexAuth` on daemon-facing routes (`/local/tool/execute`, `/internal/jobs/*`) — the daemon sends requests without user JWTs. The callback URL design (how the AI worker passes auth to the daemon for tool results) is tracked as an open design gap in `docs/STUDIO_DECISIONS_2026.md` Section 14c.
- The `updates.ts` route (Tauri auto-updater) is flagged as a future candidate to move to its own worker — it's stateless R2/KV serving that doesn't belong in the API gateway long-term.
