# 07 — Vercel AI SDK Usage (What We Use, What We Don't, What We Should)

> Snapshot date: 2026-07-07. Measured against the current tree (commit `95a436d`) and
> the AI SDK **v7** documentation (gateway-v2 already runs `ai@^7`).
>
> Purpose: settle *how much of the loop we hand-write vs. hand to the SDK*. This is the
> operational follow-through on **D8** (library abstractions are acceptable;
> infrastructure coupling is not) and **D9** (AI SDK core is the loop engine, reached
> only through the gateway custom-provider adapter). The default posture here is:
> **prefer an SDK primitive over custom code whenever it is a swappable library
> abstraction and does not break the frozen protocol or the gateway boundary.**

---

## 1. The three-bucket rule (how to read this document)

Every SDK feature falls into exactly one bucket. The rest of the doc sorts features
into these:

| Bucket | Rule | Rationale |
|---|---|---|
| **ADOPT** | Use the SDK primitive; delete the equivalent custom code | It is a library abstraction (D8-acceptable), runs on both Workers and Node, and does not touch the wire protocol or provider boundary |
| **EVALUATE** | Prototype behind an adapter; adopt only if it stays swappable | The capability is valuable but may drag in a durability backend, a wire format, or infra coupling that would violate D8 |
| **AVOID** | Keep our own code; do **not** let the SDK own this | Adopting it would break the frozen WS protocol (§2 goal 5 of doc 02), duplicate the gateway, or re-introduce infra coupling |

The goal the user set — "maximize SDK, minimize custom code" — is correct **within the
ADOPT bucket**, which is large. The discipline is refusing to let it bleed into AVOID,
where custom code exists for load-bearing reasons (the frozen protocol, the gateway as
the single provider boundary, D8 runtime-independence).

---

## 2. What the AI SDK v7 actually offers (authoritative inventory)

From the v7 docs and the AI SDK 7 release notes. Grouped by relevance to our loop.

### 2.1 Agent abstractions
| Primitive | What it is |
|---|---|
| **`ToolLoopAgent`** | The core agent class: model + tools + the ReAct loop, wrapping `streamText`/`generateText`. Handles the message array and step loop so you don't. `.generate()` and `.stream()` entry points. |
| **`WorkflowAgent`** | Durable agent execution that survives "process restarts, deploys, interruptions, and delayed approvals." Aimed squarely at long-running/resumable runs. |
| **`HarnessAgent`** | Unified interface over third-party coding harnesses (Claude Code, Codex, Pi). |
| `streamText` / `generateText` | The manual-control path: run the loop yourself with full access to every step. `ToolLoopAgent` is sugar over these. |

### 2.2 Loop control
| Primitive | Controls |
|---|---|
| **`stopWhen`** | Termination. Built-ins: `isStepCount(n)` (default 20), `hasToolCall(name)`, `isLoopFinished()`. Array = stop when *any* fires. |
| **`prepareStep`** | Per-step mutation hook. Can override **model**, **`activeTools`** (restrict visible tools this step), **`toolChoice`** (`auto`/`required`/`none`/specific), and **messages** (compaction). Receives `stepNumber`, `steps`, `messages`, `initialMessages`, `responseMessages`. |
| **`pruneMessages`** | Built-in compaction helper for use inside `prepareStep` (`reasoning`, `toolCalls`, `emptyMessages` knobs). |
| **Lifecycle callbacks** | `onStart`, `onStepStart`, `onToolExecutionStart`, `onToolExecutionEnd`, `onStepEnd`, `onEnd` (usage, finishReason). |
| **Timeouts** | Granular: total, per-step, per-chunk, per-tool. |

### 2.3 Tools
| Primitive | What it is |
|---|---|
| **`tool()`** | Typed tool: `description`, `inputSchema` (Zod), `execute`, optional `toModelOutput` (shape the result the model sees), optional **`contextSchema`** (declare server-side values a tool needs). |
| **`toolsContext`** | Per-tool injected values (API keys, scoped permissions) — tools declare need via `contextSchema`, so a tool can't reach context it didn't ask for. |
| **`runtimeContext`** | Typed shared state threaded through the whole loop, readable in `prepareStep` and callbacks (request IDs, escalation flags). |
| **Dynamic tools** | Tool set can adapt based on `runtimeContext`. |
| **Tool approvals** | Human-in-the-loop: pause the loop pending user approval; function-based or catch-all, with opt-in **HMAC-signed** approvals. |
| **MCP tools** | `experimental_createMCPClient` pulls MCP servers' tools directly into the tool set. **MCP Apps** separate model-visible tools from app-only (UI) tools. |
| **`SandboxSession`** | Portable abstraction for command execution inside tools/agents. |

