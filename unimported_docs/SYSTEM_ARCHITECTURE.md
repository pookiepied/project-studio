# STUDIO Platform — System Architecture

> **Source of truth:** Generated exclusively from source code (wrangler.toml, schema.sql, TypeScript/Rust implementation files). Do not confuse with any pre-existing markdown documents, which are outdated.

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [Platform Topology](#2-platform-topology)
3. [Cloudflare Resource Map](#3-cloudflare-resource-map)
4. [Service Reference](#4-service-reference)
   - [4.1 API Worker (api)](#41-api-worker-api)
   - [4.2 Chat Worker (studio-chat)](#42-chat-worker-studio-chat)
   - [4.3 Gateway Worker (studio-gateway)](#43-gateway-worker-studio-gateway)
   - [4.4 Agents Worker (studio-agents)](#44-agents-worker-studio-agents)
   - [4.5 Auth Worker (auth)](#45-auth-worker-auth)
   - [4.6 Tracker Worker (tracker)](#46-tracker-worker-tracker)
   - [4.7 MCP Hub Worker (studio-mcp)](#47-mcp-hub-worker-studio-mcp)
   - [4.8 Chats Storage Worker (chats)](#48-chats-storage-worker-chats)
   - [4.9 Studio Preferences Worker (studio)](#49-studio-preferences-worker-studio)
   - [4.10 Memory Worker (studio-mcp-memory)](#410-memory-worker-studio-mcp-memory)
   - [4.11 YouTube Transcript Worker (youtube-transcript-mcp)](#411-youtube-transcript-worker-youtube-transcript-mcp)
5. [Database Schemas](#5-database-schemas)
6. [Provider Registry](#6-provider-registry)
7. [Tool Catalog](#7-tool-catalog)
8. [Agent Architecture](#8-agent-architecture)
9. [Auth Architecture](#9-auth-architecture)
10. [MCP Protocol Implementation](#10-mcp-protocol-implementation)
11. [STUDIO Frontend (Tauri Desktop App)](#11-studio-frontend-tauri-desktop-app)
12. [Studio-Local MCP Runtime](#12-studio-local-mcp-runtime)
13. [Local Model Daemon](#13-local-model-daemon)
14. [STUDIO Bot (Python)](#14-studio-bot-python)
15. [Service Interaction Map](#15-service-interaction-map)
16. [User Flow Blueprints](#16-user-flow-blueprints)
17. [Current vs Planned Architecture](#17-current-vs-planned-architecture)

---

## 1. Executive Overview

STUDIO is a full-stack AI platform consisting of:

- **Cloud backend:** 11 Cloudflare Workers forming a microservice mesh, communicating via service bindings (zero-latency, no HTTP overhead)
- **Desktop frontend:** Tauri 2 (Rust) + Vite + React app with dual build targets (native desktop and web)
- **Local MCP runtime:** 4 Node.js stdio MCP servers bundled into the Tauri app, providing 80+ tools to the AI
- **Agent system:** ReAct (Reason + Act) loop-based autonomous agents running as Cloudflare Durable Objects with SQLite state
- **Multi-provider AI:** 15+ AI providers routed through a unified gateway with model capability registry
- **Memory system:** Persistent RAG memory with Vectorize + D1, auto-injected into chat context

The platform is architecturally split into a **private edge mesh** (service bindings, never exposed to the internet) and a **public API layer** (the `api` worker) that clients connect to. All AI traffic flows: `Client → api → studio-chat → studio-gateway → [provider]`.

---

## 2. Platform Topology

```
┌─────────────────────────────────────────────────────────────────────┐
│  CLIENT LAYER                                                        │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │  STUDIO Desktop  │  │   STUDIO Web     │  │   STUDIO Bot     │  │
│  │  (Tauri + React) │  │  (Vite + React)  │  │   (Python)       │  │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  │
└───────────┼──────────────────────┼─────────────────────┼────────────┘
            │  HTTPS / WebSocket   │                     │
            ▼                      ▼                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PUBLIC EDGE                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  api worker  (public entry point, JWT auth gate)                ││
│  └──┬─────┬──────┬──────┬──────┬─────────────────────────────────┘│
│     │     │      │      │      │  (service bindings)               │
│     ▼     ▼      ▼      ▼      ▼                                   │
│  studio-chat  studio-gateway  chats  studio  tracker               │
│     │              │                                                 │
│     ▼              ▼                                                 │
│  studio-agents  studio-mcp  studio-mcp-memory                      │
│     │              │                                                 │
│     └──────────────┴──→ studio-gateway → [AI Providers]            │
└─────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LOCAL (Tauri App)                                                   │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────┐   │
│  │ studio-local  │  │ Local Daemon  │  │  External MCP servers │   │
│  │ (2 MCP srvrs) │  │ (Ollama/LMS) │  │  (Composio, etc.)     │   │
│  └───────────────┘  └───────────────┘  └───────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Worker Communication Rules

- Workers communicate with each other **only via service bindings** (private, zero-latency, no egress billing)
- The `api` worker is the **only public-facing worker**; all others are `workers_dev = false`
- `/agents/*` routes in `api` are forwarded **without Hono** to preserve WebSocket upgrade headers
- The `studio-chat` worker owns the `ChatAgent` Durable Object, which handles all real-time AI streaming
- Tool results for local/MCP tools are never re-sent in full — only `~1KB` result payloads come back, not the full 70KB+ message history

---

## 3. Cloudflare Resource Map

### Workers

| Worker Name | Source Dir | Description |
|---|---|---|
| `api` | `api/` | Public API gateway, JWT auth gate |
| `studio-chat` | `chat/` | AI chat, ChatAgent DO, tool orchestration |
| `studio-gateway` | `gateway/` | Provider router, model registry |
| `studio-agents` | `agents/` | Autonomous agent runtime (OmniAgent, CodingAgent) |
| `auth` | `auth/` | Google OAuth PKCE, JWT issuance |
| `tracker` | `tracker/` | Telemetry, spans, usage events |
| `studio-mcp` | `mcp/hub/` | MCP connection registry |
| `chats` | `workers/ChatsStorage/` | Chat history R2 storage |
| `studio` | `workers/Studio/` | User preferences D1 storage |
| `studio-mcp-memory` | `workers/mcp/memory/` | Memory MCP server (RAG + profile) |
| `youtube-transcript-mcp` | `workers/mcp/youtube-transcript/` | YouTube transcript extraction |

### D1 Databases

| Binding Name | Database Name | Database ID | Owner Worker |
|---|---|---|---|
| `AI_DB` | `studio-ai` | `2f591e4e-c944-44c1-9943-bf7f2a9f257e` | studio-chat, studio-agents (shared) |
| `TRACKER_DB` | `studio-tracker` | `84d438e3-6048-4d66-bd6f-e8cd986b6b66` | tracker |
| `REGISTRY_DB` | `studio-mcp` | `372d8d03-1d80-4595-9069-1739f7b5bb6f` | studio-mcp |
| `STUDIO_DB` | `studio-prefs` | `c80f9e46-9083-4c76-81b9-8abe1d81f019` | studio |
| `MEMORY_DB` | `studio-memory` | `171ce9b6-4d75-43c3-9b22-309656635658` | studio-mcp-memory |
| `DB` | `studio-jobs` | `4c66facc-4a61-48b3-ae4c-63c65c25e531` | api |

### KV Namespaces

| Binding Name | Namespace ID | Shared By |
|---|---|---|
| `REVOKED_KV` / `AUTH_KV` | `720a294c0a5844248a4ee8ac6a91fa8f` | auth, studio-chat, studio-gateway, api, studio-mcp — **platform-wide shared** |
| `MODELS_KV` | `95440eeac45742a298ed39edcc7d3944` | studio-chat, studio-gateway |
| `MCP_KV` | `2ad99d3c8750412fa2465f255a5d22a1` | studio-chat, studio-gateway |
| `CREDITS_KV` | `08979acf4fb84e38b5d0555e8591f8eb` | studio-chat |
| `KV` | `b89be83157724d539403c468f5a7acef` | api |
| `RELEASES_KV` | `35f6ec05519142ca91278067caa2fba9` | api |
| `PROFILE_KV` | `5b0ee001b49d433996bc02388b5dc29a` | studio-mcp-memory |

> **Critical note:** `REVOKED_KV` (id `720a294c0a5844248a4ee8ac6a91fa8f`) is the **same physical namespace** used as `AUTH_KV` in the auth worker. Auth writes revoked tokens here; all workers that verify JWTs read from this namespace to check blocklist status.

### R2 Buckets

| Binding Name | Bucket Name | Owner(s) |
|---|---|---|
| `IMAGES_BUCKET` | `studio-images` | studio-chat, studio-gateway |
| `TEMP_IMAGES_BUCKET` | `studio-images-temp` | studio-chat, studio-gateway |
| `RELEASES_BUCKET` | `studio-releases` | studio-chat, api |
| `DOCS_BUCKET` | `studio-docs` | studio-chat |
| `CHATS_BUCKET` | `studio-chats` | chats |

### Vectorize Indexes

| Binding Name | Index Name | Dimensions | Metric | Owner |
|---|---|---|---|---|
| `VECTORIZE` | `studio-rag` | 768 | cosine | studio-chat |
| `VECTORIZE` | `studio-memory-vectors` | 768 | cosine | studio-mcp-memory |

Both use `@cf/baai/bge-base-en-v1.5` for embedding generation via Workers AI.

### Durable Objects

| Binding Name | Class Name | Script | Migration | Description |
|---|---|---|---|---|
| `CHAT_AGENT` | `ChatAgent` | studio-chat | `new_sqlite_class` tag: v4 | Per-conversation AI agent with WebSocket streaming |
| `RATE_TRACKER_DO` | `RateTrackerDurableObject` | studio-chat | `new_sqlite_class` tag: v3 | Rate limiting per user |
| `OMNI_AGENT` | `OmniAgent` | studio-agents | `new_sqlite_class` tag: v1 | General-purpose autonomous agent |
| `CODING_AGENT` | `CodingAgent` | studio-agents | `new_sqlite_class` tag: v2 | 4-phase coding-focused agent |
| `MCP_OBJECT` | `StudioMemoryAgent` | studio-mcp-memory | `new_sqlite_class` tag: v1 | Memory processing agent |
| `MCP_OBJECT` | `YouTubeTranscriptAgent` | youtube-transcript-mcp | — | Transcript extraction agent |

**Deleted DOs** (migration tombstones, still in wrangler.toml to prevent data loss):
- `AgentStateDurableObject` (deleted: v5)
- `AgentContextDurableObject` (deleted: v5)
- `SubAgentRunnerDO` (deleted: v5)

### Analytics Engine

| Binding Name | Dataset | Owner |
|---|---|---|
| `ANALYTICS` | `studio-errors` | studio-chat |

### Cron Triggers

| Worker | Schedule | Purpose |
|---|---|---|
| `studio-chat` | `*/15 * * * *` | 15-minute maintenance |
| `studio-chat` | `0 2 * * *` | Daily 2AM cleanup/distillation |
| `studio-gateway` | `0 */6 * * *` | Every 6h model sync from providers |
| `studio-agents` | `*/5 * * * *` | Dispatch scheduled/cron agents |
| `api` | `* * * * *` | Every minute: stale job reaper |

### Tail Consumers

The `tracker` worker operates as a Cloudflare Tail Consumer — it receives automatic invocation logs forwarded from other workers without any explicit binding. This captures raw `outcome`, URL, method, HTTP status, CPU ms, wall ms, console logs, and exceptions.

### Service Bindings Map

```
api ──────────────────→ studio-chat      (binding: AI)
api ──────────────────→ studio-gateway   (binding: GATEWAY)
api ──────────────────→ chats            (binding: CHATS_SERVICE)
api ──────────────────→ studio           (binding: STUDIO)
api ──────────────────→ tracker          (binding: TRACKER)

studio-chat ──────────→ studio-mcp-memory (binding: MEMORY)
studio-chat ──────────→ studio-mcp        (binding: MCP)
studio-chat ──────────→ studio-agents     (binding: AGENTS)
studio-chat ──────────→ tracker           (binding: TRACKER)
studio-chat ──────────→ studio-gateway    (binding: GATEWAY)

studio-gateway ───────→ tracker           (binding: TRACKER)

studio-agents ────────→ studio-mcp        (binding: MCP_TOOLS)
studio-agents ────────→ tracker           (binding: TRACKER)
studio-agents ────────→ studio-gateway    (binding: GATEWAY)

auth ─────────────────→ tracker           (binding: TRACKER)

studio-mcp-memory ────→ studio-gateway    (binding: AI_WORKER)
studio-mcp-memory ────→ tracker           (binding: TRACKER)
```

---

## 4. Service Reference

### 4.1 API Worker (`api`)

**Purpose:** Single public-facing entry point. JWT authentication gate. Pure traffic router — contains no AI business logic.

**Source:** `api/`
**Worker name:** `api`
**Compatibility:** `nodejs_compat`

#### Cloudflare Resources

| Type | Binding | Value |
|---|---|---|
| Service | `AI` | studio-chat |
| Service | `GATEWAY` | studio-gateway |
| Service | `CHATS_SERVICE` | chats |
| Service | `STUDIO` | studio |
| Service | `TRACKER` | tracker |
| D1 | `DB` | studio-jobs (`4c66facc-4a61-48b3-ae4c-63c65c25e531`) |
| KV | `KV` | `b89be83157724d539403c468f5a7acef` |
| KV | `REVOKED_KV` | `720a294c0a5844248a4ee8ac6a91fa8f` |
| KV | `RELEASES_KV` | `35f6ec05519142ca91278067caa2fba9` |
| R2 | `RELEASES_BUCKET` | studio-releases |
| Cron | — | `* * * * *` (stale job reaper) |

#### Authentication Logic (`api/src/index.ts`)

1. **WebSocket / `/agents/*`:** Forwarded directly to the `AI` service binding (bypasses Hono entirely). Necessary because WebSocket upgrade requires the original `Request` object to be forwarded unmodified.
2. **Bearer JWT:** Cryptographically verified against `JWT_SECRET`. `userId` extracted from payload.
3. **CF Access JWT:** Decoded only (not re-verified — CF Access already verified at edge). Used for internal/admin routes.
4. All other authenticated requests pass through Hono middleware stack.

#### API Routes (`api/src/routes/adapters/openai.ts`)

All routes are prefixed implicitly. The `openai.ts` adapter exposes 37+ routes:

**Chat / LLM**
- `POST /v1/chat/completions` — primary LLM route, forwarded to `AI` binding (studio-chat)
- `GET /v1/models` — model list, forwarded to gateway

**AI Modes**
- `GET /v1/modes` — current mode config
- `GET /v1/admin/modes-config` — admin view of modes config
- `PUT /v1/admin/modes-config` — update modes config (KV-backed, no redeploy)

**Audio**
- `POST /v1/audio/transcriptions` — STT (speech-to-text), forwarded to gateway
- `POST /v1/audio/speech` — TTS (text-to-speech), forwarded to gateway

**MCP Management**
- `GET /v1/mcp/connections` — list user's MCP connections
- `POST /v1/mcp/connections` — register new MCP connection
- `GET /v1/mcp/connections/:id` — get specific connection
- `PATCH /v1/mcp/connections/:id` — update connection
- `DELETE /v1/mcp/connections/:id` — remove connection
- `GET /v1/mcp/connections/type/:type` — connections by type (mcp_local, mcp_remote, composio)

**Composio**
- `GET /v1/composio/config` — get user's Composio API key + entity ID
- `PUT /v1/composio/config` — save Composio config
- `GET /v1/composio/connections` — OAuth app connections
- `POST /v1/composio/connections` — initiate OAuth app connection
- `PATCH /v1/composio/connections/:id` — update connection status (INITIATED → ACTIVE)
- `DELETE /v1/composio/connections/:id` — remove connection

**Chat Storage**
- `GET /v1/chats` — list conversations
- `GET /v1/chats/:id` — get conversation
- `POST /v1/chats` — create conversation
- `PUT /v1/chats/:id` — update conversation
- `DELETE /v1/chats/:id` — delete conversation

**Images**
- `GET /v1/images/:id` — retrieve generated image from R2
- `POST /v1/images/generate` — generate image (forwarded to gateway)

**Tracking / Analytics**
- `POST /v1/track` — client-side event tracking
- `GET /v1/usage` — usage statistics

**RAG**
- `POST /v1/rag/ingest` — ingest document into Vectorize
- `GET /v1/rag/documents` — list user's indexed documents
- `DELETE /v1/rag/documents/:id` — remove document

**Local Engine Job Dispatch** (`api/src/routes/engine.ts`)
- `GET /internal/jobs/next` — atomic `UPDATE...RETURNING`, long-polling with `?wait=N` seconds. Used by the local engine (Tauri) to dequeue jobs.
- `POST /internal/jobs/:id/result` — local engine posts tool results back
- `POST /internal/jobs/:id/heartbeat` — keepalive for running jobs
- `POST /internal/jobs/:id/progress` — streaming progress updates
- `POST /internal/tasks/register` — register task catalog entry (stored in KV as `task_catalog`)

**Memories**
- `GET /v1/memories` — list memory entries
- `POST /v1/memories` — create memory
- `DELETE /v1/memories/:id` — delete memory

**Preferences**
- `GET /v1/preferences` — user preferences (forwarded to `studio` binding)
- `PUT /v1/preferences` — update preferences

**Local Callbacks**
- `POST /v1/local/callback` — OAuth callback forwarded from Tauri local HTTP server

**Agents** (forwarded directly, bypassing Hono)
- `GET|POST /agents/*` — forwarded to studio-chat `AI` binding for WebSocket upgrades

---

### 4.2 Chat Worker (`studio-chat`)

**Purpose:** Core AI orchestration. Hosts the `ChatAgent` Durable Object that runs the ReAct agent loop, manages tool execution, streams responses over WebSocket, and coordinates with all other services.

**Source:** `chat/`
**Worker name:** `studio-chat`
**Compatibility:** `nodejs_compat`
**Main:** `src/index.ts`

#### Cloudflare Resources

| Type | Binding | Value |
|---|---|---|
| D1 | `AI_DB` | studio-ai (`2f591e4e-c944-44c1-9943-bf7f2a9f257e`) |
| KV | `MODELS_KV` | `95440eeac45742a298ed39edcc7d3944` |
| KV | `REVOKED_KV` | `720a294c0a5844248a4ee8ac6a91fa8f` |
| KV | `MCP_KV` | `2ad99d3c8750412fa2465f255a5d22a1` |
| KV | `CREDITS_KV` | `08979acf4fb84e38b5d0555e8591f8eb` |
| R2 | `RELEASES_BUCKET` | studio-releases |
| R2 | `DOCS_BUCKET` | studio-docs |
| R2 | `IMAGES_BUCKET` | studio-images |
| R2 | `TEMP_IMAGES_BUCKET` | studio-images-temp |
| Vectorize | `VECTORIZE` | studio-rag (768-dim cosine) |
| AI | `AI` | Workers AI (embedding: `@cf/baai/bge-base-en-v1.5`) |
| Analytics | `ANALYTICS` | studio-errors |
| Service | `MEMORY` | studio-mcp-memory |
| Service | `MCP` | studio-mcp |
| Service | `AGENTS` | studio-agents |
| Service | `TRACKER` | tracker |
| Service | `GATEWAY` | studio-gateway |
| DO | `CHAT_AGENT` | ChatAgent (new_sqlite_class, v4) |
| DO | `RATE_TRACKER_DO` | RateTrackerDurableObject (new_sqlite_class, v3) |
| Cron | — | `*/15 * * * *` |
| Cron | — | `0 2 * * *` |

**Enabled providers (chat-visible):** `groq`, `openrouter`, `google`, `alibaba`, `minimax`, `cloudflare`, `fal`

**Secrets:** `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `JINA_API_KEY`, `FAL_API_KEY`, `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY`, `MEMORY_AUTH_SECRET`, `MINIMAX_API_KEY`, `MINIMAX_GROUP_ID`

#### ChatAgent Durable Object (`chat/src/orchestration/agent/ChatAgent.ts`)

The `ChatAgent` extends `Agent<Env, ChatAgentState>` from the Cloudflare Agents SDK (`agents` npm package). Each conversation maps to one ChatAgent instance (addressed by conversation ID).

**State type (`ChatAgentState`):**
```typescript
interface ChatAgentState {
  pendingMessages: AgentMessage[];        // message history accumulation
  pendingSpecialist: PendingCodingSpecialist | null; // coding specialist state
  userId: string;
  modelId: string;
  provider: string;
  apiBaseUrl: string;
  temperature: number;
  maxTokens?: number;
  localEngineConnected: boolean;          // whether Tauri local engine is online
  requestId: string;
  runningMcpServers: string[];            // currently active local MCP servers
  completedContent: CompletedMessage[];   // ring buffer for offline catch-up
}
```

**WebSocket message protocol (client → agent):**
- `{ type: "start", ... }` — begin a new AI turn with message history + config
- `{ type: "tool_results", results: ToolResult[], pendingSpecialist?: ... }` — resume after local/MCP tool execution

**SSE events (agent → client, via WebSocket):**
- `stream` — individual token chunk (real-time streaming)
- `tool_start` — LLM requested a tool call `{ callId, tool, args }`
- `tool_complete` — cloud tool finished `{ callId, tool, result }`
- `local_tools_pending` — local/MCP tools need Tauri execution `{ messages, toolCalls, pendingSpecialist? }`
- `done` — turn complete `{ usage, requestId }`
- `error` — error occurred
- `vision_substitutions` — image URL rewrites for vision inputs

**Key design feature (bandwidth optimization):** When the client sends back `tool_results` to resume the loop, it sends only the ~1KB result payloads. The agent reconstructs the full message history from its in-memory state rather than requiring the client to re-send 70KB+ of conversation history.

**Blackboard:** A SQL table inside the ChatAgent's Durable Object SQLite database for cross-agent shared state. Allows specialist sub-agents to read/write shared context.

**Memory distillation:** After each completed turn, `ChatAgent` fires a `POST http://memory/process` to the `MEMORY` service binding (studio-mcp-memory) to extract and store memories from the conversation.

**Offline catch-up (`GET /completed`):** Clients that reconnect after being offline can fetch completed turns they missed. A ring buffer of `completedContent` is stored in agent state. `DELETE /completed` clears the buffer.

#### ReAct Agent Loop (`chat/src/orchestration/agent/loop.ts`)

```
START
  │
  ├─ (pendingSpecialist present?) → specialistStep
  │     ├─ type=relay → emit local_tools_pending + pendingSpecialist payload → END
  │     └─ type=done  → append finalMessage → END
  │
  └─ (normal turn) → while(true):
        │
        ├─ runLlmStep(state, enqueue)
        │    └─ streams tokens real-time via streamFull()
        │
        ├─ (no tool_calls?) → break (final answer already streamed)
        │
        ├─ emit tool_start for each tool call
        │
        ├─ runToolsStep(state)
        │    ├─ cloud tools: execute in parallel (Promise.all)
        │    │    └─ emit tool_complete for each
        │    └─ local/MCP tools: defer to client
        │
        ├─ (pendingClientToolCalls.length > 0?)
        │    └─ emit local_tools_pending → return { localToolsPending: true }
        │
        └─ (all cloud) → continue loop (next LLM turn)

RETURN { capturedUsage, localToolsPending, resolvedMessages, toolsWereCalled }
```

**Loop input (`AgentLoopInput`):**
- `messages`, `modelId`, `provider`, `apiKey`, `apiBaseUrl`, `temperature`, `maxTokens`
- `localEngineConnected` — whether Tauri is online (affects tool availability)
- `tavilyApiKey`, `userContext`, `requestId`
- `precomputedAssistantMessage` — Phase 1 result, avoids redundant API call
- `pendingSpecialist` — coding specialist state echoed back by client

#### Specialist Agent System

The `ChatAgent` can spin up specialist sub-agents (currently: coding specialist types `explorer`, `planner`, `coder`, `tester`, `debugger`, `reviewer`) that run inside Cloudflare Workers and relay local file tool calls back to Tauri via the `local_tools_pending` mechanism. The specialist's full message history and state are serialized into the `pendingSpecialist` payload and echoed back by the client on each resume, enabling stateless server-side specialists.

---

### 4.3 Gateway Worker (`studio-gateway`)

**Purpose:** Provider abstraction layer. Routes all AI inference requests to the appropriate provider. Model registry sync. Image/video generation. Audio (TTS/STT). No business logic — pure provider translation.

**Source:** `gateway/`
**Worker name:** `studio-gateway`
**Compatibility:** `nodejs_compat`

#### Cloudflare Resources

| Type | Binding | Value |
|---|---|---|
| KV | `MODELS_KV` | `95440eeac45742a298ed39edcc7d3944` |
| KV | `MCP_KV` | `2ad99d3c8750412fa2465f255a5d22a1` |
| KV | `REVOKED_KV` | `720a294c0a5844248a4ee8ac6a91fa8f` |
| R2 | `IMAGES_BUCKET` | studio-images |
| R2 | `TEMP_IMAGES_BUCKET` | studio-images-temp |
| AI | `AI` | Workers AI |
| Service | `TRACKER` | tracker |
| Cron | — | `0 */6 * * *` (model sync) |

**Enabled providers (gateway-visible):** `groq`, `openrouter`, `anthropic`, `openai`, `google`, `alibaba`, `xai`, `deepseek`, `mistral`, `cohere`, `minimax`, `fal`

Note: Chat worker and gateway have different `ENABLED_PROVIDERS` values. Gateway includes `anthropic`, `openai`, `xai`, `deepseek`, `mistral`, `cohere` which the chat worker does not list (these providers are available at the gateway layer but may be conditionally exposed).

**Secrets:** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `GROQ_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `COHERE_API_KEY`, `OPENROUTER_API_KEY`, `ALIBABA_API_KEY`, `MINIMAX_API_KEY`, `MINIMAX_GROUP_ID`, `FAL_API_KEY`, `AZURE_API_KEY`, `AZURE_ENDPOINT`, `BEDROCK_ACCESS_KEY`, `BEDROCK_SECRET_KEY`, `BEDROCK_REGION`, `JINA_API_KEY`, `TAVILY_API_KEY`, `CF_AI_GATEWAY_TOKEN`, `CF_AI_GATEWAY_ID`

#### Routes (`gateway/src/index.ts`)

**LLM**
- `POST /v1/chat/completions` — primary LLM route. Provider identified via `provider:model-id` format in request body or `model` field.
- `GET /v1/models` — aggregated model list from all enabled providers (cached in `MODELS_KV`, refreshed every 6h by cron)

**Modes**
- `GET /v1/modes` — current AI mode config (from KV)
- `GET /v1/admin/modes-config` — admin view
- `PUT /v1/admin/modes-config` — update config (KV-backed, no redeploy needed)

**Audio**
- `POST /v1/audio/transcriptions` — STT. Routes to provider's transcription endpoint.
- `POST /v1/audio/speech` — TTS. Routes to MiniMax or compatible TTS provider.
- `POST /internal/stt` — internal STT endpoint (service-binding only; returns 404 to public callers)

**Images**
- `POST /v1/images/generate` — sync image generation. Returns `image/png` bytes. Routes to fal, cloudflare, openai, or openrouter depending on provider field.
- `GET /v1/images/:id` — serve image from R2 (presigned-style direct serve)

**Videos**
- `POST /v1/videos/generate` — async video generation. Returns `{ job_id, status: "queued" }` immediately. All video jobs go to fal.ai.
- `GET /v1/videos/status/:jobId` — poll fal.ai for video job status + result URL.

**Embeddings / Rerank**
- `POST /v1/embeddings` — generate embeddings (routes to Workers AI or OpenAI-compatible)
- `POST /v1/rerank` — rerank results (routes to Cohere or compatible)

**Provider Balance**
- `GET /v1/provider-balance/:provider` — fetch current credit balance from provider API. Stored snapshot in `provider_credits` table via tracker.

#### Model Sync (Cron: `0 */6 * * *`)

Every 6 hours the gateway fetches the live model list from each enabled provider's `/models` endpoint, merges with local capability definitions from `registry.ts`, and writes the result to `MODELS_KV`. This ensures the UI always shows accurate, up-to-date model availability without requiring a redeployment.

#### Provider Registry (`gateway/src/providers/registry.ts`)

Defines capabilities per provider. See [Section 6 — Provider Registry](#6-provider-registry) for the full registry.

---

### 4.4 Agents Worker (`studio-agents`)

**Purpose:** Autonomous agent runtime. Hosts `OmniAgent` (general-purpose) and `CodingAgent` (4-phase coding). Manages scheduled agent runs (cron dispatch). Exposes REST API for agent lifecycle management.

**Source:** `agents/`
**Worker name:** `studio-agents`
**Compatibility:** `nodejs_compat`

#### Cloudflare Resources

| Type | Binding | Value |
|---|---|---|
| D1 | `AI_DB` | studio-ai (shared with studio-chat) |
| Service | `MCP_TOOLS` | studio-mcp |
| Service | `TRACKER` | tracker |
| Service | `GATEWAY` | studio-gateway |
| DO | `OMNI_AGENT` | OmniAgent (new_sqlite_class, v1) |
| DO | `CODING_AGENT` | CodingAgent (new_sqlite_class, v2) |
| Cron | — | `*/5 * * * *` |

**Default model:** `groq:llama-3.3-70b-versatile`

#### HTTP Routes (`agents/src/index.ts`)

**WebSocket (SDK routing)**
- `GET|POST /agents/*` — routed via `routeAgentRequest()` from `agents` SDK. Handles WebSocket upgrades to individual agent DOs.

**OmniAgent REST**
- `POST /v1/omni-agent` — create + start OmniAgent run
- `GET /v1/omni-agent/:id` — get agent status
- `POST /v1/omni-agent/:id/cancel` — cancel running agent
- `POST /v1/omni-agent/:id/message` — send message to running agent

**CodingAgent REST**
- `POST /v1/coding-agent` — create + start CodingAgent run
- `GET /v1/coding-agent/:id` — get agent status
- `POST /v1/coding-agent/:id/cancel` — cancel
- `POST /v1/coding-agent/:id/message` — send message

**Agent Workflows (CRUD)**
- `GET /v1/agent-workflows` — list user's saved workflows
- `POST /v1/agent-workflows` — create workflow
- `GET /v1/agent-workflows/:id` — get workflow
- `PUT /v1/agent-workflows/:id` — update workflow
- `DELETE /v1/agent-workflows/:id` — delete workflow
- `POST /v1/agent-workflows/:id/run` — trigger workflow run
- `GET /v1/agent-workflows/:id/runs` — list run history

**Scheduled (Cron: `*/5 * * * *`)**
- `dispatchScheduledAgents()` — reads `user_agents` table from `AI_DB`, finds agents with `mode=cron` whose schedule matches current time, dispatches runs.

#### OmniAgent (`agents/src/agents/OmniAgent.ts`)

General-purpose autonomous agent. Runs a ReAct loop that:
1. Calls `env.GATEWAY` for LLM inference
2. Calls `env.MCP_TOOLS` (studio-mcp) via `POST http://studio-mcp/mcp` (JSON-RPC 2.0) for tools
3. Executes tools in parallel via `Promise.all`
4. Maintains event log ring buffer (100 events max) replayed on WebSocket reconnect

**Configuration:**
- Max steps: 60
- Timeout: 300 seconds
- Status lifecycle: `idle → running → completed | failed | cancelled`

**Available tools:** `web_search`, `web_fetch`, `rag`, `http_request`, `think`, `skill_read`

#### CodingAgent (`agents/src/agents/CodingAgent.ts`)

4-phase structured coding agent optimized for understanding and modifying codebases:

| Phase | Steps | Name | Actions |
|---|---|---|---|
| 1 | 1–5 | Orientation | `list_project_files` + read key configs |
| 2 | 6–15 | Targeted Read | `read_files_batch` for relevant files |
| 3 | 16–25 | Cross-Reference | `http_request` to GitHub API |
| 4 | 26+ | Act | produce code changes / diffs / PR plan |

**Configuration:**
- Max steps: 40
- Timeout: 600 seconds
- Allowed tools: `think`, `web_search`, `web_fetch`, `http_request`, `rag`, `read_files_batch`, `list_project_files`

---

### 4.5 Auth Worker (`auth`)

**Purpose:** Google OAuth PKCE flow. JWT issuance and revocation. Token refresh.

**Source:** `auth/`

#### Cloudflare Resources

| Type | Binding | Value |
|---|---|---|
| KV | `AUTH_KV` | `720a294c0a5844248a4ee8ac6a91fa8f` (same physical namespace as REVOKED_KV) |
| Service | `TRACKER` | tracker |

**Env vars:** `FRONTEND_URL` (includes both web origin and Tauri origins), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

**Secrets:** `JWT_SECRET`

#### Auth Flow

1. Client initiates Google OAuth PKCE — on Tauri, a local HTTP server (`commands/oauth_server.rs`) opens on a random port to receive the callback.
2. Auth worker handles the OAuth redirect, exchanges code for Google tokens.
3. Issues signed JWT with `userId` embedded. Stored in `AUTH_KV` under the user's entry.
4. Token revocation: writes `{ revoked: true }` to `AUTH_KV` under the token hash. All workers that validate JWTs check `REVOKED_KV` (same namespace) before accepting requests.
5. The `api` worker cryptographically verifies Bearer JWTs against `JWT_SECRET`. The `studio-mcp` and `studio-gateway` workers decode but do not re-verify (relying on `api` as the verified boundary).

---

### 4.6 Tracker Worker (`tracker`)

**Purpose:** Centralized telemetry. Receives business events, agent trace spans, usage events, and raw Cloudflare tail consumer data. All stored in D1.

**Source:** `tracker/`
**Worker name:** `tracker`

#### Cloudflare Resources

| Type | Binding | Value |
|---|---|---|
| D1 | `TRACKER_DB` | studio-tracker (`84d438e3-6048-4d66-bd6f-e8cd986b6b66`) |

The tracker is called via service binding from virtually every other worker. It also receives automatic tail consumer logs.

#### Schema (`tracker/schema.sql`)

**`events`** — business event log
```sql
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   INTEGER NOT NULL,
  worker      TEXT NOT NULL,      -- source worker name
  category    TEXT NOT NULL,      -- event category (auth, chat, tool, agent, etc.)
  event       TEXT NOT NULL,      -- event name
  severity    TEXT NOT NULL,      -- info | warning | error | critical
  user_id     TEXT,
  session_id  TEXT,
  run_id      TEXT,
  span_id     TEXT,
  parent_span_id TEXT,
  data        TEXT                -- JSON blob, arbitrary payload
);
```

**`spans`** — distributed trace spans for agent runs
```sql
CREATE TABLE spans (
  id          TEXT PRIMARY KEY,   -- span_id (UUID)
  parent_id   TEXT,               -- parent_span_id
  trace_id    TEXT NOT NULL,
  span_type   TEXT NOT NULL,      -- llm | tool | chain | node | agent
  name        TEXT NOT NULL,
  status      TEXT NOT NULL,      -- running | success | error
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  duration_ms INTEGER,
  user_id     TEXT,
  run_id      TEXT,
  data        TEXT                -- JSON: model, tokens, tool name, etc.
);
```

**`tail_events`** — Cloudflare tail consumer raw data
```sql
CREATE TABLE tail_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   INTEGER NOT NULL,
  outcome     TEXT,               -- ok | exception | exceeded-cpu | exceeded-memory | canceled
  url         TEXT,
  method      TEXT,
  status      INTEGER,
  cpu_ms      REAL,
  wall_ms     REAL,
  logs        TEXT,               -- JSON array of console.log entries
  exceptions  TEXT                -- JSON array of errors
);
```

**`usage_events`** — per-request AI token usage
```sql
CREATE TABLE usage_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp       INTEGER NOT NULL,
  user_id         TEXT,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  cache_tokens    INTEGER,
  cost_usd        REAL,
  latency_ms      INTEGER,
  tool_call_count INTEGER,
  request_id      TEXT
);
```

**`provider_credits`** — latest balance snapshot per provider
```sql
CREATE TABLE provider_credits (
  provider    TEXT PRIMARY KEY,
  balance_usd REAL,
  checked_at  INTEGER NOT NULL
);
```

---

### 4.7 MCP Hub Worker (`studio-mcp`)

**Purpose:** MCP connection registry. CRUD for user's external MCP connections (local subprocesses, remote SSE/HTTP servers, Composio OAuth apps). Does not proxy MCP traffic — only stores connection config.

**Source:** `mcp/hub/`
**Worker name:** `studio-mcp`
**Compatibility:** `nodejs_compat`

#### Cloudflare Resources

| Type | Binding | Value |
|---|---|---|
| D1 | `REGISTRY_DB` | studio-mcp (`372d8d03-1d80-4595-9069-1739f7b5bb6f`) |
| KV | `REVOKED_KV` | `720a294c0a5844248a4ee8ac6a91fa8f` |

**Secrets:** `JWT_SECRET`, `MEMORY_AUTH_SECRET`

#### Routes (`mcp/hub/src/index.ts`)

Auth: JWT decoded from `Authorization: Bearer <token>` header. No re-verification (upstream `api` already verified).

- `GET /registry/connections` — list all connections for authenticated user
- `POST /registry/connections` — create new connection
- `GET /registry/connections/:id` — get specific connection
- `PATCH /registry/connections/:id` — update connection (enable/disable, update config)
- `DELETE /registry/connections/:id` — remove connection
- `GET /registry/connections/type/:type` — filter by type (`mcp_local`, `mcp_remote`, `composio`)

#### Schema (`mcp/hub/schema.sql`)

**`external_connections`**
```sql
CREATE TABLE external_connections (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  type         TEXT NOT NULL,        -- mcp_local | mcp_remote | composio
  name         TEXT NOT NULL,
  enabled      INTEGER DEFAULT 1,
  config       TEXT NOT NULL,        -- JSON (see below)
  credentials  TEXT,                 -- JSON, NEVER returned to API clients
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
```

**Config shapes by type:**
- `mcp_local`: `{ command: string, args: string[] }` — subprocess command
- `mcp_remote`: `{ url: string, transport: "sse" | "http" }` — remote server
- `composio`: `{ appName: string, displayName: string }` — OAuth app name

---

### 4.8 Chats Storage Worker (`chats`)

**Purpose:** Persist and retrieve conversation history. Stores full message JSON in R2 blobs.

**Source:** `workers/ChatsStorage/`
**Worker name:** `chats`

#### Cloudflare Resources

| Type | Binding | Value |
|---|---|---|
| R2 | `CHATS_BUCKET` | studio-chats |

Conversations are stored as R2 objects keyed by `{userId}/{conversationId}`. The `api` worker forwards all chat CRUD operations to this worker via the `CHATS_SERVICE` service binding.

---

### 4.9 Studio Preferences Worker (`studio`)

**Purpose:** Per-user preference storage. Persists UI/AI settings to D1.

**Source:** `workers/Studio/`
**Worker name:** `studio`

#### Cloudflare Resources

| Type | Binding | Value |
|---|---|---|
| D1 | `STUDIO_DB` | studio-prefs (`c80f9e46-9083-4c76-81b9-8abe1d81f019`) |

The `api` worker forwards all `GET /v1/preferences` and `PUT /v1/preferences` requests to this worker via the `STUDIO` service binding.

---

### 4.10 Memory Worker (`studio-mcp-memory`)

**Purpose:** Persistent AI memory system. Extracts memories from conversations, stores them in Vectorize + D1, and injects relevant memories into new chat contexts automatically.

**Source:** `workers/mcp/memory/`
**Worker name:** `studio-mcp-memory`
**Compatibility:** `nodejs_compat`

#### Cloudflare Resources

| Type | Binding | Value |
|---|---|---|
| D1 | `MEMORY_DB` | studio-memory (`171ce9b6-4d75-43c3-9b22-309656635658`) |
| Vectorize | `VECTORIZE` | studio-memory-vectors (768-dim cosine) |
| AI | `AI` | Workers AI |
| KV | `PROFILE_KV` | `5b0ee001b49d433996bc02388b5dc29a` |
| DO | `MCP_OBJECT` | StudioMemoryAgent (new_sqlite_class, v1) |
| Service | `AI_WORKER` | studio-gateway |
| Service | `TRACKER` | tracker |

**Environment:**
- `EXTRACT_MODEL`: `openrouter:xiaomi/mimo-v2.5` — model used for memory extraction
- `INJECT_TOKEN_BUDGET`: `800` — max tokens to inject into chat context
- `INJECT_RECENT_COUNT`: `3` — how many recent memories to always include
- `INJECT_SEMANTIC_COUNT`: `5` — how many semantically similar memories to retrieve

#### Memory Pipeline

1. **Post-turn trigger:** `ChatAgent` fires `POST http://memory/process` after each completed turn.
2. **Extraction:** Memory worker calls `EXTRACT_MODEL` via `AI_WORKER` (studio-gateway) to identify memorable facts from the conversation.
3. **Storage:** Extracted memories stored in `MEMORY_DB` (D1) as structured entries.
4. **Embedding:** Memory text embedded via Workers AI (`@cf/baai/bge-base-en-v1.5`) and stored in `VECTORIZE` (studio-memory-vectors).
5. **Injection:** On each new chat turn, the memory worker retrieves:
   - Last `INJECT_RECENT_COUNT` (3) memories chronologically
   - Top `INJECT_SEMANTIC_COUNT` (5) semantically similar memories via Vectorize cosine search
   - Combined, deduped, trimmed to `INJECT_TOKEN_BUDGET` (800 tokens)
   - Injected as a system message prefix into the conversation

**Profile KV:** Short-form user profile summary stored in `PROFILE_KV` for fast injection without Vectorize lookup.

---

### 4.11 YouTube Transcript Worker (`youtube-transcript-mcp`)

**Purpose:** MCP server for YouTube transcript extraction. Optionally transcribes audio using STT.

**Source:** `workers/mcp/youtube-transcript/`
**Worker name:** `youtube-transcript-mcp`

#### Cloudflare Resources

| Type | Binding | Value |
|---|---|---|
| DO | `MCP_OBJECT` | YouTubeTranscriptAgent |

**Modes:**
- **Standalone STT mode:** Uses an external OpenAI-compatible STT endpoint (configurable via env: `STT_BASE_URL`, `STT_API_KEY`, `STT_MODEL`)
- **Bound mode:** Uses the `AI_WORKER` service binding (→ studio-gateway) for transcription
- **STT providers supported:** Groq, OpenAI, any OpenAI-compatible endpoint, local (via Ollama/LMStudio)

**Three-layer transcript strategy:**
1. Fetch official YouTube captions (free, fast, no audio needed)
2. Fall back to auto-generated captions
3. Fall back to audio download + STT transcription

---

## 5. Database Schemas

### `studio-ai` D1 (shared by studio-chat and studio-agents)

#### `mcp_servers`
```sql
CREATE TABLE mcp_servers (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL,     -- local | remote
  enabled      INTEGER DEFAULT 1,
  config       TEXT NOT NULL,     -- JSON: { command, args } or { url, transport }
  endpoint_url TEXT,              -- for remote servers
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
```

#### `composio_config`
```sql
CREATE TABLE composio_config (
  user_id       TEXT PRIMARY KEY,
  api_key       TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);
```

#### `composio_connections`
```sql
CREATE TABLE composio_connections (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  app_name      TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  status        TEXT NOT NULL,    -- INITIATED | ACTIVE
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
```

#### `user_documents` (RAG knowledge base)
```sql
CREATE TABLE user_documents (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  r2_key      TEXT NOT NULL,      -- permanent/{user_id}/{id}
  chunk_count INTEGER DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
```

R2 key format: `permanent/{user_id}/{document_id}` — stored in `DOCS_BUCKET` (studio-docs).

#### `user_agents`
```sql
CREATE TABLE user_agents (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  type          TEXT NOT NULL,    -- omni | coding
  mode          TEXT NOT NULL,    -- manual | cron
  schedule      TEXT,             -- cron expression (for mode=cron)
  tools_allowed TEXT,             -- JSON array of allowed tool names
  prompt        TEXT,             -- system prompt override
  model         TEXT,             -- model override (provider:model-id)
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
```

#### `agent_runs`
```sql
CREATE TABLE agent_runs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  agent_id    TEXT NOT NULL,     -- FK → user_agents.id
  do_id       TEXT NOT NULL,     -- Durable Object ID for status polling
  status      TEXT NOT NULL,     -- idle | running | completed | failed | cancelled
  started_at  INTEGER,
  ended_at    INTEGER,
  result      TEXT,              -- JSON
  error       TEXT
);
```

### `studio-jobs` D1 (api worker)

Stores local engine job queue for Tauri (long-polling job dispatch):

```sql
CREATE TABLE jobs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  status      TEXT NOT NULL,     -- pending | running | completed | failed | stale
  task_type   TEXT NOT NULL,
  payload     TEXT NOT NULL,     -- JSON
  result      TEXT,              -- JSON (set on completion)
  error       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  heartbeat_at INTEGER,
  expires_at  INTEGER
);
```

---

## 6. Provider Registry

Defined in `gateway/src/providers/registry.ts`. Each provider entry specifies:
- `supports[]` — capability modalities it can handle
- `enabledByDefault[]` — which modalities are on by default
- Runtime override via `PROVIDER_MODALITIES_CONFIG` env var

| Provider | ID | Modalities (`supports`) | Default enabled |
|---|---|---|---|
| OpenAI | `openai` | text, embedding, image, tts, stt | text, embedding, image, tts, stt |
| Anthropic | `anthropic` | text | text |
| Google | `google` | text, embedding | text |
| Groq | `groq` | text, stt | text |
| xAI | `xai` | text, image | text |
| DeepSeek | `deepseek` | text | text |
| Mistral | `mistral` | text, embedding | text |
| Cohere | `cohere` | text, embedding, rerank | text, embedding, rerank |
| AWS Bedrock | `bedrock` | text | text |
| Azure OpenAI | `azure` | text, embedding | text |
| OpenRouter | `openrouter` | text, image | text |
| Alibaba | `alibaba` | text | text |
| MiniMax | `minimax` | text, tts | text, tts |
| Ollama | `ollama` | text, embedding | text |
| LMStudio | `lmstudio` | text | text |
| fal.ai | `fal` | image, video | image, video |

**Modalities:**
- `text` — LLM chat completions (`/v1/chat/completions`)
- `embedding` — vector embeddings (`/v1/embeddings`)
- `image` — image generation (`/v1/images/generate`)
- `video` — video generation (`/v1/videos/generate`) — fal.ai only
- `tts` — text-to-speech (`/v1/audio/speech`)
- `stt` — speech-to-text (`/v1/audio/transcriptions`)
- `rerank` — result reranking (`/v1/rerank`) — Cohere only

**Model naming convention:** `{provider}:{modelId}` — e.g., `groq:llama-3.3-70b-versatile`, `openrouter:anthropic/claude-3.5-sonnet`, `fal:fal-ai/flux-pro/v1.1`

---

## 7. Tool Catalog

### 7.1 Cloud Tools (execute in ChatAgent, studio-chat worker)

Cloud tools are TypeScript classes extending `BaseTool`. Each has:
- `executionTarget: "cloud"` — executed server-side in the Cloudflare Worker
- `tier` — capability tier (1 = basic, 2 = advanced)
- `allowInSubAgent` — whether usable in specialist sub-agents
- `group` — tool group (affects system prompt injection)

#### Retrieval Group

| Tool | Class | Description |
|---|---|---|
| `web_search` | `WebSearchTool` | Web search via Tavily (primary) with Brave Search fallback |
| `web_fetch` | `WebFetchTool` | Fetch URL as Markdown via Jina Reader (`https://r.jina.ai/{url}`) |
| `rag` | `RagTool` | Semantic search over user's documents in Vectorize (studio-rag) |

**WebSearch routing logic:**
- Primary: `POST https://api.tavily.com/search` with `TAVILY_API_KEY`
- Fallback triggered on HTTP 401, 402, 429, 500, 502, 503, 504
- Fallback: `GET https://api.search.brave.com/res/v1/web/search` with `BRAVE_SEARCH_API_KEY`

#### Generation Group

| Tool | Class | Description |
|---|---|---|
| `image_generate` | `ImageGenerateTool` | Multi-mode image generation routed via GATEWAY → R2 |
| `video_generate` | `VideoGenerateTool` | Async video generation via GATEWAY; returns jobId |
| `video_status` | `VideoStatusTool` | Poll fal.ai job status via GATEWAY |

**ImageGenerateTool modes:**
- `text-to-image` — prompt only
- `edit` — `source_image` URL (switch to image editing model variant)
- `multi-reference` — `reference_images[]` array (up to 4 URLs, first=subject, rest=style/context)
- `typography` — `font_text` field (render legible text in image)

**ImageGenerateTool providers:** `fal`, `cloudflare`, `openai`, `openrouter`

**Style presets:** `photorealistic`, `anime`, `cinematic`, `oil-painting`, `watercolor`, `sketch`, `digital-art`, `none`

**Aspect ratios + pixel sizes:**
| Ratio | Width | Height |
|---|---|---|
| `1:1` | 1024 | 1024 |
| `16:9` | 1792 | 1024 |
| `9:16` | 1024 | 1792 |
| `4:3` | 1024 | 768 |
| `3:4` | 768 | 1024 |
| `21:9` | 2048 | 896 |

**Image flow:** `ChatAgent → GATEWAY.fetch("http://studio-gateway/v1/images/generate") → [provider] → image bytes → storeGeneratedImage() → IMAGES_BUCKET R2 → presigned URL returned as markdownSnippet`

**Video flow:** `ChatAgent → GATEWAY.fetch("http://studio-gateway/v1/videos/generate") → fal.ai (async) → { job_id }` then `video_status` tool polls `GATEWAY.fetch("/v1/videos/status/{jobId}")`.

#### MCP / External Tools Group

| Tool | Description |
|---|---|
| `mcp_*` | Dynamically registered tools from user's enabled MCP connections. Calls proxied via `studio-mcp` service binding. |

#### Memory Group

| Tool | Description |
|---|---|
| `memory_search` | Semantic search over user's memory store |
| `memory_save` | Explicitly save a memory |

#### Code Specialists (cloud-side, relay local tools)

These cloud tools spawn specialist sub-agents that relay local file tool calls back to Tauri:

| Tool | Sub-agent type | Description |
|---|---|---|
| `run_explorer_agent` | `explorer` | Explore and understand a codebase |
| `run_planner_agent` | `planner` | Create implementation plan |
| `run_coder_agent` | `coder` | Write or modify code |
| `run_tester_agent` | `tester` | Write or run tests |
| `run_debugger_agent` | `debugger` | Debug issues |
| `run_reviewer_agent` | `reviewer` | Code review |

### 7.2 Local Tools (execute in Tauri via studio-local MCP)

When the LLM calls a local tool, the ChatAgent emits `local_tools_pending` and the Tauri frontend:
1. Receives the `local_tools_pending` event over WebSocket
2. Calls the appropriate studio-local MCP server via `McpManager.call_tool()`
3. Sends `tool_results` back to the ChatAgent WebSocket
4. ChatAgent resumes the ReAct loop

See [Section 12](#12-studio-local-mcp-runtime) for the full local tool catalog.

---

## 8. Agent Architecture

### 8.1 ChatAgent (Conversational AI)

The `ChatAgent` is the primary AI primitive. It runs inside a Cloudflare Durable Object, meaning:
- Each conversation has exactly one `ChatAgent` instance (singleton per conversation ID)
- State persists in the DO's built-in SQLite database
- WebSocket connections from clients attach to the DO directly
- The DO is addressed by conversation ID; Cloudflare routes the connection to the correct DO instance

### 8.2 OmniAgent (Autonomous General-Purpose)

- Durable Object, addressed by agent run ID
- Runs a tool-driven loop autonomously (no human-in-the-loop per step)
- Up to 60 steps, 300s hard timeout
- All tool calls go through studio-mcp via `POST http://studio-mcp/mcp` JSON-RPC 2.0
- LLM calls go through studio-gateway via `POST http://studio-gateway/v1/chat/completions`
- Event log ring buffer (100 events) is replayed on WebSocket reconnect
- Status transitions: `idle → running → completed | failed | cancelled`

### 8.3 CodingAgent (Structured Coding)

Same DO architecture as OmniAgent but with a deterministic 4-phase execution plan baked into the system prompt. The phase structure ensures the agent reads before it writes, reducing hallucination of non-existent files/functions.

### 8.4 StudioMemoryAgent (Memory Processing)

- Durable Object inside `studio-mcp-memory`
- Receives post-turn conversation content from ChatAgent
- Runs extraction model to identify memorable facts
- Stores to D1 + Vectorize
- Short-circuit: if no memorable content detected, skips embedding

### 8.5 Agents SDK Integration

All agent DOs extend `Agent<Env, State>` from the `agents` npm package (Cloudflare Agents SDK). This SDK provides:
- Built-in SQLite state persistence
- WebSocket routing via `routeAgentRequest()`
- `onMessage()` / `onConnect()` / `onClose()` hooks
- `setState()` / `getState()` with atomic SQLite updates

### 8.6 Scheduled Agent Dispatch

Every 5 minutes, the `studio-agents` cron handler:
1. Queries `AI_DB.user_agents` for agents with `mode = 'cron'`
2. Evaluates each agent's cron `schedule` expression against the current time
3. For matching agents, creates a run record in `agent_runs` and dispatches a new DO instance

---

## 9. Auth Architecture

### JWT Flow

```
Client                  Auth Worker             API Worker
  │                         │                       │
  ├─ GET /auth/google ──────►│                       │
  │                         ├─ redirect to Google   │
  │ ◄── 302 ────────────────┤                       │
  │                         │                       │
  │  [Google OAuth PKCE]    │                       │
  │                         │                       │
  ├─ GET /auth/callback ────►│                       │
  │                         ├─ exchange code        │
  │                         ├─ sign JWT             │
  │                         ├─ store in AUTH_KV     │
  │ ◄── { token: "..." } ───┤                       │
  │                         │                       │
  ├─ POST /v1/... (Bearer) ──────────────────────────►│
  │                                                   ├─ verify JWT (JWT_SECRET)
  │                                                   ├─ check REVOKED_KV
  │                                                   ├─ extract userId
  │                                                   ├─ forward to downstream worker
```

### Tauri-Specific OAuth

On desktop, the `oauth_server.rs` Tauri command starts a temporary local HTTP server on a random port. The auth worker's `FRONTEND_URL` config includes Tauri origins (`tauri://localhost`, `http://localhost:*`) to allow the CORS redirect to land on the local callback server.

### Token Revocation

- On logout: auth worker writes `{ revoked: true, revokedAt: timestamp }` to `REVOKED_KV` under the token's hash
- On every API request: `api` worker checks `REVOKED_KV` before accepting the token
- TTL: entries auto-expire after JWT expiry time (no manual cleanup needed)

---

## 10. MCP Protocol Implementation

### Protocol Version

All MCP communication uses JSON-RPC 2.0 over stdio (local servers) or SSE/HTTP (remote servers). Protocol version: `2024-11-05`.

### MCP Handshake (Tauri `mcp.rs`)

When the frontend starts a local MCP server:
1. Rust `McpManager.start()` spawns the Node.js subprocess with `stdin`/`stdout`/`stderr` piped
2. On Windows: subprocess launched via `cmd /C` wrapper (avoids `.cmd` extension resolution issue with `CreateProcess`)
3. On Windows: `CREATE_NO_WINDOW` flag suppresses console window in production builds
4. Sends `initialize` JSON-RPC request (protocol version + client info)
5. Waits for `initialize` response with 180s timeout
6. Sends `notifications/initialized` notification (no ID — it's a notification)
7. Server is ready; added to `HashMap<String, McpProcess>`

**Timeout:** 180 seconds (`MCP_RESPONSE_TIMEOUT_SECS`) for all operations. This is the Rust-layer hard ceiling. Individual tool handlers in Node.js have their own shorter timeouts (15s–120s per tool).

### Dead Process Detection

Before every `tools/call` or `tools/list` request, `McpManager` calls `child.try_wait()`. If the process has exited (`Ok(Some(_))`), it's evicted from the HashMap and an error is returned instead of writing to a dead stdin pipe (which would cause confusing `EPIPE` errors).

### Studio-Local Servers (4 servers)

The `resolve_studio_local_server_path()` Rust function resolves server paths:
- Production: from `app.path().resource_dir()/mcp-servers/studio-local/dist/{server}/index.js`
- Dev: from `{exe_dir}/../../.../mcp-servers/studio-local/dist/{server}/index.js`

| Server Name | Tauri command | Bundle path |
|---|---|---|
| `harness` | `mcp_resolve_studio_harness_server_path` | `dist/harness/index.js` |
| `desktop` | `mcp_resolve_studio_desktop_server_path` | `dist/desktop/index.js` |
| `system` | `mcp_resolve_studio_system_server_path` | `dist/system/index.js` |
| `network` | `mcp_resolve_studio_network_server_path` | `dist/network/index.js` |

### Remote MCP Servers

User-configured remote MCP servers connect via SSE or HTTP transport. Connection config stored in `studio-mcp` (hub worker). The `studio-chat` worker proxies tool calls to remote servers when they are in the user's `runningMcpServers` list.

### Cloud MCP (studio-mcp, studio-agents)

The `studio-agents` worker calls `studio-mcp` for its tool registry:
- `POST http://studio-mcp/mcp` — JSON-RPC 2.0 `tools/call` request
- Auth: service binding (no JWT needed — binding is internal)

---

## 11. STUDIO Frontend (Tauri Desktop App)

**Source:** `STUDIO/`
**Framework:** Tauri 2 (Rust backend) + Vite + React (TypeScript frontend)

### Build Targets

| Target | Config | Output |
|---|---|---|
| Desktop (Tauri) | `vite.config.ts` | Native app binary |
| Web | `vite.config.web.ts` | Web-deployable bundle |

### React App Entry (`STUDIO/src/App.tsx`)

- `?w=overlay` query param → overlay window mode (Floating Island)
- Multi-provider context hierarchy wrapping the app
- Tauri API accessed via `@tauri-apps/api` package

### Tauri Rust Backend (`STUDIO/src-tauri/src/`)

| File | Purpose |
|---|---|
| `lib.rs` + `main.rs` | App entry, plugin registration, state initialization |
| `commands.rs` | Tauri command handlers exposed to the frontend |
| `commands/oauth_server.rs` | Local HTTP server for OAuth callback (random port) |
| `daemon/mod.rs` | Local model daemon management (Ollama, LMStudio) |
| `mcp.rs` | MCP subprocess manager (`McpManager`) |
| `pty.rs` | Pseudo-terminal (PTY) support for terminal integration |

### Tauri Commands (exposed to frontend)

**MCP:**
- `mcp_start_server(name, command, args, env_vars)` → starts subprocess + handshake
- `mcp_stop_server(name)` → kills subprocess
- `mcp_call_tool(server, tool, args)` → JSON-RPC `tools/call`
- `mcp_get_tools(server)` → JSON-RPC `tools/list`
- `mcp_run_setup(command, args, env_vars)` → one-shot subprocess (e.g., a pre-install setup step)
- `mcp_list_running()` → list running servers, prune dead ones, emit `mcp-server-status` events
- `mcp_resolve_studio_harness_server_path()` → resolve path to harness server
- `mcp_resolve_studio_desktop_server_path()` → resolve path to desktop server
- `mcp_resolve_studio_system_server_path()` → resolve path to system server
- `mcp_resolve_studio_network_server_path()` → resolve path to network server

**OAuth:**
- `start_oauth_server()` → start local HTTP callback server, return port
- `stop_oauth_server()` → stop server

**PTY / Terminal:**
- PTY commands for terminal integration (reading `pty.rs`)

**Daemon:**
- Commands for starting/stopping local model daemon

### Tauri Events (Rust → Frontend)

- `mcp-server-status` — `{ name: string, running: boolean, error: string | null }` — emitted when any MCP server starts, stops, or crashes

### `.studio/` Folder

LLM- and tool-managed artifacts scoped to a single project:
- `.studio/CODEBASE.md` — generated by `index_codebase` tool; LLM-readable project overview
- `.studio/graph.json` — machine-readable import/export dependency graph with content hashes

---

## 12. Studio-Local MCP Runtime

**Source:** `STUDIO/mcp-servers/studio-local/`
**Language:** TypeScript (Node.js)
**Protocol:** JSON-RPC 2.0 over stdio
**Entry:** `STUDIO/mcp-servers/studio-local/src/registry.ts` (tool definitions + dispatch)

The studio-local package is split into 4 separate server bundles (harness, desktop, system, network) built from the same source. Each bundle is a self-contained Node.js script.

### Tool Summary

**Total tools: 80+** across 10 categories.

### Category: Execution (3 tools)

| Tool | Description |
|---|---|
| `bash` | Shell command (cmd.exe on Windows, /bin/sh on Unix). 50K char output cap, 45s stall kill. |
| `powershell` | PowerShell command. Windows system ops, deployment commands. 50K char cap. |
| `repl` | Node.js or Python interpreter. Temp file execution. |

### Category: Filesystem (12 tools)

| Tool | Description |
|---|---|
| `read_file` | Read file with line numbers. Supports `offset`/`limit` for large files. `allow_large: true` bypasses 5MB gate. |
| `edit_file` | Replace exact string in file (must be unique). |
| `write_file` | Write/overwrite file. Creates parent dirs. |
| `delete_file` | Delete file or directory (`recursive: true` required for dirs). |
| `move_file` | Move/rename file or directory. Copy-then-delete fallback for cross-drive on Windows. |
| `glob` | Find files by glob pattern (e.g., `**/*.ts`). Returns sorted absolute paths. |
| `grep` | ripgrep-based content search. Supports `output_mode`, `context_lines`, `multiline`, pagination. Auto-excludes `.git`, `node_modules`, `dist`. |
| `outline_file` | Structural outline (functions, classes, exports) with line numbers. LSP-first, regex fallback. |
| `ls` | List directory. Skips dotfiles by default. |
| `index_codebase` | Build/refresh `.studio/CODEBASE.md` + `.studio/graph.json`. Incremental (hash comparison). |
| `index_document` | Index local file into cloud RAG (sends to `STUDIO_AI_WORKER_URL`). |
| `explore_codebase` | Composite: build index + return project map + key file outlines. Replaces 5–10 tool calls. |

### Category: Code Intelligence (2 tools)

| Tool | Description |
|---|---|
| `search_symbol` | Find function/class/type by name. LSP workspace symbol first, then grep fallback. |
| `analyze_file` | Deep file analysis: outline + first 40 lines + reverse deps. No full read needed. |
| `lsp` | Language Server Protocol operations (run formatters, get diagnostics, go-to-definition, etc.) |

### Category: Document Indexing (1 tool)

| Tool | Description |
|---|---|
| `index_document` | Read local file, send to cloud RAG via `STUDIO_AI_WORKER_URL`, return session_id. |

### Category: Git (8 tools)

| Tool | Description |
|---|---|
| `git_status` | Working tree status: branch, staged, unstaged, untracked, ahead/behind. |
| `git_diff` | Show changes (staged or unstaged). `stat: true` for file-level summary. |
| `git_log` | Commit history. `format: full` for complete details. |
| `git_commit` | Stage files + create commit. `add_all: true` for `git add -A`. |
| `git_branch` | List / create / switch / delete branches. |
| `git_push` | Push to remote. Uses `--force-with-lease` (not `--force`) for safety. |
| `git_pull` | Fetch + integrate. `rebase: true` for linear history. |
| `git_fetch` | Download remote refs. `prune: true` removes deleted remote branches. |

### Category: Vision (5 tools)

| Tool | Description |
|---|---|
| `screenshot_and_analyze` | Capture screen (full, window, or region) → return image content for LLM vision. Combined in one call. |
| `analyze_image` | Load local image file → return as image content for LLM vision. |
| `fetch_image_url` | Fetch image from URL → return as image content for LLM vision. 20 MB max. |
| `ocr_file` | Extract text from local image file via Windows OCR (Windows.Media.Ocr). |
| `ocr_url` | Fetch image from URL + OCR extract. Combined in one call. |

### Category: Desktop / Monitoring (9 tools)

| Tool | Description |
|---|---|
| `get_system_stats` | CPU %, RAM used/total/free, disk, GPU name + VRAM, OS, uptime. |
| `get_cpu_details` | Processor name, core count, GHz, temperature, per-core % (1s sample). |
| `get_disk_io` | Disk read/write throughput KB/s per physical disk (1s sample). |
| `get_gpu_stats` | GPU load %, VRAM, temp, power. nvidia-smi for NVIDIA; WMI fallback. |
| `get_battery_info` | Charge %, status, runtime estimate, health %. |
| `list_processes` | Running processes: name, PID, CPU s, RAM MB, threads, handles. Sortable. |
| `get_network_stats` | Active TCP connections with local/remote address, state, owning process. |
| `get_network_bandwidth` | Throughput KB/s per adapter (1s sample). |
| `read_event_log` | Windows Event Log entries (System, Application, Security, etc.). |
| `get_memory_details` | RAM breakdown: physical, virtual, page file, pool, cache, page faults/s. |
| `get_storage_info` | All volumes + physical disks with health. |
| `get_system_info` | Full hardware inventory: manufacturer, CPU, BIOS, motherboard, serial. |
| `get_drivers` | Windows driver list. Filter signed/unsigned. |

### Category: Desktop / Control (7 tools)

| Tool | Description |
|---|---|
| `kill_process` | Force-kill process by name or PID. |
| `set_process_priority` | Change scheduling priority (realtime/high/above_normal/normal/below_normal/idle). |
| `suspend_process` | Suspend (freeze) or resume process via NtSuspendProcess/NtResumeProcess. |
| `manage_service` | Windows service: list/status/start/stop/restart/pause/resume. |
| `set_service_startup` | Change service startup type (Automatic/Manual/Disabled/etc.). |
| `run_elevated` | Run PowerShell as Administrator (triggers UAC). Output not capturable; redirect to file. |
| `start_process` | Launch executable. Can wait + capture stdout/stderr. |
| `get_process_details` | Deep process inspection: command line, parent, modules, company, version. |
| `set_process_affinity` | Pin process to specific CPU cores via affinity mask. |

### Category: Desktop / Settings (22 tools)

**Registry (5):** `get_registry_value`, `set_registry_value`, `list_registry_keys`, `delete_registry_value`, `delete_registry_key`

**Display (3):** `list_displays`, `get_display_settings`, `set_display_resolution`

**Audio (5):** `list_audio_devices`, `get_volume`, `set_volume`, `toggle_mute`, `set_default_audio_device`, `set_app_volume`

**Power (3):** `list_power_plans`, `set_power_plan`, `system_power_action` (shutdown/restart/sleep/hibernate/lock/logoff)

**Firewall (4):** `get_firewall_status`, `list_firewall_rules`, `add_firewall_rule`, `remove_firewall_rule`

**Environment (3):** `list_env_vars`, `set_env_var`, `remove_env_var`

**Apps (3):** `list_installed_apps`, `list_startup_apps`, `get_file_association`, `set_file_association`, `manage_startup_app`

**Scheduler (3):** `list_scheduled_tasks`, `manage_scheduled_task`, `create_scheduled_task`

### Category: Desktop / Automation (13 tools)

**Screenshots:**
- `capture_screenshot` — full screen or monitor index. Saves to `%TEMP%` or `save_path`.
- `capture_window_screenshot` — specific window by title substring.
- `screenshot_region` — rectangular region (x, y, width, height).
- `annotated_snapshot` — full screen + overlay numbered labels on interactive elements.
- `ocr_screen` — Windows OCR on screen or region.

**Window Management:**
- `list_windows`, `get_window_info`, `focus_window`, `close_window`, `show_window` (minimize/maximize/restore), `move_resize_window`
- `get_active_window`, `wait_for_window`, `launch_app`

**UI Automation (Windows UI Automation API):**
- `get_ui_tree` — inspect UI element tree of a window (name, type, automationId, bounds)
- `click_ui_element` — click via InvokePattern (falls back to mouse click)
- `get_ui_element_value` — read value via ValuePattern/SelectionItemPattern
- `set_ui_element_value` — write to text field via ValuePattern.SetValue()

**Mouse / Keyboard (8 tools):**
- `move_mouse`, `click_at`, `double_click_at`, `scroll_at`
- `type_text` (SendKeys), `press_hotkey` (SendKeys syntax: `^c`=Ctrl+C, `%{F4}`=Alt+F4)
- `get_mouse_position`, `drag_and_drop`, `key_down`, `key_up`

### Category: Desktop / System UI (3 tools)

| Tool | Description |
|---|---|
| `get_clipboard` | Read Windows clipboard as plain text. |
| `set_clipboard` | Write text to clipboard. |
| `send_notification` | Windows toast notification (Action Center). |
| `show_dialog` | Modal dialog: info/warning/error/question/input types. Returns user response. |

### Category: Network (4 tools)

| Tool | Description |
|---|---|
| `ping_host` | ICMP ping: sent/received/lost/loss%/avg/min/max ms. |
| `check_port` | Test TCP port open/closed. |
| `dns_lookup` | DNS resolution. |
| `traceroute` | Network path trace. |
| `list_wifi_networks` — `disconnect_wifi` | WiFi: scan, status, connect, disconnect |
| `list_adapters` — `set_dhcp` | Network adapter management |
| `manage_hosts_file` | Edit `/etc/hosts` (Windows: `C:\Windows\System32\drivers\etc\hosts`) |

### Category: SSH (2 tools)

| Tool | Description |
|---|---|
| `ssh_exec` | One-shot SSH command. Password or private key auth. Returns stdout/stderr/exit code. |
| `ssh_session` | Persistent SSH shell session. Actions: open/send/close. |

### Category: Interaction (1 tool)

| Tool | Description |
|---|---|
| `ask_user_question` | Show a question to the user and wait for their text response. |

### Category: Utils (1 tool)

| Tool | Description |
|---|---|
| `sleep` | Pause execution for N seconds. |

---

## 13. Local Model Daemon

**Source:** `STUDIO/daemon/`
**Language:** TypeScript (Node.js)
**Purpose:** Bridge between STUDIO frontend and locally running AI models (Ollama, LMStudio).

### Exposed Routes

- `GET /health` — health check
- `GET /models` — list available local models from all providers
- `POST /chat` — chat completions forwarded to local model

### Providers

| Provider | File | Description |
|---|---|---|
| Ollama | `providers/ollama.ts` | Connects to `http://localhost:11434` (Ollama default) |
| LMStudio | `providers/lmstudio.ts` | Connects to LMStudio's local server (OpenAI-compatible API) |

The daemon appears in the STUDIO UI as a connection option in model selection. When connected, local models show alongside cloud models. The `localEngineConnected` flag in `ChatAgentState` tracks whether the daemon is online.

---

## 14. STUDIO Bot (Python)

**Source:** `STUDIO bot/`
**Language:** Python

A Discord/messaging bot that provides STUDIO chat capabilities via messaging platforms.

### Module Structure

```
bot/
  client.py          — bot client setup
  events.py          — Discord event handlers
handlers/
  chat_handler.py    — AI chat request routing
  message_handler.py — message parsing + routing
services/
  api_client.py      — STUDIO API HTTP client
  chat_service.py    — chat session management
  memory_service.py  — memory operations
utils/
  queue_manager.py   — request queue
  whitelist_manager.py — user whitelist
  message_parser.py  — message parsing utilities
```

The bot calls the STUDIO API via `api_client.py`, which targets the public `api` worker endpoint. All AI processing goes through the same cloud backend as the desktop app.

---

## 15. Service Interaction Map

### Chat Turn (Normal, No Local Tools)

```
Client
  │── WebSocket CONNECT ──────────────────────────────► ChatAgent DO
  │
  │── { type: "start", messages, modelId, ... } ──────► ChatAgent
  │                                                         │
  │                                         ┌──────────────┤ memory inject
  │                                         ▼              │
  │                                  MEMORY binding        │
  │                                  (studio-mcp-memory)   │
  │                                         │              │
  │                                         └──────────────► runAgentLoop()
  │                                                         │
  │                                                    ┌───┤ LLM call
  │                                                    ▼   │
  │                                             GATEWAY binding
  │                                             (studio-gateway)
  │                                                    │   │
  │                                             Provider API
  │                                                    │   │
  │◄── stream events ──────────────────────────────────┘   │
  │    (token chunks)                                       │
  │                                                         │
  │◄── tool_start ──────────────────────────────────────────┤ (if tools)
  │◄── tool_complete ────────────────────────────────────────┤
  │                                                         │
  │◄── done { usage } ──────────────────────────────────────┘
  │
  │                                         ┌── MEMORY binding
  │                                         ▼   (post-turn distillation)
  │                                  studio-mcp-memory
  │                                         │
  │                                    GATEWAY (extraction LLM)
  │                                         │
  │                                    Vectorize (store embedding)
```

### Chat Turn (With Local Tools)

```
Client
  │── { type: "start", ... } ──────────────────────────► ChatAgent
  │                                                         │
  │◄── tool_start (local tool) ─────────────────────────────┤
  │◄── local_tools_pending { messages, toolCalls } ──────────┤
  │
  ├── [Tauri calls McpManager.call_tool(server, tool, args)]
  │         │
  │    studio-local MCP server (Node.js subprocess)
  │    ← JSON-RPC tools/call
  │    → { content: [...] }
  │
  │── { type: "tool_results", results: [...] } ───────────► ChatAgent
  │                                                         │
  │                                                  (loop resumes)
  │◄── done ────────────────────────────────────────────────┘
```

### Image Generation

```
Client
  │── POST /v1/images/generate ──────────────────────────► api worker
  │                                                         │
  │                                                   AI binding (studio-chat)
  │                                                         │
  │                                               image_generate tool
  │                                                         │
  │                                               GATEWAY.fetch("/v1/images/generate")
  │                                                         │
  │                                                   studio-gateway
  │                                                         │
  │                                               [fal/cloudflare/openai/openrouter]
  │                                                         │
  │                                               image bytes
  │                                                         │
  │                                               storeGeneratedImage()
  │                                                         │
  │                                               IMAGES_BUCKET R2
  │                                                         │
  │◄── { imageUrl, markdownSnippet, ... } ─────────────────┘
```

### Video Generation (Async)

```
Client
  │── video_generate tool call ─────────────────────────► ChatAgent
  │                                                         │
  │                                               GATEWAY.fetch("/v1/videos/generate")
  │                                                         │
  │                                               fal.ai (async queue)
  │                                                         │
  │◄── { jobId } ────────────────────────────────────────────┤
  │
  │  [later, client calls video_status tool]
  │
  │── video_status { jobId } ────────────────────────────► ChatAgent
  │                                                         │
  │                                               GATEWAY.fetch("/v1/videos/status/{jobId}")
  │                                                         │
  │                                               fal.ai (poll)
  │                                                         │
  │◄── { status: "completed", url: "https://..." } ──────────┘
```

### Agent Run (OmniAgent)

```
Client
  │── POST /v1/omni-agent ──────────────────────────────► api worker
  │                                                         │
  │                                                   AI binding (studio-chat)
  │                                                         │
  │                                               AGENTS binding (studio-agents)
  │                                                         │
  │                                               OmniAgent DO (created/started)
  │                                                         │
  │◄── { agentId, status: "running" } ─────────────────────┤
  │
  │── WebSocket /agents/omni/{agentId} ────────────────────► OmniAgent DO
  │                                                         │
  │                                              while(steps < 60):
  │                                                         │
  │                                              GATEWAY.fetch("/v1/chat/completions")
  │                                                         │
  │                                              MCP_TOOLS → studio-mcp /mcp
  │                                              (parallel tool execution)
  │                                                         │
  │◄── event_log events (streamed) ─────────────────────────┤
  │◄── { status: "completed", result } ─────────────────────┘
```

### Authentication (Google OAuth)

```
Client (Tauri)
  │── Tauri: start_oauth_server() → port:XXXXX
  │
  │── GET /auth/google?redirect_uri=http://localhost:XXXXX/callback
  │                                                    ► auth worker
  │◄── 302 → accounts.google.com/o/oauth2/v2/auth
  │
  │  [Google login + consent]
  │
  │  accounts.google.com → GET http://localhost:XXXXX/callback?code=...
  │
  │── Tauri local server receives callback, forwards to auth worker
  │── POST /auth/callback { code, ... } ─────────────────► auth worker
  │                                                         │
  │                                               exchange code → tokens
  │                                               sign JWT (JWT_SECRET)
  │                                               store in AUTH_KV
  │                                                         │
  │◄── { token: "eyJ..." } ─────────────────────────────────┘
  │
  │── Store token in Tauri secure storage
  │── All subsequent requests: Authorization: Bearer <token>
```

---

## 16. User Flow Blueprints

### 16.1 First Login

1. User opens STUDIO app (Tauri)
2. App presents "Sign in with Google" button
3. Tauri command `start_oauth_server()` opens local port (random, e.g., 52847)
4. App opens browser to `{FRONTEND_URL}/auth/google?redirect_uri=http://localhost:52847/callback`
5. Auth worker redirects to Google PKCE authorization URL
6. User authenticates with Google
7. Google redirects to `http://localhost:52847/callback?code=<code>&state=<state>`
8. Tauri local server receives callback, sends code to auth worker
9. Auth worker exchanges code for tokens, signs JWT, stores in `AUTH_KV`
10. Client receives JWT, stores securely
11. Subsequent requests use `Authorization: Bearer <JWT>`

### 16.2 Starting a Chat

1. Client opens WebSocket to `{API_URL}/agents/{conversationId}` (routes to ChatAgent DO)
2. Client sends `{ type: "start", messages: [...], modelId: "groq:llama-3.3-70b-versatile", temperature: 0.7, ... }`
3. ChatAgent reads `runningMcpServers` from state → determines which local tools are available
4. Memory worker queried for relevant memories → injected as system prompt prefix
5. `runAgentLoop()` called:
   a. `runLlmStep()` — streams tokens to client in real-time via WebSocket `stream` events
   b. If LLM requests tool calls → `runToolsStep()`
   c. Cloud tools execute in parallel, results appended to message history
   d. Local tools → `local_tools_pending` event → client executes via Tauri MCP → `tool_results` sent back
   e. Loop continues until LLM produces final answer with no tool calls
6. `done` event sent with token usage
7. Memory worker receives conversation content for distillation (async, post-turn)

### 16.3 Tool Use (Cloud Tool Example: Web Search)

1. LLM produces tool call: `{ name: "web_search", arguments: { query: "..." } }`
2. ChatAgent emits `tool_start` event to client
3. `runToolsStep()` dispatches `WebSearchTool.execute()`:
   - Calls `https://api.tavily.com/search` with `TAVILY_API_KEY`
   - On 429/5xx: retries with Brave Search (`https://api.search.brave.com/res/v1/web/search`)
4. Result appended to message history as tool message
5. ChatAgent emits `tool_complete` event to client
6. Loop continues: LLM receives search results, produces next turn

### 16.4 Tool Use (Local Tool Example: Read File)

1. LLM produces tool call: `{ name: "read_file", arguments: { path: "/path/to/file.ts" } }`
2. ChatAgent emits `tool_start` event, then `local_tools_pending` event:
   ```json
   { "type": "local_tools_pending", "messages": [...], "toolCalls": [{ "name": "read_file", "args": {...} }] }
   ```
3. Tauri frontend receives event
4. Tauri calls `McpManager.call_tool("harness", "read_file", { path: "..." })`
5. Rust sends JSON-RPC `tools/call` to harness MCP stdio subprocess
6. Node.js harness server reads file, returns content
7. Rust receives response, returns to frontend
8. Frontend sends `{ type: "tool_results", results: [{ callId: "...", content: "..." }] }` to ChatAgent WebSocket
9. ChatAgent resumes loop with tool results in message history
10. LLM receives file content, continues

### 16.5 Agent Creation

1. User creates agent in STUDIO UI
2. `POST /v1/agent-workflows` → api worker → `AI` binding → studio-chat → `AGENTS` binding → studio-agents
3. Agent config stored in `user_agents` table (AI_DB)
4. For manual agents: user triggers run from UI
5. For cron agents: `*/5 * * * *` cron in studio-agents checks schedule expressions, auto-dispatches

### 16.6 MCP Connection (Local)

1. User adds local MCP server in STUDIO Settings
2. UI sends `POST /v1/mcp/connections` with `{ type: "mcp_local", command: "npx", args: ["-y", "some-mcp-package"] }`
3. api → MCP → studio-mcp stores connection config in `REGISTRY_DB`
4. When user enables the server, Tauri calls `mcp_start_server(name, command, args, env_vars)`
5. Rust `McpManager` spawns subprocess, performs JSON-RPC initialize handshake
6. Server added to `runningMcpServers` in ChatAgent state
7. On next chat turn, MCP tools from this server appear in LLM's tool list

### 16.7 MCP Connection (Composio OAuth App)

1. User selects an app from Composio's catalog (e.g., GitHub, Slack, Google Drive)
2. `POST /v1/composio/connections` with `{ appName: "github" }` → stored as `INITIATED`
3. STUDIO redirects user to Composio OAuth URL
4. After OAuth completes, Composio calls STUDIO webhook
5. `PATCH /v1/composio/connections/:id` updates status to `ACTIVE`
6. On next chat turn, Composio tools for this app appear in LLM's tool list
7. Tool calls routed to Composio API via user's Composio `api_key` and `entity_id` (from `composio_config`)

### 16.8 RAG Document Indexing

1. User uploads document in STUDIO
2. `POST /v1/rag/ingest` → api → studio-chat
3. ChatAgent:
   a. Stores raw document in `DOCS_BUCKET` R2 under `permanent/{userId}/{docId}`
   b. Splits document into chunks
   c. Generates embeddings via Workers AI (`@cf/baai/bge-base-en-v1.5`)
   d. Upserts vectors to Vectorize (studio-rag)
   e. Records in `user_documents` D1 table with `chunk_count`
4. On chat turns, `rag` cloud tool available: LLM can call `rag({ query: "..." })` to retrieve relevant chunks via cosine similarity search

### 16.9 Image Generation

1. LLM calls `image_generate` tool with `{ model: "fal:fal-ai/flux-pro/v1.1", prompt: "...", aspect_ratio: "16:9" }`
2. `ImageGenerateTool.execute()`:
   a. Parses `provider:modelId` (→ `fal`, `fal-ai/flux-pro/v1.1`)
   b. Applies style prefix to prompt
   c. Calls `GATEWAY.fetch("http://studio-gateway/v1/images/generate")`
3. studio-gateway routes to fal.ai API
4. fal.ai returns image bytes
5. studio-gateway returns image bytes to ChatAgent
6. `storeGeneratedImage()` writes bytes to `IMAGES_BUCKET` R2 with auto-generated ID
7. Tool returns `{ imageUrl: "https://.../v1/images/{id}", markdownSnippet: "![...](url)" }`
8. LLM copies markdownSnippet verbatim into response → image renders in chat

### 16.10 Video Generation

1. LLM calls `video_generate` with `{ model: "fal:fal-ai/kling-video/v2.1/standard/text-to-video", prompt: "..." }`
2. ChatAgent calls `GATEWAY.fetch("/v1/videos/generate")` with `{ provider: "fal", modelId: "...", prompt: "..." }`
3. Gateway POSTs to fal.ai API — async queue, returns immediately
4. Tool returns `{ jobId: "fal-...", status: "queued" }` to LLM
5. LLM informs user that video is generating and provides the jobId
6. After user waits, LLM calls `video_status { jobId }`:
   a. ChatAgent calls `GATEWAY.fetch("/v1/videos/status/{jobId}")`
   b. Gateway polls fal.ai job status
   c. Returns `{ status: "completed", url: "https://..." }` when done
7. LLM provides video URL in response

### 16.11 File Upload (for Vision)

1. User attaches image to chat message in STUDIO
2. Frontend uploads to `TEMP_IMAGES_BUCKET` R2 via presigned URL or direct upload endpoint
3. Image stored temporarily under `temp/{userId}/{timestamp}/{filename}`
4. Image URL included in the chat message as a vision input
5. ChatAgent's `vision_substitutions` event rewrites temporary URLs to served URLs for the LLM
6. LLM receives image as a vision message part (OpenAI-compatible multi-modal format)

---

## 17. Current vs Planned Architecture

### Currently Implemented (Confirmed from Source Code)

#### Chat / Agent Runtime
- ✅ `ChatAgent` DO with WebSocket streaming and explicit ReAct loop
- ✅ `OmniAgent` DO with 60-step limit, parallel tool execution, event log ring buffer
- ✅ `CodingAgent` DO with 4-phase structured plan
- ✅ Specialist sub-agent system (coding specialists with local tool relay)
- ✅ Memory distillation via `studio-mcp-memory` after each turn
- ✅ Offline catch-up via `completedContent` ring buffer in agent state
- ✅ Blackboard SQL table for cross-agent shared state (in ChatAgent SQLite)

#### Providers / Models
- ✅ 15 providers in registry (openai, anthropic, google, groq, xai, deepseek, mistral, cohere, bedrock, azure, openrouter, alibaba, minimax, ollama, lmstudio, fal)
- ✅ Runtime provider capability override via `PROVIDER_MODALITIES_CONFIG` env var
- ✅ Model list sync every 6 hours from live provider APIs (MODELS_KV)
- ✅ Dynamic admin modes config via KV (no redeploy needed)

#### Tools
- ✅ Web search (Tavily primary, Brave fallback)
- ✅ Web fetch via Jina Reader (`r.jina.ai`)
- ✅ RAG with Vectorize (studio-rag)
- ✅ Image generation (fal, cloudflare, openai, openrouter)
- ✅ Video generation (fal, async with jobId)
- ✅ TTS via MiniMax
- ✅ STT via multiple providers
- ✅ 80+ local tools via studio-local MCP

#### Local / Desktop
- ✅ studio-local MCP servers (studio-harness, computer-use)
- ✅ Local model daemon (Ollama, LMStudio)
- ✅ PTY support for terminal integration
- ✅ LSP integration (Language Server Protocol)
- ✅ FasterWhisper reference (local STT in YouTube transcript worker config)

#### Auth / Security
- ✅ Google OAuth PKCE with Tauri local callback server
- ✅ JWT issuance + revocation via shared REVOKED_KV namespace
- ✅ CF Access JWT support (decode-only) for admin routes

#### Storage
- ✅ Chat history in R2 (studio-chats via chats worker)
- ✅ User preferences in D1 (studio-prefs via studio worker)
- ✅ RAG documents in R2 + Vectorize
- ✅ Generated images in R2 (studio-images)
- ✅ Memory in D1 + Vectorize (studio-mcp-memory)
- ✅ Composio OAuth connections in D1 (studio-ai)

### Previously Implemented, Now Removed (Migration Tombstones in Code)

The following Durable Object classes appear as deleted migrations in `chat/wrangler.toml` (tag v5 = deleted):

- ❌ `AgentStateDurableObject` — replaced by ChatAgent's built-in SQLite state
- ❌ `AgentContextDurableObject` — context now embedded in agent state
- ❌ `SubAgentRunnerDO` — replaced by the specialist relay system via `local_tools_pending`

These were deleted (not just deprecated) — the migration tombstones are required to prevent Cloudflare from attempting to restore the deleted DO namespaces.

### Planned / Partially Implemented (Visible in Code Comments/TODOs)

The following are referenced in code but not fully wired:

#### Auth (Pending)
- 🔄 `MEMORY_AUTH_SECRET` appears in `chat/wrangler.toml` secrets — a fallback static-token auth for the memory worker (currently only the JWT path is primary)
- 🔄 YouTube Transcript MCP: `auth + URL pending` (from memory notes)

#### Architecture Notes
- 🔄 **Chat worker direct provider calls:** Some code paths in `chat/` still call `createProvider()` directly (initializing provider clients inline) rather than routing through `GATEWAY.fetch()`. The architectural intent is to move all LLM calls through the gateway for unified caching/routing, but this migration is in-progress.
- 🔄 **Connection Manager:** A centralized event bus at `services/connection/` is planned for two-layer retry (backend auto + UI manual) and unified timeout configuration.
- 🔄 **MCP auto-restart:** MCP server dead-process detection fires an error; auto-restart on crash is a planned improvement.

#### Future Vision
- 🔮 **WebSocket keepalive/reconnect queuing:** Message queue for WebSocket messages sent while disconnected
- 🔮 **Multi-agent orchestration:** Multiple specialist agents running in parallel with shared blackboard
- 🔮 **Approval timeouts:** Agent tool calls that require user approval with configurable timeout
- 🔮 **Provider balance tracking:** Automatic credit balance monitoring with alerts (`provider_credits` table exists; polling + alert logic planned)
- 🔮 **Expanded agent types:** Beyond omni and coding agents (research, data analysis, etc.)
- 🔮 **RAG over chat history:** Index past conversations for long-term memory retrieval
- 🔮 **Voice mode:** Bidirectional audio via STT + TTS pipeline (infrastructure exists, UI integration planned)

---

## Appendix A: Shared Resource Reference

### Cross-Worker KV Namespace Usage

| Namespace ID | Used As | Workers |
|---|---|---|
| `720a294c0a5844248a4ee8ac6a91fa8f` | `REVOKED_KV` / `AUTH_KV` | auth, studio-chat, studio-gateway, api, studio-mcp |
| `95440eeac45742a298ed39edcc7d3944` | `MODELS_KV` | studio-chat, studio-gateway |
| `2ad99d3c8750412fa2465f255a5d22a1` | `MCP_KV` | studio-chat, studio-gateway |

### Shared D1 Database

`studio-ai` (`2f591e4e-c944-44c1-9943-bf7f2a9f257e`) is bound in both `studio-chat` (as `AI_DB`) and `studio-agents` (as `AI_DB`). The agent tables (`user_agents`, `agent_runs`) are written by `studio-agents` and read by `studio-chat` when it dispatches to the agents service.

### Shared R2 Buckets

`studio-images` and `studio-images-temp` are bound in both `studio-chat` and `studio-gateway`. The chat worker writes generated images; the gateway reads image data when serving the `/v1/images/:id` endpoint.

`studio-releases` is bound in both `studio-chat` (as `RELEASES_BUCKET`) and `api` (as `RELEASES_BUCKET`). Used for distributing application release artifacts.

---

## Appendix B: Model Format Reference

The platform uses a consistent `{provider}:{modelId}` format throughout:

| Example | Provider | Model |
|---|---|---|
| `groq:llama-3.3-70b-versatile` | groq | llama-3.3-70b-versatile |
| `openrouter:anthropic/claude-3.5-sonnet` | openrouter | anthropic/claude-3.5-sonnet |
| `google:gemini-2.0-flash` | google | gemini-2.0-flash |
| `fal:fal-ai/flux-pro/v1.1` | fal | fal-ai/flux-pro/v1.1 |
| `fal:fal-ai/kling-video/v2.1/standard/text-to-video` | fal | fal-ai/kling-video/v2.1/standard/text-to-video |
| `fal:fal-ai/wan/v2.1/text-to-video` | fal | fal-ai/wan/v2.1/text-to-video |
| `openai:gpt-4o` | openai | gpt-4o |
| `anthropic:claude-opus-4-8` | anthropic | claude-opus-4-8 |
| `cloudflare:flux-1-schnell` | cloudflare | flux-1-schnell |
| `openrouter:xiaomi/mimo-v2.5` | openrouter | xiaomi/mimo-v2.5 (used for memory extraction) |

The gateway splits on the first `:` to determine which provider client to instantiate.

---

## Appendix C: Environment Variable Reference

### studio-chat (`chat/wrangler.toml`)

| Var | Value | Type |
|---|---|---|
| `ENVIRONMENT` | `"production"` | var |
| `ENABLED_PROVIDERS` | `"groq,openrouter,google,alibaba,minimax,cloudflare,fal"` | var |
| `R2_ACCESS_KEY_ID` | — | secret |
| `R2_SECRET_ACCESS_KEY` | — | secret |
| `R2_ACCOUNT_ID` | — | secret |
| `JINA_API_KEY` | — | secret |
| `FAL_API_KEY` | — | secret |
| `TAVILY_API_KEY` | — | secret |
| `BRAVE_SEARCH_API_KEY` | — | secret |
| `MEMORY_AUTH_SECRET` | — | secret |
| `MINIMAX_API_KEY` | — | secret |
| `MINIMAX_GROUP_ID` | — | secret |

### studio-gateway (`gateway/wrangler.toml`)

| Var | Value | Type |
|---|---|---|
| `ENVIRONMENT` | `"production"` | var |
| `ENABLED_PROVIDERS` | `"groq,openrouter,anthropic,openai,google,alibaba,xai,deepseek,mistral,cohere,minimax,fal"` | var |
| `OPENAI_API_KEY` | — | secret |
| `ANTHROPIC_API_KEY` | — | secret |
| `GOOGLE_API_KEY` | — | secret |
| `GROQ_API_KEY` | — | secret |
| `XAI_API_KEY` | — | secret |
| `DEEPSEEK_API_KEY` | — | secret |
| `MISTRAL_API_KEY` | — | secret |
| `COHERE_API_KEY` | — | secret |
| `OPENROUTER_API_KEY` | — | secret |
| `ALIBABA_API_KEY` | — | secret |
| `MINIMAX_API_KEY` | — | secret |
| `MINIMAX_GROUP_ID` | — | secret |
| `FAL_API_KEY` | — | secret |
| `AZURE_API_KEY` | — | secret |
| `AZURE_ENDPOINT` | — | secret |
| `BEDROCK_ACCESS_KEY` | — | secret |
| `BEDROCK_SECRET_KEY` | — | secret |
| `BEDROCK_REGION` | — | secret |
| `JINA_API_KEY` | — | secret |
| `TAVILY_API_KEY` | — | secret |
| `CF_AI_GATEWAY_TOKEN` | — | secret |
| `CF_AI_GATEWAY_ID` | — | secret |

### studio-mcp-memory (`workers/mcp/memory/wrangler.toml`)

| Var | Value | Type |
|---|---|---|
| `EXTRACT_MODEL` | `"openrouter:xiaomi/mimo-v2.5"` | var |
| `INJECT_TOKEN_BUDGET` | `800` | var |
| `INJECT_RECENT_COUNT` | `3` | var |
| `INJECT_SEMANTIC_COUNT` | `5` | var |
| `MEMORY_AUTH_SECRET` | — | secret |
| `JWT_SECRET` | — | secret |

### auth (`auth/wrangler.toml`)

| Var | Value | Type |
|---|---|---|
| `FRONTEND_URL` | includes Tauri origins | var |
| `GOOGLE_CLIENT_ID` | — | secret |
| `GOOGLE_CLIENT_SECRET` | — | secret |
| `JWT_SECRET` | — | secret |

### studio-agents (`agents/wrangler.toml`)

| Var | Value | Type |
|---|---|---|
| `DEFAULT_MODEL` | `"groq:llama-3.3-70b-versatile"` | var |
| `ENVIRONMENT` | `"production"` | var |

---

*This document was generated from source code on 2026-06-21. It reflects the state of the implementation at that time.*
