# STUDIO Chat Worker — Full Audit (2026-06-20)

Every file in `chat/src/` read and categorized. This supersedes the vague Phase 2 description.
Decision: keep / move / rename / delete for every file, with reasons.

---

## FILE TREE (128 files, post Phase-1)

```
chat/src/
├── constants.ts
├── env.ts
├── gatewayEnv.ts
├── index.ts
├── logger.ts
├── context/
│   └── index.ts
├── durable/
│   └── RateTrackerDurableObject.ts
├── inputs/
│   └── image/
│       ├── index.ts
│       ├── pipeline.ts
│       ├── r2Store.ts
│       ├── resolver.ts
│       └── types.ts
├── orchestration/
│   ├── agent/
│   │   ├── ChatAgent.ts
│   │   ├── loop.ts
│   │   ├── state.ts
│   │   ├── completion/
│   │   │   ├── accumulator.ts
│   │   │   └── index.ts
│   │   └── nodes/
│   │       ├── catalog.ts
│   │       ├── llm.ts
│   │       ├── specialist.ts
│   │       └── tools.ts
│   ├── prompts/
│   │   ├── guardrails.ts
│   │   ├── personality.ts
│   │   ├── system.ts
│   │   ├── voice.ts
│   │   ├── sections/
│   │   │   └── outputFormatting.ts        ← added Phase 1
│   │   └── studio/
│   │       ├── agentRules.ts
│   │       ├── index.ts
│   │       └── projectContext.ts
│   ├── skills/
│   │   ├── index.ts
│   │   ├── coding.ts
│   │   ├── desktop.ts
│   │   ├── documents.ts
│   │   └── platform.ts
│   ├── specialists/
│   │   └── coding/
│   │       ├── index.ts
│   │       ├── prompts.ts
│   │       └── runner.ts
│   └── tools/
│       ├── index.ts
│       ├── tool-contract.ts
│       ├── base/
│       │   ├── BaseTool.ts
│       │   ├── index.ts
│       │   └── types.ts
│       ├── cloud/
│       │   ├── index.ts
│       │   ├── agentic/
│       │   │   ├── index.ts
│       │   │   ├── awaitAgents.ts
│       │   │   ├── blackboard.ts
│       │   │   ├── cancelAgent.ts
│       │   │   ├── expandTools.ts
│       │   │   ├── runCodingAgents.ts
│       │   │   ├── skillRead.ts
│       │   │   ├── spawnAgent.ts
│       │   │   └── todoWrite.ts           ← MISCLASSIFIED
│       │   ├── generation/
│       │   │   ├── index.ts
│       │   │   ├── imageGenerate.ts
│       │   │   ├── systemPrompt.ts        ← MISPLACED (belongs in prompts/)
│       │   │   ├── videoGenerate.ts
│       │   │   └── videoStatus.ts
│       │   ├── location/
│       │   │   ├── index.ts
│       │   │   └── userLocation.ts
│       │   ├── network/
│       │   │   ├── index.ts
│       │   │   └── httpRequest.ts
│       │   └── retrieval/
│       │       ├── index.ts
│       │       ├── rag.ts
│       │       ├── ragUtils.ts
│       │       ├── webFetch.ts
│       │       └── webSearch.ts
│       ├── composio/
│       │   ├── index.ts
│       │   ├── ComposioTool.ts
│       │   └── types.ts
│       └── mcp/
│           ├── blocklist.ts
│           ├── index.ts
│           ├── builtin/
│           │   ├── builtinLoader.ts
│           │   ├── memorySchemas.ts
│           │   └── ServiceBindingMCPTool.ts
│           ├── discovery/
│           │   ├── index.ts
│           │   ├── DynamicMCPTool.ts
│           │   └── mcpLoader.ts
│           └── remote/
│               ├── index.ts
│               └── RemoteMCPTool.ts
├── pipeline/
│   ├── assembleMessages.ts
│   ├── dispatch.ts
│   ├── parse.ts
│   ├── preload.ts
│   ├── types.ts
│   ├── userContext.ts
│   └── stream/
│       ├── helpers.ts
│       ├── index.ts
│       ├── llm.ts
│       ├── sync.ts                         ← MISNAMED (is non-streaming path)
│       └── tools.ts
├── server/
│   ├── telemetry.ts
│   ├── types.ts
│   ├── middleware/
│   │   ├── auth.ts
│   │   ├── errors.ts
│   │   ├── response.ts                     ← re-export barrel only
│   │   └── validate.ts
│   ├── providers/
│   │   ├── index.ts
│   │   ├── gatewayAdapter.ts
│   │   └── types.ts                        ← re-export barrel only
│   ├── router/
│   │   ├── index.ts
│   │   ├── classifier.ts
│   │   ├── config.ts                       ← re-export barrel only
│   │   ├── modes.ts                        ← re-export barrel only
│   │   ├── rateTracker.ts
│   │   └── types.ts                        ← re-export barrel only
│   ├── routes/
│   │   ├── admin.ts                        ← re-export barrel only
│   │   ├── chat.ts
│   │   ├── composio.ts                     ← MOVE to MCP worker
│   │   ├── docs.ts
│   │   ├── health.ts                       ← MOVE to gateway
│   │   ├── images.ts                       ← re-export barrel only
│   │   ├── kb.ts
│   │   ├── local.ts
│   │   ├── mcp.ts                          ← MOVE to MCP worker
│   │   ├── memories.ts
│   │   ├── modes.ts                        ← re-export barrel only
│   │   ├── pdf.ts
│   │   ├── workflows.ts                    ← MOVE to agents worker
│   │   └── workflows.ts
│   └── utils/
│       ├── modelParser.ts
│       └── providerUtils.ts
├── tracking/
│   ├── index.ts
│   ├── errors.ts
│   ├── events.ts
│   ├── pricing.ts                          ← MOVE to gateway
│   ├── spans.ts
│   ├── usage.ts
│   └── credits/
│       ├── base.ts                         ← MOVE to gateway
│       ├── index.ts                        ← MOVE to gateway
│       └── openrouter.ts                   ← MOVE to gateway
└── utils/
    ├── r2Signer.ts
    └── retry.ts
```

