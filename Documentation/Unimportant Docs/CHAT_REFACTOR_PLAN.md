# Studio-Chat Refactor Plan

## Guiding Rules
- `studio-chat` = pipeline orchestration + data ops (R2/D1) + thin proxies to other workers
- `studio-mcp` = MCP protocol + Composio (all external tool integrations)
- `studio-agents` = agent execution + agent workflow CRUD
- `studio-gateway` = LLM inference only, no R2 serving, no business logic

## Infrastructure Already in Place (no new wrangler work needed)
- `studio-agents` already has `AI_DB` bound → owns agent workflow tables immediately
- `studio-mcp` already has `AI_DB` + `COMPOSIO_API_KEY` in wrangler.toml → composio code just moves
- `chat/wrangler.toml` already has `MCP` and `AGENTS` service bindings → proxies work on deploy
- `GatewayAdapter` already correctly routes through `env.GATEWAY`
- `adminModes`, `modes` already re-export from gateway → no change needed

---

## Target `chat/src/` Structure

```
chat/src/
  index.ts              ← /mcp, /composio, /agent-workflows become thin proxies
  env.ts                ← remove COMPOSIO_API_KEY
  gatewayEnv.ts         ← unchanged
  constants.ts          ← unchanged
  requestContext.ts     ← unchanged

  server/               ← RENAMED from gateway/
    config/             ← re-exports, unchanged
    logger.ts
    middleware/         ← re-exports, unchanged
    providers/
      gatewayAdapter.ts ← FIX: add x-internal:1 header
      index.ts          ← unchanged
      types.ts          ← unchanged
    routes/
      chat.ts           ← unchanged (pipeline coordinator)
      health.ts         ← unchanged
      images.ts         ← unchanged (R2 serve/delete stays in chat)
      docs.ts           ← unchanged
      kb.ts             ← unchanged
      pdf.ts            ← unchanged
      localInference.ts ← unchanged
      modes.ts          ← unchanged (re-export)
      adminModes.ts     ← unchanged (re-export)
      memories.ts       ← unchanged (proxy to studio-mcp-memory)
      mcp.ts            ← CONVERTED: thin proxy → env.MCP
      composio.ts       ← CONVERTED: thin proxy → env.MCP
      agentWorkflows.ts ← CONVERTED: thin proxy → env.AGENTS
    services/router/    ← unchanged
    pipeline/
      parse.ts          ← FIX: no getApiKey for non-local providers
    utils/              ← unchanged
    telemetry.ts
    types.ts / types/

  pipeline/
    context.ts          ← remove composioTools, composioApps fields
    preload.ts          ← remove local composio loading; call env.MCP instead
    stream/
      index.ts          ← FIX: skip recordUsage when env.GATEWAY bound
      nonStreaming.ts   ← FIX: same
    (everything else unchanged)

  orchestration/
    tools/
      composio/         ← DELETED (moves to studio-mcp)
      index.ts          ← remove composio tool registration
      (everything else unchanged)
    (everything else unchanged)

  inputs/ tracking/     ← unchanged
```

---

## Task List

### Group A — Structural Rename

- [x] **T1** — Rename `chat/src/gateway/` → `chat/src/server/`
  - Find + replace all import paths across ~40 files in chat
  - Files: everything in `orchestration/`, `pipeline/`, `tracking/`, `inputs/` that imports from `gateway/`
  - Pure rename — zero logic changes

- [x] **T2** — Update `chat/src/index.ts` import paths
  - All imports from `./gateway/routes/` → `./server/routes/`
  - No route registrations change yet (proxy conversion happens in Group C)

---

### Group B — Agent Workflows → studio-agents

- [x] **T3** — Add agent workflow REST routes to `agents/src/`
  - New file: `agents/src/routes/agentWorkflows.ts`
  - Move handler logic from `chat/src/gateway/routes/agentWorkflows.ts`
  - Register in `agents/src/index.ts`:
    - `GET  /v1/agent-workflows`
    - `POST /v1/agent-workflows`
    - `PUT  /v1/agent-workflows/:id`
    - `DELETE /v1/agent-workflows/:id`
    - `POST /v1/agent-workflows/:id/run`
    - `GET  /v1/agent-workflows/:id/runs`
  - `AI_DB` already bound in `agents/wrangler.toml` ✓

