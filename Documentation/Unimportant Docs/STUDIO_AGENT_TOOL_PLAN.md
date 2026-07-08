# STUDIO — Agent & Tool Architecture Plan

> Authoritative plan for the agent rebuild + tool unification.
> Status: agreed in discussion 2026-06-23. Build not yet started.

---

## 0. The core realization

The MCP hub (`studio-mcp`) is **a pure registry + router** — it holds **zero tool
logic**. It only:
- stores **connections** (`external_connections`: mcp_local / mcp_remote / composio + creds),
- lists a **native-service catalog** (`NATIVE_SERVICES` schemas — today: memory, youtube),
- **routes execution** to backing workers via `/internal/native/execute` (JSON-RPC MCP)
  and `/internal/composio/execute`.

The **real tool registry currently lives in `chat`** (`chat/src/tools/index.ts` →
`ToolRegistry`), which hardcodes every native tool. That is the thing we are unwinding.

**Memory already proves the target architecture.** It lives in its own worker, registers
in the hub's `NATIVE_SERVICES`, the hub holds none of its logic, chat pulls it via
`loadMcpTools` → `NativeMCPTool`, and `NativeMCPTool.allowInSubAgent = true` — so
sub-agents already get it. We replicate this for first-party tools.

---

## 1. Single source of truth for tools

Create a new first-party worker **`studio-tools`** that holds the native tool
implementations and exposes them over the **MCP Streamable HTTP** transport (`/mcp`
endpoint: `initialize` → `notifications/initialized` → `tools/call`), exactly like the
memory worker.

Register `studio-tools` as a **third native service** in the hub's `NATIVE_SERVICES`
(`mcp/src/routes/internal.ts`). The hub lists its schemas and routes execution to it.
**Hub stays pure — it gains no tool code.**

### Tools that move OUT of chat → into `studio-tools`
- `web_search`, `web_fetch`, `rag` (retrieval)
- `image_generate`, `video_generate`, `video_status` (generation — may route internally
  to GATEWAY; can later split to a sub-worker, catalog stays single)
- `http_request` (network)
- `task_write`, `skill_read` (UX tools — see §4)
- `expand_tools` metadata (see §4)
- `user_location`

After migration **chat owns zero work tools.** It keeps only the orchestrator
control-plane verbs: `spawn_agent`, `await_agents`, `cancel_agent`.

### Result
Both the main agent (chat) and sub-agents (agents worker) get their entire work-tool
catalog from the hub via the same `loadMcpTools`-style path. One catalog. No
`agents → chat` binding.

---

## 2. Local MCP tools for sub-agents (the hard part)

Local tools (`DynamicMCPTool`) are **stubs in the cloud** — `execute()` throws; the tools
node defers to the Tauri desktop over the ChatAgent WebSocket. The hub only *lists* them.
`allowInSubAgent = false` today because only the main agent has a desktop socket.

**Plan:** the desktop (Tauri, via the existing Connection Manager) opens a channel to each
running **sub-agent DO**, the same way it connects to the ChatAgent. The sub-agent's loop
emits the same "pending local tool" deferral over *its* channel; the desktop runs it via
subprocess and returns the result. **No main-agent hop** — independent loop, independent
channel.

- Catalog of local tools = single source of truth (hub lists them, served to both).
- **Execution** of local tools = always a desktop-channel relay, per agent. Never the hub.
- `allowInSubAgent` for local tools becomes config-driven per agent type, not a blanket flag.

**Offline caveat → solved by the queue (§6).** A background/cron sub-agent that needs a
local tool while the machine is offline parks in a "waiting for local runtime" state
(DO hibernation) and resumes via the queue when the desktop reconnects.

---

## 3. Blackboard + agent-to-agent comms

- `spawn_agent` / `await_agents` / `cancel_agent` stay **native in chat** as control-plane
  verbs (`allowInSubAgent = false`). They are not "tools" in the work sense — they are the
  orchestrator commanding the agents worker. Repoint them from the deleted `omni-agent`
  endpoints to the new agent-type endpoints.
- **Blackboard** is run-scoped shared state, today backed by `getChatAgent()` (ChatAgent DO)
  — unreachable from the agents worker. Move its backing to a **DO owned by the agents
  worker** (or a dedicated coordination DO both workers bind to), keyed by
  conversationId / runId. The two blackboard tools (`write_to_blackboard`,
  `read_from_blackboard`, `allowInSubAgent = true`) register in the catalog and route to
  that DO. Hub stays pure.