### 2.4 Output, models, streaming, ops
| Primitive | What it is |
|---|---|
| **`Output.object` / `generateObject` / `streamObject`** | Structured output against a Zod/JSON schema. |
| **`reasoning` option** | Standardized reasoning-effort config mapped to each provider's native setting. |
| **Custom provider / `LanguageModelV2`** | Any object implementing the provider interface plugs into all of the above — **this is the D9 gateway adapter's contract.** |
| **`createAgentUIStreamResponse` / UI message streams** | SDK's own client-streaming wire format. |
| **Realtime** | Provider-agnostic WebSocket sessions with audio + tool calling. |
| **Telemetry** | `experimental_telemetry` → OpenTelemetry; global registration; perf stats (`timeToFirstOutputMs`, `outputTokensPerSecond`). |
| **`uploadFile` / `uploadSkill`** | Provider-side upload caches (avoid re-sending bytes; containerized skill envs). |
| Media | `embed`/`embedMany`, `generateImage`, `experimental_transcribe`, `experimental_generateSpeech`, `experimental_generateVideo`. |

---

## 3. What we use today (measured, not assumed)

| Where | Uses from the SDK | Verdict |
|---|---|---|
| **`gateway-v2/` (`ai@^7`, `@ai-sdk/*@^4`)** | Provider packages (`@ai-sdk/openai`, `-anthropic`, `-google`, `-groq`, `-mistral`, `-xai`, `-deepseek`, `-fal`, `-replicate`, `-elevenlabs`, `-openai-compatible`) + `generateText`, `streamText`, `Output`, `jsonSchema`, `embed`/`embedMany`, `generateImage`, `experimental_transcribe/generateSpeech/generateVideo` | **Correct and idiomatic.** This is exactly where provider packages belong (D9). No change needed beyond finishing cutover (Phase 1). |
| **`gateway/` (old, `ai@^6`)** | Same family, older versions | Deleted in Phase 1. |
| **`chat/` (`ai@^6` in package.json)** | **Nothing.** Grep finds zero `import … from "ai"` in `chat/src`. The ReAct loop, tool registry, tier/`expand_tools` logic, streaming, and MCP discovery are **all hand-written plain TS.** | The `ai` dependency is vestigial. This custom code is the migration target. |
| **`agents/`** | Custom loop (`runtime/loop.ts`), custom `GatewayLLMClient` | Same — hand-written; merges into the shared loop (P3.2b). |

**One-line summary:** we use the SDK *properly as a provider boundary* and *not at all
as an agent engine*. D9 says the agent engine should also be the SDK. Everything in §4
is the delta.

**Version note:** the new `packages/agent-loop` must target **`ai@7`** to align with
gateway-v2 and to get `ToolLoopAgent`/`prepareStep`/`activeTools` (the v6 agent class
was the older `experimental_Agent`). Bumping `chat/` is moot — `chat/` is being deleted.

---

## 4. ADOPT — SDK primitives that replace planned custom code

This is the "maximize the SDK" list. Each row replaces something docs 05/06 currently
plan to hand-write inside `packages/agent-loop`.

