# 02 — Target Architecture (Version 2)

> What the system looks like when Phase 2 is finished, and why each piece is shaped
> that way. Decisions referenced as D1…D12 are recorded in `03-DECISION-LOG.md`.

## 1. Design goals

1. **Local-first.** The main agent loop runs on the user's machine inside Studio, with
   full tool calling, streaming, state, long-running tasks, and sub-agents.
2. **Cloud-compatible.** The same loop runs on Cloudflare for cloud conversations.
   One shared implementation; only thin platform adapters differ (D9).
3. **Vendor independence, correctly defined.** Library abstractions (Vercel AI SDK)
   are acceptable; infrastructure coupling (Durable Objects, Cloudflare Agents SDK,
   WS hibernation APIs) inside the core loop is not (D8).
4. **Single responsibility per worker.** Gateway routes providers. Data owns user data.
   Registries register. AI runs the loop. Nothing else.
5. **Unchanged user experience.** Frozen WS protocol, stable API surface. Users must
   not notice the migration.

## 2. Final topology

```
CLIENTS            STUDIO Desktop (Tauri)      STUDIO Web        STUDIO Bot (unchanged)
                        │  local loop                │                  │
                        │  + local MCPs              │                  │
                        ▼                            ▼                  ▼
PUBLIC EDGE        ┌──────────────────────────────────────────────────────┐
                   │ api (JWT gate — the only general public entry point) │
                   │ auth (public — OAuth/JWT issuance)                    │
                   │ mcp hub (public MCP endpoint, own JWT gate)           │
                   └──────────────┬───────────────────────────────────────┘
                                  │ service bindings (private)
INTERNAL MESH      studio-ai ── studio-gateway ── [AI providers via CF AI Gateway]
                   studio-data (3× R2 + D1)      tracker
                   studio-skills (registry)      studio-mcp (registry + Composio)
                   studio-mcp-memory (MCP)       studio-tools (native cloud MCP)
LOCAL (in Studio)  agent loop (shared pkg) · Agent Spawn MCP · Agent Communication MCP
                   Agent Management MCP · Skill Management MCP · Skill Runtime MCP
                   MCP Management (in harness) · local daemon (Ollama/LM Studio)
```

Deleted relative to today: `chat/`, `agents/`, `gateway/` (old),
`workers/ChatsStorage/`, `workers/Studio/`.

## 3. Cloud services

### 3.1 Gateway (`gateway-v2/` → `studio-gateway`)
Provider router only. Multi-modal (chat, vision, tools, embeddings, STT/TTS,
image/video/music gen), normalized internal format, egress through Cloudflare AI
Gateway with direct-key fallback, model catalog discovery, error taxonomy. No auth
(internal-only), no storage (media pass-through), no bespoke telemetry (CF AI Gateway
+ thin tracker summary). Fully specified in `gateway-v2/GATEWAY_GUIDE.md`.

### 3.2 AI (`ai-v2/` → `studio-ai`) — replaces `chat/`
Pure compute. Owns the interactive loop: WS per conversation, ReAct loop, streaming,
cloud-tool execution, local-tool relay, model tier routing, per-turn persistence via
`studio-data`, fire-and-forget memory distillation. No R2/D1/Vectorize of its own.
No Durable Objects, no Cloudflare Agents SDK (D8). Loop engine is Vercel AI SDK core
against a gateway-backed custom provider (D9). Session state behind a `SessionBackend`
interface: Cloudflare D1 in cloud, SQLite locally. Full spec: `ai-v2/AI_GUIDE.md`
(as amended by D4, D8, D9).

### 3.3 Data (`workers/data/` → `studio-data`) — merges `chats` + `studio`
The single home for user data. Absorbs upload routes and blob-lifecycle crons
currently in `chat/`.

| Bucket | Contents | Notes |
|---|---|---|
| `user-uploads` | documents, images, user files | temp-upload expiry lifecycle |
| `conversations` | conversation history | JSON-formatted, encrypted at rest |
| `generated-content` | AI images/videos, generated artifacts | |

