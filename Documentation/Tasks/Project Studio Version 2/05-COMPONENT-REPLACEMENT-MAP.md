# 05 — Component Replacement Map

> File-level: for every component that exists today, what replaces it, with what
> technology, and how the replacement behaves in **both** environments.
> Written from a direct read of the implementation (2026-07-07, commit `47c08f2`),
> not from the folder names. Environment columns: **Cloud** = Cloudflare Worker
> deployment; **Local** = Node sidecar inside the Studio Tauri app.
>
> Parity rule (Decision D13): no component may exist in one environment without a
> defined equivalent in the other.

## 1. `chat/` worker (104 files) — replaced by `packages/agent-loop` + `studio-ai` host

| Current component | What it does today (verified in code) | Replacement | Cloud | Local |
|---|---|---|---|---|
| `agent/loop.ts` (178 ln) | Plain-TS ReAct loop: llmStep → toolsStep → emit; exits early on `local_tools_pending`; **already portable, no SDK imports** | Ported into `packages/agent-loop/loop` on AI SDK core (D9); protocol events unchanged | identical code | identical code |
| `agent/steps/llm.ts` | Provider call via `createProvider` (in-process gateway code), tiered tool visibility, `expand_tools` meta-tool, streaming via `streamFull()` | Same step, model calls through the gateway custom-provider adapter instead of in-process provider code | gateway via service binding | gateway via HTTPS through `api`; local models via daemon provider |
| `agent/steps/tools.ts` | Splits tool calls: cloud tools run in parallel (retry allowlist for idempotent ones); local/MCP tools → `pendingClientToolCalls` | Same split logic, driven by each tool's `executionTarget` | local tools relayed to client via `local_tools_pending` (unchanged protocol) | local tools **execute in-process** — the relay branch short-circuits; no WS round-trip |
| `agent/ChatAgent.ts` (532 ln) | Agents-SDK DO shell: WS handling, `setState` (pendingMessages, session config, completedContent), hibernation workarounds, `waitUntil` continuation | **Deleted.** Replaced by a thin `SessionHost` per environment + `SessionStore` (see 06 §3) | Worker `WebSocketPair` + D1 session rows | sidecar `ws` server on 127.0.0.1 + SQLite session rows |
| `agent/completion/` (accumulator) | Buffers streamed text so a disconnected client can catch up via GET/DELETE `/completed` | Kept as-is (portable); `completedContent` becomes a column in the session store | D1 | SQLite |
| `pipeline/parse.ts` | Request parsing + "auto" model routing + provider/key resolution | Split: parsing → `agent-loop/session`; key resolution deleted (gateway owns keys, already true for non-local per T15) | same | same |
| `pipeline/preload.ts` | Parallel fetch: memory `/inject` context, skills index, user MCP tools (MCP binding + KV cache), Composio schemas (via hub), builtin MCP tools; builds per-request `ToolRegistry` | `agent-loop/context` with a `RegistryClient` adapter interface | service bindings (`MEMORY`, `SKILLS`, `MCP`) + `MCP_KV` | HTTPS via `api`; KV cache → SQLite cache table; skills index read from **local skill store** (D5) |
| `pipeline/assembleMessages.ts`, `userContext.ts`, `dispatch.ts` | System-prompt assembly, user context extraction, requestId/threadId setup | Ported into `agent-loop/context` mostly unchanged (portable TS) | same | same |
| `inputs/image` (`preprocessVision`) | Rewrites base64 data-URLs to R2 presigned URLs mid-request | **Deleted** — Pattern A: client pre-uploads to `studio-data` via `api`, sends URLs (AI_GUIDE §6). Same flow both environments | client → `api` → `studio-data` | identical (upload still goes to cloud storage) |
| `pipeline/stream/` | SSE/WS chunk formatting, tool event emission | Ported to `agent-loop/emit` (protocol frozen) | same | same |
| `server/routes/` docs.ts, kb.ts (Vectorize/KB) | Knowledge-base index/list/delete | Move to `studio-mcp-memory` (owns Vectorize) | memory worker | via `api` → memory worker |
| `server/routes/` upload/image/PDF + crons (`*/15`, `0 2 * * *` cleanup) | Blob storage + lifecycle | Move to `studio-data` (Phase 2) | studio-data crons | n/a — blobs live in cloud in both modes |
| `server/router/` (model tier router) | Tier → model selection by user tier + admin config | `agent-loop/router` step before gateway call (AI_GUIDE §9) | config from D1/api | config fetched from `api`, cached in SQLite |
| `server/routes/memories.ts` | Proxy to memory worker | `api` routes directly to memory worker; chat drops out of the path | api | api |
| `tools/agentic/spawnAgent.ts`, `awaitAgents.ts` | `spawn_agent` POSTs to agents-worker DO `/run` via `AGENTS` binding; `await_agents` polls DO `/status`; in-memory `NAME_REGISTRY` map (lost on eviction) | Rebuilt on the **run store** (06 §4): spawn inserts a run row + starts a loop task; await reads run rows. Name registry becomes a column (fixes the eviction loss) | runs table in D1; sub-agent loops run in the same worker via `waitUntil`/queue | Agent Spawn MCP (D6) backed by the same run store schema in SQLite; sub-agents are sidecar tasks |
| `tools/agentic/blackboard.ts` | `write_to_blackboard`/`read_from_blackboard` → BlackboardDO via `AGENTS` binding | Agent Communication MCP (D6) locally; same message table cloud-side (06 §5) | `agent_messages` table in D1 | `agent_messages` table in SQLite via Agent Communication MCP |
| `tools/agentic/expandTools.ts` + `steps/catalog.ts` | Virtual meta-tool: tiered tool directory, per-turn expansion limit | Ported unchanged (pure TS over the registry) | same | same |
| `tools/mcp/` (discovery, remote, builtin, blocklist) | Loads user MCP tools from hub + KV, builtin service-binding MCP tools, harness blocklist | `RegistryClient` adapter + ported tool wrappers | binding + KV | `api` HTTP + SQLite cache; locally-running MCP servers connect directly (stdio) |
| `tools/composio/` | Proxy tools rebuilt from hub-provided schemas; hub owns execution + API key | Unchanged pattern — hub stays the Composio owner (D5) | via `MCP` binding | via `api` → hub |
| `tools/retrieval`, `network`, `client/todoWrite` | web/rag/http moved to studio-mcp-tools already (per `tools/index.ts` comment); remaining: `skill_read`, `task_write`, `user_location` | Port remaining three into `agent-loop/tools`; `skill_read` reads registry (cloud) / skill store (local) | same | skill_read hits local skill store |
| `skills/*.ts` (desktop/coding/documents/platform prompt bodies) | Skill instruction text compiled into the worker | Move into installable skills in the local skill store; cloud keeps only registry index (D5) | skills registry serves index | Skill Runtime MCP serves content |
| `prompts/` (system, sections, studio) | System prompt assembly | `agent-loop/prompts`, environment flag selects studio/local sections | same | same |
| `tracking/` (spans, emit) | Tracker spans via binding + `ctx.waitUntil` | `agent-loop/telemetry` behind a `Telemetry` adapter | tracker binding + waitUntil | batched HTTPS to `api` → tracker |
| `context/index.ts` (AsyncLocalStorage env/ctx/registry) | Request-scoped globals; **registry Map is module-level and lost on DO hibernation** (rebuilt in `handleToolResults`) | Registry becomes part of session state, rebuilt deterministically from stored config — no ambient globals | same mechanism | same mechanism |
| `index.ts` (`routeAgentRequest`) | Routes `/agents/chat-agent/{id}` to the DO | `studio-ai` router: conversationId → session row + WS accept | Worker fetch handler | sidecar HTTP/WS listener |