---

## WHAT EACH FILE DOES

### Root Files

| File | What it does |
|---|---|
| `constants.ts` | Compile-time defaults: app identity, timeouts, model IDs, TTLs, limits. Fine here. |
| `env.ts` | `Env` interface — chat-only bindings: `AI_DB`, `ANALYTICS`, `MEMORY`, `MCP`, `AGENTS`, `GATEWAY`, `CHAT_AGENT`, `RATE_TRACKER_DO`. Fine here. |
| `gatewayEnv.ts` | Shared binding schema for gateway + chat: LLM API keys, Azure/AWS creds, R2, KV, Vectorize, feature flags. Fine as shared. |
| `index.ts` | Hono app entry: CORS, auth middleware, all HTTP routes registered, cron jobs (15-min temp image cleanup, daily doc/image cleanup + rate tracker reset). Fine here. |
| `logger.ts` | JSON logger singleton with timestamp/level/worker name. Fine here. |

### context/

| File | What it does |
|---|---|
| `index.ts` | Four request-scoped mechanisms via AsyncLocalStorage: `Env`/`baseUrl`/`ExecutionContext`, request→threadId map, `AgentExecutionContext`, request→ToolRegistry map. These let any deep call site reach env/registry without prop-drilling. Fine here — this is the Cloudflare equivalent of request-scoped injection. |

### durable/

| File | What it does | Decision |
|---|---|---|
| `RateTrackerDurableObject.ts` | Durable Object: atomic per-provider daily request counter. HTTP: `POST /increment?key=`, `GET /count?key=`, `DELETE /usage/cleanup`. Storage key: `{provider}:{YYYY-MM-DD}`. | **Phase 6 (deferred):** Move to gateway. Rate limiting is a gateway concern — it already exports this DO, chat holds it only because of early coupling. The `server/router/rateTracker.ts` client code moves with it. |

### inputs/image/

All 5 files belong here. Well organized.

| File | What it does |
|---|---|
| `types.ts` | `ImageSource` (5 variants), `ResolvedImage`, `VisionPreprocessResult`, `ImageStorageMetadata`. |
| `resolver.ts` | Resolves any `ImageSource` (data URL, HTTPS, R2 key, base64, bytes) → `ResolvedImage`. Enforces `MAX_IMAGE_BYTES`. Never throws. |
| `r2Store.ts` | Two tiers: `storeTempImage()` (TEMP_IMAGES_BUCKET, 1hr TTL) and `storeGeneratedImage()` (IMAGES_BUCKET, 7-day TTL). |
| `pipeline.ts` | Two-pass preprocessing per request: (1) upload pasted images → R2 presigned URLs, (2) promote pasted HTTPS image URLs to `image_url` message parts. |
| `index.ts` | Re-export barrel. |

