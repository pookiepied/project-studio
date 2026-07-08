# Project Studio — Replacement Plan

> **Last updated:** 2026-05-31
> **Scope:** What gets replaced, what it gets replaced with, and why — ordered by priority.
> **What does NOT change:** Auth worker, Tracker worker, auto-router, tool tier/visibility system, expand_tools meta-tool, all tool implementations, Studio Harness local MCP bridge.

---

## Philosophy: Open-Source First

Before writing any custom code, check if an open-source library, official SDK, or managed service already does it well. This project proves the approach works: replacing 3,200 lines of custom SSE parsers with `@ai-sdk/*` packages took one week and the result is more correct, better maintained, and handles edge cases we never would have caught.

**The rule:**
1. **New AI provider?** → Check `@ai-sdk/*` first. Only write a custom adapter if no package exists.
2. **New MCP tool category?** → Check [modelcontextprotocol.io/servers](https://modelcontextprotocol.io/servers) first. Only build custom if nothing fits.
3. **New integration?** → Check Composio (250+ apps with OAuth handled). Only write HTTP calls if Composio doesn't cover it.
4. **New cloud capability?** → Check Cloudflare-native first (D1, R2, Vectorize, KV, Workers AI). Avoids external dependencies and keeps costs low.
5. **New UI pattern?** → Check Vercel AI SDK UI hooks, shadcn/ui, or existing React ecosystem. Don't hand-roll what a library does in 10 lines.
6. **Any new tool?** → Open npm and GitHub before opening a new file.

This applies retroactively too: if existing custom code has a good open-source replacement, it's a candidate for this doc.

---

## Current Status Overview

| # | Replacement | Status |
|---|---|---|
| 1 | Cloudflare AI Gateway | ✅ Done |
| 2 | Provider adapters → `@ai-sdk/*` | ✅ Done |
| 3 | Image + video generation → fal.ai | ✅ Done |
| 4 | Web fetch → Jina Reader | ✅ Done |
| — | Web search → Tavily | ✅ Done |
| 5 | LangGraph → Cloudflare Agents SDK | ✅ Done |
| 6 | `aiService.ts` + `ChatContext` → `useAgentChat` + modular chat context | ✅ Done |
| 7 | Studio Harness dev tools → official MCP servers | 🔜 Planned |
| 8 | ChatPage.tsx decomposition | ✅ Done (hooks extracted, 925→573 lines) |
| 9 | Composio → deep integration | 🔜 Planned |
| 10 | Memory system → hybrid search | ✅ Done (Vectorize wired, D1 + vector search) |
| 11 | Auth → managed provider | 💭 Consider |
| 12 | Monorepo tooling | 💭 Consider |

---

## Table of Contents

1. [LangGraph Orchestration → Cloudflare Agents SDK](#1-langgraph-orchestration--cloudflare-agents-sdk)
2. [Provider Adapters (16 custom) → @ai-sdk/* packages](#2-provider-adapters-16-custom--ai-sdk-packages)
3. [Frontend Streaming → useAgentChat WebSocket hook](#3-frontend-streaming--useagentchat-websocket-hook)
4. [Image Generation → fal.ai](#4-image-generation--falai)
5. [Video Generation → fal.ai (async)](#5-video-generation--falai-async)
6. [Web Fetch → Jina Reader](#6-web-fetch--jina-reader)
7. [Studio Harness — Dev Tools Split](#7-studio-harness--dev-tools-split)
8. [ChatPage.tsx Decomposition](#8-chatpagetsx-decomposition)
9. [Cloudflare AI Gateway (transparent proxy)](#9-cloudflare-ai-gateway-transparent-proxy)
10. [Composio — Deepen Integration](#10-composio--deepen-integration)
11. [Memory System — Hybrid Search](#11-memory-system--hybrid-search)
12. [Auth — Managed Provider](#12-auth--managed-provider)
13. [Monorepo Tooling](#13-monorepo-tooling)
14. [What Stays & Why](#14-what-stays--why)
15. [Open-Source Candidates for Future Features](#15-open-source-candidates-for-future-features)

---

## The Four Layers

| Layer | Before | After | Status |
|---|---|---|---|
| **Proxy** | Manual logging per provider | Cloudflare AI Gateway | ✅ Done |
| **Provider adapters** | 16 custom SSE parsers | `@ai-sdk/*` packages | ✅ Done |
| **Agent orchestration** | LangGraph StateGraph + 3 custom DOs | Cloudflare Agents SDK + explicit ReAct loop | ✅ Done |
| **Frontend streaming** | 1,247-line `aiService.ts` + 2,335-line ChatContext | `useAgentChat` WebSocket hook + modular chat context | ✅ Done |

---

## 1. LangGraph Orchestration → Cloudflare Agents SDK

✅ **Complete**

### What changed

**Removed entirely:**
- `agent/graph.ts` — StateGraph, compiled graph, WeakMap caching, conditional edge routing
- `agent/state.ts` — LangGraph Annotation state schema
- `AgentStateDurableObject` — deleted in DO migration v5
- `AgentContextDurableObject` — deleted in DO migration v5
- `SubAgentRunnerDO` — deleted in DO migration v5
- `RemoteMCPTool` — replaced by Agents SDK native MCP client

**Replaced with:**
- **`ChatAgent.ts`** (391 lines) — extends `Agent<Env, ChatAgentState>`, Durable Object with native SQLite state (DO v4 migration)
- **`loop.ts`** (287 lines) — explicit ReAct `while` loop, replaces LangGraph state machine
- **`ResearchSubAgent`** — native Agents SDK sub-agent spawned via `subAgent()`
- **WebSocket-first** — client connects once; tool results sent back over the same connection; no 70 KB history echo per round-trip

### What the DO migration cleaned up

| Migration | What happened |
|---|---|
| v1–v3 | Legacy class setup |
| v4 | `ChatAgent` and `ResearchSubAgent` promoted to `new_sqlite_class` |
| v5 | Deleted `AgentStateDurableObject`, `AgentContextDurableObject`, `SubAgentRunnerDO` |

`RateTrackerDurableObject` kept for backward compatibility.

### What stays custom (plugs into Agents SDK)
- **Local tool relay** (cloud → WebSocket → Tauri → local execution → resume) — always custom; Agents SDK provides the WebSocket layer it now runs on
- **Tool tier/visibility system** — tier-1 always visible, tier-2 keyword-gated, MCP activation — `prepareTools()` called before each LLM turn
- **expand_tools meta-tool** — schema injection, rate-limited, catalog-categorized — custom, plugs into the loop
- **Two-phase streaming** — Phase 1 (direct stream for first-token latency) custom; loop handles Phase 2

---

## 2. Provider Adapters (16 custom) → @ai-sdk/* packages

✅ **Complete**

### What changed

| Before | After |
|---|---|
| 16 hand-rolled adapters, ~3,200 lines | 10 thin adapters, `~800 lines total` |
| Custom SSE parsing per provider | `@ai-sdk/*` packages handle the wire format |
| Manual token counting | SDK provides usage objects |
| Custom error normalization | SDK normalizes errors |

### Current adapter inventory (`ai/src/gateway/providers/adapters/`)

| Adapter | Backed by |
|---|---|
| `anthropic.ts` | `@ai-sdk/anthropic` |
| `google.ts` | `@ai-sdk/google` |
| `groq.ts` | `@ai-sdk/groq` + Groq quirks (231 lines) |
| `openrouter.ts` | `@ai-sdk/openai-compatible` (50 lines) |
| `generic.ts` | Factory for OpenAI, Mistral, XAI, DeepSeek via their `@ai-sdk/*` packages |
| `alibaba.ts` | DashScope API (31 lines, no official package) |
| `minimax.ts` | MiniMax TTS + cloning (95 lines, no official package) |
| `ollama.ts` | Local inference (25 lines) |
| `lmstudio.ts` | Local inference (25 lines) |
| `base.ts` | BaseAdapter class (347 lines) |

**Rule going forward:** If a new provider is added, check `@ai-sdk/*` first. If the package exists, use it. Never write a custom SSE parser again.

### Packages in ai/package.json
```
@ai-sdk/anthropic, @ai-sdk/deepseek, @ai-sdk/google, @ai-sdk/groq
@ai-sdk/mistral, @ai-sdk/openai, @ai-sdk/openai-compatible, @ai-sdk/xai
ai (core), agents (Cloudflare Agents SDK)
```

---

## 3. Frontend Streaming → useAgentChat WebSocket hook

✅ **Complete** — but NOT Vercel's `useChat()`. Custom WebSocket hook built instead.

### Why custom WebSocket instead of Vercel useChat()

Vercel's `useChat()` is designed around HTTP/SSE streaming to a stateless endpoint. This project uses a persistent Durable Object (`ChatAgent`) with WebSocket — a fundamentally different protocol. Wrapping `useChat()` around it would require more adapter code than just writing the hook directly.

### What changed

| Before | After |
|---|---|
| `aiService.ts` — 1,247 lines | `aiService.ts` — 55 lines (re-export facade only) |
| `ChatContext.tsx` — 2,335 lines (monolith) | `ChatContext.tsx` — 13 lines (re-export) |
| HTTP/SSE per request, ~70 KB history resent each round | WebSocket per conversation, ~1 KB tool results only |
| SSE parsing: 11 hand-rolled event types | WebSocket message types: typed protocol |

### Current structure

**`useAgentChat.ts`** (444 lines) — replaces `aiService.chatStream()`:
- Persistent WebSocket per conversation (not per message)
- Sends only tool results on relay, not full history
- `onLocalToolsPending` callback bridges to Tauri tool execution
- Exponential backoff reconnect

**`contexts/chat/`** — ChatContext split into 9 focused modules:
```
ChatProvider.tsx      — main provider (1,412 lines, down from 2,335)
messageBuilder.ts     — token-based pruning, system messages
toolExecutor.ts       — local/MCP tool execution
contextCompactor.ts   — context size optimization
toolClassifier.ts     — tool routing classification
notifications.ts      — desktop notification handling
types.ts              — ChatContextType, TodoItem, ActiveToolCall, ToolDisplayClass
constants.ts          — SENSITIVE_TOOLS, SILENT_TOOLS, CAPSULE_NATIVE_TOOLS
index.ts              — barrel export
```

**What stays custom:** relay state, permission gates, continuation engine, sub-agent card state, auto-routing display info. These are application logic with no library equivalent.

---

## 4. Image Generation → fal.ai

✅ **Complete**

`imageGenerate.ts` (673 lines) routes across:
- **fal.ai** (primary) — 100+ models, supports source image editing, style presets, aspect ratio mapping
- **OpenRouter** — legacy, deprecated but kept for compatibility
- **Cloudflare Workers AI** — `env.AI` binding, no external call
- **OpenAI DALL-E** — still supported

Style presets (photorealistic, anime, cinematic, oil-painting, watercolor, sketch, digital-art) and aspect ratio → pixel dimension mapping all stay as application logic.

**Note:** fal.ai calls are made directly from tool code — no `@fal-ai/serverless-client` package. This is fine for now but the SDK would handle retry/error normalization — a candidate for a future simplification.

---

## 5. Video Generation → fal.ai (async)

✅ **Complete** — and the broken UX is fixed.

**Before:** Polling every 5 seconds, hard 90-second timeout, returned raw `jobId` if job wasn't done.

**After:**
- `videoGenerate.ts` (280 lines) — submits to fal.ai, returns `jobId` immediately
- `videoStatus.ts` (181 lines) — separate tool the agent calls to check completion
- Models: Kling 2.1, WAN 2.1, Luma Ray 2, MiniMax Hailuo, CogVideoX 5B
- Auto-swaps to image-to-video model variant when `source_image` provided

No more timeout cliff. Agent polls status when it wants to check, not on a fixed timer.

---

## 6. Web Fetch → Jina Reader

✅ **Complete**

- `webFetch.ts` (341 lines) — calls `r.jina.ai/{url}`, returns clean Markdown
- Handles JS-heavy SPAs, PDFs, GitHub, Reddit, YouTube transcripts
- Falls back to raw HTML stripper if `JINA_API_KEY` not set
- Free tier: 1M tokens/month with key

**Web search → Tavily** — also complete. `webSearch.ts` (106 lines) calls Tavily API. Returns AI-synthesized answer + full results with 200-400 word content extracts. Free tier: 1,000 searches/month.

**RAG → Cloudflare Vectorize** — added alongside these. `rag.ts` (149 lines) + `ragUtils.ts`. Uses `@cf/baai/bge-base-en-v1.5` embeddings via Workers AI (no external API call). Documents stored in R2 `studio-docs` bucket with 24h TTL lifecycle rule.

---

## 7. Studio Harness — Dev Tools Split

🔜 **Next**

### Current state

Single `studio-harness` MCP server with a 2,626-line `registry.ts` covering everything: filesystem, git, execution, desktop automation, system monitoring, network, security, LSP, interaction.

### The split

**Split A — Official MCP Reference Servers** (replace the boring half):

| Current harness tools | Replace with |
|---|---|
| `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `list_directory`, `outline_file`, `index_codebase` | `@modelcontextprotocol/server-filesystem` |
| `git_status`, `git_diff`, `git_log`, `git_commit`, `git_branch` | `@modelcontextprotocol/server-git` |

These are Node.js stdio processes — Tauri spawns them exactly like it spawns studio-harness today. No architectural change needed.

`bash`, `powershell`, `repl`, `run_process` — no official server exists. Move to Studio Desktop MCP.

**Split B — Studio Desktop MCP** (the unique half):

The Windows-native tools have no equivalent. They become a smaller, focused server:
- Desktop automation (screenshots, OCR, mouse/keyboard control, window management, UI tree)
- System monitoring (GPU, CPU, disk I/O, process list, network bandwidth, event logs)
- Desktop settings (registry, display, audio, power, firewall, environment, scheduled tasks)
- Network (SSH, WiFi, adapter management, DNS, hosts file)
- Security (user/group management)
- Execution (bash, powershell, REPL, run_process)
- Interaction (ask_user_question, clipboard, notifications)

**Result:** Official servers handle the commodity tools. Studio Desktop MCP becomes ~100 tools of genuine unique value.

**LSP tool:** check [mcp-lsp](https://github.com/modelcontextprotocol/servers) — if an official LSP server exists, use it. Otherwise keep custom.

---

## 8. ChatPage.tsx Decomposition

🔜 **Next** (alongside or after #7)

### Current state

`ChatPage.tsx` is 866 lines (was 2,000+, significant decomposition has already happened but further splitting is still worthwhile).

### Target decomposition

| New component | Responsibility | Approx lines |
|---|---|---|
| `MessageList.tsx` | Message bubbles, markdown, code blocks, images, tool cards | ~400 |
| `ToolCallPanel.tsx` | Tool call cards, sub-agent cards, status visualization | ~300 |
| `InputBar.tsx` | Text input, voice, attachments, model picker, tier selector | ~300 |
| `ConversationSidebar.tsx` | Thread list, title editing, search, deletion | ~200 |
| `ChatPage.tsx` (shell) | Layout, routing between the above | ~100 |

**Why it matters:** 1,796 lines in one file means any change risks unintended side effects. Decomposition makes the pieces independently testable and navigable.

**Check first:** `@ai-sdk/react`'s `Message` types and rendering helpers — may simplify the message rendering layer without adding much weight.

---

## 9. Cloudflare AI Gateway (transparent proxy)

✅ **Complete**

Sits between the AI worker and provider APIs. No code changes required — just a URL prefix. Provides:
- Logging of every AI API call across all providers in one dashboard
- Caching of repeated prompts (zero cost on cache hits)
- Spend caps per provider
- Rate limiting

Configured via `CF_AI_GATEWAY_ACCOUNT_ID` and `CF_AI_GATEWAY_NAME` env vars. Provider factory in `ai/src/gateway/providers/index.ts` routes through gateway when these are set.

---

## 10. Composio — Deepen Integration

🔜 **Planned**

### Current state

Shallow: `composioService.ts` (87 lines) is a thin REST client that lists apps and manages connections. Composio is not used for actual tool execution — tools still come from studio-harness and cloud tools.

### What deeper integration looks like

Composio covers 250+ apps with OAuth already handled. The opportunity:
- **GitHub tools:** instead of custom `http_request` calls to GitHub API, route through Composio's GitHub actions — OAuth is automatic, parameters are validated, results are normalized
- **Google Workspace:** Gmail read/send, Calendar, Drive — all covered. Zero OAuth management.
- **Slack, Linear, Notion:** same pattern

**How to get there:**
1. Add `@composio-core/cloudflare` SDK (Cloudflare Workers compatible)
2. Replace specific `http_request` patterns with Composio action calls
3. Surface connected apps in the UI's Extensions page alongside MCP servers

**What it is NOT:** a replacement for studio-harness or cloud tools. Composio covers SaaS app integrations. Local file system, desktop automation, system monitoring stay in studio-harness.

**Cloudflare constraint:** Composio SDK must run in the AI Worker (Cloudflare Workers runtime). Check `@composio-core/cloudflare` compatibility — if it doesn't have a CF-compatible package, proxy via a fetch call to their API instead.

---

## 11. Memory System — Hybrid Search

🔜 **Planned**

### Current state

`memory.ts` (400+ lines) + `supabase.ts` (172 lines). Tier-based storage in Supabase PostgreSQL. Memory is retrieved by tier and recency — not by semantic relevance.

Separately, `rag.ts` uses Cloudflare Vectorize for document embeddings. These two systems don't talk to each other.

### What hybrid search looks like

**Problem:** when the AI needs to recall a memory, it fetches by tier (working/short/project/etc.) and recency. A user asking "what did we decide about the auth design last month?" requires semantic search, not chronological lookup.

**Solution:** index memories into Vectorize alongside documents. On memory read:
1. Embed the query (Workers AI, no external call)
2. Vectorize cosine search → top-k relevant memories
3. Filter by tier/expiry as a post-filter

**What stays:** Supabase as the source of truth for memory CRUD. Vectorize as the search index. On `memory_write`, embed and upsert into Vectorize. On `memory_read`, vector search first, Supabase fetch second.

**Open-source check:** [mem0](https://mem0.ai) has an open-source library and hosted API. Worth evaluating — but the 7-tier system here is more sophisticated than what mem0 provides out of the box, so likely keep the current model and just add the Vectorize search layer.

---

## 12. Auth — Managed Provider

💭 **Consider**

### Current state

`auth/` worker: Google OAuth + JWT (HMAC-SHA256), email whitelist in KV, access (1h) + refresh (7d) tokens, rate limiting. 1,192 lines.

### The case for managed auth

The auth worker is solid and has no known bugs. The argument for replacement is maintenance burden: JWT rotation logic, CORS handling, and rate limiting all need to stay correct as the project evolves.

**Options:**
- **Clerk** — drop-in auth, has Cloudflare Workers SDK, Google OAuth built-in, email whitelist via organization membership. Free tier covers small user counts.
- **Cloudflare Access** — zero-trust, native to the platform, but requires Cloudflare Teams setup and changes the auth UX.

**Recommendation:** Don't replace now. Revisit when/if the product goes multi-tenant or needs more auth providers. The whitelist-based model works for controlled access. If the user base expands beyond a whitelist, that's the trigger to switch.

---

## 13. Monorepo Tooling

💭 **Consider**

### Current state

Six workers (`ai`, `api`, `auth`, `tracker`, `workers/Studio`, `workers/ChatsStorage`) + Tauri desktop app. Each has its own `package.json` and `wrangler.toml`. No shared build tooling.

### The case for Turborepo

[Turborepo](https://turbo.build/repo) handles monorepo task caching and parallel execution. In practice:
- `turbo build` runs all worker builds in parallel, skips packages that haven't changed
- Shared TypeScript config (`tsconfig.base.json`) reduces duplication
- Shared types (e.g. the SSE event schema between AI worker and frontend) can live in a `packages/` directory

**Cloudflare constraint:** Each worker must still have its own `wrangler.toml` and be deployed independently. Turborepo doesn't change that — it only coordinates the build step.

**Recommendation:** Low priority. Add when the six-worker build becomes noticeably slow or when shared types start being duplicated across packages.

---

## 14. What Stays & Why

| Component | Why it stays |
|---|---|
| **Auth worker** | Solid, tested, 1,192 lines. No known issues. Revisit only if user base changes. |
| **Tracker worker** | Clean telemetry. D1-backed, 5 tables. No reason to touch. |
| **Auto-router** | 5-tier request classification mapped to real cost points. Custom logic, correct, no equivalent. |
| **Tool tier/visibility system** | Tier-1 always visible, tier-2 keyword-gated, MCP keyword activation. Application logic. |
| **expand_tools meta-tool** | Schema injection with rate-limiting and catalog categorization. No framework equivalent. |
| **Local tool relay** | Cloud → WebSocket → Tauri → local execution → resume. Unique to this project. Gets cleaner with WebSocket but always custom. |
| **Studio Desktop MCP tools** | Windows-native desktop automation. 200+ tools. No off-the-shelf equivalent. |
| **Specialist sub-agents** | Research, plan, verification, data-analyst types with specific tool policies. Application logic. ResearchSubAgent is now native Agents SDK. |
| **All cloud tool implementations** | web_search, memory_*, spawn_agent, think, http_request, etc. All application logic. |
| **Daemon (local inference bridge)** | Ollama/LM Studio bridge. Simple Express server, correct, no replacement needed. |
| **Cloudflare Vectorize for RAG** | Native to the platform, zero external dependency, already working. |
| **Supabase memory** | Tier-based CRUD works. Hybrid search (item #11) adds on top without replacing. |

---

## 15. Open-Source Candidates for Future Features

This section answers "what should we use when we build X next?" — the policy is always check here before writing custom code.

### AI / Model Layer

| Need | Library | Notes |
|---|---|---|
| New text provider | `@ai-sdk/<provider>` | Always check here first |
| New image/video model | fal.ai | Already integrated |
| Embeddings | `@cf/baai/bge-base-en-v1.5` via Workers AI | No external API call |
| Local models | Ollama (already bridged) | Daemon handles it |
| Structured output from LLM | `ai` SDK `generateObject()` + Zod | Use for specialist outputs |

### Agent / Orchestration Layer

| Need | Library | Notes |
|---|---|---|
| Agent framework | Cloudflare Agents SDK (`agents` package) | Already in use — extend, don't replace |
| Background/durable jobs | [Trigger.dev](https://trigger.dev) | For webhook-based async jobs (video generation, long crawls). Has Cloudflare Workers integration. |
| Workflow engine | Cloudflare Workflows (beta) | Durable, step-based, native to platform. Evaluate when Trigger.dev feels heavy. |
| Task queues | Cloudflare Queues | Already have D1 job queue in API gateway — if it grows, migrate to Cloudflare Queues |

### Tools / MCP Layer

| Need | Library | Notes |
|---|---|---|
| Filesystem tools | `@modelcontextprotocol/server-filesystem` | Planned in item #7 |
| Git tools | `@modelcontextprotocol/server-git` | Planned in item #7 |
| SaaS integrations | Composio | 250+ apps. Check here before writing any API client. |
| New MCP server | [modelcontextprotocol.io/servers](https://modelcontextprotocol.io/servers) | Registry of community MCP servers |

### Storage / Data Layer

| Need | Library | Notes |
|---|---|---|
| Relational data | Cloudflare D1 | Native, already in use across all workers |
| File/blob storage | Cloudflare R2 | Native, already in use |
| Vector search | Cloudflare Vectorize | Already in use for RAG |
| Key-value | Cloudflare KV | Already in use |
| Full-text search | Cloudflare D1 FTS (SQLite FTS5) | Before adding Elasticsearch or similar |
| Real-time sync | Cloudflare Durable Objects | Already in use via Agents SDK |

### Frontend / UI Layer

| Need | Library | Notes |
|---|---|---|
| Component primitives | shadcn/ui | Unstyled, composable, already popular in the React ecosystem. Check before writing a custom component. |
| Node/graph UI | `@xyflow/react` | **Removed** — was unused. Add back if a graph/workflow UI is needed. |
| 3D visualization | Three.js | In `package.json`. `@pixiv/three-vrm` was removed (unused). |
| Charts | Recharts | Already in `package.json`. |
| Animations | Framer Motion | Already in `package.json`. |
| Math rendering | KaTeX | Already in `package.json`. |
| Diagrams | Mermaid | Already in `package.json`. |
| PDF rendering | pdfjs-dist | Already in `package.json`. |
| Token counting | js-tiktoken | Already in `package.json`. |
| Icons | Phosphor + Lucide | Both already in `package.json`. Don't add a third icon set. |

### Dev Tooling

| Need | Library | Notes |
|---|---|---|
| Testing | [Vitest](https://vitest.dev) | Fast, Vite-native. Add to STUDIO and each worker. |
| Monorepo build | [Turborepo](https://turbo.build) | When worker build time becomes a problem. |
| Type-safe SQL | [Drizzle ORM](https://orm.drizzle.team) | D1-compatible. Replaces raw SQL strings in workers. Add when D1 queries proliferate. |
| API validation | [Zod](https://zod.dev) | If not already used consistently — standardize on it for all request/response types. |

### Cloudflare vs. Local Machine — The Decision Rule

When adding any new capability, ask:

| Question | Answer → |
|---|---|
| Does it need local file system, OS, or desktop access? | Studio Desktop MCP (local machine, always) |
| Does it need to run without internet? | Daemon bridge + local models (always local) |
| Does it involve AI inference on user-provided data? | Cloud AI Worker (Cloudflare) — unless local model is selected |
| Does it involve storing user data? | Cloudflare D1/R2/KV — unless privacy requires local-only |
| Does it involve calling third-party APIs? | Cloud AI Worker — keeps API keys server-side |
| Does it involve real-time WebSocket state? | ChatAgent Durable Object — already the pattern |

The web version (`STUDIO/web/`) gets everything except: MCP servers, local inference, file system, system monitoring, desktop automation. Design new features so they degrade gracefully in the web version, or explicitly mark them desktop-only.

---

## Priority Order (Current)

| # | Item | Effort | Blocks | Status |
|---|---|---|---|---|
| 7 | Harness split → official MCP servers | 1 week | Nothing | 🔜 Next |
| 8 | ChatPage.tsx decomposition | 3–4 days | Nothing | 🔜 Next |
| 10 | Memory hybrid search (Vectorize) | 3–4 days | Nothing | 🔜 Planned |
| 9 | Composio deep integration | 1–2 weeks | Nothing | 🔜 Planned |
| 11 | Auth → managed | — | — | 💭 Only if user base changes |
| 12 | Monorepo tooling (Turborepo) | 2 days | — | 💭 Only if build pain appears |