---

## 4. UX / meta tools

- `task_write`, `skill_read` → move to `studio-tools` (so chat owns zero tools — cleaner
  than leaving 1–2 orphans in chat). "Only the main agent calls task_write" is enforced by
  agent config / system prompt, not by physical location.
- `expand_tools` → move to `studio-tools` and **expose to sub-agents**. Scoped agents
  (e.g. a coding agent) get a fixed predetermined tool list and never need it; general /
  research agents need dynamic expansion. The difference is per-agent **config**, not a
  blanket `allowInSubAgent = false`. Two agent tool-access modes:
  - **fixed**: exact tool list injected, no expand_tools.
  - **discoverable**: a starter set + `expand_tools` to pull more on demand.

---

## 5. Agents worker rebuild

- New spawnable agent DO classes (CF Agents SDK `Agent<Env, State>` + WebSocket, SQLite
  state, hibernation). Added as `new_sqlite_classes` in a new migration tag.
- `AGENT_TYPES` repopulated with the new agent definitions (scope + tool-access mode per type).
- Re-enable `handleRunAgent` (currently a 503 shell).
- Multi-tenant: every agent instance keyed by `(userId, agentId, runId)` → one DO per run.
  User-facing — user 1 and user 2 run isolated instances.
- Thread `userId` into every hub call so Composio connections / local routing / rate limits
  resolve correctly (the worker already threads `X-User-Id`).

---

## 6. Cross-cutting: Queue + Retry + Notifications (separate track)

The project lacks a proper queue / retry / error-feedback layer; it is handled ad-hoc and
slips. Build a **centralized queue** covering main agent, sub-agents, image/video gen, MCP
calls — every operation that can fail or block.

- **Queue**: a task that can't complete now (machine offline, tool down) is enqueued and
  resumes when the dependency is back online.
- **Retry**: bounded, logical backoff — not 30-day retries.
- **Notifications**: in-app notification center in STUDIO (bell icon, Instagram/Facebook
  style — click to view), not just on-demand desktop toasts. "Your agent task failed /
  completed." Global across agents + workspace events.

Can be built alongside the agent rebuild or standalone. It is the proper home for the
"waiting for local runtime" state from §2.

---

## Build sequence (each step compiles + deploys independently)

1. ✅ **`studio-mcp-tools` worker scaffold** — DONE. New worker at `workers/mcp/tools/`
   (name `studio-mcp-tools`, mirrors `studio-mcp-memory`). McpAgent `StudioToolsAgent`
   serves `/mcp`; first real tool = `http_request` (self-contained fetch, ported from
   chat). Hub wired: `TOOLS` binding (`mcp/src/env.ts` + `mcp/wrangler.toml`) and a
   `studio-tools` entry in `NATIVE_SERVICES` (`mcp/src/routes/internal.ts`) advertising
   `http_request`. Hub holds no tool logic — it lists + routes via `/internal/native/execute`.
   chat/agents need NO binding change: they already reach it through `MCP_TOOLS → studio-mcp`.
   Both hub and new worker `tsc --noEmit` clean.
   - **NOTE — chat still also registers `http_request` natively** (not yet removed). The
     hub-native version overrides it in the per-request registry, so no schema dup. Its
     removal from `chat/src/tools/index.ts` is the first action of step 2.
   - **DEPLOY ORDER (when wrangler login is available):** deploy `studio-mcp-tools` FIRST,
     then `studio-mcp` (so the `TOOLS` service binding resolves), then chat. Deploying the
     hub before the tools worker exists will fail the service-binding check.