### orchestration/agent/

All correct, all belong here.

| File | What it does |
|---|---|
| `ChatAgent.ts` | Cloudflare Agents SDK DO entry: WebSocket onMessage/onConnect/onClose. Handles `start` (new turn) and `tool_results` (Tauri relay resume) message types. Runs full pipeline + agent loop. |
| `loop.ts` | Explicit ReAct while-loop. Routes to `specialistStep` if `pendingSpecialist` exists, else `llmStep` → `toolsStep`. Exits on: no tool calls, `localToolsPending`, max iterations. |
| `state.ts` | Plain TypeScript state for loop: messages, tool calls, pending specialist, pending client tool calls, usage captures. No LangGraph. |
| `completion/accumulator.ts` | Captures streamed text chunks via WebSocket intercept. Saves partial responses on client disconnect so they can be resumed or rolled back. |
| `completion/index.ts` | Re-export barrel. |
| `nodes/catalog.ts` | Tool directory builder: `buildToolDirectory()` → lightweight `[Tool Directory]` index; `buildExpandedCatalog()` → grouped catalog with categories. Used by `expand_tools`. |
| `nodes/llm.ts` | LLM step: filters tools contextually, calls provider adapter, handles streaming vs complete, handles expand_tools limit (max 2/turn), records spans and usage. |
| `nodes/specialist.ts` | `runSpecialistStep()`: extracts relay results from latest messages, resumes specialist via `runCodingSpecialistTurn()`, returns relay (more local tools) or done. |
| `nodes/tools.ts` | Tools step: classifies tool calls by target (cloud/local/mcp/specialist), executes cloud tools inline, queues local tools for Tauri, starts specialist relay. Contains main-loop advisory blocking write_file/bash/git_commit. |

### orchestration/prompts/

| File | What it does | Decision |
|---|---|---|
| `guardrails.ts` | Hard constraint string: harm prevention, privacy, security, honesty. Static. | Keep. |
| `personality.ts` | Voice/tone section: calm, direct, restrained, task-first. | Keep. |
| `system.ts` | Assembles static sections (cached) + dynamic sections (per-request). Static: identity, guardrails, personality, decision cascade, planning, agent capabilities, tool discovery, error handling, web, output formatting. Dynamic: skills index, context (time/tz/location), memory, MCP servers, harness, terminal. | Keep. |
| `voice.ts` | Specialized system prompt for TTS: 1–3 sentences, no markdown, spoken numbers. | Keep. |
| `sections/outputFormatting.ts` | Full output format guide (mermaid, latex, html, svg, csv, json, text rules). Added Phase 1. | Keep. |
| `studio/agentRules.ts` | Agent orchestration rules: direct-vs-agents decision, independent agent table, chain (explorer→planner→coder→tester→reviewer) with skip conditions and mandatory context-passing, parallel agent patterns. | Keep. |
| `studio/projectContext.ts` | .studio/ folder spec + project detection branches (empty / known .studio/ / unknown existing). Defines how Studio Local bootstraps project memory. | Keep. |
| `studio/index.ts` | Assembles `studioCodingOverlay()` from agentRules + projectContext. | Keep. |

### orchestration/skills/

Already reorganized in Phase 1. All flat files, correct location.

### orchestration/specialists/coding/

| File | What it does |
|---|---|
| `index.ts` | `PendingCodingSpecialist` type (relay state), `CODING_AGENT_TOOL_SETS` per agent type, `TOOL_NAME_TO_AGENT_TYPE` map, `SpecialistResumePayload` (Tauri-safe subset). |
| `prompts.ts` | Six complete system prompts for explorer, planner, coder, tester, debugger, reviewer — each ~300–400 lines with role definition, tool rules, output format, guardrails. |
| `runner.ts` | One relay iteration: call LLM → classify tool calls (cloud vs local) → execute cloud inline → if local tools needed return relay result → if done return final content. Max 20 cloud-tool iterations per relay turn. |

### orchestration/tools/base/