| SDK primitive | Replaces (custom code in 05/06) | Why it's a clean win |
|---|---|---|
| **`ToolLoopAgent` (or `streamText` + `stopWhen`)** | `agent/loop.ts` port — the hand-written `llmStep → toolsStep → emit` iteration (05 §1) | The loop *is* the SDK's core competency. Reaches models through our custom gateway provider, so D9 holds. Use raw `streamText` if we need to interleave the frozen-protocol emit between steps (likely — see §6). |
| **`stopWhen` (`isStepCount`, `hasToolCall`, `isLoopFinished`)** | `maxIterations` / `tokenBudget` / early-exit-on-`local_tools_pending` logic in both loops (06 §1, `agents/runtime/loop.ts`) | Declarative stop conditions replace bespoke counters. `hasToolCall('local_tools_pending-ish')` can model the relay early-exit. |
| **`prepareStep` → `activeTools`** | The tiered tool-visibility + **`expand_tools` meta-tool** + per-turn expansion limit (`tools/agentic/expandTools.ts`, `steps/catalog.ts`) | This is the biggest single win. Tiered/expandable tool visibility is exactly what `activeTools` does per step — a large chunk of custom "virtual meta-tool" machinery becomes a `prepareStep` return value. |
| **`prepareStep` → messages + `pruneMessages`** | Any custom context-window trimming/compaction | Built-in compaction; we decide the policy, the SDK does the surgery. |
| **`prepareStep` → model override** | The `router/` tier→model selection *as applied mid-loop* | Model routing per step without leaving the loop. (Tier *policy* still ours; the *application* is a one-liner.) |
| **`tool()` + `inputSchema` + `toModelOutput`** | Hand-rolled tool registry entries, result shaping | Typed tools with schema validation for free; `toModelOutput` replaces manual result-trimming (e.g. the ~1KB result shaping). |
| **`toolsContext` / `runtimeContext`** | `context/index.ts` **AsyncLocalStorage ambient globals + the module-level registry Map that breaks on hibernation** (05 §1, 06 S2) | Directly fixes a named defect: no ambient globals, no rebuild-after-hibernation hack. Context is threaded explicitly and typed. |
| **Lifecycle callbacks (`onStepEnd`, `onEnd`, `onToolExecutionEnd`)** | Manual per-turn persistence hooks + `tracking/` span emission points | Natural, guaranteed hook points for `StateStore` checkpointing and `Telemetry` — instead of threading emit calls through loop internals. |
| **`experimental_telemetry` (OpenTelemetry)** | Parts of `tracking/` span construction | Standard spans + `timeToFirstOutputMs`/`outputTokensPerSecond` feed the tracker restructure (Phase 6) instead of bespoke span code. Keep our `Telemetry` adapter as the sink. |
| **Timeouts (per-step/per-tool)** | Any custom per-tool timeout/abort logic | Config, not code. |
| **`experimental_createMCPClient`** | `tools/mcp/` discovery + remote/builtin tool wrappers (05 §1) — **the local side** | For locally-installed MCP servers the sidecar talks to directly (stdio/SSE), the SDK's MCP client is the standard path. (Cloud MCP-registry discovery via binding stays ours — see §5.) |

**Net effect:** the `loop/`, `tools/` (registry + expand), `router/` (application),
`context/` (globals), and parts of `telemetry/` folders in the 06 §3 layout shrink
substantially. The *policies* (which tier, which tools per turn, what to persist)
remain ours; the *mechanics* move to the SDK.

---

## 5. EVALUATE — valuable, but must stay swappable (D8 gate)

Prototype these behind an adapter and adopt only if the swap cost stays "rewrite one
in-process layer" (D8). Each carries a specific coupling risk to check first.

| SDK primitive | What it could replace | The gate it must pass |
|---|---|---|
| **`WorkflowAgent`** | The **entire `supervisor/`** design (06 §3): heartbeat + generation-token + bounded-resume ported from `agentDO.ts`, plus the `Scheduler` adapter | **Highest-value candidate here.** Durable execution surviving restarts/interruptions/delayed-approvals is precisely our resumable-runs requirement. **Gate:** what is its durability backend, and is it swappable to *our* `StateStore` (SQLite local / D1 cloud, D13)? If durability requires Vercel/other-specific infra, it is D8 infra-coupling → **AVOID** and keep the `agentDO.ts` port. If the backend is pluggable, it could delete ~100 lines of supervisor logic *and* the generation-token concurrency code. **Resolve before P3.2.** |
| **Tool approvals (human-in-the-loop)** | Nothing today — this is *new capability* | Low risk (it's a loop-pause mechanic). Worth adopting for destructive/expensive tools. Confirm the pause state serializes into our `StateStore` so a paused approval survives eviction/app-restart (must, to match `WorkflowAgent`'s promise). |
| **`HarnessAgent`** | Potentially the local coding sub-agents (D6 Agent Spawn presets; the coding explorer/planner/coder/tester specialists) | Only relevant to the local file-system coding agents. Evaluate in **Phase 4**, not Phase 3. Check it doesn't assume a specific process/sandbox model we can't run in the Tauri sidecar. |
| **`SandboxSession`** | Command-execution plumbing for local coding agents | Phase 4 concern. Gate: does it run in our sidecar without a cloud sandbox dependency? |
| **`reasoning` option** | Any per-model reasoning-effort handling | Likely a clean ADOPT; parked here only to confirm it's plumbed *through the gateway provider* rather than requiring a direct provider package in `agent-loop` (which D9 forbids). |

---

## 6. AVOID — keep our own code here

Adopting these would break a load-bearing constraint. This is where "maximize the SDK"
stops.

