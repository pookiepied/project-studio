# STUDIO Architecture Decision — 2026-06-20

## Table of Contents

1. [Philosophy & Guiding Principles](#philosophy--guiding-principles)
2. [Current Reality Map](#current-reality-map)
3. [Target Architecture](#target-architecture)
4. [Worker Boundary Definitions](#worker-boundary-definitions)
5. [Migration Work Items (A–G)](#migration-work-items)
6. [Chat Worker Folder Reorganization](#chat-worker-folder-reorganization)
7. [Skills vs System Prompt Decision](#skills-vs-system-prompt-decision)
8. [Intent Detection System](#intent-detection-system)
9. [Centralized Retry, Queue & User Feedback](#centralized-retry-queue--user-feedback)
10. [Agent Architecture](#agent-architecture)
11. [MCP Architecture](#mcp-architecture)
12. [File-by-File Disposition](#file-by-file-disposition)
13. [What Is Already Correct](#what-is-already-correct)
14. [Open Questions](#open-questions)

---

## Philosophy & Guiding Principles

These rules govern every decision in this document. When in doubt, come back here.

1. **One worker, one responsibility.** Each worker owns exactly the code it needs to perform its function. Business logic from another worker's domain never bleeds in.

2. **No inline code.** Every constant, schema, system prompt section, and configuration lives in a named, importable file. No magic strings or embedded templates inside handler functions.

3. **Small files, clear purpose.** A file that does more than one thing is a signal. Prefer 60-line focused files over 300-line kitchen-sink files.

4. **Proper folders, not flat dumps.** Files are grouped by what they do, not by accident of creation order. If a reader has to read five filenames before guessing what a folder contains, the folder is named wrong.

5. **Transparency first.** Every retry, every failure, every agent step, every tool call is logged and visible. Nothing is silently swallowed.

6. **Centralize cross-cutting concerns.** Retry logic, error reporting, queue management, and user feedback are shared systems. They are NOT re-implemented in each route handler.

7. **What belongs in a worker must run there.** If a file imports from a different worker's source tree to borrow its code, that code is in the wrong place.

---

## Current Reality Map

### Inventory Summary (as of 2026-06-20)

| Worker | Files | Primary Responsibility |
|--------|-------|----------------------|
| `studio-gateway` | ~60 | LLM routing, provider adapters, pricing, model discovery |
| `studio-chat` | 131 | Main agent loop, streaming, pipelines, tool registry |
| `studio-agents` | ~15 | Sub-agent DOs (OmniAgent, CodingAgent), workflow CRUD |
| `studio-mcp` | 2 | MCP connection registry (D1-backed CRUD) |

### What's In the Wrong Place Today

| File / Module | Current Worker | Should Be In | Why |
|---------------|---------------|--------------|-----|
| `tracking/credits/` (provider balance fetching) | chat | gateway | Credit balance is a provider concern |
| `tracking/pricing.ts` (estimateCostUsd) | chat | gateway | Cost estimation belongs with model data |
| `durable/RateTrackerDurableObject.ts` | chat | gateway or tracker | Rate limiting is a gateway concern |
| `orchestration/tools/composio/` | chat | chat (ok for now, migrate later) | Composio tool instantiation needs to happen at request time; *credentials* should come from MCP worker |
| `server/routes/composio.ts` | chat | mcp | Composio CRUD (add/remove connections) is registry work |
| `server/routes/mcp.ts` (connection CRUD) | chat | mcp | MCP CRUD belongs in the registry |
| `orchestration/localAgents/coding/` | chat | stays but rename | Not a local agent — it is a **local tool relay**; rename to `specialists/` |
| `lib/` (empty) | chat | deleted | Remove empty directory |

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Studio Frontend                          │
│  (React/Tauri app — chat UI, retry UI, agent progress panels)  │
└────────────────┬──────────────────────────────────────────────┘
                 │ WebSocket (ChatAgent DO) + HTTP
                 ▼
┌───────────────────────────────────────────────────────────────┐
│                     studio-chat                               │
│                                                               │
│  Main agent loop (ChatAgent DO)                               │
│  ├── System prompt builder + intent detection                 │
│  ├── Tool registry (cloud tools, agentic tools, MCP clients)  │
│  ├── Pipeline: parse → preload → assemble → dispatch → stream │
│  ├── Inputs: image upload/storage                             │
│  └── Routes: chat, health, images, docs, kb, memories, local  │
│                                                               │
│  Calls out via service bindings:                              │
│  ├── GATEWAY → LLM requests                                   │
│  ├── AGENTS  → spawn/await/cancel sub-agents                  │
│  ├── MCP     → MCP connection registry lookups                │
│  ├── MEMORY  → Studio Memory MCP (built-in)                   │
│  └── TRACKER → observability events + usage                   │
└─────────────┬─────────────┬────────────────────────────────┘
              │             │
              ▼             ▼
┌──────────────────┐  ┌────────────────────────────────────┐
│  studio-gateway  │  │         studio-agents               │
│                  │  │                                     │
│  LLM routing     │  │  OmniAgent DO (60-step ReAct loop)  │
│  Provider APIs   │  │  CodingAgent DO (40-step, 4-phase)  │
│  Model pricing   │  │  Workflow CRUD (D1)                 │
│  Model discovery │  │  Agent run history (D1)             │
│  Rate limiting   │  │                                     │
│  Credit tracking │  │  Each DO: calls GATEWAY for LLM,   │
└──────────────────┘  │  calls MCP_TOOLS for tool execution │
                      └────────────────────────────────────┘
                                       │
                                       ▼
                      ┌────────────────────────────────────┐
                      │         studio-mcp                 │
                      │                                    │
                      │  Connection registry (D1)          │
                      │  external_connections table        │
                      │  Types: mcp_local, mcp_remote,     │
                      │         composio                   │
                      │                                    │
                      │  Endpoints:                        │
                      │  POST/GET/PATCH/DELETE /registry/* │
                      └────────────────────────────────────┘
                                       │ (connection metadata)
              ┌──────────────────────┬─┘
              ▼                      ▼
┌────────────────────┐   ┌──────────────────────────────┐
│  Remote MCP Servers│   │  Local MCP Servers            │
│  (any cloud host)  │   │  (user's machine via Tauri)   │
│  Registered by URL │   │  Registered by command+args   │
│  in studio-mcp D1  │   │  in studio-mcp D1             │
└────────────────────┘   └──────────────────────────────┘
```

---

## Worker Boundary Definitions

### studio-gateway
**Owns:** LLM provider routing, API key management, model discovery, pricing, cost estimation, credit tracking, rate limiting, streaming adapters.

**Must NOT contain:** Any chat-specific business logic, agent coordination, MCP registration, or user identity management beyond what's needed to route a request.

### studio-chat
**Owns:** The main agent conversation loop, the streaming pipeline, the tool registry, user context extraction, image handling, document indexing, knowledge base, Studio Local relay.

**Must NOT contain:** LLM provider implementations, agent sub-loop execution (those run in agents worker), MCP server hosting, MCP connection CRUD (that's MCP worker's job), Composio CRUD.

### studio-agents
**Owns:** Sub-agent Durable Objects (OmniAgent, CodingAgent and any future agents), agent workflow definitions, agent run history, cron-triggered agent dispatch.

**Must NOT contain:** The main chat conversation loop, streaming to the browser, image/document handling.

### studio-mcp
**Owns:** The registry of all MCP connections (local, remote, Composio). Pure D1-backed CRUD. Never hosts an MCP server itself.

**Must NOT contain:** MCP protocol message handling, tool execution, Composio API calls, LLM routing.

---

## Migration Work Items

### Phase A — Chat Routes: Move CRUD to MCP Worker

**Scope:** `server/routes/composio.ts` and the connection-management parts of `server/routes/mcp.ts` in chat.

**Current:** Chat handles POST/GET/DELETE for Composio connections and MCP server registrations.

**Target:** These CRUD operations move to `studio-mcp` worker as new routes alongside the existing `/registry/connections` API. Chat retains read-only calls to MCP registry to discover what tools to load at request time.

**Specific moves:**
```
chat/server/routes/composio.ts     → mcp/src/routes/composio.ts (CRUD only)
chat/server/routes/mcp.ts          → mcp/src/routes/mcp.ts (connection CRUD only)
```

The Composio TOOL code (`orchestration/tools/composio/`) stays in chat — it's consumed at request time for tool instantiation.

---

### Phase B — Tracking: Credits and Pricing to Gateway

**Scope:** `chat/src/tracking/credits/` and `chat/src/tracking/pricing.ts`

**Current:** Chat worker fetches provider credit balances and estimates cost from MODELS_KV. This logic is duplicated from gateway.

**Target:**
- `tracking/credits/` → move to `gateway/src/tracking/credits/`
- `tracking/pricing.ts` → move to `gateway/src/tracking/pricing.ts` (already partly there)

Chat retains: `events.ts`, `usage.ts`, `errors.ts`, `spans.ts` — because chat IS the caller that needs to record its own usage.

---

### Phase C — RateTrackerDurableObject: Move to Gateway

**Scope:** `chat/src/durable/RateTrackerDurableObject.ts` and `chat/src/server/router/rateTracker.ts`

**Current:** The rate tracker DO lives in chat but is logically a gateway concern (per-provider daily request counting).

**Target:** Move to gateway worker. The rate limiter is enforced at the LLM routing layer, not the chat layer.

**Note:** This is a coordination step — both the DO class and the callers need to move together. Defer until gateway routing is more stable.

---

### Phase D — Empty Files: Remove Dead Weight

**Immediate action (no coordination needed):**
- `chat/src/lib/` — **DELETE** (empty directory, purpose unknown)
- Verify `server/config.ts` exists/is needed — currently `server/router/config.ts` is just a re-export shim

---

### Phase E — Specialists Rename (not a migration, a clarification)

**Scope:** `chat/src/orchestration/localAgents/`

**Problem:** The name "localAgents" implies these are agents running on the user's machine. They are not. They are **specialist relay loops** — the main agent enters a specialist mode where it relays local tool calls (Studio Local tools: edit_file, bash, etc.) back to the client.

**Target:** Rename `orchestration/localAgents/` → `orchestration/specialists/`. No code changes needed, just rename.

**Long-term path (Phase E+):** When Studio Local exposes an MCP server interface (registered in studio-mcp), the relay pattern becomes unnecessary. The CodingAgent DO in agents worker calls Studio Local tools via MCP, and chat no longer needs the relay loop.

---

### Phase F — System Prompt System Upgrade

See detailed section: [Skills vs System Prompt Decision](#skills-vs-system-prompt-decision) and [Intent Detection System](#intent-detection-system).

---

### Phase G — Centralized Retry, Queue & User Feedback

See detailed section: [Centralized Retry, Queue & User Feedback](#centralized-retry-queue--user-feedback).

---

## Chat Worker Folder Reorganization

### Current structure (problems annotated)
```
chat/src/
├── constants.ts                    ✅ Keep
├── context/index.ts                ✅ Keep — AsyncLocalStorage for env/ctx
├── durable/
│   └── RateTrackerDurableObject.ts ⚠️ Move to gateway (Phase C)
├── env.ts                          ✅ Keep
├── gatewayEnv.ts                   ✅ Keep
├── index.ts                        ✅ Keep
├── inputs/image/                   ✅ Keep — well organized
├── lib/                            ❌ DELETE — empty
├── logger.ts                       ✅ Keep
├── orchestration/
│   ├── agent/                      ✅ Keep — main agent loop
│   ├── localAgents/coding/         ⚠️ RENAME → specialists/coding/
│   ├── prompts/                    ✅ Keep — but upgrade content (Phase F)
│   ├── skills/                     ✅ Keep — but reorganize (Phase F)
│   └── tools/
│       ├── base/                   ✅ Keep
│       ├── cloud/
│       │   ├── agentic/            ✅ Keep — agent dispatch tools
│       │   ├── generation/         ✅ Keep
│       │   ├── location/           ✅ Keep
│       │   ├── network/            ✅ Keep
│       │   └── retrieval/          ✅ Keep
│       ├── composio/               ✅ Keep (tool code) — credentials from MCP worker
│       ├── mcp/                    ✅ Keep (client code only)
│       └── tool-contract.ts        ✅ Keep
├── pipeline/                       ✅ Keep
├── server/
│   ├── middleware/                 ✅ Keep
│   ├── providers/                  ✅ Keep
│   ├── router/                     ✅ Keep (rateTracker may move with Phase C)
│   ├── routes/
│   │   ├── admin.ts                ✅ Keep
│   │   ├── chat.ts                 ✅ Keep
│   │   ├── composio.ts             ⚠️ CRUD moves to MCP worker (Phase A)
│   │   ├── docs.ts                 ✅ Keep
│   │   ├── health.ts               ✅ Keep
│   │   ├── images.ts               ✅ Keep
│   │   ├── kb.ts                   ✅ Keep
│   │   ├── local.ts                ✅ Keep — Studio Local relay
│   │   ├── mcp.ts                  ⚠️ CRUD moves to MCP worker (Phase A)
│   │   ├── memories.ts             ✅ Keep
│   │   ├── modes.ts                ✅ Keep
│   │   ├── pdf.ts                  ✅ Keep
│   │   └── workflows.ts            ✅ Keep — agent workflow proxy
│   ├── telemetry.ts                ✅ Keep
│   ├── types.ts                    ✅ Keep — wire-format LLM types
│   └── utils/                      ✅ Keep
├── tracking/
│   ├── credits/                    ⚠️ Move to gateway (Phase B)
│   ├── errors.ts                   ✅ Keep
│   ├── events.ts                   ✅ Keep
│   ├── index.ts                    ✅ Keep (update re-exports)
│   ├── pricing.ts                  ⚠️ Move to gateway (Phase B)
│   ├── spans.ts                    ✅ Keep
│   └── usage.ts                    ✅ Keep
└── utils/
    ├── r2Signer.ts                 ✅ Keep
    └── retry.ts                    ✅ Keep — wire into retry system (Phase G)
```

### Target structure (after reorganization)
```
chat/src/
├── constants.ts
├── context/index.ts
├── durable/                        [empty after Phase C — delete dir]
├── env.ts
├── gatewayEnv.ts
├── index.ts
├── inputs/
│   └── image/
│       ├── index.ts
│       ├── pipeline.ts
│       ├── r2Store.ts
│       ├── resolver.ts
│       └── types.ts
├── logger.ts
├── orchestration/
│   ├── agent/                      [main loop — unchanged]
│   │   ├── ChatAgent.ts
│   │   ├── completion/
│   │   ├── loop.ts
│   │   ├── nodes/
│   │   └── state.ts
│   ├── specialists/                [renamed from localAgents/]
│   │   └── coding/
│   │       ├── index.ts
│   │       ├── prompts.ts
│   │       └── runner.ts
│   ├── prompts/                    [upgraded content — Phase F]
│   │   ├── guardrails.ts
│   │   ├── intent/                 [NEW — Phase F]
│   │   │   ├── detector.ts
│   │   │   └── injectors.ts
│   │   ├── personality.ts
│   │   ├── sections/               [NEW — split system.ts into sections]
│   │   │   ├── agentCapabilities.ts
│   │   │   ├── decisionCascade.ts
│   │   │   ├── errorHandling.ts
│   │   │   ├── outputFormatting.ts  [absorbs rendering skill]
│   │   │   ├── planning.ts
│   │   │   └── toolDiscovery.ts
│   │   ├── studio/
│   │   │   ├── agentRules.ts
│   │   │   ├── index.ts
│   │   │   └── projectContext.ts
│   │   ├── system.ts               [assembler — calls sections]
│   │   └── voice.ts
│   ├── skills/
│   │   ├── coding/index.ts
│   │   ├── desktop/index.ts
│   │   ├── documents/index.ts
│   │   ├── index.ts
│   │   └── platform/index.ts      [rendering moves to system prompt — Phase F]
│   └── tools/
│       ├── base/
│       ├── cloud/
│       │   ├── agentic/
│       │   ├── generation/
│       │   ├── location/
│       │   ├── network/
│       │   └── retrieval/
│       ├── composio/
│       ├── index.ts
│       ├── mcp/
│       └── tool-contract.ts
├── pipeline/
│   ├── assembleMessages.ts
│   ├── dispatch.ts
│   ├── parse.ts
│   ├── preload.ts
│   ├── queue/                      [NEW — Phase G]
│   │   ├── RetryQueue.ts
│   │   └── index.ts
│   ├── stream/
│   ├── types.ts
│   └── userContext.ts
├── server/
│   ├── middleware/
│   ├── providers/
│   ├── router/
│   ├── routes/
│   │   ├── admin.ts
│   │   ├── chat.ts
│   │   ├── docs.ts
│   │   ├── health.ts
│   │   ├── images.ts
│   │   ├── kb.ts
│   │   ├── local.ts
│   │   ├── memories.ts
│   │   ├── modes.ts
│   │   ├── pdf.ts
│   │   └── workflows.ts
│   ├── telemetry.ts
│   ├── types.ts
│   └── utils/
├── tracking/
│   ├── errors.ts
│   ├── events.ts
│   ├── index.ts
│   ├── spans.ts
│   └── usage.ts
└── utils/
    ├── r2Signer.ts
    └── retry.ts
```

---

## Skills vs System Prompt Decision

### The problem

Skills are currently injected **on-demand** (loaded into system prompt when the agent decides to load them via `skill_read` tool). The system prompt builder assembles static sections (identity, guardrails, personality, decision cascade, planning, agent capabilities, tool discovery, error handling, output formatting) plus dynamic per-request context (MCP servers, memory, user profile).

Some content is **always relevant** and should be in the system prompt. Other content is **conditionally relevant** and should be a skill or an intent-injected section.

### Decision table

| Content | Current | Target | Reason |
|---------|---------|--------|--------|
| `skills/rendering/` (output formatting: mermaid, LaTeX, HTML, SVG, CSV, JSON) | Skill (on-demand) | **System prompt** | Formatting rules apply to every response |
| `skills/platform/` (what Studio is, architecture, features) | Skill (on-demand) | **Skill** — keep | Not needed for every message; loaded when user asks about Studio |
| `skills/coding/` (coding workflow, agent selection, step-by-step) | Skill (on-demand) | **Intent-injected** | Auto-inject when coding context detected |
| `skills/documents/` (document querying, structure) | Skill (on-demand) | **Intent-injected** | Auto-inject when documents are in context |
| `skills/desktop/` (110 tools, decision trees, 8 domains) | Skill (on-demand) | **Skill** — keep | Large content, only needed when desktop tools are active |

### Action: Move rendering into system prompt

Remove `skills/rendering/` and integrate its content into `orchestration/prompts/sections/outputFormatting.ts` (a dedicated static section of the system prompt). This section is assembled once per isolate and cached.

---

## Intent Detection System

### Concept

Currently, the main agent must explicitly call `skill_read("coding")` to get coding workflow guidance. This is reactive and adds latency.

Instead, build a lightweight intent detector that fires **before the LLM call**, inspects the incoming messages, and auto-injects the relevant context section.

### How it works

```
Messages arrive (preload phase)
    ↓
intent/detector.ts → detectIntent(messages) → IntentSignals
    ↓
intent/injectors.ts → buildInjectedContext(signals) → string | null
    ↓
System prompt + injected context assembled
    ↓
LLM sees the right context without needing to request it
```

### Intent signals to detect

| Signal | Trigger | Injected content |
|--------|---------|-----------------|
| `coding` | Files mentioned, code blocks in message, "write a function", "fix bug", "refactor" | Coding workflow section |
| `document` | PDF/doc in context, "summarize this", "find where", "quote from" | Document workflow section |
| `creative` | "write a story", "poem", "design", creative verbs | Creative mode guideline |
| `research` | "research", "find out", "compare", "what is" | Web search encouragement section |
| `desktop` | Desktop tools loaded in MCP context | Desktop workflow section (already skill) |

### Implementation notes

- Detection runs on `messages.slice(-3)` (last 3 messages) — cheap, no LLM needed
- Regex + keyword matching initially; can upgrade to embedding-based later
- Detection result is cached per request
- Total overhead: < 1ms

### File: `orchestration/prompts/intent/detector.ts`

```typescript
export interface IntentSignals {
  coding:    boolean;
  document:  boolean;
  creative:  boolean;
  research:  boolean;
  desktop:   boolean;
}

export function detectIntent(messages: AgentMessage[]): IntentSignals { ... }
```

### File: `orchestration/prompts/intent/injectors.ts`

```typescript
export function buildInjectedContext(
  signals: IntentSignals,
  skills: SkillsIndex
): string | null { ... }
```

---

## Centralized Retry, Queue & User Feedback

### The problem

Every tool, route handler, and stream has its own retry logic (or worse, none). When a call fails, the user sees an error and has no path forward. There is no "continue from where it failed" mechanism.

### Target system: Three layers

#### Layer 1 — RetryQueue (server-side, `pipeline/queue/`)

```typescript
interface QueuedOperation<T> {
  id:           string;
  fn:           () => Promise<T>;
  maxAttempts:  number;
  backoffMs:    number;
  onRetry?:     (attempt: number, error: Error) => void;
  onExhausted?: (error: Error) => void;
}

class RetryQueue {
  enqueue<T>(op: QueuedOperation<T>): Promise<T>;
  cancel(id: string): void;
}
```

- All retryable operations (TRACKER calls, gateway calls, agent spawns) go through `RetryQueue`
- Existing `utils/retry.ts` becomes the inner executor; `RetryQueue` manages identity and callbacks

#### Layer 2 — User-facing failure state (SSE event)

When `RetryQueue.onExhausted` fires, emit a structured SSE event:

```json
{
  "type": "operation_failed",
  "operationId": "uuid",
  "operationType": "agent_spawn | llm_call | tool_call | mcp_call",
  "humanMessage": "The coding agent failed to start after 3 attempts.",
  "retryable": true,
  "context": { ... }
}
```

#### Layer 3 — Frontend "Retry UI"

A **persistent panel** in the Studio UI that shows failed operations:

```
┌──────────────────────────────────────────────────┐
│  ⚠ Coding agent failed to start                  │
│  3 attempts exhausted — gateway timeout           │
│                                                   │
│  [  Continue  ]  [  Dismiss  ]  [  View details  ]│
└──────────────────────────────────────────────────┘
```

- "Continue" re-queues the operation with fresh context from the conversation state
- "Dismiss" removes it from the queue
- "View details" opens the error log for that operation

This is the **only** way to surface retryable failures to the user. No more silent catches, no more terminal error messages with no recovery path.

### What uses RetryQueue

| Caller | Operation | Max attempts | Backoff |
|--------|-----------|-------------|---------|
| `tracking/events.ts` | TRACKER ingest | 2 | 250ms |
| `tracking/usage.ts` | TRACKER usage | 2 | 250ms |
| `tools/cloud/agentic/spawnAgent.ts` | Agent spawn | 3 | 1s |
| `tools/cloud/agentic/awaitAgents.ts` | Agent poll | 5 | 2s |
| `pipeline/stream/llm.ts` | LLM stream | 2 | 500ms |
| `tools/mcp/remote/RemoteMCPTool.ts` | MCP JSON-RPC | 3 | 1s |

### Transparency requirements

Every retry MUST log:
```
[RETRY] attempt 2/3: spawnAgent failed — gateway timeout (1234ms)
```

Every exhaustion MUST log AND emit the `operation_failed` SSE event.

---

## Agent Architecture

### What exists and where

| Component | Location | Status |
|-----------|----------|--------|
| Main agent loop (`ChatAgent.ts`, `loop.ts`, nodes/) | `studio-chat` | ✅ Correct |
| OmniAgent DO (60-step ReAct) | `studio-agents` | ✅ Correct |
| CodingAgent DO (40-step, 4-phase) | `studio-agents` | ✅ Correct |
| Specialist relay (`localAgents/coding/`) | `studio-chat` | ⚠️ Correct location, wrong name — rename |
| Agent dispatch tools (`agentic/`) | `studio-chat` | ✅ Correct |

### How agent invocation works (today and target)

```
User message → ChatAgent (main loop)
                    ↓
              LLM decides: "I need to spawn a coding agent"
                    ↓
              spawnAgent tool fires
                    ↓
              POST to AGENTS service binding (studio-agents)
                    ↓
              CodingAgent DO starts running its own loop
              (calls GATEWAY for LLM, calls MCP_TOOLS for tools)
                    ↓
              awaitAgents tool polls for result
                    ↓
              Main agent gets result, continues conversation
```

This flow is **already implemented**. The gap is:
1. No retry on agent spawn/await (Phase G)
2. No user-facing failure feedback (Phase G)
3. Specialist relay for LOCAL tools still needed until Studio Local becomes an MCP server

### Clarification: No "local agents"

There are no local agents. There are two patterns:

**Pattern A — Cloud sub-agent:** Spawns an OmniAgent or CodingAgent DO in `studio-agents`. The DO runs fully in the cloud. This is the correct model for deep research, large codebase analysis, etc.

**Pattern B — Local tool relay:** For tasks requiring local tools (edit file, run bash, etc.), the main agent enters "specialist mode" and relays tool call/result pairs with the client. The LLM runs in the cloud. Only the tool execution happens locally. This is `orchestration/specialists/coding/`.

**Long-term path for Pattern B:** When Studio Local exposes a proper MCP server interface registered in `studio-mcp`, the relay pattern is replaced. The CodingAgent DO calls Studio Local tools via `studio-mcp` directly.

### Future agents to add to studio-agents

These do NOT belong in chat. They would be new DOs in `studio-agents`:

| Agent | Purpose | Max steps |
|-------|---------|-----------|
| `ResearchAgent` | Deep web research + synthesis | 80 steps |
| `DebugAgent` | Error analysis + fix proposal | 30 steps |
| `ReviewAgent` | Code review against standards | 25 steps |
| `DocAgent` | Documentation generation from code | 20 steps |

When to add them: When there's a concrete user need. Do not add preemptively.

---

## MCP Architecture

### Current state: Correct

`studio-mcp` is already a pure registry. It never hosts MCP servers. It stores connection metadata in D1. This is the right model.

### What stays in chat (MCP client code)

```
orchestration/tools/mcp/
├── blocklist.ts              — blocked tool names (hardcoded, make configurable)
├── builtin/                  — service-binding MCP tools (studio-memory)
│   ├── ServiceBindingMCPTool.ts
│   ├── builtinLoader.ts
│   └── memorySchemas.ts
├── discovery/                — queries D1 via MCP worker, loads tool manifests
│   ├── DynamicMCPTool.ts     — local MCP (via Tauri subprocess relay)
│   ├── mcpLoader.ts          — fetches from KV, creates tool instances
│   └── index.ts
├── index.ts
└── remote/                   — HTTP JSON-RPC to cloud MCP servers
    ├── RemoteMCPTool.ts
    └── index.ts
```

### What moves to mcp worker (Phase A)

- `server/routes/mcp.ts` (connection CRUD — listing, adding, removing user MCP connections)
- `server/routes/composio.ts` (Composio connection CRUD)

### MCP discovery flow

```
Request arrives at chat worker
        ↓
preload.ts calls loadMcpTools()
        ↓
mcpLoader.ts fetches user's active connections from studio-mcp registry
(via MCP service binding: GET /registry/connections)
        ↓
For each connection:
  - mcp_local   → DynamicMCPTool (relay via Tauri)
  - mcp_remote  → RemoteMCPTool (HTTP JSON-RPC in worker)
  - composio    → ComposioTool (Composio API with stored credentials)
        ↓
Tools injected into ToolRegistry for this request
```

### Blocklist: Make configurable

`orchestration/tools/mcp/blocklist.ts` hardcodes blocked tool names. This should be:
- Stored in KV or D1
- Configurable per user/tier
- Has a sensible default (current hardcoded list)

---

## File-by-File Disposition

### Files to DELETE

| File | Reason |
|------|--------|
| `chat/src/lib/` (directory) | Empty, no purpose |
| Dead code removed in Phase 7/8 | Already done |

### Files to RENAME/MOVE within chat

| From | To | Reason |
|------|----|--------|
| `orchestration/localAgents/` | `orchestration/specialists/` | Name is misleading |

### Files to MOVE to mcp worker (Phase A)

| From (chat) | To (mcp) |
|-------------|---------|
| `server/routes/mcp.ts` (CRUD only) | `mcp/src/routes/mcp.ts` |
| `server/routes/composio.ts` | `mcp/src/routes/composio.ts` |

### Files to MOVE to gateway (Phase B+C)

| From (chat) | To (gateway) |
|-------------|-------------|
| `tracking/credits/` | `gateway/src/tracking/credits/` |
| `tracking/pricing.ts` | `gateway/src/tracking/pricing.ts` |
| `durable/RateTrackerDurableObject.ts` | `gateway/src/durable/RateTrackerDurableObject.ts` |

### Files to CREATE (new)

| File | Phase | Purpose |
|------|-------|---------|
| `orchestration/prompts/intent/detector.ts` | F | Intent signal detection |
| `orchestration/prompts/intent/injectors.ts` | F | Context injection from signals |
| `orchestration/prompts/sections/outputFormatting.ts` | F | Absorbs rendering skill |
| `pipeline/queue/RetryQueue.ts` | G | Centralized retry queue |
| `pipeline/queue/index.ts` | G | Queue module exports |

---

## What Is Already Correct

Don't touch these without a concrete reason:

| Area | Status |
|------|--------|
| `studio-agents` (OmniAgent + CodingAgent DOs) | ✅ Architecturally correct |
| `studio-mcp` (pure registry) | ✅ Already correct — minimal and clean |
| `chat/src/pipeline/` structure | ✅ Clean, well-organized |
| `chat/src/inputs/image/` structure | ✅ Clean — upload vs generation properly separated |
| `chat/src/orchestration/tools/cloud/` | ✅ Well-categorized by tool type |
| `chat/src/orchestration/agent/` (main loop) | ✅ ChatAgent, loop, nodes, state — clear structure |
| Phase 5 path aliases (`@gateway/*`) | ✅ Complete — no more cross-worker relative imports |
| Phase 6 ragUtils / imageGenerate refactors | ✅ Complete |
| Phase 7 security hardening | ✅ Complete |
| Phase 8 dead code removal | ✅ Complete |
| `tracking/events.ts` + `tracking/usage.ts` | ✅ Now log on failure (Phase 7 AG2) |
| `RateTrackerDurableObject` cleanup endpoint | ✅ Now implemented (Phase 7 AG1) |
| `buildSystemPrompt()` deprecated params removed | ✅ Complete (Phase 8) |

---

## Open Questions

These need a decision before implementation can begin:

1. **Agent-to-agent communication:** When OmniAgent wants to spawn a CodingAgent, does it (a) call back to chat which calls spawnAgent tool? Or (b) call `studio-agents` directly? The cleanest model is (b) — agents worker has an internal spawn endpoint. Needs design.

2. **Studio Local as MCP server:** When do we implement this? It eliminates the specialist relay entirely. Depends on Tauri layer timeline.

3. **Blocklist configurability:** Is per-user MCP blocklist needed now, or is the hardcoded list sufficient? Who manages it — admin or per-user?

4. **Intent detection model:** Start with regex/keyword matching? Or use a small LLM classifier? Regex is fast and free; classifier is slower but more accurate. Recommendation: start with regex, upgrade later.

5. **Retry UI component:** Who owns the "Continue" button state? The chat room component? Or a global session manager? Needs frontend architecture decision.

6. **Composio ownership post-migration:** After Composio CRUD moves to MCP worker, does the ComposioTool code in chat fetch credentials from MCP registry or cache them in KV? Performance implication: one extra service binding call per request.

7. **Deep research agent:** Do we want a `ResearchAgent` DO in `studio-agents` that parallelizes web searches? Timeline?

---

*Document authored: 2026-06-20. All observations based on codebase state at this date.*
*Next: implement migrations in Phase A order. Each phase should pass `tsc --noEmit` before the next begins.*
