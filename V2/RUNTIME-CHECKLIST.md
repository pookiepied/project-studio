# Studio Runtime Requirements Checklist

Master checklist for the durable execution runtime (2026-07-11). The AI SDK owns model
interaction and agent-loop mechanics; **our runtime owns everything around it**. Planner
and Agent runtimes reuse the same structure with different config (prompt, loop, budgets).

> **Read with [OWNERSHIP.md](OWNERSHIP.md).** This list is a reference of what a complete
> system needs *somewhere* — NOT an implementation mandate for the execution runtime.
> Each item gets built in its proper layer per the placement doctrine.

Legend: ✅ built · 🟡 partial · ❌ not started · 📝 user caveat attached

---

## 1. Runtime ownership (the product is the runtime, not the loop)

| # | Capability | Status |
|---|-----------|--------|
| 1 | Run state and lifecycle | ✅ granular 16-state lifecycle + transition matrix |
| 2 | Durable persistence | ✅ DO SQLite event log + run projection + checkpoints |
| 3 | WebSocket communication | ✅ hibernation API, log-before-broadcast |
| 4 | Reconnection and event replay | 🟡 snapshot/replay + subscribe/ack built; auth and client gap behavior pending |
| 5 | Tool authorization and scheduling | 🟢 policy metadata, approval gate, wrapper, concurrency coordinator, and external result parking built |
| 6 | Cancellation | ✅ explicit command → server-owned AbortController → AI SDK + tools |
| 7 | Crash recovery | ✅ alarm watchdog restarts from checkpoint after eviction |
| 8 | Context construction | 🟡 📝 **built OUTSIDE the runtime** — Context package handoff exists; real selection/packing still belongs to Studio Context. |
| 9 | Local/cloud execution routing | 🟢 Registry/Context descriptors route cloud calls through MCP hub and local calls through the desktop relay |
| 10 | Observability | ❌ |
| 11 | Queue mechanism for incoming commands/turns | ❌ 📝 frontend will handle several of these flows; boundary TBD |

## 2. Stable execution identities

| Item | Status |
|------|--------|
| `conversationId`, `runId` | ✅ |
| `branchId`, `turnId`, `attemptId`, `toolCallId` | ✅ (`stepId`/`streamId` deferred until needed) |
| Run ID ≠ conversation ID | ✅ already separate |
| `idempotencyKey` on every user submission (duplicate send ≠ duplicate run) | ✅ atomic claim in DO SQLite |

## 3. Explicit run state machine

Current: `pending → running → paused/cancelled/completed/failed`.

Target states: `queued, starting, reasoning, tool_calls_pending, tools_running,
waiting_for_approval, waiting_for_external_result, responding, pausing, paused,
cancelling, cancelled, recovering, completed, failed, expired`.

- [x] Expand `RunStatus` + `TRANSITIONS` matrix (16 states, invalid transitions rejected)
- [x] Transition record: `run.status_changed` carries `{ previousStatus, nextStatus, runVersion, reason }`
- [x] `runVersion` CAS — control commands may send `expectedVersion`; stale → `stale_command`

## 4. Append-only event protocol (Studio Runtime Protocol)

Frontend consumes **our** protocol, never the AI SDK stream format. ✅ principle already
honored (loop translates stream parts into `ExecutionEvent`s).

- [x] Monotonic sequence per conversation (SQLite `seq`)
- [x] Envelope upgrade: `protocolVersion`, `eventId`, `turnId`, `timestamp` (ms)
- [x] Full event vocabulary (approval/artifact types defined; emitted once those features land)
- [x] Client `ack` recorded per-socket (hibernation-safe attachment); 🟡 gap-detection consumer pending

## 5. Reconnection protocol

- [x] Snapshot (with `latestSequence`) + replay after last seq
- [x] `subscribe` frame with `lastReceivedSequence` (query param kept as convenience)
- [x] Runtime surface ownership check on connect/control/approval (`X-User-ID` from API/auth boundary)
- [ ] API V2 route/JWT forwarding into execution-runtime
- [x] Client ack of highest processed sequence
- [x] Three resumes kept distinct: transport resume ✅ · execution recovery ✅ (watchdog) · conversation resume ❌ (needs Studio Data)
- [x] **Disconnect ≠ cancel** — refresh/close/sleep/reconnect never stop a run; only explicit `run.cancel`
- 📝 **Desktop/local nuance:** a local runtime touching local files can't keep running headless the same way. Grace window (~30–60s) then pause-or-stop on reconnect-resume — but this is the **parent/frontend's decision, not the runtime's**. Runtime exposes pause/resume primitives; policy lives above it.

## 6. Durable checkpoints

Current: checkpoint after each model step. Target — persist at *every* boundary:

- [x] Before model call (persist-intent checkpoint at every attempt start) · [x] after step · [ ] before each tool · [ ] after each tool result (explicit tool-boundary checkpoints pending real tools)
- [ ] Before/after approval as checkpoints (§9) · [x] approval request/verdict persisted separately · [x] before/after final message · [x] on status change (run projection saved)
- [x] Never rely on shutdown hooks — incremental writes only (log-before-broadcast)
- [x] `RunCheckpoint` record upgrade: `version`, `modelMessagesHash`, `completed/pendingToolCallIds`, `activeApprovalId`, `partialAssistantText`
- [x] Persist intent → do operation → persist result → advance (pattern established; extend to tools)

## 7. Tool execution coordinator 🟡

