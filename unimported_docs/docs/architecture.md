# Project Studio — Architecture

> **Last updated:** 2026-06-14
> **Status:** Mid-development. Active work ongoing. Treat code as ground truth; this doc describes the intended and largely-implemented structure.

For architectural decisions, rationale, and per-objective history see `docs/STUDIO_DECISIONS_2026.md`.

---

## System Overview

Project Studio is a cloud-first AI platform with a Tauri desktop app front-end. The AI orchestration, tool execution, and all LLM calls run on Cloudflare Workers. The desktop app adds local MCP servers, local model inference, and desktop automation on top of the cloud layer.

**Key principles:**
- Cloud-first: all AI intelligence lives in CF Workers, not on the user's machine
- WebSocket-primary: one persistent WS connection per conversation (not HTTP/SSE per message)
- CF Agents SDK: `ChatAgent` Durable Object drives the conversation loop — no LangGraph
- MCP-hub pattern: `studio-chat` and `studio-agents` never call capability workers directly — they go through `studio-mcp`

---

## Worker Map

```
Public (internet-accessible):
  studio.com / app        → Cloudflare Pages (STUDIO React frontend)
  api.studio.com          → api Worker (auth, routing, job queue, updates)

Internal only (Service Bindings — no public routes):
  studio-chat             → ChatAgent DO, WebSocket sessions, cron dispatcher
  studio-gateway          → LLM routing, provider adapters, model discovery
  studio-agents           → OmniAgent DO, CodingAgent DO
  studio-mcp              → MCP hub / registry / router
  studio-mcp-memory       → Memory storage, extraction, vector search
  studio-mcp-youtube      → YouTube transcript extraction
  studio-tracker          → Telemetry, usage, cost tracking
  auth                    → JWT issuing, Google OAuth, email whitelist
```

`api` and `auth` carry no Studio prefix — they are centralized infrastructure, not Studio-specific.

---

## Service Binding Graph

```
api              → auth                 token validation
api              → studio-chat          WebSocket routing + agent sessions
api              → studio-mcp-memory    memory routes (direct, legacy path)
studio-chat      → studio-gateway       all LLM calls
studio-chat      → studio-agents        spawn + poll OmniAgent / CodingAgent
studio-chat      → studio-mcp           ALL MCP (memory inject, capability tools)
studio-agents    → studio-gateway       LLM calls (independent of chat)
studio-agents    → studio-mcp           all tool calls via MCP hub
studio-gateway   → studio-tracker       per-LLM-request cost + token tracking
studio-mcp       → studio-mcp-memory    memory storage + retrieval
studio-mcp       → studio-mcp-youtube   transcript extraction
studio-mcp       → studio-tracker       MCP usage tracking
```

All cross-worker calls use Service Bindings — Cloudflare internal network, ~1ms overhead.

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                          END USER                                 │
│            Desktop App (Tauri)  ·  Web Browser  ·  Discord        │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                    api Worker (public)                            │
│  Hono · JWT auth · Job queue · OpenAI adapter · Update serving   │
└──┬──────────┬──────────┬──────────┬──────────┬───────────────────┘
   │          │          │          │          │
   ▼          ▼          ▼          ▼          ▼
studio-   studio-    studio-   studio-   workers/
chat      tracker    mcp-mem   agents    Studio/Chats
(WebSocket)                             (prefs/storage)
   │
   ├── studio-gateway   (LLM calls)
   ├── studio-agents    (spawn/poll agent DOs)
   └── studio-mcp       (memory inject + tool routing)
         ├── studio-mcp-memory
         └── studio-mcp-youtube
```

```
                                      │
                    ◄─────────────────┘
                    │  WebSocket (local_tools_pending)
                    ▼
┌──────────────────────────────────────────────────────────────────┐
│                  STUDIO Desktop App (Tauri)                       │
│  React Frontend · Rust Backend · MCP Subprocess Manager · Daemon  │
└──┬───────────┬──────────┬────────────────────────────────────────┘
   │           │          │
   ▼           ▼          ▼
