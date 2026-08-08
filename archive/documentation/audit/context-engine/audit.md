# Worker Audit — Context Engine (`studio-context-engine`)

Verified by static analysis. Folder: `Backend/Cloud/context-engine` (~1827 LOC, 20 files).

## 1–2. Responsibility (arch doc §4)
Build the complete `ContextPackage` for a runtime: conversation history, memory, normalized attachments/artifacts, capability catalog + default tools, environment, provider-ready messages. Route to Execution/Planner runtime.

## 3. Entry points
`src/index.ts` routes: `/context` = `/context-engine` (POST), `/expand-tool`, `/cache`, `/health`.
`context.ts` → `assembleContext(env, body)` where body = `{userId, taskId, conversationId, task, consumer}` (+ optional `workspaceId`, `agentId`). Requires `x-user-id` == `body.userId`.

## 4. Assembly flow (`assembly/assemble.ts`)
1. **Capability snapshot** (cached): `Promise.all` of `buildMcpContext`, `buildConnectorContext`, `buildSkillContext`, `buildAgentContext` (+ soft `buildProjectContext`), then `readToolPoolProjection` (`TOOL_POOL /projection`) for `defaultTools` + `summaries`.
2. **Context package**: `Promise.all` of `buildConversationContext` (from DATA) + soft `buildUserContext` (memory). Adds system prompt (per consumer), capability preamble, records assembly to `CONTEXT_DB`, persists memory references to DATA, then `buildSendableContext` → `sendable.modelInput.messages` (provider-neutral) which the runtime lowers to gateway messages.

## 5. Dependencies (bindings)
`REGISTRY` (mcp/skills/agents/project builders), `DATA` (conversation/artifacts/attachments/memory-refs), `TOOL_POOL` (projection), `CONNECTORS` (connector builder), `MCP` (memory retrieval via hub — **missing worker**, G-02), `CONTEXT_DB` (D1, assembly log).

## 6. External contracts (all match consumers)
- `TOOL_POOL /projection` → `studio.tool-pool.projection.v1`. ✅
- `REGISTRY /mcp|/skills|/agents` → `{items}` filtered `status==='active'`. ✅
- `DATA /transcripts/model` (preferred) with fallback `/conversations/:id/messages` (legacy). ✅ robust dual-path.
- `MCP /internal/native/execute` `{serviceId:"memory", toolName:"memory_recall", toolArgs}` → hub route. ⚠️ hub absent.
- Output `sendable.modelInput.messages: ProviderNeutralMessage[]` consumed by `modelLoop.lowerContextToMessages`. ✅

## 7. Storage / state model
- **Capability cache** (`cache/contextCache.ts`) is an **in-process `Map`** with 5-min TTL, keyed by `(user, workspace, agent, consumer)` — **not** `conversationId`/`task`. On Cloudflare this is per-isolate and ephemeral: it does not reliably share across requests or the fleet, and evaporates on isolate eviction. Effectively best-effort, not a real cache.
- **`CONTEXT_DB`** (D1) used only by `recordContextAssembly` (audit log of each assembly). `database_id` is placeholder `00000000-...`.

## 8. Conversation builder (strong)
`builders/conversation.ts` (270 LOC) pulls **slices** (last 80 msgs / 20 tool results), resolves artifacts + attachments to `ResolvedContextResource` with text inlining (24–32k caps), image/file reference modes, and **redacts** token/secret/credential/key fields in `runtimeData`. Well-engineered.

## 9. Bugs / defects & reliability
- **CE-1 (High, reliability):** `recordContextAssembly` (a D1 **audit-log write**) is `await`ed inside `Promise.all` in `buildContextPackage` and **is not soft-wrapped**. If `CONTEXT_DB` is unmigrated/unreachable (its id is a placeholder), the INSERT throws → **the entire context assembly 500s** → runtime silently falls back to the bare prompt. An audit write should never be able to fail context construction. Fix: fire-and-forget / soft-wrap.
- **CE-2 (Medium):** capability builders `mcp/skills/agents/connectors` are **not** `soft()`-wrapped (only `project`/`user` are). One REGISTRY/CONNECTORS hiccup zeroes the *entire* capability set instead of degrading per-layer. (= G-05.)
- **CE-3 (Medium, consistency):** **two different memory access paths** — auto-injection uses `MCP /internal/native/execute serviceId=memory`; runtime explicit `memory_*` tools route via tool-execution `MEMORY /operations/{op}`. Different transports/targets for the same store; both currently unbacked (G-02).
- **CE-4 (Low):** cache key omits `task`; if Tool Pool later ranks `defaultTools` by task, cached defaults could mismatch the task.

## 10. Observability
Runtime cannot tell "context unavailable" from "empty context" — CE emits nothing the runtime surfaces on failure (= G-06).

## 11. Unused / duplicate
`expansion/expand.ts` + `/expand-tool` route parallel the Tool Pool `/expand`; confirm which is authoritative. Two capability caches (CE `Map` + Tool Pool live recompute) — split ownership (see tool-pool Q-TP1).

## 12. Testing status
`scripts/` present; no unit tests found for assembly.

## 13. Recommended changes
1. **CE-1:** make `recordContextAssembly` non-fatal (soft/`ctx.waitUntil`).
2. **CE-2/G-05:** soft-wrap each capability builder for per-layer degradation.
3. **CE-3:** unify memory access on one path/contract once G-02 is decided.
4. Provision + migrate `CONTEXT_DB` (real id) or make it optional.
5. Decide caching ownership (durable vs in-proc) and include `task` in key if ranking becomes task-aware.

## 14. Open questions
- Q-CE1: Is the capability cache meant to be durable (KV/DO/D1) or is best-effort in-proc acceptable?
- Q-CE2: Single memory path — hub `native/execute` or tool-execution `MEMORY`? (ties to G-02)
- Q-CE3: Is `CONTEXT_DB` required, or should assembly logging be optional?

## 15. Severity & priority
- **CE-1 High** — a placeholder/unmigrated CONTEXT_DB silently kills all context (capabilities, history, memory) fleet-wide.
- CE-2/CE-3 Medium. Conversation/attachment handling: solid, low risk.