2. **Migrate stateless tools** chat → studio-tools, group by group (retrieval → generation →
   network → UX). Remove from chat's `ToolRegistry` as each lands. Verify chat still lists
   them via `loadMcpTools`.
   - ✅ **Retrieval + http_request DONE** (2026-06-23): `http_request`, `web_search`,
     `web_fetch`, `rag` ported into `workers/mcp/tools/src/tools/` (+ `indexing.ts`,
     `constants.ts`), registered in `StudioToolsAgent`, advertised in the hub's
     `studio-tools` catalog, and **removed from chat's `ToolRegistry`** (the cutover).
     studio-tools binds `VECTORIZE` (studio-rag), `AI`, `MCP_KV` (shared id), and
     `TAVILY_API_KEY`/`BRAVE_SEARCH_API_KEY` secrets. web_fetch auto-index now awaits inline
     (no ctx.waitUntil in McpAgent handlers — also removes the index→query race). All three
     workers (studio-mcp-tools, studio-mcp, studio-chat) `tsc --noEmit` clean.
     - Dead source files left in chat (`tools/retrieval/{webSearch,webFetch,rag}.ts`,
       `tools/network/httpRequest.ts` + their barrel re-exports). `tools/retrieval/indexing.ts`
       stays — shared by the `/v1/docs` route. Delete the dead tool files in a later cleanup.
   - ✅ **Generation DONE** (2026-06-23): `image_generate`, `video_generate`, `video_status`
     ported into `workers/mcp/tools/src/tools/`, registered in `StudioToolsAgent`, advertised
     in the hub catalog, and removed from chat's `ToolRegistry`. video_* are pure GATEWAY
     pass-throughs; image_generate stores into the shared `studio-images` bucket (gateway
     still serves `/v1/images/:id` + owns the 7-day cleanup cron — untouched) and builds the
     URL from a new `PUBLIC_IMAGE_BASE` var (replaces chat's request-scoped
     `getRequestBaseUrl()`; set to `https://api.pookiepied.dev` — verify domain). All three
     workers `tsc --noEmit` clean.
     - **FOLLOW-UP (groupPrompt loss):** the chat generation tools carried
       `groupPrompt = GENERATION_SYSTEM_PROMPT`, auto-injected into the system prompt when
       active. `NativeMCPTool` has no `groupPrompt`, so that guidance is lost on migration.
       Same will apply to other tools that carry group prompts. Needs a new home — bake into
       tool descriptions, or have chat inject a prompt block when the studio-tools server is
       active. Tracked for a dedicated pass.
   - ✅ **UX group resolved — STAYS in chat** (2026-06-23): the code makes the boundary
     decisive, so nothing here migrates:
     - `task_write`, `get_location` — `executionTarget="client"`: a cloud worker can't run
       them (no client relay / no browser). They ride chat's `local_tools_pending` channel.
       Both `allowInSubAgent=false` — main-agent/UI only.
     - `skill_read` — a thin reader over chat-owned skill content that is *already* injected
       into chat's system prompt (`getSkillsIndex()`). Splitting loader from content across
       workers makes no sense. Stays.
     - `expand_tools` — a chat-loop discovery meta-tool over chat's own `ToolRegistry`.
       Sub-agent discovery (fixed vs discoverable access) is handled in the agents-worker
       rebuild, not by porting this. Stays.
     What remains in chat is a coherent set: orchestration control-plane
     (spawn/await/cancel/blackboard) + client/UI relay tools (task_write, get_location) +
     chat-loop meta/guidance (expand_tools, skill_read). Every stateless cloud **work** tool
     now lives in the hub catalog.
   - ✅ **Cleanup DONE** (2026-06-23): deleted dead chat tool files
     (`tools/retrieval/{webSearch,webFetch,rag}.ts`, `tools/network/httpRequest.ts`,
     `tools/generation/{imageGenerate,videoGenerate,videoStatus,index}.ts` + empty dir),
     trimmed the `retrieval`/`network` barrels. Kept `indexing.ts` (shared by `/v1/docs`),
     `r2Store.ts`, `prompts/sections/generation.ts`. chat `tsc --noEmit` clean.

   **STEP 2 COMPLETE.** studio-mcp-tools now owns: http_request, web_search, web_fetch, rag,
   image_generate, video_generate, video_status. Chat owns only orchestration + client/UI +
   meta tools.
