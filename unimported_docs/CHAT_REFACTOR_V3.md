# Chat Refactor V3 — Dead Code Removal, Auth Hardening, Stale Docs

## Context

- **V1** (CHAT_REFACTOR_PLAN.md): Structural rename gateway/→server/, service binding topology, composio/MCP split, agent workflow split. All complete.
- **V2** (CHAT_REFACTOR_V2.md): Code quality — pipeline folder coherence, blocklist centralisation, type safety, specialist resume bug, local inference registry fix. All complete except B2.
- **V3** (this file): Dead code removal, auth hardening, stale documentation cleanup.

---

## Audit Findings

### What's clean and correct — do not touch

| Area | State |
|------|-------|
| `pipeline/` | ✅ All 7 stages (parse→userContext→preload→systemPrompt→dispatch→stream) in the right folder |
| `server/routes/` | ✅ Each route in its own file, thin proxies for MCP/agents/composio |
| `server/providers/` | ✅ GatewayAdapter wraps `env.GATEWAY` correctly; falls back to direct adapters in local dev |
| `server/services/router/` | ✅ Model tier classifier stays in chat — it needs user context + admin modes |
| `server/middleware/` | ✅ CORS, origin validation, error handler, response formatters all correct |
| `orchestration/agent/ChatAgent.ts` | ✅ WebSocket + tool loop correctly separated |
| `orchestration/tools/` | ✅ Tool registry, cloud tools, MCP tools, Composio execution |
| `orchestration/skills/` | ✅ 5 skill categories, loaded via `skill_read` tool on demand |
| `orchestration/specialists/coding/` | ✅ ACTIVE — used by phase2.ts `handleSpecialistResume` |
| `tracking/` | ✅ Thin client to studio-tracker; not duplication |
| Service bindings | ✅ GATEWAY, AGENTS, MCP, TRACKER, MEMORY all wired |

### What's broken / dead / stale

| # | Area | Problem |
|---|------|---------|
| 1 | `specialists/base/` | 3 files — BaseSpecialistGraph, SpecialistRuntime, specialistPrompt. Dead. Nobody calls these. |
| 2 | `specialists/research/` | 3 files — ResearchAgentGraph runner/prompt/tools. Dead. `getSpecialist()` is never called from active code. |
| 3 | `specialists/registry.ts` | Dead. `getSpecialist()`, `getRegisteredSpecialistTypes()`, `PRIMARY_SPECIALIST_TYPES` are never imported anywhere else. |
| 4 | `specialists/state.ts` | Dead. `SpecialistStateType` only used by base/ and research/. Not by coding/. |
| 5 | `specialists/types.ts` | Dead. `SpecialistConfig`, `SpecialistResult`, `ToolPolicy` only used by base/ and research/. |
| 6 | `server/routes/agentWorkflows.ts` | **Pending B2 scope**: currently reads userId from `X-User-Id` header without JWT verification |
| 7 | `server/routes/kb.ts` | Same: reads userId from header, no JWT check |
| 8 | `server/routes/pdf.ts` | Same |
| 9 | `server/routes/docs.ts` | Same |
| 10 | `orchestration/tools/cloud/agentic/spawnAgent.ts` line 92 | Stale description: "Spawn a cloud-based research sub-agent" — should be "Spawn a cloud OmniAgent" |
| 11 | `chat/README.md` line 70 | References `src/gateway/routes/chat.ts` — the old path. Now `src/server/routes/chat.ts` |

---

## Dead Specialist Code — Proof

The `ResearchAgentGraph` is registered in `specialists/registry.ts`:
```typescript
const SPECIALIST_REGISTRY: Record<string, BaseSpecialistGraph> = {
  "research": new ResearchAgentGraph(),
};
export function getSpecialist(agentType: string): ...
```

But `getSpecialist` is **never imported by any file outside `specialists/`**. And `spawnAgent.ts` only accepts `"omni"` and `"coding"` in its `agent_type` enum — "research" is not a valid value. The old research sub-agent spawning path is completely cut off.

`specialists/state.ts` and `specialists/types.ts` are imported by `base/BaseSpecialistGraph.ts` and `research/runner.ts` only. The coding specialist (`specialists/coding/`) has its own types (`PendingCodingSpecialist`, `SpecialistResumePayload`) and does not extend `BaseSpecialistGraph`.

**Dead files confirmed (9 files, 3 folders):**
```
orchestration/specialists/
  base/
    BaseSpecialistGraph.ts  ← dead
    SpecialistRuntime.ts    ← dead
    specialistPrompt.ts     ← dead
  research/
    prompt.ts               ← dead
    runner.ts               ← dead
    tools.ts                ← dead
  registry.ts               ← dead
  state.ts                  ← dead
  types.ts                  ← dead
```

**Stays (3 files, 1 folder):**
```
orchestration/specialists/
  coding/
    index.ts                ← ACTIVE: PendingCodingSpecialist + SpecialistResumePayload types
    runner.ts               ← ACTIVE: runCodingSpecialistTurn (used by phase2.ts)
    prompts.ts              ← ACTIVE: specialist system prompts
```

---

## Auth Gap — B2 (Carried from V2)

Middleware 4 in `index.ts` only checks header **presence** (CF Access assertion OR Authorization). Routes that handle user-owned data but bypass `handleChat` have no userId extraction or token verification:

| Route handler | User-owned data | Risk |
|--------------|-----------------|------|
| `handlePDFUpload`, `handlePDFDelete` | User R2 objects | Any authed user can delete anyone's PDFs |
| `handleDocsIndex`, `handleDocsDelete` | User vectors + DB rows | Same |
| `handleKbList`, `handleKbIndex`, `handleKbDelete` | User KB docs | Same |
| `handleListAgents`, `handleCreateAgent`, etc. | User agent workflows | Same |

Fix: Add `extractUserId(request, env): Promise<string | null>` helper in `server/middleware/auth.ts` that verifies the Bearer JWT and returns the `sub` claim. Apply at the top of each affected handler.

---

## Task List

### Group D — Dead code removal

- [x] **D1** — Delete `specialists/base/` folder (3 files)
  - `rm orchestration/specialists/base/BaseSpecialistGraph.ts`
  - `rm orchestration/specialists/base/SpecialistRuntime.ts`
  - `rm orchestration/specialists/base/specialistPrompt.ts`
  - Remove `orchestration/specialists/base/` directory

- [x] **D2** — Delete `specialists/research/` folder (3 files)

- [x] **D3** — Delete dead specialist infrastructure (3 files)
  - registry.ts, state.ts, types.ts

- [x] **D4** — No dead imports in `orchestration/agent/ChatAgent.ts`
  - Only imports `specialists/coding/index` (ACTIVE) — nothing to remove

- [x] **D5** — Updated stale comment in `orchestration/context/requestContextStore.ts`
  - No dead imports existed; comment referencing BaseSpecialistGraph removed

---

### Group B — Auth hardening

- [x] **B2** — Per-route JWT auth for user-data routes
  - Add to `server/middleware/auth.ts`:
    ```typescript
    export async function extractUserId(request: Request, env: Env): Promise<string | null> {
      const auth = request.headers.get("authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      if (!token) return null;
      const payload = await verifyToken(token, env.JWT_SECRET).catch(() => null);
      if (!payload || payload.type !== "access") return null;
      return payload.sub;
    }
    ```
  - Apply in route handlers that use `userId` for scoping:
    - `handlePDFUpload`, `handlePDFDelete`
    - `handleDocsIndex`, `handleDocsDelete`
    - `handleKbList`, `handleKbIndex`, `handleKbDelete`
    - `handleListAgents`, `handleCreateAgent`, `handleUpdateAgent`, `handleDeleteAgent`, `handleRunAgent`, `handleListRuns`
  - Return `401 Unauthorized` if `extractUserId` returns null
  - Images routes (`handleImageServe`, `handleImageDelete`) are keyed by ID not userId — leave as-is

---

### Group C — Cleanup / stale docs

- [x] **C5** — Fix stale `spawn_agent` tool description
  - `orchestration/tools/cloud/agentic/spawnAgent.ts` line 92
  - Current: `"Spawn a cloud-based research sub-agent for web research tasks. "`
  - Fix: `"Spawn a cloud-based OmniAgent for research, analysis, or multi-step tasks. "`

- [x] **C6** — Fix stale `chat/README.md`
  - Line 70: `src/gateway/routes/chat.ts` → `src/server/routes/chat.ts`
  - Line 71: `src/gateway/providers/` → `src/server/providers/`
  - Update the Worker Bindings table to include `MCP_KV` (D1-backed MCP server config)

---

### Group E — Verify

- [x] **E1** — TypeScript compile check — 0 errors ✅

---

## Execution order

```
D1 + D2 + D3          (file deletions — independent)
D4 + D5               (import cleanup — after files are gone)
E1                     (verify deletions compile clean)
B2                     (auth hardening — independent of deletions)
C5 + C6               (descriptions — any time)
E1 (again)             (verify final state)
```

---

## What this does NOT change

- `specialists/coding/` — ACTIVE, stays as-is
- ChatAgent DO + WebSocket loop — correct, no changes
- Two-phase pipeline (Phase1 stream + Phase2 tool loop) — correct, no changes
- `server/services/router/` — stays in chat (routing decisions need user context)
- Service binding topology — already correct
- `tracking/` — thin client pattern, correct

---

## Open question — Coding specialist relay vs. WebSocket path

`handleSpecialistResume` in `phase2.ts` is the HTTP-mode path for resuming a coding specialist after Tauri returns local tool results. It handles the `pending_specialist` field in the request body.

The WebSocket path (ChatAgent loop) handles the same scenario differently — specialist tool calls go over the WebSocket, Tauri executes, results come back over the WebSocket.

**Question**: Is the HTTP-mode specialist relay still needed, or does all traffic go through the WebSocket path now?

If STUDIO never sends `pending_specialist` on the HTTP path (all real coding sessions use WebSocket), then `handleSpecialistResume` + `specialists/coding/runner.ts` + `specialists/coding/index.ts` can all be deleted and `specialists/` can be emptied completely.

If the HTTP path is still used (e.g., for some non-DO fallback or testing), it must stay.

**Action**: Check the STUDIO frontend — does it ever set `pending_specialist` in the HTTP chat request body? If the answer is no, add a V3.1 task to delete the coding specialist relay entirely.