| File | What it does |
|---|---|
| `BaseTool.ts` | Abstract base all tools extend. `normalizeSchema()` for cross-provider JSON Schema compliance (strips incompatible fields, anyOf→enum, strict mode). `toDefinition()`, `toLLMDefinition()`, `successResult()`, `errorResult()`. |
| `types.ts` | `ExecutionTarget` (cloud/local/mcp/remote_mcp/client), `ToolGroup`, `ToolTier` (1=always-on, 2=behind expand), `ToolContext`, `Tool` interface. |
| `index.ts` | Re-export barrel. |

### orchestration/tools/cloud/agentic/

| File | What it does | Decision |
|---|---|---|
| `spawnAgent.ts` | Spawns omni/coding sub-agents in studio-agents worker. Actions: spawn, list, status. Returns immediately; paired with awaitAgents. Tier 2. | Keep. |
| `awaitAgents.ts` | Polls sub-agents for completion. Returns results. Tier 2. | Keep. |
| `cancelAgent.ts` | Signals running sub-agent to stop. Tier 2. | Keep. |
| `blackboard.ts` | `write_to_blackboard` / `read_from_blackboard` — shared KV across agents in same request (DO-backed SQLite). Tier 2. | Keep. |
| `expandTools.ts` | Meta-tool for tool discovery. Not a registered tool — intercepted by llm.ts. Index calls free; expansion max 2/turn. | Keep. |
| `runCodingAgents.ts` | Six specialist agent tools: run_explorer_agent, run_planner_agent, run_coder_agent, run_tester_agent, run_debugger_agent, run_reviewer_agent. `execute()` returns stub error — actual execution is intercepted by toolsNode before registry.execute(). Requires localEngineConnected. Tier 2. | Keep. |
| `skillRead.ts` | Loads full skill content by key. Tier 1. | Keep. |
| `todoWrite.ts` | **Client-native UI state manager** — updates React checklist in STUDIO frontend. `executionTarget: "client"`. Returns stub error on server-side call. NOT an agent-coordination tool. | **MOVE to `tools/cloud/client/todoWrite.ts`** (new `client/` directory for client-native tools). |
| `index.ts` | Re-export barrel. | Update after todoWrite move. |

### orchestration/tools/cloud/generation/

| File | What it does | Decision |
|---|---|---|
| `imageGenerate.ts` | text→image, edit, multi-ref, typography via GATEWAY binding. Tier 2. | Keep. |
| `videoGenerate.ts` | text→video or image→video via fal.ai. Returns jobId. Async. Tier 2. | Keep. |
| `videoStatus.ts` | Polls fal.ai for video job status. Returns URL when complete. Tier 2. | Keep. |
| `systemPrompt.ts` | Generation tool instructions: when/how to use image vs video generation. Injected via expand_tools groupPrompt mechanism. | **MOVE to `orchestration/prompts/sections/generation.ts`**. A system-prompt-like content file has no business living inside a tools directory. Update import in imageGenerate.ts / wherever it's consumed. |
| `index.ts` | Re-export barrel. | Update after systemPrompt move. |

### orchestration/tools/cloud/location/ + network/ + retrieval/

All correct, all belong here.

| File | What it does |
|---|---|
| `location/userLocation.ts` | Client-native geolocation (browser navigator.geolocation). Reverse geocode. executionTarget: "client". |
| `network/httpRequest.ts` | Generic HTTP client (GET/POST/PUT/PATCH/DELETE). Uses plain JSON Schema (not TypeBox) to work around Groq strict validation. |
| `retrieval/webSearch.ts` | Tavily (primary) + Brave (fallback) web search. Returns AI-synthesized answer + results. Tier 1. |
| `retrieval/webFetch.ts` | Fetch URL, clean content, auto-index to RAG if >16KB. Returns session_id. Tier 1. |
| `retrieval/rag.ts` | index/query/toc with chapter+section filtering. Uses VECTORIZE + AI. Tier 1. |
| `retrieval/ragUtils.ts` | Text chunking, chapter/section detection, embedding batching, ToC generation. Internal helper. |

### orchestration/tools/composio/