3. ✅ **Blackboard backing → agents-worker DO** — DONE (2026-06-23). New `BlackboardDO`
   (`agents/src/blackboard/BlackboardDO.ts`): plain SQLite DO, one instance per conversation
   scope via `idFromName(conversationId)`. Dispatch route `agents/src/routes/blackboard.ts`
   (`POST /blackboard/{write,read}`, resolves scope → DO stub). Wired in `agents/src/index.ts`
   (export + route), `agents/src/env.ts` (`BLACKBOARD` DO binding), `agents/wrangler.toml`
   (DO binding + migration v4 `new_sqlite_classes=["BlackboardDO"]`).
   - Chat's `write_to_blackboard`/`read_from_blackboard` rewired to call
     `env.AGENTS.fetch("/blackboard/...")` with `scope = getChatAgent().name`
     (= conversationId) instead of the local `ChatAgent` DO. Value-shaping (writtenBy/
     writtenAt/description) unchanged; read response `{ data }` mirrors the old
     `readBlackboard()` shape so downstream tool logic is untouched.
   - Removed the now-dead `ChatAgent.writeBlackboard/readBlackboard` + the `blackboard` table
     init in `onStart`.
   - Respects the chat → agents direction (chat may call agents; agents never calls back).
     Sub-agents (step 4) will hit the same DO directly within the agents worker.
   - Tradeoff: main-agent blackboard ops are now a cross-worker call (service binding + DO)
     vs the old local SQLite — fine, they're occasional tool calls, not hot-path.
   - chat + agents both `tsc --noEmit` clean. **DEPLOY:** agents worker (migration v4) must
     deploy before/with chat; no new chat binding (AGENTS already bound).