| SDK primitive | Why NOT | What we keep |
|---|---|---|
| **`createAgentUIStreamResponse` / UI message streams** | The SDK's client-streaming wire format is **not** our frozen protocol (`start`/`tool_start`/`tool_complete`/`local_tools_pending`/`done`/…, doc 01 §4). Adopting it forces a client change — violating "users notice nothing" (doc 02 goal 5). | Our `emit/` layer. Drive the loop with **`streamText`** and translate its step/chunk events into our frozen events ourselves. This is the reason to prefer `streamText` over the fully-encapsulated `ToolLoopAgent` where they conflict. |
| **Realtime WebSocket sessions** | Same reason — it owns the socket and the protocol. Our WS is turn-scoped and frozen (06 §6). | Our `WebSocketPair` (cloud) / `ws` sidecar (local) + catch-up path. |
| **`@ai-sdk/<vendor>` provider packages inside `agent-loop`** | **D9, absolute.** Provider packages live only in gateway-v2. | The single gateway custom-provider adapter (binding / HTTPS / daemon transports). |
| **Cloud MCP-registry discovery via the SDK MCP client** | Cloud tool discovery goes through our `MCP` service binding + KV cache and the hub's Composio ownership (D5). The SDK MCP client is for *directly-connected* servers, which cloud isn't. | Our `RegistryClient` adapter for the cloud/binding path; use `experimental_createMCPClient` only for locally-attached servers (§4). |
| **`uploadFile` provider caches for vision** | We already chose **Pattern A** (client pre-uploads to `studio-data`, sends URLs; 05 §4). Provider-side upload caches would fork that model per-provider and re-introduce provider specifics above the gateway. | Pattern A through `studio-data`. (`uploadFile` *could* be a gateway-internal optimization later — that's a gateway decision, not an `agent-loop` one.) |

---

## 7. Recommendations (what to actually do, and when)

1. **Target `ai@7` in `packages/agent-loop`** from the first commit (P3.2). Aligns with
   gateway-v2; unlocks `ToolLoopAgent`/`prepareStep`/`activeTools`/`WorkflowAgent`.
2. **Build the loop on `streamText` + `stopWhen` + `prepareStep`, not the fully-wrapped
   `ToolLoopAgent`** — because our frozen-protocol `emit/` layer needs to sit between
   steps (§6). Revisit `ToolLoopAgent` if a clean seam for custom emission exists.
3. **Delete `expand_tools`/tier-catalog machinery in favor of `prepareStep`→`activeTools`.**
   This is the largest custom-code reduction available and should be an explicit P3.2 task.
4. **Replace `context/index.ts` ambient globals with `runtimeContext`/`toolsContext`.**
   This also erases the hibernation-registry-rebuild hack (06 S2) at the source.
5. **Resolve the `WorkflowAgent` question before writing `supervisor/`** (§5). It could
   make the single riskiest custom component (the `agentDO.ts` resilience port)
   unnecessary — *if* its durability backend is pluggable to our `StateStore`. This is
   the one open decision that changes the Phase 3 build plan; record the outcome as a
   new decision (D16) in `03-DECISION-LOG.md`.
6. **Wire `experimental_telemetry` into the `Telemetry` adapter** during the Phase 6
   tracker restructure — don't hand-build spans the SDK now emits.
7. **Defer `HarnessAgent`/`SandboxSession` to Phase 4** (local coding agents), evaluated
   against the sidecar's constraints.

---

## 8. Open questions to resolve (feed into the decision log)

| # | Question | Blocks | Proposed owner action |
|---|---|---|---|
| Q1 | Is `WorkflowAgent`'s durability backend swappable to our SQLite/D1 `StateStore`, or is it infra-coupled? | `supervisor/` design (P3.2) | Spike a `WorkflowAgent` on a local SQLite-backed store; if impossible, keep the `agentDO.ts` port. → **D16** |
| Q2 | Does `streamText`'s step/chunk event stream give a clean seam to emit our frozen protocol, or do we need lower-level control? | Loop host shape (P3.2/P3.3) | Prototype the emit translation in P3.2's mock-gateway test. |
| Q3 | Does tool-approval paused-state serialize into `StateStore` so it survives eviction/restart? | Whether we adopt approvals | Confirm in the same spike as Q1. |
| Q4 | Can the gateway custom provider expose the `reasoning` option without leaking provider packages upward? | `reasoning` adoption | Gateway-side; confirm the adapter passes it through. |

---

## 9. Relationship to existing decisions

- **Extends D8** with a concrete three-bucket test (ADOPT/EVALUATE/AVOID) for every SDK
  feature — the operational form of "replaceability, not vendor name."
- **Implements D9** by naming *which* SDK core primitives `agent-loop` uses and
  confirming they all reach models through the gateway adapter.
- **Governed by D15** (research-led rebuild): the ADOPT/EVALUATE/AVOID calls below are
  *provisional inputs* to the per-block research, not pre-commitments — each is
  confirmed at build time via D15's dual-target gate.
- **One open item will produce a new decision:** Q1 → potential **D16** (WorkflowAgent
  vs. hand-rolled supervisor). Record it before P3.2 starts.
