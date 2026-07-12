# AI Guide — `studio-ai` Build Guide

> This is the single source of truth for building `ai-v2/` (the future `studio-ai` worker).
> It mirrors the discipline of `../gateway-v2/GATEWAY_GUIDE.md`: cold-start readable, plain
> English, decisions locked once so implementation is mechanical.
>
> The old chat worker was audited inline across `../CHAT_REFACTOR_PLAN.md`,
> `../CHAT_REFACTOR_V2.md`, `../CHAT_REFACTOR_V3.md`, and `../SYSTEM_ARCHITECTURE.md`.
> Every decision below traces to a real coupling problem found there; "Why" notes cite the
> specific file or section.
>
> **Status:** greenfield. Nothing is built yet. Phase 0 has not started.
> **First capability:** one interactive chat turn, end-to-end (WS connect → loop → stream → done).
> **Golden rule:** no rush. One capability at a time, done properly, with tests.

---

## 0. The seven decisions that shape everything

These were decided by the project owner and are not open for re-litigation while building:

1. **`studio-ai` is pure compute.** It owns no user data. No R2 buckets, no D1 tables of its
   own, no Vectorize indexes. It orchestrates; it does not persist. See §2.
2. **The Cloudflare Agents SDK (`agents` npm package) is removed.** No `class extends Agent`.
   No `routeAgentRequest`. The DO + hibernation model is replaced by a swappable
   `SessionBackend` interface with two implementations (cloud D1 + local SQLite). See §3.
3. **The Vercel AI SDK stays — but only behind `studio-gateway`.** `studio-ai` never imports
   `@ai-sdk/*` directly. LLM inference is a service-binding call to `studio-gateway`, same as
   today. The AI SDK's job is the provider layer; `studio-ai`'s job is the loop. See §4.
4. **The WebSocket message protocol is frozen.** `start` / `tool_results` / `stream` /
   `tool_start` / `tool_complete` / `local_tools_pending` / `done` / `error` /
   `vision_substitutions`. The Tauri client and Rust WS code do not change. See §5.
5. **Attachments are pre-uploaded by the client (Pattern A).** The client POSTs the image to
   `api → studio-data` first, gets a URL back, then sends the WS `start` message with that URL
   inline. `studio-ai` never sees base64 image payloads and never runs `preprocessVision`.
   See §6.
6. **Local-first is a first-class target, not a port.** The same `studio-ai` code runs in a
   Cloudflare Worker (cloud) and in a Node/Bun sidecar bundled into the Tauri app (local).
   The only thing that swaps is the `SessionBackend` implementation and the `studio-gateway`
   transport. See §3 + §7.
7. **`studio-agents` stays a separate worker.** Background autonomous agents (OmniAgent,
   CodingAgent, scheduled runs, cron) have a different lifecycle from interactive chat
   (long-running vs WS-bounded, checkpointed vs ephemeral). Merging them adds complexity to
   save one process. See §10.

---

## 1. Authentication — there is none, on purpose

Same rule as `gateway-v2/GATEWAY_GUIDE.md §1`. The `api` worker is the only public entry point;
it verifies the caller against the `auth` worker and only then forwards internally. `studio-ai`
is only ever reached by trusted sibling workers (cloud) or by the Tauri app itself over
localhost (local). **Do not add JWT checks, bearer middleware, or `REVOKED_KV` bindings.**

> The old chat worker's `middleware 4` (auth gate on public requests) was doing redundant work
> that `api` already did. It carried over only because `studio-chat` was accidentally
> public-reachable in some dev configurations. `studio-ai` is `workers_dev = false` with no
> routes — same as the gateway.

**One caveat for local mode:** the Tauri sidecar listens on `127.0.0.1` only. No network
exposure, no auth needed. Documented as a trust assumption rather than defended against.

---

## 2. Scope — what is and is NOT `studio-ai`'s job

The single most important section. The old chat worker accumulated ~12 HTTP routes that have
nothing to do with running an agent loop. That stops here.

### IN scope

- Accept a WebSocket connection per conversation (`/agents/chat/{conversationId}`).
- Run the ReAct (Reason + Act) loop: LLM step → tool step → emit → repeat.
- Stream tokens back to the client in real time over the WebSocket.
- Orchestrate cloud tools (run in-process) and local/MCP tools (relay to Tauri and wait).
- Relay specialist sub-agents (coding explorer/planner/coder/tester/debugger/reviewer) that
  need local file tools, same `local_tools_pending` mechanism as today.
- Persist the "pending messages" buffer needed for the bandwidth optimization (client sends
  ~1KB tool results on resume, not the full 70KB history). See §5.
- Persist a small "completed content" ring buffer so a reconnecting client can fetch the
  last turn they missed (`GET /agents/chat/{id}/completed`).
- After each completed turn, fire a fire-and-forget memory distillation call to
  `studio-memory`.
- Decide which model a request should use, based on user tier + admin mode config (the
  "model tier router" — currently `server/services/router/` in the old chat worker). This runs
  as a step inside the loop, before handing to `studio-gateway`. See §9.
- Save the completed conversation turn to `studio-data` (one service-binding call per turn).
  `studio-ai` does not own the R2 key format — `studio-data` does.

### OUT of scope — do not build these here