studio-    computer-    Daemon
harness    use MCP      (Ollama / LM Studio bridge, port 11435)
(200+ tools)
```

---

## Core Workers

### api (public gateway)

Entry point for all frontend traffic. Auth, routing, job queue for local inference, app auto-updates, OpenAI-compatible API surface. See `api/README.md`.

### studio-chat

Owns all active conversations. One `ChatAgent` Durable Object per thread. Persistent WebSocket with the STUDIO frontend. Runs an explicit ReAct `while` loop — no LangGraph. Routes tool calls: inline cloud tools execute here; local/MCP tools relay to Tauri via WebSocket; agent spawning goes to `studio-agents`. See `chat/README.md`.

### studio-gateway

LLM routing layer. Accepts `"provider:model-id"` format, strips prefix, calls upstream provider API. Supports 16+ providers via thin `@ai-sdk/*`-backed adapters. Dynamic 5-tier auto-router (`simple → standard → complex → advanced → extreme`) — currently in `static` mode pending classifier validation. Model catalog cached in KV (6-hour cron refresh). See `gateway/`.

### studio-agents

Durable Object worker for long-running background agents:
- **OmniAgent** — general-purpose agent (research, analysis, writing, multi-step tasks). `runFiber()` for hibernation-safe execution. Parallel tool calls by default.
- **CodingAgent** — specialist for code tasks. 4-phase protocol (orientation → targeted read → cross-reference → act). Needs rewrite before production use.

Both use `studio-gateway` for LLM calls and `studio-mcp` for all tools. See `agents/`.

### studio-mcp (hub)

Central MCP registry and router. `studio-chat` and `studio-agents` call this — never individual capability workers directly. Routes by namespace prefix:
- `memory/*` → `studio-mcp-memory`
- `youtube/*` → `studio-mcp-youtube`
- Local tools → daemon signal

Also hosts native cloud tools directly: `think`, `web_search`, `web_fetch`, `rag`, `image_generate`, `video_generate`, `http_request`. See `mcp/hub/`.

### studio-mcp-memory

Memory storage, extraction, and retrieval. D1 + Cloudflare Vectorize. Auto-extracts facts from conversations (LLM pass, `ctx.waitUntil()`, zero latency impact). Semantic similarity search via `@cf/baai/bge-base-en-v1.5` embeddings. 7 memory tiers: `working` (24h) → `short` (14d) → `periodic / project / personal / core` (permanent). See `mcp/memory/`.

---

## STUDIO Desktop App

**Location:** `STUDIO/`  
**Stack:** Tauri 2 (Rust) + React 19 + Vite + TypeScript  
**Modes:** Desktop (full features) or Web (no local tools, no MCP, no local inference)

### Frontend Key Modules

| Module | Purpose |
|--------|---------|
| `src/contexts/chat/ChatProvider.tsx` | Main chat context — streaming, tool execution, conversation state |
| `src/pages/ChatPage.tsx` | Chat UI — messages, tool cards, input |
| `src/services/ai/useAgentChat.ts` | Persistent WebSocket hook per conversation |
| `src/pages/WorkspacePage.tsx` | Knowledge Base / Memory / Agents management |
| `src/pages/ComputerUsePage.tsx` | Computer use agent UI |
| `src/components/ui/ArtifactPanel.tsx` | Right-side panel: agent activity, code, document views |
| `src/agent/core/ContinuationEngine.ts` | Auto-continuation when AI hits iteration limits |
| `src/services/connection/ConnectionManager.ts` | Centralized WS + MCP reliability event bus |

### Rust/Tauri Backend

| Module | Purpose |
|--------|---------|
| `src-tauri/src/mcp.rs` | MCP subprocess lifecycle — start, stop, call_tool, JSON-RPC over stdio |
| `src-tauri/src/daemon/mod.rs` | Local inference daemon (Ollama/LM Studio bridge) |
| `src-tauri/src/commands/oauth_server.rs` | Local OAuth callback server (port 8765) |
| `src-tauri/src/lib.rs` | App bootstrap, 29 Tauri command registrations |

### Local MCP Servers (subprocesses)

| Server | Tools | Notes |
|--------|-------|-------|
| `studio-harness` | 200+ (filesystem, bash, git, SSH, desktop, network) | Main coding agent toolset |
| `computer-use` | Desktop automation, system monitoring/control, network management | Desktop-only |

---

## Chat Request Flow

```
User message
  │
  ▼
STUDIO frontend (useAgentChat WebSocket hook)
  │  Persistent WS per conversation
  ▼
api Worker
  │  JWT auth → inject X-User-ID → forward to studio-chat via Service Binding
  ▼
ChatAgent DO (studio-chat)
  │
  ├── Phase 1 — Direct streaming via studio-gateway
  │     └── If no tool calls: stream answer → done
  │
  └── Phase 2 — ReAct loop (loop.ts)
        ├── Execute cloud tools inline
        ├── Relay local/MCP tools → STUDIO via WebSocket → Tauri → MCP subprocess
        ├── Spawn agents → studio-agents via Service Binding
        └── Continue until no tool calls or iteration limit
              └── Auto-continuation: ContinuationEngine builds a silent user message
```

---

## Local Inference Flow

```
STUDIO selects local:ollama:* or local:lmstudio:*
  │
  ▼
studio-chat returns local_inference_required event (with prepared context)
  │
  ▼
STUDIO calls daemon at localhost:11435
  │
  ▼
Daemon (Express, port 11435)
  ├── Routes to OllamaProvider (localhost:11434)
  │   or LMStudioProvider (localhost:1234)
  ├── Multi-round tool loop (max 10 rounds)
  │   ├── POST messages → local model
  │   ├── If tool_calls: relay to studio-chat callback URL
  │   └── Append results → continue
  └── Streams tokens back to STUDIO
```

---

## Data Storage

| System | Worker | Technology | Data |
|--------|--------|------------|------|
| Chat history | ChatsStorage | R2 (gzip-compressed) | Per-conversation JSON |
| Memory facts | studio-mcp-memory | D1 + Vectorize | Extracted facts, embeddings |
| MCP registrations | studio-chat | D1 (AI_DB) | Server config, enabled status |
| User documents (KB) | studio-chat | D1 + R2 + Vectorize | Permanent uploaded docs |
| Agent workflows | studio-chat | D1 (AI_DB) | Scheduled agent definitions + run history |
| Model cache | studio-gateway | KV (MODELS_KV) | Discovered model metadata + pricing |
| User preferences | workers/Studio | D1 | models/ui/behavior settings per user |
| Usage tracking | studio-tracker | D1 | Events, spans, token/cost per request |
| Job queue | api | D1 (studio-jobs) | Local inference jobs |
| App releases | api | KV + R2 | Update manifests + installers |
| Agent state | studio-chat | Durable Objects | ChatAgent SQLite state per thread |

---

## Authentication

| Token | Issued by | Lifetime | Storage |
|-------|-----------|----------|---------|
| Access JWT | `auth` worker | 1 hour | Frontend memory |
| Refresh JWT | `auth` worker | 7 days | HttpOnly cookie + body (desktop) |

Flow: User → Google OAuth → `auth` worker verifies idToken + checks KV whitelist → issues JWT pair.

Desktop variant: Tauri starts local HTTP server on port 8765, opens browser for Google login, captures OAuth callback code, exchanges for tokens.

---

## Current Open Items

See `docs/STUDIO_DECISIONS_2026.md` Section 14c for the pre-deploy audit checklist.

Key items tracked there:
- Tracker wiring audit across all workers
- Error propagation audit (no raw errors to frontend)
- Frontend ↔ backend contract verification
- `cancel_agent` endpoint wiring in `studio-agents`
- TypeScript clean compile across all workers