- [x] **T4** — Convert `chat/src/server/routes/agentWorkflows.ts` → thin proxy
  - Replace full handler with proxy to `env.AGENTS`:
    ```typescript
    export async function handleAgentWorkflows(request: Request, env: Env): Promise<Response> {
      return env.AGENTS.fetch(request);
    }
    ```

---

### Group C — MCP + Composio → studio-mcp

- [x] **T5** — Add HTTP REST router to `mcp/hub/src/index.ts`
  - Current hub only speaks MCP JSON-RPC
  - Add URL-based routing that handles both JSON-RPC (existing) AND new REST routes
  - Keeps existing MCP protocol handler intact

- [x] **T6** — Move composio route handlers to `mcp/hub/src/routes/composio.ts`
  - Move `chat/src/gateway/routes/composio.ts` (623 lines) into `mcp/hub/`
  - `AI_DB` and `COMPOSIO_API_KEY` already in `mcp/hub/wrangler.toml` ✓
  - Fix import paths only

- [x] **T7** — Move composio tool types to `mcp/hub/src/tools/composio/`
  - Move entire `chat/src/orchestration/tools/composio/` folder to `mcp/hub/src/tools/composio/`
  - Files: ComposioProvider.ts, ComposioTool.ts, composioContract.ts, index.ts, types.ts

- [x] **T8** — Add internal composio tool loader endpoint to `mcp/hub/src/index.ts`
  - New route: `GET /internal/tools/composio?userId=X`
  - Returns `{ tools: ComposioTool[], apps: ComposioAppSummary[] }`
  - Used by chat's preload.ts to fetch composio tools at request time

- [x] **T9** — Convert `chat/src/server/routes/composio.ts` → thin proxy → env.MCP

- [x] **T10** — Convert `chat/src/server/routes/mcp.ts` → thin proxy → env.MCP
  - wrangler.toml already has `MCP` binding with note "wired for future migration" ✓
  - Migration completes here

- [x] **T11** — Update `chat/src/pipeline/preload.ts`
  - Remove `loadComposioTools()` local call
  - Replace with call to `env.MCP.fetch('/internal/tools/composio?userId=...')`
  - Remove composio imports

- [x] **T12** — Delete `chat/src/orchestration/tools/composio/ComposioProvider.ts`
  - Execution (ComposioTool) stays in chat; only discovery moved to mcp/hub
  - Remaining files (ComposioTool.ts, types.ts, index.ts) still needed for tool execution

- [x] **T13** — Update `chat/src/orchestration/tools/index.ts`
  - Removed `loadComposioTools` re-export (discovery moved to mcp/hub)

---

### Group D — Correctness Fixes

- [x] **T14** — Fix usage double-counting
  - `chat/src/server/providers/gatewayAdapter.ts`: added `"x-internal": "1"` header
  - `gateway/src/routes/chat.ts`: all 4 `recordUsage()` calls gated on `!isInternal`

- [x] **T15** — Fix `chat/src/server/pipeline/parse.ts` — no provider key extraction
  - Replaced `getApiKey(env, provider)` with `""` for all non-local providers
  - Removed unused `getApiKey` import

- [x] **T16** — Remove dead image routes from gateway
  - `gateway/src/index.ts`: removed `GET /v1/images/:id` and `DELETE /v1/delete-image/:id`
  - Implementations kept in `gateway/src/routes/images.ts` (chat re-exports them)

---

### Group E — Cleanup

- [x] **T17** — Env + context cleanup (no-op — kept as-is)
  - `composioTools`/`composioApps` still used by systemPrompt.ts + preload.ts
  - `COMPOSIO_API_KEY` still needed by ComposioTool.execute() in chat

- [x] **T18** — TypeScript compile check — ALL CLEAN
  - `chat/`: 0 errors
  - `gateway/`: 0 errors
  - `agents/`: 0 errors (fixed cron destructuring + stale import paths)
  - `mcp/hub/`: 0 errors

---

## Execution Order
```
T1 → T2                          (rename first — all other tasks use correct paths)
T3 + T4                          (agent workflows — self-contained)
T5 → T6 → T7 → T8 → T9 → T10   (MCP + Composio — sequential, each builds on prior)
T11 → T12 → T13                  (chat side of composio removal)
T14 + T15 + T16                  (correctness fixes — independent of each other)
T17 → T18                        (cleanup + compile)
```