| File | What it does | Decision |
|---|---|---|
| `ComposioTool.ts` | Thin tool proxy: on execute() calls `env.MCP.fetch("http://studio-mcp/internal/composio/execute")`. Has NO D1 logic — execution fully delegated to MCP worker. | Keep tool definition in chat. The execution already goes to MCP worker. Tool schema/discovery stays here. |
| `types.ts` | ComposioConnection, ComposioAction, ComposioUserConfig, ComposioAppSummary. | Keep. |
| `index.ts` | Re-export barrel. | Keep. |

### orchestration/tools/mcp/

| File | What it does | Decision |
|---|---|---|
| `blocklist.ts` | Blocks Studio Harness tools from cloud agents: write_file, edit_file, bash, repl, git_commit, get_coding_guide, sleep. These are local-only execution tools. | Keep. |
| `builtin/memorySchemas.ts` | Hardcoded JSON Schema for 11 studio-memory tools: memory_recall, memory_search, memory_recent, memory_profile, memory_note, memory_relate, memory_timeline, memory_list, memory_delete, memory_forget, memory_stats. | Keep — static schemas that define tool interface. |
| `builtin/ServiceBindingMCPTool.ts` | Wraps studio-memory (and future built-in MCP servers) via CF service binding. Sends MCP JSON-RPC via `binding.fetch()`. Handles both JSON and SSE response streams. | Keep in chat for now — it's the orchestration layer for built-in servers. The execution goes through the MEMORY service binding, not local HTTP. |
| `builtin/builtinLoader.ts` | Instantiates ServiceBindingMCPTool for each tool in each built-in server. Currently: studio-memory only (MEMORY binding). | Keep. |
| `discovery/DynamicMCPTool.ts` | Stub for user-installed local MCP tools. executionTarget: "mcp" — deferred to Tauri. `allowInSubAgent = false`. | Keep. |
| `discovery/mcpLoader.ts` | Queries D1 for user's enabled servers, fetches manifests from KV, creates DynamicMCPTool (local) or RemoteMCPTool (remote) instances. Discovery only — no install/admin. | Keep. |
| `remote/RemoteMCPTool.ts` | HTTP MCP client: Streamable HTTP (primary) + Legacy SSE (fallback). Handles JSON-RPC, auth, timeouts from tool-contract. 300 lines. executionTarget: "remote_mcp". | Keep in chat for now — it IS the orchestration proxy for user-remote-MCP, not a worker-level executor. The HTTP calls go to user's own external MCP servers. |
| `index.ts`, `discovery/index.ts`, `remote/index.ts` | Re-export barrels. | Keep. |

### pipeline/

All belong here. The pipeline is the heart of chat.

| File | What it does |
|---|---|
| `parse.ts` | Validates ChatRequest, routes "auto" model via Router, extracts provider:modelId, fetches model capabilities (supportsTools, supportsVision, type) from MODELS_KV. |
| `userContext.ts` | JWT verification or x-user-id (service binding path only). Platform detection. Geo context from CF headers. localEngineConnected detection. |
| `preload.ts` | Parallel fetch: (1) STUDIO Memory context via `env.MEMORY.fetch("/inject")`, (2) MCP tools from D1+KV, (3) Composio tools via `env.MCP.fetch("/internal/tools/composio")`, (4) built-in MCP tools (sync). Merges into ToolRegistry. Also fires background `fireMemoryProcess()` (last 30 messages → MEMORY worker). |
| `assembleMessages.ts` | Builds system prompt + merges messages. Two paths: Studio main chat (full orchestration prompt + client context), sub-agents (honor their own system prompt). |
| `dispatch.ts` | Request setup: generates requestId, conversationFingerprint, threadId. Stores ToolRegistry in context maps. Handles local model dispatch (returns `local_inference_required` payload). |
| `types.ts` | `ChatPipelineContext` — mutable context object threaded through all stages. |
| `stream/index.ts` | SSE Response with ReadableStream. Manages inactivity timeout (60s), absolute timeout (8min), keepalive heartbeat. Orchestrates Phase 1 → Phase 2. Cleanup in finally. |
| `stream/llm.ts` | Phase 1: streams tokens to client immediately (real TTFT). Returns tool calls for Phase 2. |
| `stream/sync.ts` | Non-streaming path. **Name is misleading — should be `nonStreaming.ts`**. Runs agent loop for non-streaming clients. |
| `stream/tools.ts` | Phase 2: runs agent loop with Phase 1 tool calls pre-injected. Also handles specialist relay resume. |
| `stream/helpers.ts` | SSE formatting: sseChunk, safeParseArgs, parseMcpToolName, serializeToolCall, emitToolCompletes. |

