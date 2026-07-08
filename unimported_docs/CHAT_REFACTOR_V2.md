# Chat Refactor V2 — Correctness, Hardening, Cleanup

## What this covers

The first chat refactor (CHAT_REFACTOR_PLAN.md) was architectural: move things into the right workers,
wire up service bindings, establish the thin-proxy pattern. This pass is about **quality**:
strong types, consistent auth, single sources of truth, and fixing real bugs found during the audit.

## Findings that drive this plan

| # | File | Issue |
|---|------|-------|
| 1 | `server/pipeline/parse.ts` | Pipeline stage living in the wrong folder — should be `pipeline/parse.ts` alongside all other stages |
| 2 | `index.ts:140-163` | `/user/memories*` route logic inline in index.ts — should be `server/routes/memories.ts` |
| 3 | `pipeline/preload.ts:148` | `STUDIO_MAIN_LOOP_BLOCKED` defined inline |
| 3 | `pipeline/stream/index.ts:225` | `STUDIO_STREAM_BLOCKED` defined inline (same 7 names) |
| 3 | `orchestration/agent/nodes/llm.ts:99` | `STUDIO_BLOCKED_TOOLS` defined inline (same 7 names) |
| 4 | `pipeline/stream/phase1.ts:32` | `adapter: any` — loses all type safety for `.streamFull()` |
| 4 | `pipeline/stream/phase2.ts:35` | `adapter: any` — same |
| 5 | `pipeline/stream/phase2.ts:204` | `getApiKey(ctx.env, payload.provider)` leaks chat env key into specialist payload (T15 class bug — missed) |
| 6 | `server/routes/localInference.ts:81` | `createRequestRegistry([])` — empty registry, user MCP tools never loaded for local-model tool calls |
| 7 | `agents/src/index.ts` | No HTTP-level JWT auth — safe (service binding only) but undocumented |
| 8 | `index.ts middleware 4` | Checks header PRESENCE only — full JWT validation only inside handleChat, leaving images/pdf/docs/kb/agent-workflows without token verification |

---

## Task List

### Group A — Structural (pipeline folder coherence)

- [x] **A1** — Move `chat/src/server/pipeline/parse.ts` → `chat/src/pipeline/parse.ts`
  - Update import in `server/routes/chat.ts`: `from "../pipeline/parse"` → `from "../../pipeline/parse"`
  - Update import in `orchestration/agent/ChatAgent.ts:282`: `"../../server/pipeline/parse"` → `"../../pipeline/parse"`
  - Delete `chat/src/server/pipeline/` directory (now empty)
  - Result: `pipeline/` is complete — parse → userContext → preload → systemPrompt → dispatch → stream

- [x] **A2** — Extract memories routes from `index.ts` → `server/routes/memories.ts`
  - Move `GET /v1/user/memories` and `DELETE /v1/user/memories/:id` handlers to new file
  - New file exports: `handleListMemories`, `handleDeleteMemory`
  - Update `index.ts`: replace inline handlers with imports + registrations
  - Pattern: same as other route files — `import { handleListMemories, handleDeleteMemory } from "./server/routes/memories"`

---

### Group B — Auth hardening

- [~] **B1** — ~~Add JWT auth to the agents worker HTTP surface~~ CANCELLED
  - `agents/` is internal-only (`workers_dev = false`). Accessed via service binding from chat/ only.
  - JWT at the agents layer is unnecessary and wrong — auth is handled by the chain (api/ or CF Access → chat/ → agents/).
  - See STUDIO_MASTER_PLAN.md Phase 7 for the correct cleanup (remove CORS, add comment).

- [ ] **B2** — Add per-route auth for non-chat routes in chat
  - Currently Middleware 4 only checks header PRESENCE (cf-access-jwt-assertion OR Authorization exists)
  - Routes bypassing `handleChat` (images, pdf, docs, kb) get no userId extraction / token verification
  - Add a shared `extractUserId(request, env): Promise<string | null>` helper in `server/middleware/auth.ts`
    that calls `verifyBearerToken` and returns the sub claim (or null if absent/invalid)
  - Apply in each non-chat route handler that reads or modifies user-owned data:
    - `handlePDFUpload`, `handlePDFDelete` — scope to userId
    - `handleDocsIndex`, `handleDocsDelete` — scope to userId
    - `handleKbList`, `handleKbIndex`, `handleKbDelete` — scope to userId
  - Images (serve/delete) are keyed by ID not userId — no user scoping needed, leave as-is