4. **Agents worker foundation + DO rebuild.** Build the runtime *environment* first
   (so any cloud agent can "live" and use any tool), THEN decide agent types, THEN build them.
   - ✅ **4a — Tool-access plane DONE** (2026-06-23). The agents worker can now load + execute
     tools from all sources, same reach as the main agent. New modules under `agents/src/tools/`
     (no inline code — all imported):
       - `types.ts` — `AgentToolDescriptor` + `ToolSource` (native | composio | remote_mcp |
         local_mcp) + routing unions.
       - `hubClient.ts` — typed studio-mcp hub client (catalog + execution proxies).
       - `loader.ts` — `loadAgentTools(env, userId)` builds the catalog from hub connections +
         native services + Composio + KV manifests (`mcp_manifest:{name}`).
       - `executor.ts` — `executeAgentTool()` routes native/composio/remote_mcp → hub (cloud),
         local_mcp → `ClientToolBridge`.
       - `clientBridge.ts` — `ClientToolBridge` interface + `NotConnectedBridge` (the seam for
         local tools; the desktop ↔ sub-agent channel fills it in step 6).
       - `index.ts` — barrel.
     Hub gained `/internal/remote/execute` (`mcp/src/routes/remote.ts`, wired in `internal.ts`)
     so remote MCP execution also routes through the hub — hub stays the single execution
     router (proxy, not owner). Agents worker bound `MCP_KV` (shared id) for manifests.
     All cloud tool types work cloud-side now; local tools are a clear seam (NotConnectedBridge
     returns a "not available" error until the desktop channel exists). hub + agents `tsc` clean.
     - ✅ Follow-up resolved: hub remote.ts now implements the full GET-SSE transport fallback
       (lifted from chat's RemoteMCPTool) — legacy-only MCP servers now work for sub-agents
       too. Hub + agents tsc clean.
   - ✅ **4b — Runtime DONE** (2026-06-27). New `agents/src/runtime/` (all imported, no inline):
       - `types.ts` — `AgentRunConfig`, `AgentState`, `LLMMessage/ToolCall/ToolDefinition`,
         `AgentLoopResult`, `LoopStopReason`, `AgentStatus`.
       - `llmClient.ts` — `GatewayLLMClient`: non-streaming POST to studio-gateway
         `/v1/chat/completions`; passes `x-user-id` + `x-agent` headers.
       - `loop.ts` — `runAgentLoop()`: ReAct loop — LLM step → tool execution (series) →
         append messages → repeat; exits when no tool_calls returned; unbounded by default;
         respects `maxIterations` / `tokenBudget` flags; `onIteration` callback for DO
         checkpointing; local_mcp tools filtered out when bridge is not connected.
       - `agentDO.ts` — `BaseAgentDO extends Agent<Env, AgentState>`: CF Agents SDK DO;
         addressed by runId via idFromName; HTTP API: POST /run (blocks, runs full loop),
         GET /status, POST /cancel; state checkpointed after each iteration; sub-classes
         declare SYSTEM_PROMPT + optionally override buildToolDescriptors().
       - `index.ts` — barrel.
     Concrete agent types will live under `agents/src/agents/{type}/` and extend BaseAgentDO.
     hub + agents both tsc clean.
   - ✅ **4c — Agent types DONE + REVISED** (2026-06-27). DECISION: only ONE agent — `research`.
     (Integration agent was built then REMOVED — too close to what the main agent already does;
     bar for a new agent type is "clearly parallel + qualitatively different," which it failed.)
     - `agents/src/agents/research/` — ResearchAgent: ONLINE research (no memory, per user).
       Fixed tools: web_search, web_fetch, rag, http_request. `prompt.ts` is a disciplined
       research prompt (decompose→ranked sub-questions, source-quality judgement, verify via
       independent confirmation, self-checkpoint, strict cited output, budget-aware, blackboard
       coordination) — USER REVIEW PENDING. `index.ts` extends BaseAgentDO, filters
       loadAgentTools to native ALLOWED_TOOLS.
     - `agents/src/agents/registry.ts` — single source of truth: AgentType, AGENT_TYPES,
       getAgentNamespace, agentTypeFromRunId. Used by both the workflow route and the spawn route.
     - **Model tiers** (`agents/src/runtime/modelTiers.ts`): agents get their OWN quick/balanced/
       deep tiers curated for coding/reasoning-capable models — deliberately NOT the chat
       worker's generalist user-facing modes. Env-overridable. `resolveAgentModel(spec,env,
       inheritModel)` accepts tier | "inherit" | "provider:model"; default balanced. The agents
       worker resolves tier→concrete model before calling the gateway (gateway takes explicit
       provider:model). primary+fallback threaded config.fallbackModel → llmClient (retry once).
     - `handleRunAgent` (persisted /v1/agent-workflows path, for user-saved agents) re-enabled:
       D1 lookup → getAgentNamespace → runId → agent_runs insert → ctx.waitUntil(DO /run) → 202;
       DO result updates D1. wrangler.toml: RESEARCH_AGENT binding + migration v5=["ResearchAgent"].
5. ✅ **spawn/await/cancel repoint DONE** (2026-06-27). The old tools pointed at deleted
   omni-agent/coding-agent DOs — broken. Now:
   - New EPHEMERAL door: `agents/src/routes/spawn.ts` `handleAgentDispatch` — POST
     `/agents/{type}/spawn` (resolve tier→model, new runId=`{type}-{uuid8}`, ctx.waitUntil(DO
     /run), 202+{runId}), GET `/agents/{type}/{runId}/status`, POST `.../cancel`. This is the
     door spawn_agent uses (ephemeral, no user_agents row); both doors funnel into BaseAgentDO.
   - Blackboard is now built into the agents runtime (`agents/src/runtime/blackboard.ts`) —
     always-on write/read tools injected into the loop when conversationId is set, direct
     env.BLACKBOARD call, stored shape matches the chat side. This is the a2a channel:
     main agent + all siblings share the conversationId-scoped board. (Closed the gap where
     sub-agents couldn't coordinate.)
   - Tracker events (`agents/src/runtime/tracker.ts`): loop emits agent.iteration each round;
     DO emits agent.spawned/done/failed — live progress + notification-center groundwork.
   - chat tools rewired: `spawnAgent.ts` (AGENT_TYPES={research}; adds model tier +
     max_iterations + token_budget params; POSTs the spawn endpoint with task/model/inheritModel/
     conversationId/budgets + X-User-Id), `awaitAgents.ts` (polls the new status endpoint, maps
     new AgentState), `cancelAgent.ts` (new cancel endpoint; type from runId prefix).
   - All three workers (chat/agents/hub) tsc clean.
6. ⏳ **Sub-agent local-tool channel** — Connection Manager extension (desktop ↔ sub-agent DO);
   fills the ClientToolBridge seam so sub-agents can run local MCP tools the same way the main
   agent does (deferral over its own channel, no main-agent hop).
7. ⏳ **Queue + retry + notification center** (parallel track). The tracker agent.* events emitted
   in step 5 are the groundwork; this adds the bell-icon notification UI + bounded retry + the
   offline queue ("waiting for local runtime") state.

## Open sub-decisions (recommendation in parens)
- Blackboard DO owner: agents worker vs dedicated coordination DO (→ agents worker).
- Generation tools: in studio-tools vs own sub-worker behind it (→ start in studio-tools).
- `studio-tools` naming: confirm it fits the `studio-{noun}` convention (→ yes).