### server/middleware/

| File | What it does | Decision |
|---|---|---|
| `auth.ts` | `extractUserId()` wrapping `verifyBearerToken()` from gateway. Chat-specific user ID extraction. | Keep. |
| `errors.ts` | `handleError()` — catches any error, returns OpenAI-compatible 500 JSON with CORS. | Keep. |
| `response.ts` | Re-export barrel from `@gateway/middleware/response`. No local logic. | **Delete barrel, import from gateway directly at call sites.** |
| `validate.ts` | `parseJsonBody()`, `requireFields()`, `requireArray()` — request validation helpers. | Keep. |

### server/providers/

| File | What it does | Decision |
|---|---|---|
| `gatewayAdapter.ts` | `ProviderAdapter` implementation that calls gateway via service binding. Non-streaming: POST → `/v1/chat/completions`. Streaming: same with `stream: true` + SSE parsing. Sends `x-internal: 1` so gateway doesn't double-count usage. | Keep — this is correct. Chat always calls LLM through gateway. |
| `index.ts` | Wraps `createProvider()`: if `env.GATEWAY` binding → uses GatewayAdapter with telemetry error reporter; else (local dev) → calls gateway's `_createProvider()` directly. | Keep — this dev/prod split is intentional. |
| `types.ts` | Re-export barrel from `@gateway/providers/types`. | **Delete barrel, import from gateway directly.** |

### server/router/

| File | What it does | Decision |
|---|---|---|
| `classifier.ts` | Zero-latency tier classifier. Five tiers (extreme/advanced/complex/standard/simple). Signals: token count, tool rounds, first message, keywords, message length. | Keep in chat — classification is per-request and feeds parse.ts. |
| `config.ts` | Re-export barrel from `@gateway/services/router/config`. | **Delete barrel, import from gateway directly.** |
| `index.ts` | `Router` class: `resolveAutoConfig()` (60s TTL KV cache), `decide()` (classify + check rate budgets), `recordRequest()`. | Keep in chat — this is the auto-router that chat calls per request. |
| `modes.ts` | Re-export barrel from `@gateway/services/router/modes`. | **Delete barrel, import from gateway directly.** |
| `rateTracker.ts` | `RateTracker` class: client for RateTrackerDurableObject. `isUnderBudget(provider)` + `recordRequest(provider)`. Falls back to MODELS_KV in dev/preview (non-atomic). | Keep for now. Moves with RateTrackerDO in Phase 6. |
| `types.ts` | Re-export barrel from `@gateway/services/router/types`. | **Delete barrel, import from gateway directly.** |

### server/routes/