## 2. `agents/` worker (25 files) — functionality absorbed, worker deleted (D4)

| Current component | What it does today | Replacement | Cloud | Local |
|---|---|---|---|---|
| `runtime/agentDO.ts` (BaseAgentDO) | Per-run DO (`idFromName(runId)`): SDK-SQLite checkpoint state, heartbeat before each LLM step, `schedule()` watchdog every 60s, generation token vs zombie loops, ≤3 auto-resumes | **The pattern survives, the DO dies.** `RunSupervisor` in `agent-loop`: same heartbeat/generation/resumeCount columns on the run store; watchdog = scheduler adapter (06 §6) | cron trigger scans `runs` for stale heartbeats | sidecar interval timer + on-startup scan (catches app restarts) |
| `runtime/loop.ts` (220 ln) | Autonomous ReAct loop with hooks (`onIteration` checkpoint, `shouldContinue`, `onBeforeStep`), maxIterations/tokenBudget, `GatewayLLMClient` | **Merged with chat's loop** into the single `agent-loop` engine — today's two near-duplicate loops (interactive vs checkpointed) become one loop with optional hooks | same engine | same engine |
| `runtime/llmClient.ts` | OpenAI-format completion via `GATEWAY` binding | The D9 gateway custom-provider adapter | binding transport | HTTPS transport |
| `blackboard/BlackboardDO.ts` | Per-conversation DO, raw `SqlStorage` KV table, `/write` `/read` | `agent_messages` table in the shared state store; richer schema (sender, recipient, kind, payload) per the Communication MCP design (06 §5) | D1 | SQLite (Agent Communication MCP) |
| `agents/registry.ts` + `agents/research/` | Agent-type → DO-namespace map; research agent prompt/tools | Agent-type registry in `agent-loop/agents` (plain data); research/coding/etc. defined as agent presets | same presets | same presets, plus local-only types (file-system coding agents) |
| `routes/spawn.ts`, `routes/agentWorkflows.ts` (372 ln) | Spawn endpoint; user-defined agents with `manual`/`cron` triggers, runs bookkeeping | Spawn/list/cancel become run-store operations exposed as: internal endpoints on `studio-ai` (cloud) and Agent Spawn/Management MCPs (local). Cron-triggered user agents: worker cron trigger (cloud) / sidecar node-cron (local), both reading the same `user_agents` table shape | D1 + cron trigger | SQLite + sidecar scheduler |
| `runtime/tracker.ts` (`emitAgentEvent`) | Lifecycle events (spawned/iteration/done/failed/resumed) to tracker | `Telemetry` adapter (same events, same names) | binding | via `api` |
| `tools/loader.ts`, `executor.ts`, `clientBridge.ts` | Cloud-executable tool descriptors; `NotConnectedBridge` stub for local tools | Superseded by the unified `agent-loop` tool registry with `executionTarget` | n/a | n/a |

