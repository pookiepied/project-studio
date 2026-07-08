# 06 — Agent Runtime Design (SDK Removal Analysis + Dual-Runtime Parity)

> The load-bearing document for the refactor's core: what the Cloudflare Agents SDK
> actually does for us today (from code, not documentation), whether removing it is
> justified, what replaces each capability, and how every capability works in both
> environments. Supersedes the corresponding sections of `ai-v2/AI_GUIDE.md` where
> they conflict (the guide predates this analysis; see §9).

## 1. What the Agents SDK actually provides — measured, not assumed

The SDK (`agents` npm package) appears in exactly **three classes** across the whole
backend: `ChatAgent` (chat), `BaseAgentDO` (agents), and `routeAgentRequest` in
`chat/src/index.ts`. `BlackboardDO` is a raw Durable Object without the SDK.
Everything else — both ReAct loops, the pipeline, all tools, prompts, streaming —
is plain TypeScript with no SDK imports.

The six capabilities actually used:

| # | Capability | Where used | What the code does with it |
|---|---|---|---|
| S1 | **Actor addressing** — `routeAgentRequest` / `idFromName` gives one instance per conversationId / runId | ChatAgent, BaseAgentDO, BlackboardDO | Guarantees one live handler per conversation; serializes message handling |
| S2 | **Persistent state** — `this.state`/`setState` on DO-attached SQLite | ChatAgent (pendingMessages, session config, completedContent), BaseAgentDO (full checkpoint: messages, iteration, tokens, generation, resumeCount) | Survives isolate eviction; IS the checkpoint |
| S3 | **WebSocket handling + hibernation** — `onMessage`/`onClose`, socket survives isolate sleep | ChatAgent | Client keeps one WS per conversation; 25s pings keep it alive |
| S4 | **Scheduling** — `this.schedule(seconds, method)` DO alarms | BaseAgentDO watchdog (60s re-arm) | Self-healing resume of stalled runs |
| S5 | **Post-handler continuation** — `this.ctx.waitUntil` | ChatAgent (loop survives client disconnect → completedContent catch-up) | Turn completes even if WS closes |
| S6 | **Per-conversation shared storage** — BlackboardDO `SqlStorage` | blackboard tools (chat + agents workers) | Agent-to-agent KV coordination |

## 2. The removal verdict: **remove it — confirmed by the code, with two honest costs**

**Decision D14 (FINAL): the Cloudflare Agents SDK and all Durable Objects are removed
from the agent runtime.**

Evidence that the SDK is fighting the design rather than serving it:

1. **The loops don't need it.** Both ReAct loops are already SDK-free plain TS. The
   SDK exists only in hosting shells. Removal is a shell replacement, not a rewrite.
2. **The code is already working around it.** `ChatAgent.handleToolResults` rebuilds
   the module-level registry Map after hibernation wipes it
   ([chat/src/agent/ChatAgent.ts:418-440]). `distillMemory` must `await` (not
   fire-and-forget) because "the Agents SDK hibernation model cancels in-flight
   service binding fetches" (comment at ChatAgent.ts:498). These are taxes, not features.
3. **The resilience machinery is already portable.** BaseAgentDO's real value —
   heartbeat, generation tokens, bounded auto-resume — is ~100 lines of logic over
   *any* transactional store. Only `schedule()` and `setState` are DO-specific.
4. **It is the single blocker for local-first.** Every other dependency (bindings,
   D1, R2) has a local analog; DO actor semantics do not exist off-platform.

The two honest costs, and their mitigations:

| Cost | Mitigation |
|---|---|
| **Hibernation economics**: a DO with a hibernated WS costs ~nothing while idle; a plain Worker holding an open WS keeps an isolate alive | WS lifetime becomes **turn-scoped**: client connects on send, may disconnect after `done`; the catch-up path (S5 replacement, §7) already makes disconnects safe. Idle conversations hold no socket. The existing 25s client ping is retired in cloud mode. |
| **Single-actor guarantee**: DO serializes concurrent messages per conversation for free | Optimistic concurrency in the session store — the **generation-token pattern that `agentDO.ts` already implements**. A second concurrent `start` on one conversation bumps the generation; the stale loop's commits are rejected. Locally the sidecar is naturally single-process. |

## 3. Replacement architecture — the three shared primitives

Everything below lives in `packages/agent-loop` and runs identically in both
environments. Platform code is confined to three adapter interfaces:

```
packages/agent-loop/
  loop/        one ReAct engine (merges chat + agents loops; hooks optional)
  context/     preload (memory inject, skills index, MCP/Composio discovery)
  tools/       registry, executionTarget split, expand_tools, agentic tools
  router/      model tier routing
  prompts/     system prompt assembly
  emit/        frozen WS/SSE protocol
  supervisor/  heartbeat + generation + bounded resume (from agentDO.ts)
  adapters/    StateStore | Scheduler | GatewayTransport   ← ONLY platform code
```

### Adapter 1 — `StateStore` (replaces S2, S6; enables S1's replacement)

One SQL schema, two drivers. **Why SQLite/D1 specifically:** Cloudflare D1 *is*
SQLite (same dialect, same types), so a single schema and query layer runs verbatim
against both `better-sqlite3` (local) and the D1 binding (cloud). No ORM divergence,
no dual dialects — the driver is the only difference. Tables:

| Table | Replaces | Key columns |
|---|---|---|
| `sessions` | ChatAgent DO state | conversation_id PK, pending_messages JSON, model/provider config, completed_content, generation, updated_at |
| `runs` | BaseAgentDO state + agents-worker runs bookkeeping | run_id PK, agent_type, status, messages JSON (checkpoint), iteration, total_tokens, generation, resume_count, heartbeat_at, name (persists spawnAgent's lossy NAME_REGISTRY) |
| `agent_messages` | BlackboardDO | scope (conversation_id), sender, recipient?, kind, key?, payload JSON, created_at |
| `user_agents` | agentWorkflows.ts | user-defined agents, trigger_type manual/cron, cron_expr |
| `cache` | MCP_KV | key, value, expires_at (local only; cloud keeps KV) |

Concurrency contract: every state commit is `UPDATE … WHERE generation = ?` —
commits from superseded loops affect 0 rows and the loop exits. This is the direct
port of `agentDO.ts`'s `mine()` guard.

### Adapter 2 — `Scheduler` (replaces S4)

One portable function, `resumeStalledRuns()`: scan `runs` where status='running' and
`heartbeat_at < now − 150s` (constant kept from `agentDO.ts`), resume from checkpoint
if `resume_count < 3`, else mark failed.

| Environment | Trigger |
|---|---|
| Cloud | Worker **cron trigger** every minute on `studio-ai` (replaces per-DO alarms with one sweep — same watchdog cadence, one timer instead of N) |
| Local | sidecar `setInterval` + **on-startup sweep** (also covers the case DOs never had: the whole app was closed mid-run — resumable long tasks across restarts) |

Cron-triggered user agents (`user_agents.cron_expr`): cloud = same cron trigger
evaluates due agents; local = sidecar scheduler. Same table, same evaluation code.

### Adapter 3 — `GatewayTransport` + `RegistryClient` (D9/D10)

| Concern | Cloud | Local |
|---|---|---|
| LLM inference | `GATEWAY` service binding | HTTPS `api → gateway`; local models via daemon (Ollama/LM Studio) |
| Memory inject/distill | `MEMORY` binding | HTTPS via `api` |
| Skills index | `SKILLS` binding (registry) | local skill store (Skill Runtime MCP) |
| MCP tool discovery | `MCP` binding + KV cache | HTTPS via `api` + SQLite cache; locally-installed MCP servers connect directly (stdio/SSE) |
| Composio | via hub (unchanged) | via `api` → hub |
| Telemetry | tracker binding + `waitUntil` | batched HTTPS via `api` |

## 4. Agent capabilities: kept / replaced / dropped — explicit inventory

| Capability today | Verdict | How it works after (both environments) |
|---|---|---|
| Interactive chat turn (WS, streaming, tool loop) | **KEPT**, frozen protocol | `agent-loop` engine hosted by `studio-ai` (cloud) / sidecar (local) |
| `local_tools_pending` relay + ~1KB resume | **KEPT** in cloud mode (it exists *because* execution is remote) | Cloud: unchanged — `pending_messages` in `sessions`. Local: relay short-circuits, tools execute in-process; state still checkpointed so a crashed app resumes |
| Disconnect catch-up (`/completed` GET/DELETE) | **KEPT** | `completed_content` column; same endpoints on both hosts |
| `spawn_agent` / `await_agents` tools | **KEPT**, re-based | Insert/read `runs` rows. Cloud: sub-agent loop runs via `waitUntil` (long runs: Workers cron resumes from checkpoint if evicted). Local: sidecar task via Agent Spawn MCP (D6) |
| Sub-agent types (research today; coding specialists relayed) | **KEPT + EXTENDED** | Agent presets in `agent-loop/agents`; local gains file-system-native coding/exploration/debugging agents (D6); cloud keeps network-capable presets. A preset declares required tool targets, so a cloud spawn of a local-only preset is rejected with a clear error — not silently degraded |
| Blackboard KV coordination | **REPLACED** | `write/read_to_blackboard` retired in favor of Agent Communication MCP tools over `agent_messages`: directed messages, broadcast, status signals — not just shared keys. Cloud loop uses the same table via internal tools (parity, D13) |
| Watchdog self-healing (heartbeat/generation/≤3 resumes) | **KEPT** — pattern promoted to shared code | `supervisor/` + `Scheduler` adapter (§3) |
| Cron user agents (`agentWorkflows.ts`) | **KEPT** | `user_agents` table + per-environment scheduler |
| Agent lifecycle events to tracker | **KEPT**, same event names | `Telemetry` adapter |
| DO hibernation | **DROPPED** | Turn-scoped WS + catch-up path make it unnecessary (§2) |
| Vision preprocessing in-loop | **DROPPED** | Pattern A client pre-upload (05 §4) |

## 5. Agent Communication MCP — contract with the shared store

The three local agent MCPs (D6: Spawn, Communication, Management) and the two skill
MCPs (D7) all sit **on top of the same local `StateStore`/skill-store** — the shared
state layer mandated in D6/D7. Concretely: the sidecar owns one SQLite database;
each MCP server is a thin tool surface over it. In cloud mode the same operations
are internal functions of `studio-ai` over D1 — same table schema, same semantics,
no MCP hop (bindings are cheaper and the cloud has no MCP client for itself). This
satisfies D13: identical capability, different transport.

## 6. Streaming & connection model per environment

| Aspect | Cloud (`studio-ai`) | Local (sidecar) |
|---|---|---|
| Transport | Worker `WebSocketPair` accepted in fetch handler | `ws` server on 127.0.0.1 (frontend connects to sidecar) |
| Socket lifetime | Turn-scoped; safe disconnect via catch-up | App-session-scoped (no cost concern) |
| Loop survives disconnect | `ctx.waitUntil` (platform adapter around the loop invocation) | process keeps running (no-op adapter) |
| Concurrency guard | generation token in `sessions` | same (cheap insurance, single process anyway) |

## 7. Failure-mode parity check (the D13 audit)

| Failure | Cloud behavior | Local behavior |
|---|---|---|
| Client disconnects mid-turn | waitUntil finishes turn → `completed_content` | sidecar finishes turn → same column |
| Runtime dies mid-run (isolate eviction / app quit) | cron sweep resumes from `runs` checkpoint (≤3) | startup sweep resumes from same checkpoint (≤3) |
| Duplicate concurrent start | generation supersede (stale loop's writes rejected) | same |
| MCP registry unavailable | preload degrades to no external tools (today's catch-all behavior, kept) | same; locally-installed MCP servers still work offline |
| Gateway unreachable | turn fails with taxonomy error | cloud models fail the same way; local daemon models still work — **the one asymmetry, accepted and surfaced in UI** |

## 8. What this means for `ai-v2/AI_GUIDE.md`

The guide remains the studio-ai build reference with these amendments (to be edited
into the guide at P3.1):
- §0 decision 3 → replaced by D9 (AI SDK core as loop engine via gateway adapter).
- §0 decision 7 → replaced by D4 (agents worker removed; its runtime absorbed here).
- §3 `SessionBackend` → superseded by the wider `StateStore` (sessions + runs +
  agent_messages + user_agents), since the agents-worker absorption means studio-ai
  hosts sub-agent runs too.
- New sections sourced from this doc: supervisor/watchdog (§3), turn-scoped WS (§6).

## 9. Execution-plan impact

Phase 3 (04-EXECUTION-PLAN) gains one step and one clarification:
- **P3.2** now explicitly includes `supervisor/` (port of agentDO.ts resilience) and
  the `StateStore` schema above.
- **New P3.2b — loop unification test:** before building hosts, run both of today's
  loop behaviors (interactive streaming; checkpointed autonomous with
  maxIterations/tokenBudget) through the single engine against a mock gateway, since
  merging `chat/src/agent/loop.ts` and `agents/src/runtime/loop.ts` is the riskiest
  code move in the refactor.
- Phase 6 P6.1 (delete `agents/`) additionally requires: blackboard tools replaced,
  cron user-agents migrated to `user_agents`, and run history exported.