| File | Routes | Decision |
|---|---|---|
| `chat.ts` | POST /v1/chat/completions | **Keep** — core orchestrator. |
| `docs.ts` | POST /v1/docs/index, DELETE /v1/docs/{id} + cron cleanup | **Keep** — session RAG, chat-side. |
| `kb.ts` | GET /v1/kb, POST /v1/kb/index, DELETE /v1/kb/{id} | **Keep** — persistent knowledge base, chat-side. |
| `local.ts` | POST /v1/chat/save, POST /v1/tool-execute | **Keep** — local model integration. |
| `memories.ts` | GET /v1/memories, DELETE /v1/memories/{id} | **Keep** — proxies MEMORY binding, chat context layer. |
| `pdf.ts` | POST /v1/pdf/upload, DELETE /v1/pdf/{id} | **Keep** — PDF → presigned R2 URL for Claude document API. |
| `composio.ts` | All /composio/* | **Phase 3: MOVE to MCP worker** — thin proxy to studio-mcp. Has no chat logic. |
| `mcp.ts` | All /mcp/* | **Phase 3: MOVE to MCP worker** — thin proxy to studio-mcp. Has no chat logic. |
| `workflows.ts` | /v1/agent-workflows/* + WS /v1/agents/stream/{type}/{doId} | **Phase 3: MOVE to agents worker** — thin proxy to studio-agents with auth injection. |
| `health.ts` | GET /health | **Phase 3: MOVE to gateway** — infrastructure probe, not chat logic. |
| `admin.ts` | (none — re-export barrel) | **Delete barrel**, wire gateway route directly. |
| `images.ts` | (none — re-export barrel) | **Delete barrel**, wire gateway route directly. |
| `modes.ts` | (none — re-export barrel) | **Delete barrel**, wire gateway route directly. |

### server/utils/

| File | What it does |
|---|---|
| `modelParser.ts` | Parses model strings, extracts provider:model:variant. |
| `providerUtils.ts` | Provider utility helpers (normalize provider name, etc.). |

Both belong here.

### server/telemetry.ts + types.ts

| File | What it does |
|---|---|
| `telemetry.ts` | Records to CF Analytics Engine ("studio-errors" dataset). Non-blocking. Event types: unhandled_error, tool_failure, provider_error, request_timeout, stream phase failures, rate_limit_hit, auth_failure. |
| `types.ts` | Wire-format types: ToolCall, AgentMessage, ChatMessage, ChatRequest, ChatResponse, ToolDefinition, Model, ProviderContract, HealthResponse, TranscribeRequest/Response. |

Both belong here.

### tracking/

| File | What it does | Decision |
|---|---|---|
| `events.ts` | Canonical `AIEvent` union type + `emit()` to TRACKER binding. Fire-and-forget. `ctx.waitUntil()` when available. | **Keep in chat** — tracks chat-specific events (streaming, agent, memory, provider). |
| `errors.ts` | `emitError()` convenience wrapper (severity=error). | **Keep in chat**. |
| `usage.ts` | `recordUsage()` — token counts, cost, latency to `https://tracker/ingest/usage`. | **Keep in chat** — tracks chat-side AI usage. |
| `spans.ts` | Lightweight custom spans (NOT OpenTelemetry). `spanStart()` + `spanEnd()` to `https://tracker/ingest/span`. Per-runId execution tree for dashboard. | **Keep in chat** — tracks agent loop spans. |
| `index.ts` | Unified import point: emit, recordUsage, emitError, fetchAllCredits, estimateCostUsd, spanStart, spanEnd. | **Keep — update exports after credits/pricing move.** |
| `pricing.ts` | Dynamic cost estimation. Priority: (1) provider-returned cost, (2) MODELS_KV lookup (`pricing:{provider:modelId}`), (3) null. Does NOT call gateway. | **Phase 2: MOVE to gateway**. Pricing is a gateway billing concern. Gateway already owns MODELS_KV. |
| `credits/base.ts` | `CreditProvider` interface + `ProviderCreditResult` type. | **Phase 2: MOVE to gateway**. |
| `credits/index.ts` | Credit balance fetcher. Queries OpenRouter API → caches in CREDITS_KV → writes to TRACKER. Called by gateway/routes/tracking.ts. | **Phase 2: MOVE to gateway**. |
| `credits/openrouter.ts` | OpenRouter credit fetcher: GET /api/v1/credits, computes balance. | **Phase 2: MOVE to gateway**. |

### utils/

| File | What it does |
|---|---|
| `r2Signer.ts` | AWS SigV4 presigned URLs for R2 object access via aws4fetch. |
| `retry.ts` | Exponential backoff retry for async functions. Retries on network errors + HTTP 5xx. Does not retry 4xx. |

Both belong here.

---

## DECISIONS SUMMARY

### Phase 2 — Tracking split + route moves + structural fixes

**2A. Move `tracking/credits/` + `tracking/pricing.ts` → gateway**
- `tracking/credits/base.ts` → `gateway/src/tracking/credits/base.ts`
- `tracking/credits/index.ts` → `gateway/src/tracking/credits/index.ts`
- `tracking/credits/openrouter.ts` → `gateway/src/tracking/credits/openrouter.ts`
- `tracking/pricing.ts` → `gateway/src/tracking/pricing.ts`
- Update `tracking/index.ts` exports (remove fetchAllCredits, estimateCostUsd)
- Update `tracking/usage.ts` (imports estimateCostUsd from gateway now)
- Update wherever gateway calls these (already calls via tracking/index.ts)

**2B. Move generation system prompt → proper prompts location**
- `orchestration/tools/cloud/generation/systemPrompt.ts` → `orchestration/prompts/sections/generation.ts`
- Update import in generation tools (imageGenerate.ts, wherever it's consumed)

**2C. Move todoWrite → client tools directory**
- `orchestration/tools/cloud/agentic/todoWrite.ts` → `orchestration/tools/cloud/client/todoWrite.ts`
- Create `orchestration/tools/cloud/client/index.ts`
- Update `orchestration/tools/cloud/agentic/index.ts` (remove todoWrite)
- Update `orchestration/tools/cloud/index.ts` (add client/ barrel)
- Update `orchestration/tools/index.ts` ToolRegistry registration

**2D. Rename sync.ts → nonStreaming.ts**
- `pipeline/stream/sync.ts` → `pipeline/stream/nonStreaming.ts`
- Update import in `pipeline/stream/index.ts`

**2E. Delete pointless re-export barrels (import from gateway directly)**
- `server/middleware/response.ts` — delete, update call sites
- `server/providers/types.ts` — delete, update call sites
- `server/router/config.ts` — delete, update call sites
- `server/router/modes.ts` — delete, update call sites
- `server/router/types.ts` — delete, update call sites
- `server/routes/admin.ts` — delete, wire gateway route in index.ts directly
- `server/routes/images.ts` — delete, wire gateway route in index.ts directly
- `server/routes/modes.ts` — delete, wire gateway route in index.ts directly

### Phase 3 — Route moves to correct workers

- `server/routes/composio.ts` → MCP worker (thin proxy, no chat logic)
- `server/routes/mcp.ts` → MCP worker (thin proxy, no chat logic)
- `server/routes/workflows.ts` → agents worker (thin proxy + auth injection)
- `server/routes/health.ts` → gateway (infrastructure probe)

### Phase 6 (deferred — previously agreed)

- `durable/RateTrackerDurableObject.ts` → gateway worker
- `server/router/rateTracker.ts` moves with it

---

## ISSUES THAT DON'T NEED THEIR OWN PHASE

These are small and can be fixed inline during Phase 2-3 work:

1. **`server/utils/modelParser.ts` + `providerUtils.ts`** — check if these are actually used or if they duplicate gateway utilities.
2. **`mcp/discovery/mcpLoader.ts`** — D1 query `WHERE user_id = ? AND enabled = 1` has no composite index on `(user_id, enabled)` — could be slow with many users/servers. Flag for DB migration.
3. **`mcp/builtin/builtinLoader.ts`** — silently skips servers with missing bindings (no admin warning). Should log.
4. **`context/index.ts`** — the request→ToolRegistry map is module-level (`Map<requestId, ToolRegistry>`). If a request leaks (exception before cleanup), the registry stays in memory indefinitely. Ensure `dispatch.ts` always cleans up in finally.

---

## WHAT IS CORRECT AND SHOULD NOT BE TOUCHED

- `orchestration/agent/` — ChatAgent, loop, state, nodes, completion. Architecture is correct.
- `orchestration/specialists/coding/` — renamed from localAgents, content is correct.
- `orchestration/prompts/` — system, guardrails, personality, voice, studio/. All correct.
- `orchestration/skills/` — flat files post-Phase-1. Correct.
- `orchestration/tools/base/` — BaseTool, types. Foundation, correct.
- `orchestration/tools/composio/` — thin proxy tools to MCP worker. Correct to keep definitions here.
- `orchestration/tools/mcp/` — discovery (DynamicMCPTool, mcpLoader) and builtin (ServiceBindingMCPTool, memorySchemas) are orchestration-layer code. Correct here.
- `pipeline/` — all stages correct. Pure request orchestration.
- `inputs/image/` — R2 upload + vision preprocessing. Correct.
- `tracking/events.ts`, `tracking/usage.ts`, `tracking/errors.ts`, `tracking/spans.ts` — chat-side observability. Correct here.
- `utils/retry.ts`, `utils/r2Signer.ts` — utilities. Correct here.
- `server/middleware/auth.ts`, `errors.ts`, `validate.ts` — request middleware. Correct here.
- `server/providers/gatewayAdapter.ts`, `providers/index.ts` — provider wiring. Correct.
- `server/router/classifier.ts`, `router/index.ts`, `router/rateTracker.ts` — auto-router. Correct for now.
- `server/routes/chat.ts`, `docs.ts`, `kb.ts`, `local.ts`, `memories.ts`, `pdf.ts` — core chat routes. Correct.
- `constants.ts`, `env.ts`, `gatewayEnv.ts`, `logger.ts`, `index.ts` — root config. Correct.