## 3. Everything else (summary — no change from docs 02/04, listed for completeness)

| Current | Replacement | Phase |
|---|---|---|
| `gateway/` | `gateway-v2/` (built, cutover pending) | 1 |
| `workers/ChatsStorage/` + `workers/Studio/` | `workers/data/` (`studio-data`, 3 buckets + D1 prefs) | 2 |
| `skills/` (registry + bundled + execution) | registry-only; content → local skill store | 5 |
| `mcp/` | unchanged (registry + Composio) | — |
| `workers/mcp/tools/` | `studio-tools` native MCP server, registered in hub | 5 |
| `workers/mcp/memory/` | unchanged + receives KB/docs routes from chat | 3/5 |
| `tracker/` | restructured (ingest/query/routes) | 6 |
| `api/`, `auth/`, `packages/jwt` | unchanged surface; endpoints adjusted per cutover | rolling |
| `workers/mcp/youtube-transcript/`, `STUDIO bot/` | out of scope | — |

## 4. What is deliberately deleted with no successor

| Component | Why nothing replaces it |
|---|---|
| `preprocessVision` + vision substitution WS event | Pattern A pre-upload removes the need; `vision_substitutions` remains in the protocol as a no-op for client compat until a protocol rev |
| Agents-SDK hibernation handling (`hasRequestRegistry` rebuild path, awaited-distillation workaround in `ChatAgent.distillMemory`) | These are workarounds for SDK behavior; the replacement design (06 §7) has no hibernation |
| `NAME_REGISTRY` in-memory map (`spawnAgent.ts`) | Was already lossy across isolate evictions; becomes a persisted column |
| chat worker's `getApiKey` fallback paths | Gateway owns provider keys (T15 finished the cloud side) |
