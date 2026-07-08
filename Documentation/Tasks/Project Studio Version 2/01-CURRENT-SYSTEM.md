# 01 — Current System (Mental Model)

> Snapshot date: 2026-07-07, commit `799f015`.
> Long-form source-derived audit: `SYSTEM_ARCHITECTURE.md` at repo root. This document
> is the working mental model: what each piece is, how big it is, how it talks to the
> others, and what is wrong with it.

## 1. The one-paragraph version

STUDIO is a Cloudflare Workers microservice mesh behind a single public `api` worker,
plus a Tauri desktop app (`STUDIO/`). A chat message flows
`Client → api → studio-chat (ChatAgent Durable Object) → studio-gateway → AI provider`,
with side calls to memory, MCP hub, skills, tracker, and storage workers over private
service bindings. The desktop app is a frontend that also bundles local MCP servers and
a local-model daemon. The central problem: `studio-chat` has absorbed most of the
system's responsibilities and is welded to Cloudflare-specific infrastructure
(Durable Objects, the Cloudflare Agents SDK), which blocks the local-first goal.

## 2. Worker inventory (measured 2026-07-07)

| Folder | Service name | Size (src) | Role today | V2 fate |
|---|---|---|---|---|
| `api/` | `api` | 22 files / 2.8k lines | Only public worker; JWT gate; routes to everything | Keep, adjust endpoints |
| `auth/` | `auth` | 19 / 1.1k | Google OAuth PKCE, JWT issuance | Keep |
| `chat/` | `studio-chat` | **104 / 11.8k** | ChatAgent DO, ReAct loop, tools, + ~12 unrelated routes (uploads, crons, KB, memories) | Replace with `studio-ai` |
| `gateway/` | `studio-gateway` | 84 / 8.6k | Provider router (old) | Delete after v2 cutover |
| `gateway-v2/` | (same, on cutover) | **192 / 9.5k + tests** | Provider router (new), near-complete | Finish, cut over |
| `agents/` | `studio-agents` | 25 / 2.5k | OmniAgent/CodingAgent DOs, blackboard, cron | Remove (D4) |
| `mcp/` | `studio-mcp` | 6 / 1.4k | MCP connection registry + Composio | Keep as registry |
| `skills/` | `studio-skills` | 24 / 1.4k | Skill registry **+ bundled skill content + execution** | Strip to registry only |
| `tracker/` | `tracker` | 7 / 0.7k | Telemetry spans, usage events | Keep, restructure |
| `workers/ChatsStorage/` | `chats` | 4 / 249 | Chat history in R2 | Merge into `studio-data` |
| `workers/Studio/` | `studio` | 3 / 172 | User preferences in D1 | Merge into `studio-data` |
| `workers/mcp/memory/` | `studio-mcp-memory` | 14 / 1.5k | Memory MCP (RAG, Vectorize + D1) | Keep as MCP server |
| `workers/mcp/tools/` | (tools) | 12 / 1.2k | Cloud tools MCP | Becomes native Tools MCP |
| `workers/mcp/youtube-transcript/` | `youtube-transcript-mcp` | — | Third-party project | **Ignore entirely** |
| `packages/jwt/` | — | 1 / 152 | JWT sign/verify | Keep |
| `ai-v2/` | (future `studio-ai`) | guide only | Locked build guide, no code | Build in Phase 2 |
| `STUDIO/` | desktop app | large | Tauri 2 + React frontend, local MCP servers, daemon | Becomes local execution environment |
| `STUDIO/daemon/` | local daemon | 12 / 1k | Ollama/LM Studio bridge | Keep |
| `STUDIO bot/` | Python bot | — | Separate client | Out of scope |

## 3. Service-binding graph (who calls whom)

Verified from `wrangler.toml` files:

```
api        → studio-chat (AI), studio-gateway, chats, studio, studio-skills, tracker
studio-chat→ studio-gateway, studio-agents, studio-mcp, studio-mcp-memory, studio-skills, tracker
agents     → studio-gateway, studio-mcp, studio-mcp-memory, tracker
mcp hub    → memory, youtube-transcript
```

Two structural facts fall out of this graph:

1. **`chat/` is the hub.** It binds to six other workers and is bound by `api`.
   Anything replacing it inherits all those edges. This is why `studio-ai` is the
   hardest, latest migration — everything else should be stabilized first.
2. **`gateway` has no outbound bindings to our workers** (only outward to providers
   and tracker). It is a leaf. That is why gateway-v2 could be built first with zero
   coordination — and why it's the template for all other migrations.

## 4. How the main agent loop works today

- Client opens a WebSocket to `api /agents/chat/{conversationId}`, forwarded raw
  (bypassing Hono) to preserve upgrade headers.
- `studio-chat` routes it to a **ChatAgent Durable Object** (Cloudflare Agents SDK,
  `class extends Agent`), one DO per conversation, with DO-attached SQLite state.
- The DO runs a ReAct loop: model step via `GATEWAY` binding → tool step → emit.
- **Cloud tools** run in-process. **Local/MCP tools** are relayed to the Tauri client
  via a `local_tools_pending` WS message; the client executes and replies with ~1KB
  tool results (not full history) — the "bandwidth optimization."
- Frozen WS message protocol: `start / tool_results / stream / tool_start /
  tool_complete / local_tools_pending / done / error / vision_substitutions`.
- Sub-agents (coding explorer/planner/coder/tester/debugger/reviewer) are relayed
  through the same mechanism; autonomous background agents live in `agents/` as
  separate DOs coordinating through a blackboard module.

## 5. Tracking and telemetry today

- `tracker/` receives spans and usage events from `api`, `chat`, `agents`, `gateway`.
- Old gateway double-counted usage (fixed via `x-internal` header, see
  `STUDIO_MASTER_PLAN.md` T14).
- gateway-v2 decision: Cloudflare AI Gateway is the inference-analytics backbone;
  tracker receives only a thin business summary.

## 6. What is wrong (the reasons for Version 2)

| Problem | Evidence | V2 answer |
|---|---|---|
| Chat worker owns everything | 104 files: loop + uploads + crons + KB + memories + vision preprocessing | `studio-ai` pure compute; storage → `studio-data`; KB → memory worker |
| Cloudflare Agents SDK / DO dependency | ChatAgent + agents/ DOs; cannot run on a user's machine | Swappable `SessionBackend` (D1 / SQLite), no DO, no Agents SDK |
| Agent execution is cloud-only | Sub-agent relay round-trips every tool call through the cloud | Local agent loop in Studio; cloud loop for cloud mode; one shared implementation |
| Skills worker hosts content + execution | `skills/src/bundled/` | Registry-only cloud worker; skill hosting/execution local |
| Storage scattered | chats R2 + studio D1 + blobs inside chat/ | One `studio-data` worker, 3 R2 buckets |
| Two gateways in the tree | `gateway/` + `gateway-v2/` both live | Finish cutover, delete old |
| Planning docs scattered | 8+ overlapping root-level .md files | This Documentation/ folder |