Per-tool policy metadata: `locality (cloud|local|either)`, `effect (none|read|write|destructive)`,
`concurrencyKey`, `idempotent`, `requiresApproval`, `retryable`, `timeoutMs`, `maxResultBytes`,
`permissionScopes`.

This means ordering tool execution **inside one active run**, not cron/scheduled agents.
Scheduled/background invocation belongs to Agent Runtime / parent/API scheduling layers.

The coordinator preserves AI SDK parallel tool calling: tools with no shared
`concurrencyKey` run in parallel. Calls with the same key serialize in FIFO order
inside the current run attempt. Recovery safety still comes from idempotency records,
not from in-memory locks.

Parallelize independent reads/searches; serialize same-file writes, git mutations,
same-record DB writes, destructive actions by assigning the same `concurrencyKey`.

Tool sources are now explicit in shared contracts: connectors, native cloud tools,
user remote MCP tools, native local relay tools, and client actions. Runtime resolves
only the descriptors supplied by Studio Context; Registry/Context own discovery and
selection.

## 8. Idempotent side effects ✅

- [x] Operation record `${runId}:${toolCallId}` with `reserved | executing | completed | failed`
- [x] Atomic reserve → check-completed → return-previous-result-when-safe
- [x] Never blindly repeat destructive/external effects: non-idempotent op found `executing` after a crash is refused, not repeated

## 9. Tool approval system 🟡

- [x] Approval driven by **tool policy** (`requiresApproval`), not model request — and the DECISION is the frontend's; the runtime is a permission listener that enforces the boundary
- [x] `ApprovalRequest`: id, runId, toolCallId, summarizedAction, normalizedInput, riskLevel, expiresAt
- [x] Persist request · reject duplicate responses (`approval_already_resolved`) · recover parked run after DO restart · authorize responder by runtime conversation ownership
- [ ] Public API JWT/auth route for V2 approval resolution
- [x] `waiting_for_approval` state + `approval.required/resolved` events

## 10. Loop controls and budgets 🟡

- [x] No arbitrary default cap: execution limits are optional; undefined means unlimited
- [x] Optional per-run limits contract: model steps, tool calls, repeated tool calls, wall-clock, tokens, cost, consecutive errors
- [x] Runtime observes model/token/tool usage and records repeated tool signatures
- [x] Exact repeated tool-call detection can stop pathological loops without capping legitimate long runs; threshold comes from context/runtime profile, not product plan
- [ ] Cost accounting source (Gateway/tracker integration) and consecutive-error accounting still need real provider/tool error taxonomy wiring

## 11. Context management 🟡 📝

Three representations, never conflated:
1. **UI history** (everything shown, incl. branches) — frontend/Data
2. **Canonical conversation history** (durable semantic records) — Studio Data
3. **Context window** (what the model sees) — **Studio Context worker** builds it

📝 Context is constructed **outside** the runtime. A minimal runtime↔Context handoff now
exists: Execution Runtime asks Studio Context for a `ContextPackage` and consumes its
runtime prompt, relevant history, tool package, and optional limit profile. Real context
selection, attachment/artifact fetching, token packing, caching, and compaction still
belong in Studio Context, not in the main agent loop.

## 12. Durable Object responsibilities ✅ scoped correctly

DO owns: active-run lock, command ordering, event sequencing, client registry,
broadcasting, approval coordination, replay buffer, recovery initiation. ✅

DO does NOT own: search, analytics, billing, cross-user reporting, large artifacts → Studio Data. ✅

- [x] `acceptWebSocket()` hibernation · [ ] serialized WS attachments for connection metadata
- [x] DO ≠ durable continuation of in-flight JS — checkpoint incrementally, never batch-at-end

## 13. Error and retry policy 🟡 📝

- [ ] Error taxonomy: `validation, authentication, authorization, rate_limit, provider_transient, provider_terminal, tool_transient, tool_terminal, timeout, cancelled, runtime_restart, protocol_error`
- [x] Auto-retry transient (backoff, max 3) · [x] never retry cancellation
- [ ] Never auto-retry: permission denials, destructive effects without idempotency, oversized context without compacting, unknown tools
- [ ] Normalize AI SDK errors/callbacks into our taxonomy
- 📝 **User note:** deep retry orchestration is more a user-level request than a core runtime duty — keep the taxonomy and hooks in place so nothing important is missed, but don't over-build automatic retry.

## 14. Conversation concurrency rules 🟡

- [x] One active run per conversation (currently hard `reject`)
- [ ] `ConcurrentInputPolicy`: `queue | interrupt_and_replace | fork_branch | reject` (default for chat: interrupt_and_replace or queue)
- [ ] Defined behavior for: regenerate-during-run, edit-earlier-message, two tabs sending, mobile+desktop together, local & cloud both claiming ownership, double approval, tool result after cancel
- [ ] Run versions / CAS to reject stale commands

## 15. Things NOT to build twice ✅ principle locked

AI SDK keeps: stream parsing, provider tool-call normalization, input validation,
multi-step continuation, standard retry plumbing, approval message representation,
step callbacks, structured output parsing.

We build only where Studio needs stronger semantics: durable state, tool policy,
idempotency, ownership, reconnection, event protocol, context policy, local/cloud
routing, recovery, observability.

## 16. Sibling runtimes

- [ ] Planner Runtime: same structure, different config (read-only tool gate, structured `Plan` output, its own budgets)
- [ ] Agent Runtime: same engine reused (architecture decision #3), agent-specific prompt/config