| Out-of-scope thing | Why | Where it goes |
|---|---|---|
| **PDF upload / delete** | Blob storage, not AI | `api → studio-data` |
| **Image serve / delete** (R2 GET) | Blob storage | `api → studio-data` |
| **Document upload / delete** | Blob storage | `api → studio-data` |
| **Vision preprocessing** (base64 → R2 presigned URL rewriting) | Client pre-uploads now (§6); messages already contain URLs | Disappears |
| **Image / temp-image cleanup crons** | Blob lifecycle | `studio-data` (owns the buckets it cleans) |
| **Docs index / KB list+delete** | Vectorize ingestion is `studio-memory`'s job | `api → studio-memory` |
| **Memories list / delete** | Memory is a domain worker | `api → studio-memory` (already does) |
| **Local chat save** (`POST /v1/local/chat/save`) | Conversation persistence | `api → studio-data` (or `studio-ai` calls `studio-data` itself at turn end) |
| **Local tool execute callback** (`POST /v1/local/tool/execute`) | Replaced by the WS `tool_results` message — the HTTP relay was a workaround for the old architecture | Disappears |
| **Modes config (GET/PUT `/v1/modes`, `/v1/admin/modes-config`)** | User preference, not AI logic | `studio` (preferences worker) — already owns D1 |
| **MCP connection CRUD** | Already lives in `studio-mcp` | `studio-mcp` (unchanged) |
| **Composio connection CRUD** | Already lives in `studio-mcp` | `studio-mcp` (unchanged) |
| **Provider API keys** | Gateway's concern | `studio-gateway` (BYOK via CF AI Gateway in v2) |
| **Model discovery / catalog** | Gateway's concern | `studio-gateway` (every 6h cron) |
| **Image / video / audio generation** | Gateway routes to fal/CF/etc. | `studio-ai` calls `studio-gateway` as a cloud tool, gets bytes back, calls `studio-data` to save the result |

**Litmus test:** if a feature is about *storing*, *displaying*, *listing*, *authenticating*,
or *configuring*, it is not `studio-ai`'s job. If removing it still leaves "run one chat turn
over WebSocket" working, it doesn't belong here.

**One nuance worth calling out:** generated media (an `image_generate` tool result) does flow
through `studio-ai` — the loop calls the gateway, gets bytes back, and must persist them. But
this is a one-line service-binding call ("save this blob, return a URL") to `studio-data`. The
contract is "give me bytes, give me a URL" — `studio-ai` never learns the bucket name or key
format. That is not owning storage; that is calling a service.

---

## 3. Transport & state — the `SessionBackend` interface

This is the biggest architectural change from the old chat worker, and it's what unlocks
local-first. The old `ChatAgent` extended `Agent<Env, ChatAgentState>` from the `agents` npm
package — a Durable Object with SQLite-backed state, hibernation, and WebSocket lifecycle
hooks. That class IS the Cloudflare lock-in. Replacing it is the point of v2.

### The interface

`studio-ai` defines one interface — `SessionBackend` — and two implementations. The agent loop
talks only to the interface. swapping cloud ↔ local is swapping the implementation.

```
SessionBackend {
  // WebSocket transport
  attach(server): void                              // wire WS upgrade to onMessage/onClose
  send(connection, data: string): void              // emit a protocol frame
  onClose(connection, handler): void                // react to disconnect

  // Per-session state (the only thing the loop needs to persist)
  loadSession(conversationId): SessionState | null
  saveSession(conversationId, state: SessionState): Promise<void>
  clearSession(conversationId): Promise<void>

  // Offline catch-up buffer (small ring of completed turns)
  getCompleted(conversationId): string | null
  setCompleted(conversationId, content: string | null): Promise<void>
  clearCompleted(conversationId): Promise<void>

  // Keep-alive after WS close (so a turn finishes even if the client disconnects)
  waitUntil(promise: Promise<unknown>): void
}
```

That's the entire surface. The agent loop (`loop.ts`) is unchanged from v1 — it still takes
`enqueue: (data: string) => void` and runs the same `while(true)` ReAct loop. The backend just
decides where bytes go and where state lives.

### Two implementations

| | CloudSessionBackend | LocalSessionBackend |
|---|---|---|
| Where runs | Cloudflare Worker (`studio-ai`) | Tauri sidecar (Node or Bun) |
| WebSocket | Hono `upgrade` handler in the Worker | `ws` (Node) or `Bun.serve({ websocket })` |
| State store | D1 (`AI_DB`, already shared with `studio-agents`) | `better-sqlite3` file under Tauri app data |
| Offline catch-up | Same D1, one row per conversation | Same SQLite file, one row per conversation |
| `waitUntil` | `ctx.waitUntil(p)` from the Worker fetch handler | Process stays alive naturally — no-op shim |
| Hibernation behavior | Worker isolate can be evicted between WS messages; state survives in D1 | Process never hibernates; state survives in SQLite |
| Concurrency model | One DO per conversation (singleton, serialized) | One in-process Map per conversation; OS-level isolation across users |

### Two non-negotiable properties the interface must guarantee

1. **State survives process death.** Whether the cloud Worker isolate gets evicted or the local
   sidecar crashes, the next WS reconnect must be able to `loadSession(conversationId)` and
   resume the loop from the stored `pendingMessages`. This is the bandwidth optimization
   (§5) — it only works if state is durable.
2. **One writer per conversation at a time.** In cloud, the DO singleton enforced this for free.
   In v2, the `SessionBackend` must reject a second `start` while one is running (return 409 or
   the equivalent). The implementation decides how (D1 row lock, in-process Map, etc.).

### What disappears with the DO

- `class ChatAgent extends Agent<...>` — replaced by a plain function or class implementing the
  backend interface
- `routeAgentRequest` import (`agents` SDK) — WS routing handled by Hono directly
- `this.setState` / `this.state` — replaced by `saveSession` / `loadSession`
- `this.ctx.waitUntil` — replaced by `backend.waitUntil`
- `getCurrentAgent()` / `getChatAgent()` SDK exports — tools that need the backend get it via
  the same request-context store as env (already used by `runWithEnv` in v1)
