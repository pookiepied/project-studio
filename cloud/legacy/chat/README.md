# studio-chat

The core chat worker for Project Studio. Manages WebSocket-based AI conversations via a `ChatAgent` Durable Object, orchestrates the tool execution loop, and coordinates with specialist agents and the MCP hub.

**Worker name:** `studio-chat`  
**Runtime:** Cloudflare Workers + Durable Objects  
**Framework:** Cloudflare Agents SDK (`agents` package) — NOT LangGraph  
**Language:** TypeScript

---

## Role in the Architecture

```
api (public) → studio-chat (internal, service binding only)
                  ├── studio-gateway   LLM calls
                  ├── studio-agents    OmniAgent / CodingAgent DOs
                  └── studio-mcp       All MCP tool calls (memory, YouTube, etc.)
```

`studio-chat` is internal-only — it has no public routes. All external traffic arrives via the `api` worker's service binding. The frontend connects via WebSocket (not HTTP/SSE).

---

## Architecture

### ChatAgent Durable Object

One DO instance per conversation thread. Extends `Agent<Env, ChatAgentState>` from the Cloudflare Agents SDK. Owns:
- Persistent WebSocket connection to the STUDIO desktop app
- Explicit ReAct `while` loop (`loop.ts`) — replaces the old LangGraph StateGraph
- Tool execution routing (cloud tools inline, local tools relayed to Tauri via WS, MCP via `studio-mcp`)
- Sub-agent spawning via `studio-agents` service binding

### Two-Phase Chat Pipeline

**Phase 1 — Direct streaming**  
Immediate first-token latency. `studio-gateway` streams tokens directly back over the WebSocket. If no tool calls: done. If tool calls: proceed to Phase 2.

**Phase 2 — Tool loop**  
Runs inside `ChatAgent` via `loop.ts`. Each iteration: execute tools → send results to gateway → stream next response. Continues until no tool calls or iteration limit.

### Tool Routing

| Target | Where it runs | Examples |
|--------|--------------|---------|
| `cloud` | Inline in ChatAgent | web_search, rag, image_generate, think |
| `local` / `mcp` | Relayed to Tauri via WebSocket | studio-harness file/bash tools |
| `studio-mcp` | Via MCP service binding | memory, YouTube transcript |
| `studio-agents` | Via AGENTS service binding | spawn_agent (omni/coding types) |

### Durable Objects

| DO Class | Purpose |
|----------|---------|
| `ChatAgent` | One per conversation thread — owns WS + tool loop |

The old `AgentContextDO`, `AgentStateDO`, and `SubAgentRunnerDO` were all removed in the CF Agents SDK migration.

---

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Worker entry + cron dispatcher |
| `src/orchestration/agent/ChatAgent.ts` | Main DO class — WS handling + loop orchestration |
| `src/orchestration/agent/loop.ts` | Explicit ReAct loop (replaces LangGraph graph) |
| `src/pipeline/` | Chat pipeline: context, preload, systemPrompt, dispatch, stream |
| `src/server/routes/chat.ts` | Chat endpoint coordinator |
| `src/server/providers/` | Provider layer — GatewayAdapter wraps env.GATEWAY; direct adapters for local dev |
| `src/orchestration/tools/index.ts` | ToolRegistry — cloud + MCP + Composio tools |
| `src/orchestration/tools/cloud/` | Inline native tools (web_search, rag, image_generate, spawn_agent, etc.) |

---

## Worker Bindings

| Binding | Type | Purpose |
|---------|------|---------|
| `GATEWAY` | Service | `studio-gateway` — all LLM calls |
| `AGENTS` | Service | `studio-agents` — OmniAgent + CodingAgent DOs |
| `MCP` | Service | `studio-mcp` — MCP hub (memory, YouTube, etc.) |
| `MEMORY` | Service | `studio-mcp-memory` — direct memory binding (legacy path) |
| `TRACKER` | Service | `studio-tracker` — usage + cost tracking |
| `AI_DB` | D1 | MCP server registrations, user documents, agent workflows |
| `CHAT_AGENT` | DO | ChatAgent binding |

---

## Cron Jobs

| Schedule | Purpose |
|----------|---------|
| `*/5 * * * *` | Dispatch scheduled agent workflows (`user_agents` table) |

---

## Development

```bash
npm install
npm run dev      # local dev server
npm run deploy   # deploy to Cloudflare
npx tsc --noEmit # type check (should be zero errors)
```
