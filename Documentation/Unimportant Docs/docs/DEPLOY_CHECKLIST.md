# Studio Deploy Checklist
_Manual steps required after code changes in this session_

---

## 1  Pre-flight: fill in `PUBLIC_CHAT_BASE`

Before deploying `studio-mcp`, open `mcp/hub/wrangler.toml` and set the chat
Worker's public domain. The hub uses this to build image URLs returned to the
frontend (images are served by the chat Worker, not the hub).

```toml
# mcp/hub/wrangler.toml  [vars]
PUBLIC_CHAT_BASE = "https://studio-chat.pookiepied.dev"   # ← set this
```

> If you don't know the domain yet, deploy `studio-chat` first, then note its
> URL from the Cloudflare dashboard and come back.

---

## 2  Create Vectorize index (one-time, if not already done)

```sh
cd mcp/hub
npx wrangler vectorize create studio-rag --dimensions=768 --metric=cosine
```

Skip if `studio-rag` already exists.

---

## 3  Set secrets on `studio-mcp`

Run these from the `mcp/hub/` directory:

```sh
# Web search
wrangler secret put TAVILY_API_KEY
wrangler secret put BRAVE_SEARCH_API_KEY      # fallback — optional

# Web fetch (Jina Reader)
wrangler secret put JINA_API_KEY              # optional — falls back to raw HTML

# Image generation
wrangler secret put FAL_API_KEY
wrangler secret put OPENROUTER_API_KEY        # only if using openrouter: image models
wrangler secret put OPENAI_API_KEY            # only if using openai:dall-e-* models

# R2 presigned URL signing (same credentials as studio-chat)
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put R2_ACCOUNT_ID             # your CF account ID

# Service-to-service auth (must match studio-mcp-memory's MEMORY_AUTH_SECRET)
wrangler secret put MEMORY_AUTH_SECRET
```

---

## 3.5  Set secrets on `studio-agents`

Run these from the `agents/` directory:

```sh
# LLM provider keys (OmniAgent calls providers directly — no circular dep with chat)
wrangler secret put GROQ_API_KEY
wrangler secret put OPENROUTER_API_KEY    # optional; needed for non-Groq models

# Service-to-service auth (must match studio-mcp's MEMORY_AUTH_SECRET)
wrangler secret put MEMORY_AUTH_SECRET
```

---

## 4  Deploy order

Dependencies must be live before callers. Deploy in this sequence:

| Step | Worker | Directory | Command |
|------|--------|-----------|---------|
| 4.1 | `studio-mcp-memory` | `mcp/memory/` | `npx wrangler deploy` |
| 4.2 | `studio-mcp` | `mcp/hub/` | `npx wrangler deploy` |
| 4.3 | `studio-agents` | `agents/` | `npx wrangler deploy` |
| 4.4 | `studio-chat` | `chat/` | `npx wrangler deploy` |
| 4.5 | `api` | `api/` | `npx wrangler deploy` |

> `studio-mcp-youtube` is only needed if YouTube transcript tools are in use.
> Deploy it separately: `cd mcp/youtube-transcript && npx wrangler deploy`.

---

## 5  Verify workers are up

After deploying:

```sh
# studio-mcp health
curl https://studio-mcp.<account>.workers.dev/health
# Expected: {"status":"ok","service":"studio-mcp"}

# studio-mcp tools list
curl -X POST https://studio-mcp.<account>.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <MEMORY_AUTH_SECRET>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
# Expected: 9 tools (think, skill_read, web_search, web_fetch, rag,
#           image_generate, video_generate, video_status, http_request)

# studio-agents health
curl https://studio-agents.<account>.workers.dev/health
# Expected: {"status":"ok","service":"studio-agents"}
```

---

## 6  Cloudflare dashboard: check service bindings

In the Cloudflare dashboard for `studio-chat`:

- **Settings → Bindings → Service Bindings** should show:
  - `MEMORY` → `studio-mcp-memory`
  - `MCP` → `studio-mcp`
  - `AGENTS` → `studio-agents`
  - `TRACKER` → `tracker`

For `studio-mcp`:

- Should show `MCP_MEMORY` → `studio-mcp-memory`, `MCP_YOUTUBE` → `studio-mcp-youtube`, `TRACKER` → `tracker`

For `studio-agents`:

- Should show `MCP_TOOLS` → `studio-mcp`, `TRACKER` → `tracker`

> Service bindings are set automatically by `wrangler deploy` from `wrangler.toml`.
> The dashboard view is just a sanity check.

---

## 4.6  Apply D1 schema migration (Objective 7 — `user_documents` table)

Run from the `chat/` directory after deploying `studio-chat`:

```sh
cd chat
wrangler d1 execute studio-ai --remote --file=./schema.sql
```

This is idempotent (`CREATE TABLE IF NOT EXISTS`) — safe to run against an existing database.

---

## 7  What changed (summary)

| File | What changed |
|------|-------------|
| `ai/` | **Renamed** to `chat/` (CF worker name: `studio-chat`) |
| `mcp/memory/wrangler.toml` | `name` changed: `studio-memory` → `studio-mcp-memory` |
| `mcp/hub/` | **New** Worker (`studio-mcp`) — 9 cloud tools as MCP server |
| `chat/wrangler.toml` | Added `MCP` → `studio-mcp`, `AGENTS` → `studio-agents` bindings |
| `chat/src/orchestration/tools/index.ts` | Cloud tools now route through hub via `HubTool` proxy |
| `chat/src/orchestration/tools/cloud/agentic/spawnAgent.ts` | Added `omni` and `coding` agent type routing to `studio-agents` |
| `chat/src/orchestration/tools/cloud/agentic/awaitAgents.ts` | Dual-mode polling: `omni-*`/`coding-*` via AGENTS binding, `research-*` via ChatAgent |
| `agents/` | **New** Worker (`studio-agents`) — OmniAgent + CodingAgent DOs with ReAct loops |
| `mcp/hub/src/tools/coding/` | **New** tools: `read_files_batch`, `list_project_files` (GitHub repo support) |
| `api/wrangler.toml` | AI service binding updated: `ai` → `studio-chat` |
| `chat/schema.sql` | **New** `user_documents`, `user_agents`, `agent_runs` tables |
| `chat/src/gateway/routes/kb.ts` | **New** KB routes: list, index, delete |
| `chat/src/gateway/routes/agentWorkflows.ts` | **New** agent workflow CRUD + run + history routes |
| `chat/wrangler.toml` | Added `*/5 * * * *` cron for agent dispatch |
| `STUDIO/src/services/files/kbService.ts` | **New** frontend KB + memory facts service |
| `STUDIO/src/services/agents/agentWorkflowService.ts` | **New** frontend agent workflow service |
| `STUDIO/src/pages/WorkspacePage.tsx` | **Rebuilt** — Knowledge Base / Memory / Agents tabs (full) |

---

## 8  Rollback plan

If `studio-mcp` has issues after deploy, the chat Worker can fall back to its
own local tool implementations:

1. In `chat/src/orchestration/tools/index.ts`, revert the imports — swap
   `thinkHubTool` back to `thinkTool`, etc. (the original cloud tool instances
   are still in `./cloud` and unchanged).
2. Redeploy `studio-chat` only. No other workers need to change.

The hub Worker can be fixed and redeployed independently — callers just see
HTTP errors until it's back up.