- Migration tombstones for deleted DOs (`AgentStateDurableObject`, etc.) — gone
- `wrangler.toml` `[[durable_objects]]` entries for `CHAT_AGENT` — gone (only `RATE_TRACKER_DO`
  stays, and that's rate limiting not agent state)

---

## 4. The LLM call — via `studio-gateway`, never direct

`studio-ai` never imports `@ai-sdk/*`. It never calls `generateText` or `streamText`. It calls
`studio-gateway` over the `GATEWAY` service binding (cloud) or the local HTTP equivalent
(local), speaking the OpenAI-compatible `POST /v1/chat/completions` shape — exactly the contract
`GatewayAdapter` and `GatewayLLMClient` already use today.

```
studio-ai agent loop
  │
  │  adapter.streamFull({ model, messages, tools, ... })
  │
  ▼
GatewayAdapter (in chat/src/server/providers/index.ts — unchanged in v2)
  │
  │  POST http://studio-gateway/v1/chat/completions
  │  body: { model, messages, tools, tool_choice, temperature, ... }
  │  headers: { x-user-id, x-agent: true }
  │
  ▼
studio-gateway (v1 today, v2 later)
  │
  │  routes to OpenAI / Anthropic / Groq / Google / ...
  │  (v2: through Cloudflare AI Gateway with BYOK aliases)
  │
  ▼
AI vendor
```

**Why this matters for v2 of `studio-ai`:** the gateway swap from v1 → v2 changes nothing in
`studio-ai`. The gateway keeps the same `/v1/chat/completions` route and request/response
shape (`GATEWAY_GUIDE.md §9`). The only thing that changes is *how the gateway reaches the
vendor* (direct keys in v1, CF AI Gateway + BYOK in v2). That's invisible to `studio-ai`. So
you can build `studio-ai` today and adopt `gateway-v2` later without touching the loop.

### Local-mode transport

When running locally, `studio-gateway` runs in the same sidecar (or a sibling process) and uses
`directKeys` transport (`GATEWAY_GUIDE.md §3.8`) — vendor API keys read from local env, no CF
AI Gateway hop. The `GATEWAY` "service binding" becomes a `fetch("http://localhost:PORT/...")`
call. From `studio-ai`'s perspective the contract is identical: POST to a URL, get a stream
back. The transport picks based on environment.

### What stays from v1

- The `GatewayAdapter` wrapper class (`chat/src/server/providers/gatewayAdapter.ts`) — keeps the
  error-reporting hook and lets `studio-ai` swap cloud service-binding vs local HTTP without the
  loop knowing
- The `createProvider()` factory (`chat/src/server/providers/index.ts`) — picks GatewayAdapter
  when `env.GATEWAY` is bound, falls back to direct adapter construction otherwise. The fallback
  path is what local mode uses
- The `CapturedUsage` shape — token accounting reported back to the loop for tracker forwarding
- The streaming protocol — `streamFull()` yields `{ type: "content" | "reasoning" |
  "tool_calls" | "usage" }` events, same as `chat/src/agent/steps/llm.ts:195` consumes today

---

## 5. The message protocol — frozen, do not change

This is the wire contract with the Tauri client. Changing it would touch Rust, which is the
most expensive thing to touch. Preserve it exactly.

### Client → `studio-ai` (WebSocket messages)

| Message | Shape | Purpose |
|---|---|---|
| `start` | `{ type: "start", body: ChatRequestBody }` | Begin a new turn: messages, model, temperature, etc. |
| `tool_results` | `{ type: "tool_results", results: ToolResultItem[] }` | Tauri executed local tools and sends ONLY the results — no full history |
| `ping` | `{ type: "ping" }` | Keepalive, no reply needed (sent every 25s by client) |

`ChatRequestBody` is unchanged from `chat/src/agent/ChatAgent.ts:98`: `messages`, `model`,
`stream`, `temperature`, `max_tokens`, `calling_app`, `local_engine_connected`, `user_id`,
`user_profile`, `running_mcp_servers`.

### `studio-ai` → client (JSON strings, sent over WS)

| Event | Shape | When |
|---|---|---|
| `stream` | `{ type: "stream", choices: [{ delta: { content } }] }` | Each token as it's generated |
| `thinking` | `{ type: "thinking" }` | First reasoning chunk (extended thinking models) |
| `thinking_delta` | `{ type: "thinking_delta", chunk }` | Subsequent reasoning chunks |
| `tool_start` | `{ type: "tool_start", callId, tool, args }` | LLM requested a tool call |
| `tool_complete` | `{ type: "tool_complete", callId, tool, result }` | A cloud tool finished |
| `local_tools_pending` | `{ type: "local_tools_pending", messages, toolCalls }` | Local/MCP tools need Tauri execution |
| `vision_substitutions` | `{ type: "vision_substitutions", substitutions }` | Image URL rewrites — DISAPPEARS in v2 (Pattern A, §6) |
| `done` | `{ type: "done" }` | Turn complete |
| `error` | `{ type: "error", error }` | Something went wrong |

### The bandwidth optimization (preserve this)

The single most valuable property of v1's design (`ChatAgent.ts:443`): when the client sends
`tool_results` to resume the loop, it sends only the ~1KB result payloads. `studio-ai`
reconstructs the full message history from its `SessionState.pendingMessages` rather than
requiring the client to re-send 70KB+ of conversation.

`SessionState` (the only thing `studio-ai` persists) is exactly:

```
SessionState {
  pendingMessages: AgentMessage[]             // the in-flight conversation when local tools are pending
  userId: string | null
  modelId: string
  provider: string
  apiBaseUrl: string
  temperature: number
  maxTokens: number | undefined
  localEngineConnected: boolean
  requestId: string
  runningMcpServers: string[]
  completedContent: string | null             // ring buffer for offline catch-up
}
```

Same shape as `ChatAgentState` (`chat/src/agent/ChatAgent.ts:70`), just relocated from
DO-backed SQLite to `SessionBackend.saveSession()`.

### HTTP endpoints (kept, non-WS)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/chat/completions` | Non-streaming LLM inference — same as today, for clients that don't want WS |
| `GET` | `/agents/chat/{conversationId}/completed` | Retrieve the last completed turn (offline catch-up) |
| `DELETE` | `/agents/chat/{conversationId}/completed` | Clear the catch-up buffer after the client stored it |
| `GET` | `/health` | Rich status (§11) |

That's it. Everything else is gone (see §2 OUT table).

---

## 6. Attachments — pre-upload, not in-loop

The old `preprocessVision` step (`ChatAgent.ts:325`) took a client message with inline base64
images, saved each one to R2, and rewrote the message to reference presigned URLs. That coupled
the chat worker to R2's key format and bucket name — exactly the problem v2 fixes.

### The new flow (Pattern A)

```
1. Client pastes image
   │
   │  POST /v1/media/uploads  (multipart or raw body)
   │
   ▼
api → studio-data → R2 (media-uploads bucket) → returns { id, url }

2. Client shows thumbnail in compose box (can edit, delete, retry on failure)

3. Client sends WS "start" with message containing URLs, not base64:
   { messages: [{ role: "user", content: [
       { type: "text", text: "what's in this?" },
       { type: "image_url", image_url: { url: "https://...r2.../{id}" } }
   ]}] }

4. studio-ai's ChatAgent receives the message and runs the loop
   → never sees base64, never touches R2, never imports preprocessVision
```

### Why pre-upload, not in-loop

| Reason | Detail |
|---|---|
| **studio-ai stays pure compute** | No R2 binding, no storage key formats. If `studio-ai` knew how to write to R2, it would own half of `studio-data`'s contract — recreating the v1 coupling |
| **Real upload progress** | The client shows actual upload bytes, not a fake spinner while the loop buffers the whole message |
| **Retry / edit before send** | User can paste, delete, paste again — none of that touches `studio-ai` |
| **Local mode is symmetric** | Tauri "upload" = copy file to `{app_data}/media-uploads/{id}`, return a `file://` or `http://localhost:PORT/media/{id}` URL. Same client code, different transport |
| **It's the modern pattern** | ChatGPT, Claude, Slack, Discord, Linear all pre-upload. v1's inline-base64 was a shortcut, not a design |

### Generated media (different flow — in-loop, but via service binding)

When the agent loop runs the `image_generate` tool, the result is bytes that need a home. This
does flow through `studio-ai`, but only as a one-line call:

```
studio-ai agent loop
  │
  │  tool call: image_generate(prompt, provider, ...)
  │
  ▼
ImageGenerateTool.execute()
  │
  │  GATEWAY.fetch("http://studio-gateway/v1/images/generate") → image bytes
  │
  │  STUDIO_DATA.fetch("http://studio-data/media/generated", { body: bytes })
  │    → returns { url }
  │
  ▼
emit tool_complete with { markdownSnippet: "![image](url)" }
```

`studio-ai` calls `studio-data` with bytes, gets a URL back. It never learns the bucket name
(`media-generated`) or key format (`generated/{userId}/{id}`). The contract is "give me bytes,
give me a URL" — `studio-data` owns everything else.

> This is the same distinction as §2's nuance: calling a service is fine; owning its
> storage contract is not. `studio-ai` is allowed to POST bytes to `studio-data`; it is not
> allowed to know what R2 bucket those bytes land in.

---

## 7. Local-first architecture

The same `studio-ai` code runs in two places. The build target is decided at deploy time, not
code time.

### What runs locally (inside or alongside the Tauri app)

| Component | Cloud | Local |
|---|---|---|
| `studio-ai` (agent loop + WS) | Cloudflare Worker | Node/Bun sidecar process |
| `studio-gateway` (LLM routing) | Cloudflare Worker + CF AI Gateway | Same sidecar or sibling process, `directKeys` transport |
| `studio-memory` (Vectorize + D1) | Cloudflare Worker | Local: `sqlite-vss` or `sqlite-vec` + SQLite file |
| `studio-data` (3 R2 buckets) | Cloudflare Worker + R2 | Filesystem under Tauri app data dir |
| `studio-mcp` (connection registry) | Cloudflare Worker (D1) | Local JSON file or SQLite |
| `studio` (preferences) | Cloudflare Worker (D1) | Local JSON file (existing Tauri settings) |
| `auth`, `api`, `tracker` | Cloud-only | Not needed locally — Tauri is the host |

### Why the loop code is unchanged

The agent loop (`loop.ts`) talks to exactly three things:

1. `enqueue(data)` — the WS send function. `SessionBackend.send` provides this. Same interface
   whether the WS is a Hono upgrade or a `ws` lib socket.
2. `createProvider(...)` — the LLM adapter. In cloud this returns a `GatewayAdapter` wrapping
   the `GATEWAY` service binding. In local this returns a `GatewayAdapter` wrapping a
   `fetch("http://localhost:PORT/")` call. Same class, different fetcher.
3. Tool registry — already environment-agnostic (v1's `registry.getContextualDefinitions()`
   takes `localEngineConnected: boolean` and filters accordingly). No change.

That's it. The loop is three function calls; each one is environment-swappable.

### What "local-first" means for users

- Offline chat works (with cloud models unavailable; local Ollama/LM Studio via
  `studio-gateway`'s `ollama`/`lmstudio` providers).
- Conversations, memories, and uploads persist locally and sync to cloud when connectivity
  returns. (Sync is a future concern — out of scope for v2 build; documented as open decision.)
- The Tauri app is the host process. The sidecar (Node/Bun) is started by Tauri on launch.

### Runtime choice — Node or Bun (open decision §13)

The local sidecar needs a host. Two candidates:
- **Bun** — faster, native WS, supports CF Workers syntax via `Bun.serve` (could theoretically
  run the Worker code near-unchanged). Newer ecosystem.
- **Node** — more mature, more library compatibility, the existing MCP servers
  (`STUDIO/library/mcp-servers/studio-local`) are already Node. Slower WS, requires `ws` lib.

Decision deferred to Phase 0 — does not block the guide or any Phase 1+ work, because the
`SessionBackend` interface hides the choice from the loop.

---

## 8. The tool layer (replaces GATEWAY_GUIDE.md §5 "provider layer")

Tools are how the agent acts on the world. Three categories, same as v1's
`tools/base/types.ts` `executionTarget` field.

### 8.1 Cloud tools (run in-process inside `studio-ai`)

| Tool | What it does |
|---|---|
| `web_search` | Tavily (primary) + Brave (fallback) — unchanged from v1 |
| `web_fetch` | Jina Reader fetch-as-Markdown — unchanged |
| `rag` | Semantic search over user's documents — calls `studio-memory` (was `studio-chat`'s Vectorize directly in v1; now a service binding) |
| `image_generate` | Routes via `studio-gateway`, persists result via `studio-data` (§6) |
| `video_generate`, `video_status` | Async video via fal — unchanged |
| `memory_search`, `memory_save` | Calls `studio-memory` service binding |
| `expand_tools` | Schema-diet mechanism for large MCP tool catalogs — unchanged |
| Code specialist tools (`run_explorer_agent`, `run_planner_agent`, `run_coder_agent`, `run_tester_agent`, `run_debugger_agent`, `run_reviewer_agent`) | Spawn sub-agents in `studio-agents` via service binding — unchanged |

Cloud tools call `studio-gateway` (for LLM-routed generation), `studio-memory` (for RAG/memory),
`studio-data` (for blob persistence of generated media), and `studio-agents` (for specialist
sub-agent spawning). All via service bindings — `studio-ai` itself owns no storage.

### 8.2 Local / MCP tools (relayed to Tauri)

When the LLM calls a tool with `executionTarget: "local"`, `studio-ai` does NOT execute it.
Instead:

1. The loop emits `local_tools_pending` with the tool calls + current message history.
2. `studio-ai` saves `SessionState.pendingMessages` (the bandwidth optimization, §5).
3. The Tauri client receives the event, calls its local MCP server (`studio-local` /
   `studio-harness`), and sends back `{ type: "tool_results", results: [...] }` over the
   WebSocket.
4. `studio-ai` `loadSession`s the pending state, appends only the new tool results (~1KB), and
   resumes the loop.

Same exact flow as v1, just with `SessionBackend.loadSession/saveSession` instead of
`this.state`/`this.setState`.

### 8.3 Dynamically-registered MCP tools

`mcp_*` tools (from user's enabled MCP connections in `studio-mcp`) are registered at run time
via the preload pipeline (v1's `pipeline/preload.ts`). The mechanism is unchanged — `studio-ai`
calls `studio-mcp` to fetch the user's enabled connections, builds tool definitions, and adds
them to the registry. Tool execution for remote MCP servers happens in `studio-mcp`; for local
MCP servers it relays through the same `local_tools_pending` mechanism.

> The v1 blocklist (`tools/mcp/blocklist.ts`) and `expand_tools` diet mechanism both stay. They
> already live in `chat/src/tools/` and are environment-agnostic — no `agents` SDK dependency.

---

## 9. The model tier router — stays in `studio-ai`

Currently `chat/src/server/services/router/` classifies which model a request should use based
on user tier + admin mode config. It needs user context (calls `studio` preferences) AND runs
right before the LLM call. 

**It belongs in `studio-ai`.** It is part of the loop's "decide which model" step, before
handing to `studio-gateway`. Forcing it into a separate worker would mean a round trip per turn
just to ask "which model?" — and the answer depends on per-turn state (user tier, current mode,
fallback chains).

What changes:
- The "admin modes config" it reads moves to `studio` (preferences worker) — see §2 OUT table.
  The router reads it via service binding instead of from local `MODELS_KV`.
- Model discovery moves to `studio-gateway` (already does it via cron, writing to `MODELS_KV`).
  The router reads the catalog from gateway, not from its own KV.

What stays:
- The tier-classification logic
- The fallback chain logic (primary → secondary → tertiary model)
- The per-turn decision (not cached across turns)

---

## 10. The `studio-agents` worker — separate, not merged

| | `studio-ai` | `studio-agents` |
|---|---|---|
| Lifecycle | Per-conversation WebSocket session | Per-run long-lived background process |
| Bound by | Client connection | None — runs to completion or timeout |
| State shape | Ephemeral per-conversation | Checkpointed, resumable |
| Triggered by | Client WS message | REST API call or cron schedule |
| Tool catalog | Cloud + local/MCP relay | Cloud only (no local relay — runs server-side) |
| Persistence | `SessionBackend` (D1 row or SQLite) | Its own DO state (Omni/Coding) — and yes, can also be refactored to a `SessionBackend` later if desired |
| Examples | Interactive chat | Deep research, scheduled coding agents, "find all X and summarize" |

**Why not merge:**
- Different concurrency model (chat needs one-instance-per-conversation serialization; agents
  need N concurrent runs)
- Different tool surface (chat has local/MCP relay; agents only call cloud tools server-side)
- Different failure modes (chat fails fast and tells the user; agents fail slow, retry, checkpoint)
- Different trigger sources (chat = client; agents = cron + REST)

Merging would force one execution model to handle both, adding complexity to save one process.
Keep separate. When v2 reaches the `studio-agents` worker refactor (future, post-`studio-ai`
ship), the same `SessionBackend` pattern can be applied there independently.

---

## 11. Health endpoint — rich status

`GET /health` reports more than "ok":

- version + uptime
- `SessionBackend` reachability (can we read/write D1 / local SQLite right now?)
- `studio-gateway` reachability (the LLM transport backbone)
- `studio-data`, `studio-memory`, `studio-mcp`, `studio-agents`, `studio` service bindings
  reachable?
- Active WS sessions count (gauge)
- Last error (truncated, redacted)

This makes `/health` the one-call operational overview of `studio-ai`, same as the gateway.

---

## 12. Full folder structure

```
ai-v2/
  src/
    core/
      types.ts            # AgentMessage, SessionState, StreamEvent, CompletionParams (freeze v1 shapes)
      sessionBackend.ts   # the SessionBackend interface (§3)
      loop.ts              # the ReAct while-loop — ported from chat/src/agent/loop.ts, unchanged logic
      steps/
        llm.ts            # LLM step — calls createProvider().streamFull(); identical to v1
        tools.ts          # tools step — splits cloud vs local-pending; identical to v1
        catalog.ts        # builds tool definitions from registry; identical to v1
      tracking.ts         # thin span emit to tracker service binding — unchanged
      errors.ts           # one error taxonomy, user-facing, proper HTTP codes (like gateway-v2 §4.4)
      validation.ts       # validate request before the loop starts (catch bad model, missing messages)

    backends/
      cloudSessionBackend.ts    # CloudSessionBackend: Hono WS upgrade + D1 state
      localSessionBackend.ts    # LocalSessionBackend: ws lib + better-sqlite3
      index.ts                  # picks based on env (cloud if env.GATEWAY bound, local otherwise)

    pipeline/             # pre-loop stages (port from chat/src/pipeline/, unchanged logic)
      parse.ts            # parseRequest: model routing ("auto" resolution) — was in chat
      userContext.ts      # extract userId, profile from headers
      preload.ts          # load MCP tool defs from studio-mcp, build tool registry
      systemPrompt.ts     # assemble system prompt from skills + tools
      assembleMessages.ts # merge memory injection + system prompt + user messages

    tools/                # tool registry + cloud tool implementations
      base/               # BaseTool, types, registry (port from chat/src/tools/base/)
      cloud/              # web_search, web_fetch, rag, image_generate, video_*, memory_*, expand_tools
      agentic/            # spawn_agent (Omni/Coding via studio-agents), expand_tools, blackboard
      mcp/                # mcp_* dynamic registration + blocklist (port from chat/src/tools/mcp/)

    skills/               # 5 skill categories loaded via skill_read tool (port from chat/src/skills/)

    specialists/coding/   # coding specialist relay (explorer/planner/coder/tester/debugger/reviewer)
                          # — port from chat/src/agent/specialists/coding/, ACTIVE in v1

    routes/
      chat.ts             # POST /v1/chat/completions (+ WS upgrade at /agents/chat/{id})
      completed.ts        # GET/DELETE /agents/chat/{id}/completed (offline catch-up)
      health.ts          # GET /health

    infrastructure/
      cloudflare/
        env.ts            # the worker's OWN env type (no ../../chat imports — kills audit §L)
      local/
        env.ts            # the local sidecar's env type (filesystem paths, ports)

    index.ts              # wires routes + backends + pipeline. No auth. No storage.

  tests/                  # write tests this time (refactor V3 §N flagged zero tests in chat)
  wrangler.toml           # bindings: GATEWAY, STUDIO_DATA (new), MEMORY, MCP, AGENTS, TRACKER, AI_DB (D1).
                          # NO R2, NO Vectorize, NO KV (gateway owns MODELS_KV/MCP_KV now).
                          # NO durable_objects (RATE_TRACKER_DO stays in some worker if needed).
  package.json            # ai, @ai-sdk/* NOT present — only hono + ws + better-sqlite3 types
  tsconfig.json
  AI_GUIDE.md             # this file
  README.md               # written at Phase 4
```

### Package dependency profile (deliberately minimal)

| Package | Present? | Why |
|---|---|---|
| `hono` | Yes | HTTP + WS upgrade routing |
| `agents` (CF Agents SDK) | **No** — this is the point of v2 | |
| `ai`, `@ai-sdk/*` | **No** — moved to gateway-only | The loop calls gateway via service binding |
| `aws4fetch` | Yes (if Bedrock route is kept in gateway only, no; otherwise no) | Likely gone |
| `better-sqlite3` | Dev dep only (for `LocalSessionBackend` types) | Sidecar ships its own runtime |
| `@cloudflare/workers-types` | Dev dep | For cloud target type defs |
| `wrangler` | Dev dep | For cloud deploy |

If the `package.json` ends up importing `ai` or `agents`, the build is wrong.

---

## 13. Open decisions (revisit when relevant; do not block Phase 0/1)

- [ ] **Local runtime host: Node vs Bun.** Phase 0 picks. Doesn't affect the loop code.
- [ ] **Upload-token scheme:** when the client pre-uploads an attachment, how is the upload
  bound to the eventual conversation? (Simplest: pass the upload IDs in the `start` body and
  let `studio-data` own the association. Token-with-expiry if we want stricter semantics.)
- [ ] **Exact `studio-data` bucket names.** Suggestions: `studio-conversations`,
  `studio-media-generated`, `studio-media-uploads`. Decide when `studio-data` worker is built.
- [ ] **Local sync to cloud.** When a user chats offline then reconnects, do local conversations
  push to cloud `studio-data`? Probably yes, but the conflict-resolution policy (especially for
  edited memories) is out of scope for v2 build. Document the assumption: local is canonical
  offline, cloud is canonical online, last-write-wins on reconnect for v2.
- [ ] **Whether `studio-agents` v2 refactor happens alongside or after `studio-ai` v2.**
  Recommended after — the same `SessionBackend` pattern can be applied to Omni/Coding DOs in
  a follow-up.
- [ ] **Rate limiting.** v1 had `RATE_TRACKER_DO` in the chat worker. Where does it live in v2?
  Cleanest: `api` worker rate-limits at the edge (it already has `DB` for jobs). `studio-ai`
  doesn't rate-limit — `api` does it before forwarding. Flag for v2 build.
- [ ] **Final naming swap:** when v2 reaches parity, delete `chat/`, rename `ai-v2/` → `ai/`.
  Worker `name` flips from `studio-chat` → `studio-ai` — this is a breaking change for the
  `AI` service binding in `api` (must update `wrangler.toml` bindings there too). Plan the
  rename carefully; the CF AI Gateway + BYOK config history stays with `studio-gateway`, not
  with `studio-ai`.

---

## 14. Phase plan

Strict order. Each phase is independently reviewable, ships tests, and leaves `studio-ai`
working for what's been built. **No phase starts until the previous is reviewed.**

### Phase 0 — Skeleton, `SessionBackend` interface, cloud backend

- Scaffold the tree in `ai-v2/`.
- Write `core/` (`types.ts` with `AgentMessage`/`SessionState`/`StreamEvent`/`CompletionParams`
  frozen from v1; `sessionBackend.ts` interface; `errors.ts`; `validation.ts`).
- `infrastructure/cloudflare/env.ts` (own types, no `../../chat` imports).
- `backends/cloudSessionBackend.ts` — Hono WS upgrade + D1 backing for `SessionState`.
- `index.ts` with `/health` wired, no routes.
- `wrangler.toml` — bindings: `AI_DB` (D1, shared), `GATEWAY` (service), `STUDIO_DATA`
  (service, new), `MEMORY` (service), `MCP` (service), `AGENTS` (service), `TRACKER` (service).
  No R2. No KV. No DOs.
- Pick Node or Bun for local runtime (decision recorded in README).
- **Exit:** `npm run build` clean; `/health` 200; `SessionBackend.saveSession` round-trips
  through D1 in a unit test.

### Phase 1 — One interactive chat turn, end to end

- Port `loop.ts` + `steps/llm.ts` + `steps/tools.ts` from v1, unchanged logic.
- Port `pipeline/parse.ts` + `userContext.ts` + `preload.ts` + `systemPrompt.ts` +
  `assembleMessages.ts` from v1.
- Wire `routes/chat.ts`: WS upgrade + `start` handler + stream + `done` event.
- `createProvider()` factory, swappable cloud-service-binding vs local-HTTP.
- Tests: a real Groq chat completion works end-to-end through `studio-gateway`,
  streamed token-by-token to a WS client. One tool call (e.g. `web_search`) round-trips.
- **Exit:** a Клиent can WS-connect, send `start`, receive streaming tokens, and get `done`.

### Phase 2 — `tool_results` resume + offline catch-up

- `tool_results` handler — the bandwidth optimization: `loadSession`, append results, resume.
- `GET / DELETE /agents/chat/{id}/completed` — offline catch-up ring buffer.
- Tests: client disconnects mid-turn, reconnects, fetches `completed`, sees the saved answer.
  Local tool relay (Tauri mock) round-trips ~1KB results.

### Phase 3 — Cloud tool catalog

- Port `tools/base/` + `tools/cloud/` (web_search, web_fetch, rag, image_generate, video_*,
  memory_*, expand_tools, spawn_agent, blackboard).
- Port `tools/mcp/` dynamic registration + blocklist.
- Port `skills/` (5 categories, `skill_read` tool).
- Port `specialists/coding/` relay (unchanged).
- Tests per tool group.

### Phase 4 — Pre-upload attachment flow (Pattern A)

- Coordinate with `studio-data` build: `POST /v1/media/uploads` returns `{ id, url }`.
- Update Tauri client (separate effort): paste → upload → compose → send WS `start` with URL.
- Remove `preprocessVision` from the pipeline — `studio-ai` no longer touches R2 for vision.
- Tests: round-trip an image upload through `studio-data`, then a chat turn that references it.

### Phase 5 — Local runtime + `LocalSessionBackend`

- `backends/localSessionBackend.ts`: `ws` lib (or Bun) + `better-sqlite3` state.
- `infrastructure/local/env.ts`: filesystem paths under Tauri app data dir.
- Bundle as Tauri sidecar — started by Rust on app launch, stopped on app exit.
- Tests: same as Phase 1 + 2 but against the local backend. Same loop code unchanged.
- **Exit:** the same chat turn works in a Tauri-only context (no Cloudflare).

### Phase 6+ — Hardening

- Memory distillation call to `studio-memory` (it already has `/process` endpoint — unchanged).
- Model tier router (§9) — port from v1 `server/services/router/`.
- Rate limiting moved to `api` (open decision §13).
- Telemetry observability — spans via tracker, same as v1.
- `studio-agents` v2 refactor (apply same `SessionBackend` pattern to Omni/Coding DOs).

---

## 15. Audit issues this design eliminates (traceability)

| v1 problem | How v2 kills it |
|---|---|
| `studio-chat` owning ~12 misc HTTP routes (PDF, docs, kb, images, modes, memories) | §2 scope OUT table — every route has an assigned new home |
| `ChatAgent extends Agent` (DO + hibernation + `agents` SDK lock-in) | `SessionBackend` interface with swappable cloud/local backends (§3) |
| `routeAgentRequest` WS routing bypass | Hono WS upgrade directly in `routes/chat.ts` |
| `this.setState` / `this.state` DO SQLite lock-in | `backend.saveSession()` / `backend.loadSession()` — D1 or SQLite |
| `preprocessVision` coupling chat worker to R2 | Pattern A pre-upload (§6) — client owns the upload, `studio-ai` sees only URLs |
| Image / temp-image cleanup crons in chat worker | Moved to `studio-data` (owns the buckets it cleans, §2 OUT table) |
| `POST /v1/local/tool/execute` HTTP relay | Disappears — `tool_results` over WS is the only resume path |
| Local chat save in chat worker (`/v1/local/chat/save`) | Conversation save = `studio-ai` → `studio-data` service binding at turn end |
| `MODELS_KV` / `MCP_KV` KV bindings in chat worker | Gateway owns `MODELS_KV`; `studio-mcp` owns `MCP_KV`; chat owns neither |
| Modes config in chat worker (`/v1/modes`, `/v1/admin/modes-config`) | Moved to `studio` preferences worker (§2 OUT table) |
| `CREDITS_KV` KV binding in chat worker | Gateway owns credit balance reporting, not chat |
| `IMAGES_BUCKET` / `TEMP_IMAGES_BUCKET` / `DOCS_BUCKET` / `RELEASES_BUCKET` R2 bindings | `RELEASES_BUCKET` stays in `api`; everything else in `studio-data` |
| `VECTORIZE` binding (RAG index) in chat worker | Moves to `studio-memory` (already has one for AI memories; merge or sibling) |
| `ANALYTICS` (CF Analytics Engine) in chat worker | Replaced by thin `tracking/track.ts` → tracker service binding |
| Three refactor docs (V1/V2/V3) chipping at symptoms | Greenfield — decisions locked once here |
| `../../gateway/src/...` cross-worker imports (audit §L) | Infrastructure owns its own env type; no cross-worker source imports |
| Zero tests in chat worker (audit §N) | Every phase ships tests |

---

## 16. What does NOT change (intentionally)

- **The Vercel AI SDK** — still the provider layer, still in `studio-gateway`. `studio-ai`
  doesn't import it.
- **The 16-provider gateway** — stays. v2 of gateway adds CF AI Gateway transport; doesn't
  affect `studio-ai`.
- **The WS message protocol** — frozen (§5). Tauri/Rust WS client code is unchanged.
- **The ReAct loop shape** — `while(true) { llmStep; if no tool_calls break; toolsStep; }`
  Ported verbatim from `chat/src/agent/loop.ts`.
- **The bandwidth optimization** — `pendingMessages` saved server-side, client sends ~1KB on
  resume. Same property, different backing store.
- **Tool registry shape** (`getContextualDefinitions()`, `executionTarget`, `allowInSubAgent`,
  `tier`, `group`) — ported unchanged.
- **`expand_tools` + MCP blocklist** — ported unchanged.
- **Coding specialist relay** — `local_tools_pending` mechanism, ported unchanged.
- **Memory distillation call** — `POST http://memory/process` after each completed turn,
  unchanged.
- **Service binding mesh** — `GATEWAY`, `MEMORY`, `MCP`, `AGENTS`, `TRACKER` unchanged. Adds
  `STUDIO_DATA` (new). Drops `IMAGES_BUCKET`, `TEMP_IMAGES_BUCKET`, `DOCS_BUCKET`,
  `RELEASES_BUCKET`, `VECTORIZE`, `ANALYTICS`, `MODELS_KV`, `MCP_KV`, `CREDITS_KV`,
  `CHAT_AGENT` DO, `RATE_TRACKER_DO` DO.

---

## 17. Naming & deployment note

`ai-v2/` is a temporary folder name so it can coexist with the current `chat/` during the
build. The Worker/project becomes `studio-ai`. When v2 is verified:

1. Delete `chat/`.
2. Rename `ai-v2/` → `ai/`.
3. Flip the Worker `name` in `wrangler.toml` from `studio-chat` → `studio-ai`.
4. Update the `AI` service binding in `api/wrangler.toml` to point at `studio-ai` instead of
   `studio-chat` (binding name can stay `AI` or rename to `STUDIO_AI` — recommend `STUDIO_AI`
   for clarity, but that's a one-time sweep in `api` only).
5. The `CHAT_AGENT` Durable Object binding is deleted. If `RATE_TRACKER_DO` is kept, it moves
   to whichever worker owns rate limiting (likely `api`).

**Mesh after the rename is complete:**

| Worker | Type | Role |
|---|---|---|
| `api` | Edge | Auth gate, router, rate limit |
| `auth` | Domain | OAuth, JWT, token revocation |
| `studio-data` | Domain | All user blobs (3 R2 buckets: conversations, media-generated, media-uploads) |
| `studio-memory` | Domain | Vectorize + D1 (AI memories + RAG document embeddings) |
| `studio-mcp` | Domain | MCP connection registry |
| `studio` | Domain | User preferences + admin modes config |
| `studio-gateway` | Compute | LLM routing (v2: through CF AI Gateway + BYOK) |
| `studio-ai` | Compute | Agent loop + WS sessions + tool orchestration |
| `studio-agents` | Compute | Background autonomous agents (Omni/Coding) + cron |
| `tracker` | Cross-cutting | Telemetry |

10 workers. Every worker is either a domain service (owns data + logic for one capability) or a
compute worker (pure processing, owns no user data). The two compute workers — `studio-ai` and
`studio-gateway` — are the ones that run locally in the Tauri sidecar. The domain services swap
their storage engine between cloud (R2/D1/Vectorize) and local (filesystem/SQLite/sqlite-vss),
driven by environment, not code branches.