Plus the D1 preferences store inherited from `workers/Studio/`. Three buckets rather
than one-with-prefixes because lifecycle rules, access patterns, and the encryption
boundary differ per class (D3).

### 3.4 Registries
- **`mcp/` (studio-mcp):** MCP registration + Composio. Every MCP server in the
  ecosystem — including our own `studio-tools` and memory — is registered here. Public
  MCP endpoint with its own JWT gate (per `STUDIO_MASTER_PLAN.md`).
- **`skills/`:** skill registration + discovery metadata only. No skill bodies, no
  instructions, no execution (D5). Bundled content migrates to the local skill store.

### 3.5 MCP servers (cloud)
- **`studio-tools`** (from `workers/mcp/tools/`): native cloud capabilities — image
  generation/editing, video generation/editing, RAG, web search, web fetch, HTTP
  requests. Media generation calls go through `studio-gateway`. Name provisional (D11).
- **`studio-mcp-memory`:** all memory operations, memory tools, automatic memory
  binding. Also receives the docs/KB/Vectorize routes leaving `chat/`.

### 3.6 Tracker
Same responsibility — events, telemetry, activity — restructured into proper
ingest/query/route modules. Receives thin summaries from gateway (CF AI Gateway holds
inference analytics) and local-execution telemetry relayed through `api`.

### 3.7 API + Auth + Packages
Functionally unchanged. Endpoints adjusted as cutovers require. `packages/jwt` import
rule stands (auth signs; api and mcp hub verify; nobody else). New shared code between
cloud and local — above all `packages/agent-loop` — lives in `packages/` (D9).

## 4. Local execution environment (Studio)

### 4.1 The local loop
The same `packages/agent-loop` code as `studio-ai`, running in a Node sidecar bundled
with the Tauri app, bound to `127.0.0.1`. Differences from cloud are adapters only:
SQLite `SessionBackend`, HTTP(S) transport to gateway instead of a service binding,
and optional local-daemon providers (Ollama / LM Studio).

**Registration flow (every conversation, local or cloud):**
1. User sends a message/task in Studio.
2. Studio calls `api` — auth, conversation registration, usage/telemetry entry.
3. Execution begins locally (sidecar loop) or in the cloud (`studio-ai`).
4. Cloud-model inference from a local loop still flows `api → gateway → provider`;
   local-model inference goes to the daemon but the turn is still registered.
5. Completion, usage, and history are reported back (`api` → tracker / studio-data).

This mirrors how Claude Code / Codex remain gateway-connected while executing locally.

### 4.2 Local MCP servers (D6, D7)
Sub-agent functionality moves entirely local. Agent operations are tools, exposed as
MCP servers the local loop consumes:

| Server | Responsibility |
|---|---|
| **Agent Spawn MCP** | Creating, starting, cancelling agents |
| **Agent Communication MCP** | Structured inter-agent communication (Blackboard replacement): collaboration, boundaries, in-flight messaging rather than wait-for-completion |
| **Agent Management MCP** | Creating, removing, deleting, managing existing agents |
| **Skill Management MCP** | Installing/removing/adding skills; from folders and URLs; location management |
| **Skill Runtime MCP** | Reading, running, interacting with skills |
| **MCP Management** (in studio-harness) | Add/remove/delete/configure MCP servers locally |

Coordination note (accepted risk of the split, D6/D7): Spawn/Management share agent
state, and Skill Management/Runtime share the skill store. Each pair therefore
**must** consume one shared local state layer (single SQLite/agent-state module;
single skill-store directory contract) rather than owning private copies. That
contract is defined once, in the local runtime, before either server of a pair is built.

Local agents (research, coding, exploration, debugging, specialized) persist execution
state so they can resume interrupted work.

## 5. Long-running tasks

Local execution removes the cloud round-trip per tool call, making long-running
coding/research/autonomous workflows practical. The registration flow (§4.1) keeps
usage, telemetry, and history complete regardless of where execution happens.