---

### Group C — Code quality

- [ ] **C1** — Centralize the Studio harness blocked-tool list
  - Create `chat/src/orchestration/tools/mcp/blocklist.ts`:
    ```typescript
    export const STUDIO_HARNESS_BLOCKED = new Set([
      "mcp_studio_harness__write_file",
      "mcp_studio_harness__edit_file",
      "mcp_studio_harness__bash",
      "mcp_studio_harness__repl",
      "mcp_studio_harness__git_commit",
      "mcp_studio_harness__get_coding_guide",
      "mcp_studio_harness__sleep",
    ]);
    ```
  - Replace inline Set definitions in 3 files:
    - `pipeline/preload.ts:148-156` — remove inline Set, import `STUDIO_HARNESS_BLOCKED`
    - `pipeline/stream/index.ts:225-233` — same
    - `orchestration/agent/nodes/llm.ts:99-107` — same
  - Single source of truth — adding/removing a blocked tool now touches 1 line

- [ ] **C2** — Type `adapter` properly in phase1.ts / phase2.ts
  - Both files use `adapter: any` — replace with `import type { ProviderAdapter } from "../../server/providers/types"`
  - `runPhase1(ctx, adapter: ProviderAdapter, ...)` and `runPhase2(ctx, adapter: ProviderAdapter, ...)`
  - This surfaces any type mismatch in `.stream()`, `.streamFull()`, `.complete()` call sites

- [ ] **C3** — Fix `getApiKey` bug in specialist resume (phase2.ts)
  - `phase2.ts:204`: `apiKey: getApiKey(ctx.env, payload.provider) ?? ""`
  - Fix: `apiKey: ""` — specialist routes through agents' GATEWAY binding; chat env key is never needed
  - Also fix `apiBaseUrl: PROVIDER_URLS[payload.provider] ?? ""` → `apiBaseUrl: ""` (same reasoning)
  - Remove now-unused `getApiKey, PROVIDER_URLS` import from phase2.ts

- [ ] **C4** — Fix `handleToolExecute` empty registry
  - `server/routes/localInference.ts:81`: `createRequestRegistry([])` — no MCP tools loaded
  - Fix: load user MCP tools before executing:
    ```typescript
    const userId = (body as any).userId;
    const { tools: mcpTools } = userId && env.AI_DB && env.MCP_KV
      ? await loadMcpTools(userId, env.AI_DB, env.MCP_KV, undefined)
      : { tools: [] };
    const registry = createRequestRegistry(mcpTools);
    ```
  - Import `loadMcpTools` from `"../../orchestration/tools/mcp"`
  - userId must be included in the POST body from the local daemon

---

### Group D — Documentation / wrangler

- [ ] **D1** — Document agents auth design in `agents/src/index.ts`
  - Add a comment block before the route registrations explaining:
    > All routes are reachable only via service binding from studio-chat (which is fully authenticated).
    > B1 above adds JWT verification for direct HTTP access. Until that's deployed, direct HTTP is unauthenticated.
  - Add `JWT_SECRET` to `agents/wrangler.toml` secrets comment block

---

### Group E — Verify

- [ ] **E1** — TypeScript compile check across all 4 workers
  - `npx tsc --noEmit` in: `chat/`, `gateway/`, `agents/`, `mcp/hub/`
  - Expected errors to fix: import path change from A1, type import from C2, removed `getApiKey` import in C3

---

## Execution order
```
A1 + A2                    (structural, independent)
B1 + B2                    (auth, independent of each other)
C1 → C2 → C3 → C4         (quality — C1 first so imports resolve)
D1                         (docs, any time)
E1                         (validate everything)
```

## What this does NOT change
- Service binding topology (already correct from V1 plan)
- GatewayAdapter / x-internal routing (already correct from T14)
- Composio split (discovery in mcp/hub, execution in chat — deliberate)
- ChatAgent DO WebSocket handling (separate concern, no bugs found)
- Phase 1/Phase 2 streaming logic (correct — only types and one key bug)
- Specialist system (complex, working, separate refactor if needed)
- RateTrackerDurableObject (still active — used by router service for per-provider counters)
- Re-export pattern in `server/` folder (fragile but functional; breaking it requires shared package)
