# The Agent Platform Plan — Phase 13 and the architecture around it

**Status:** Proposed · 2026-09-29
**Execution order:** `agent-platform-roadmap.md`, written 2026-10-03 beside this plan — it owns order, gates, and per-stage status (S0–S2 shipped); this plan owns scope and decisions. When the two disagree, this plan is right and the roadmap gets fixed.
**Written against:** `STUDIO HARNESS` on `@flue/runtime` 2.0.3 (patched), post Flue-2 migration, post ADR 0057.
**Scope:** The whole agent system — agent types, subagents, tasks, tool exposure, MCP, skills, hooks, permissions, identities, dispatch, persistence — as one architecture, with a staged path from what exists to what should exist.

This plan was written after a full read of the harness (app.ts, studio-runtime.ts, the kernel, the gate, contracts, the extend spine, MCP catalog, skills registry, transport, brokers, observability, the Flue patches), the STUDIO client's chat/connection and Tauri host layers, and the decision record (ADRs 0001–0057, mental-model, roadmap, phases-1-11 register, flue-2-migration). Every claim below is code- or ADR-sourced.

---

## Part I — The architecture as it exists (the map)

### 1. Runtime ownership (do not re-litigate)

| Layer | Owner | Where |
|---|---|---|
| Agent loop, durability, compaction, delegation primitive, `task` tool, skills surface | **Flue** (`@flue/runtime` 2.0.3, patched) | `node_modules/@flue/runtime`, `patches/@flue__runtime@2.0.3.patch` |
| Model protocol, cache placement | **Pi** (`@earendil-works/pi-ai` 0.84.4, patched) | `src/gateway/language/` only (lint-enforced, ADR 0051) |
| Tool policy, permissions, registry, identity, dispatch surfaces, the app | **Us** | `src/` everywhere else |

The patch on Flue is small and deliberate: duplicate `Date:`/`Working directory:` removal from `composeSystemPrompt` (keeping the `## Available Agents` section — it is the `task` tool's other half), a `compactInstance` manual-compaction door published on `globalThis.__projectStudioCompactAgentInstance`, compaction prompts riding the config, and a transient-model-retry policy consulted on `globalThis.__projectStudioTransientModelRetryPolicy` with `submission_retry_scheduled` records. Any Phase 13 work that needs more from Flue should extend this patch the same way (anchor on function names, never bundle hashes).

### 2. Process shape

Two processes, one machine (ADR 0001): the **Tauri Host** (`STUDIO/src-tauri/src/harness/`) spawns the Harness, hands it a per-launch admission credential over the bootstrap channel (fd 4 on Unix, stdin on Windows — ADR 0040), reads a readiness frame (`PORT=0`), and holds the bearer forever — the webview calls `service_fetch` / `service_stream` / `service_fetch_bytes` and never sees the token (ADR 0044). The Harness serves HTTP + SSE over loopback through Hono (`src/transport/http/create-app.ts`): one admission middleware, per-client-type scope tables (`admission/scopes.ts`), the Flue agent router mounted at `/agents/studio`, and product routes under `/api/*`.

**There is no cloud runtime.** The Studio Gateway Worker was cancelled and deleted (`bd4d389`), its client with it (`45233d5`); `Backend/` is an undeployed scaffold — the pookiepied.dev umbrella, kept and explicitly out of scope by the operator's direction (2026-10-03: ignore that folder, no task here modifies it); no "Cloud Agent Loop" exists anywhere in code or docs. Model sources are `test` and `local` only; `"gateway"` is reserved in the provider contract for a future user-hosted source. The Studio account sign-in (`src/auth/`) exists and is wired to nothing.

### 3. Identity and correlation (ADR 0033, as amended for Flue 2)

The vocabulary is fixed and any new work must speak it:

| Identity | Owner | Meaning here |
|---|---|---|
| `instanceId` | caller-chosen | The product's conversation: `cnv_<uuid>` (webview-minted), or `<conversation id>-t<N>` for a titling take |
| `submissionId` | Flue | One admitted piece of durable work, `sub_<ulid>`; event `kind` distinguishes `direct` / `dispatch` |
| `conversationId` (Flue) | Flue | Flue's own `conv_<ulid>` durable stream — **not** the product's conversation |
| `agentName` | Flue (pinned literal per module) | `studio`, `title`, `improve`, `describe` — separates two agents on one instance |
| `requestId` / `operationId` / `parentOperationId` / `attemptId` | Studio | The execution-context graph in `src/execution/context.ts`; `ExecutionOperationKind` already includes `"subagent"` (reserved, marked) |
| `toolCallId`, `turnId`, `taskId` | Flue | Preserved, linked, not duplicated |
| `traceId` / `spanId` | OpenTelemetry | Live telemetry only, never durable identity |
| `idempotencyKey` | Flue 2.0 upstream | **Declined** for the current shape; reopen condition: any path that resends a submission automatically must carry it |

Two databases, deliberately: Flue's `~/.studio/data/flue.db` (canonical transcripts, submission journal, run state) and the product's `~/.studio/data/studio.db` (24 tables: conversation index, projects, grants, trust, extension selection, MCP registry, sandbox scopes, plans, questions, approvals, provider records, library, documents, context usage). Flue's stream is the only transcript; the product stores never hold text.

### 4. The execution path of one user turn (traced)

1. **Webview** (`STUDIO/src/features/chat/connection/useConversation.ts`): mints `cnv_<uuid>`, POSTs the submission through Tauri `service_fetch` (Rust attaches the bearer), then re-attaches by offset with `service_stream` (SSE). State machine: `no-harness → attaching → live → submitted → streaming (retrying) → idle | interrupted | run-failed`. The webview holds one durable thing per conversation: an offset (ADR 0045). A dead window cancels nothing.
2. **Admission**: the middleware verifies the bearer and scope (`agent:run` for agent routes); the **turn-settings middleware** (`transport/http/middleware/turn-settings.ts`) reads `modelId` / `reasoningLevel` / `permissionMode` / `projectId` from the body, settles them into the conversation index **before** the run is admitted (Flue strips everything but the message envelope), creates the row on a first turn (and removes it if the send is refused — Task 33), hands first words to the titler, and re-opens a pending capability note. `streamHeartbeat` sits before the agent router.
3. **Flue run**: the render (`agents/studio.ts`) re-runs per submission — reads turn settings, mounts `useModel` (with Studio's compaction reserve: max(20k, 15% of window)), `useSandbox` (the factory below), `useSkill` per conversation-enabled skill, `useDelivery`, a `useAgentStart` documents announcement — and returns the system prompt: static prompt + environment block (workspace, kind, scratch/attachments/artifacts, library, background jobs) + capability inventory (memoized per conversation, reopenable only between submissions).
4. **Sandbox factory** (`createAgentSandbox`, once per submission): builds `ExecutionScope { clientId, sessionId, agentId: "studio", conversationId, projectId }`, the policy (read/write roots from scope grants + project folders + scratch/attachments/artifacts/library), `LocalSandbox`, `PermissionKernel` (grants + approval broker + posture from per-conversation mode + trust store), `CallGate` (+ bounds, snapshots per **project**), `ClosingTurns`, and registers the native tools plus the `discover` tool wired to this conversation's enablement chain.
5. **Tool array**: `refreshTools()` loads natives + this conversation's *adopted* MCP keys (append-only per conversation, `#discoveredToolKeys`); the array is exposed through the factory's `tools()` callback mapped through `modelToolName()` with conflict detection.
6. **A call**: model names a tool → the gate parses, resolves resources, **kernel.authorize** (policy → grants → mode-resolved default; trust precondition ahead of both; definition-hash re-ask for changed MCP tools; scope ladder offered to the approver) → **sandbox.assertSupports** (operator switches; the gate is the boundary, ADR 0057) → abort check → snapshot if any effect earns undo → `CallBounds.run` (deadline, FIFO queue of 8, idempotency-aware abandonment messages) → tool `execute` (sandbox-contained paths; background jobs via `spawnPlan`; MCP via supervisor connection with `_meta.studio/conversation` for system servers) → result normalized, untrusted-content labels applied, finished-job notices appended on the way back.
7. **Persistence**: Flue appends canonical records (idempotent under caller key); the webview reads by offset. Product rows (grants, usage, jobs) live in studio.db. Background-job endings reach the model three ways, exactly-once among them: the tool-result tail, the next turn's environment block, and the `studio.jobs.finished` signal dispatched to the conversation's instance (`deliverJobPing`).

### 5. What already exists for the phase we're planning

- **Delegation machinery in Flue 2.0.3, unused by us**: `useSubagent` / `defineSubagent` / `GeneralSubagent`; the `task` tool registered unconditionally with an always-present `## Available Agents` section (empty-roster paragraph kept by patch decision); `SubagentNotDeclaredError`, `DelegationDepthExceededError` (depth cap 4); delegates inherit the parent's **environment** (sandbox + harness tools + workspace context + model) and nothing of the conversation; `model` / `thinkingLevel` overrides per delegate; child sessions are durable streams that recovery reattaches and resumes.
- **The observability layer is already subagent-aware**: `observability/flue.ts` maps `operation.type === "task"` (and `operationKind === "task"`) to `ExecutionOperationKind "subagent"`, and `agentName` exists precisely to separate a conversation's turn from background work.
- **The dispatch-only agent pattern is in production**: `title`, `improve`, `describe` — unmounted `'use agent'` modules with pinned `agentName`, invoked by in-process `dispatch(Agent, { id, message })` (by function value), each with its own durable stream, plus `init()`-style wait via the SDK (`FlueHarnessClient.wait` semantics measured).
- **Background work exists at the process level**: `BackgroundJobs` (ring-buffered per-conversation process jobs), `MediaJobs` (generation jobs with artifacts), the `jobs` tool, the rail's background panel, and the `JobPings` completion-signal hub.
- **Recorded decisions that bind the design**: subagents are **not** an `extend/` kind — "a subagent consumes the three" (`archive/phase-11-mcp/002-design.md`); a grant belongs to an agent (ADR 0038 — "a second agent cannot inherit the first one's approvals. Asserted now"); a child inherits nothing it was not given (ADR 0039); a background task is "another durable stream with an offset … reuse ADR 0045's mechanism" (`architecture/transcript-and-rendering.md` §6); ADR 0030 §5 — "subagent authority derivation … requires a trusted application context, grant-store schema changes, and a separate product/API decision; caller-supplied ids are not accepted as a substitute"; ADR 0012's open question — is a subagent's policy derived from its parent or declared independently — is **ours to answer now**.

### 6. Known defects and debts that touch this work (from the register, code-verified)

- **#73** — a user cannot see or withdraw any grant: `PermissionGrantStore.list()/revoke()/revokeConversation()` have no caller and no route. Phase 13's per-agent grants need this surface to exist first.
- **#49** — grants must not leak parent → child: the ledger names this as Phase 13's permission dependency.
- **#50 / #86** — snapshots exist; restore does not (`SnapshotStore.list()/restore()` have no caller). Auto-mode writes are licensed by undo that cannot currently be invoked.
- **#66** — no MCP tool-timeout / tool-cancellation tests.
- **#31** — `createRetryExecutionContext` (the `attemptId` half of ADR 0033) is declared-not-wired; the durable execution projection (step 5) has no consumer.
- **#88** — the Host starts the Harness with bare `Command::new("node")` through `PATH` (the thing the TS side refuses).
- **#89** — a Windows MCP child can outlive its Harness (`process_group(0)` is `#[cfg(unix)]`; the Job Object was never created). Any background-agent work that spawns children inherits this.
- **#13** — the gateway decision is still open (recommendation recorded: Phase 7 harness-side only for 1.0).
- **Meta-task §5** — two undecided gate designs: RTK (tool-result projection — "the gate needs a result-projection seam it does not currently have") and the Execution guard (conversation-scoped *state* as a fourth gate stage). "Both want a gate that carries state across calls within a conversation. That is one design, and it should be decided once."
- **C-19** — STUDIO away from the machine: "the relay needs the same capability seam subagents need, and building it earlier means designing that seam twice."
- **Stale docs** (fix as part of Stage 0): `domain-ownership.md` (AppContainer era, pre-remediation "violations"), `api-inventory.md` (1.0 vocabulary, `runId`, missing half the routes), `rules.md` (Node 22.18.0; the `tasks/` folder rule), `directory-map.md` (`tasks/` listed as live; Phase 11 "in progress"), `mental-model.md` (`1.0.0-beta.9`; "9 files import @flue"), every `tasks/...` pointer in roadmap/phase docs, ADR 0030 §2 (the `conversation:` prefix sentence).

---

## Stage 0 findings — the delegation measurement (2026-09-29)

Measured against a live built harness, `dist/server.mjs` spawned the way
`tests/integration/skills-flue.test.ts` spawns it (random port, admission
credential, `PROJECT_STUDIO_MODEL_SOURCE=test`, temp `PROJECT_STUDIO_HOME`),
driven by the scripted test model. The instrument was a throwaway and was
**removed after the reading** — deliberately: three probe edits (a
`[probe:*]` scenario set in `test-adapter.ts`, a wrapped sandbox factory and a
`useSubagent` declaration in `agents/studio.ts`, an operation log in the
observability interceptor), a one-function delegate module, and a temporary
integration driver, all reverted; the working tree carries none of it. What
follows is the record. Every "measured" below came from that run; "from the
installed source" means read from the patched `node_modules/@flue/runtime`
dist, which is the code that ran.

### The disarmed path (no delegate declared)

- **The `task` tool is in the model's tool array** — measured
  (`task-in-tools=true`), on a build that declares nothing. Stock 2.0.3
  registers it unconditionally; its spec is static (no roster text), so the
  cached prefix never moves with roster state. Confirms the patch's own
  comment, from the live array.
- **The model reads the empty-roster paragraph.** The composed prompt the
  model's context carries contains, byte-for-byte: *"None. No subagents are
  currently declared, so the `task` tool has no valid `agent` value — do not
  call it unless an agent is introduced later in the conversation."* The
  section is `## Available Agents`, placed after the instructions. The patch
  deliberately kept this section when removing the duplicate date/working-
  directory lines; measured, it is there and it is the `task` tool's other
  half.
- **The refusal is a successful tool result, not an error.** Calling `task`
  with an agent no roster names returns `isError: false`, text: *"Subagent
  "nobody-here" is not declared. Available subagents: (none)."*, details
  `{agent, available: []}`. The same call on the armed build (roster =
  `explore`) answers *"Available subagents: explore."* with
  `details.available = ["explore"]` — the factual miss names the real roster.
  This is the behavior the runtime's own `createTaskTool` comment documents
  ("a name outside the roster answers with a factual miss (same pattern as
  `activate_skill`), not an error outcome") and the measurement hypothesis
  the Stage 0 brief carried; measured, it holds, with the sharper fact that
  the result is not even error-shaped.

### The armed path (one delegate declared via `useSubagent` in the render)

- **Delegation runs end to end on the untouched runtime.** The parent's model
  called `task {agent: "explore", prompt}`; the child ran, answered, and the
  child's final text returned as the task tool result — confirming that all
  delegation behavior is stock Flue 2.0.3 (the 590-line patch has no
  delegation hunks; the only delegation-adjacent hunk is the
  `composeSystemPrompt` date/working-directory removal, which keeps the
  Available Agents section).
- **`createSandbox` does not run per delegate.** It ran once per conversation
  (one submission each in this run), `options = {id: <the instance id>}` — and
  did **not** run again for the delegate's task session. The child session is
  constructed with `parentEnv` — the parent's already-built `Sandbox` — which
  the instrumentation confirmed directly: every tools-callback invocation,
  parent's and child's, logged the **same workspace cwd**. The factory
  contract's own words agree ("every session and task session of that harness
  shares the returned sandbox"). One factory per submission, one gate, one
  scope object — shared by every delegate that submission spawns.
- **The `tools()` callback is a per-assembly question, not a constant.** It
  ran five to six times in one two-turn submission: the parent's turn
  assemblies, the child's task-session creation, the child's prompt-time
  assembly, and at least one post-answer assembly. Each call re-answers for
  one session against the same shared environment. `options` is
  `{subagents: <the calling session's own roster>}` — the parent's assemblies
  carried `{"explore": …}`, the child's carried `{}`. It carries **the
  roster, never the acting agent's name**.
- **The execution-context frame identifies the task, not the delegate.** At
  the delegate's own tool execution (measured: the child called `glob`), our
  interceptor built `kind: "tool"` over a frame carrying the **child's**
  `conversationId` (`conv_<ulid>`, runtime-minted) and the **taskId** — and
  `agentName` stayed `"studio"` throughout, inherited from the admission
  root. The delegate's name rides nowhere in the execution context: not in
  the operation (`{type: "task", taskId}` carries no name), not in
  `FlueExecutionContext` (its `agentName` is the submission's agent), not in
  the session context the child spreads. The name exists only in the
  task_start/task events and records, in the task tool result's `details`
  (`agent: "explore"` — measured, present in the model-visible result), and
  in Flue's internal child-conversation row. No harness code subscribes to
  Flue events (grep-verified), so today nothing ours can see the name without
  a new seam.
- **The graph the interceptor builds is correct and connected.** Measured
  chain: `request` (the submission) → `tool` (the `task` call) →
  `task` → `kind: "subagent"` with a `parentOperationId` (linked, not root) →
  the child's `agent`/`model`/`tool` operations nested under it, each carrying
  the child's conversationId and the taskId. The plan's claim that the
  observability layer already projects `kind: "subagent"` with a parent link
  is confirmed live.
- **The ids, measured** (and this is where the plan's D2 needs correcting):
  `taskId = task_<ulid>` (Flue-minted); the task's session name =
  `task:<parentSessionName>:<taskId>` (the parent's session name is
  `"default"` — the harness's session, not the conversation id); the child's
  durable stream is a **fresh `conv_<ulid>` conversation under the parent's
  instance**. There is no per-delegate Flue instance id at all — the plan's
  D2 sentence assigns `<parent conversation id>-task-<n>` to the wrong path.
  The measurement splits what D2 merged: a **model-driven** delegate (the
  `task` tool, Stage 3) has no instance id and no product-minted name — the
  `task` tool executes inside Flue, so no product code sees the dispatch —
  and its index row keys on the runtime's `taskId`, with the parent
  conversation and originating submission as columns. An **application-driven**
  background task (Stage 4's `dispatchBackgroundAgent`) is the titling
  pattern measured: the product mints the instance id itself, and there D2's
  `<conversationId>-task-<n>` is right, because `dispatch(Agent, { id })`
  takes the id from the caller. One principle survives both paths — the id
  the runtime mints is never the model's to choose; which side mints depends
  on who dispatches.
- **The child's toolset is the parent's, unfiltered.** Measured from the
  child's own report: `read, write, edit, delete, move, glob, grep, git,
  shell, jobs, discover, ask_user_question, request_folder, plan,
  library_search, library_keep, studio_image, studio_video, ocr, web_search,
  fetch, task` — all twenty-one natives plus `discover` plus the framework's
  `task`. No allowlist exists today; D4's filter is genuinely missing, and
  until it lands a delegate sees and can call everything the conversation's
  gate holds.
- **The child's prompt carries its own (empty) roster paragraph** — the
  delegate's nested `useSubagent` declarations are its own catalog, measured
  (`has-none-roster=true` in the child's report). Roster isolation is
  per-render, as designed.
- **The child's transcript is not addressable through the product routes.**
  Measured 404s (`stream_not_found`, "Streams are created when their agent
  instance receives its first prompt") for all three candidate ids: the task
  session name, the child's `conv_<ulid>`, and the taskId. A delegate has no
  agent instance, so ADR 0045's reader — `GET /agents/:name/:id` — has no id
  that reaches it. **This contradicts the plan's D10**, which assumed the
  existing transcript reader suffices for a task's stream. The task
  transcript view (D10, Stage 5) needs a product route served in-process from
  Flue's own store, or a Flue change; it is a design question Stage 3/5 must
  answer, recorded here so it is not discovered late.
- **Observed, unexplained, not load-bearing:** the interceptor fired eight
  times per model turn (same turnId, identical context each time). Recorded
  so the count does not surprise the next reader of a trace; the context was
  stable across all eight, so nothing here builds on the multiplicity.

### The D4 mechanism, decided on the evidence

The plan's D4 offered (a) read the acting agent from the execution-context
frame, or (b) extend the patch to pass the delegate name into the factory
options. Measured: **(a) as written does not exist** — the frame carries
taskId and the child's conversationId but never the delegate's name, and
nothing ours can read supplies it (no event subscribers; the name in the
result details arrives too late and outside any frame). The options the
`tools()` callback receives carry the roster, not the actor. So the mechanism
is **(b), in its smallest form**: one patched hunk in the module the patch
already touches, adding the delegate's name to the child session's execution
context; our interceptor maps it into `FlueExecutionLinks` (a new
`subagentName` link beside `taskId`); the factory's tools callback and the
gate then read it from `currentExecutionContext()` — which is (a)'s seam,
made honest by (b)'s one line. The gate stays the only door: the filter is a
viewer rule inside the existing callback, and the delegate's calls resolve
their scope through the same frame (the captured scope's `agentId`
substituted by the acting definition's name at call time — designed, see D3;
the substitution is what makes ADR 0038's grant isolation real for
delegates, because measured today the delegate's calls carry the parent's
`agentId: "studio"`).

### Dispositions (decided now; executed in Stage 4/6)

- **`createRetryExecutionContext` — delete, with its test.** The wiring
  condition the plan named ("when the task dispatcher needs attempts") does
  not materialize: the TaskStore projects status from settlement events, not
  attempt contexts, and ADR 0033's conservative rule bars any automatic
  resend — the only path that would ever need attempt attribution is gated
  behind the idempotency-key reopen condition, which is recorded on the
  dispatcher and, if it ever fires, restores this function with a real
  consumer one revert away. The `attemptId` field stays in the execution
  vocabulary (ADR 0033); only the caller-less factory goes. #31's
  declared-not-wired marker comes off the source when the file goes.
- **`durableDirectories()` / `settingsPath()` — delete both.** `settingsPath()`
  documents a settings file nothing reads or writes; preferences live in the
  `app_setting` table and ADR 0014's description of the file is false as
  built. `durableDirectories()` enforces a backup set that does not exist —
  nothing in the harness backs up, so there is no consumer to wire without
  inventing a feature. Both return with the feature that needs them: a
  settings export/import consumes `settingsPath()`, a backup consumes
  `durableDirectories()`'s list — and each then gets its ADR-documented
  consumer. ADR 0014's two sentences describing them are corrected when the
  files go (Stage 6's docs pass).

**Both dispositions were executed 2026-09-30, in Stage 1, ahead of the stages
named** — the callers were verified absent once more before the deletions, and
nothing since has given either a consumer. The register rows (#31, #75, #76)
carry the closures; the return conditions above are unchanged.

### Instrument disposal

Removed: the `test-adapter.ts` probe scenarios, `agents/explore.ts`, the
factory wrapper and `useSubagent` declaration in `agents/studio.ts`, the
interceptor log in `observability/flue.ts`, the integration driver, and the
run logs. `tsc --noEmit` and `vite build` green after the removal. The
`useSubagent` declaration returns in Stage 3 as the real Explore vertical
slice, with its own tests; nothing here needed to stay.

---

## Part II — The design decisions

These are the answers this plan commits to. Each says what it builds on; none re-opens a settled ADR.

### D1. Agent types are definitions, and they are not extensions

An **AgentDefinition** is a typed record + an agent function, living in `src/agents/` (never `src/extend/` — the recorded rule: a subagent consumes MCP/skills/hooks, it is not one of them). It is data first, so a new agent type is a declaration, not a runtime fork:

```ts
// src/agents/definitions/explore.ts
export const exploreAgent: StudioAgentDefinition = {
  identity: {
    agentName: "explore",            // pinned literal, ADR 0038's pattern
    title: "Explorer",
    description: "Read-only research delegate…",  // what the parent's model reads
  },
  kind: "delegate",                  // "conversation" | "delegate" | "background"
  instructions: EXPLORE_PROMPT,      // static; composed per render like Studio's
  modelPolicy: { inherit: true },    // or { specifier, thinkingLevel }
  tools: {
    natives: ["read", "glob", "grep", "git"],   // allowlist, closed
    discover: false,                 // delegates do not adopt tools (see D6)
    mcp: { namespaces: [] },         // static allowlist of namespaces
  },
  skills: { ids: [], allowSelection: false },
  permissions: {
    // read-only by construction; effects is the vocabulary, not booleans
    maxEffects: ["read"],
    mode: "ask",                     // the delegate's own consent default
  },
  context: { workspace: "inherit", extraRoots: "inherit" },
  limits: { delegationDepth: 0, timeoutMs: 600_000, maxAttempts: 3 },
  lifecycle: { onStart?, onSettle? },   // code hooks, see D7
  delegates: [],                     // a delegate may declare delegates (depth ≤ 4)
};
```

The definition validates at module load (the `defineSubagent` pattern: fail at load, not first render) and one architecture test closes the vocabulary: every agent the harness mounts or dispatches resolves through the registry; nothing renders an unregistered agent function.

The three kinds map onto what exists:

- **conversation** — today's `studio`: mounted at `/agents/studio/<cnv_>`, owned by the product's conversation index, compaction, projects, skills, MCP selection.
- **delegate** — a subagent declared by a conversation agent and reached through Flue's `task` tool. No conversation id of its own in the product index; its durable stream lives under `agents/<name>/<taskId>`.
- **background** — the title/improve/describe pattern generalized: dispatch-only, one-shot or short-lived, addressed by a task instance id, surfaced in the UI as a task.

Today's four agents refactor onto this shape with **no behavior change** (Stage 2): `studio` keeps its bespoke render (it is the richest definition and mounts per-conversation state); `title` / `improve` / `describe` become background definitions whose prompts and no-tools/no-sandbox posture move into the record.

### D2. Subagent spawning, identity, and IDs

Spawning is model-driven through Flue's `task` tool (the parent decides when; the definition decides what exists to delegate to). Application code and harness tools can force a delegate through `harness.prompt(...)` when a workflow must not leave the choice to the model — that is Flue's own seam for it.

**IDs.** The delegate's Flue instance id is minted by the runtime, never by the model:

```
<parent conversation id>-task-<n>        e.g. cnv_9f2c…-task-1
```

This follows the measured titling pattern (`<conversation id>-t<N>`): the parent is legible in the stream path `agents/explore/cnv_9f2c…-task-1`, ids are unique per conversation, and a task's stream is addressable by offset exactly like any conversation (ADR 0045's mechanism, reused — the recorded decision). Inside Studio's vocabulary the task also gets a product row (D5) keyed by the same id, carrying `agentName`, parent conversation, originating submission, status, and result pointer. The execution-context graph links it automatically: the interceptor already assigns `kind: "subagent"` and a `parentOperationId` under the parent turn's frame.

Delegation depth is capped at four (Flue's own limit) and each definition's `delegates: []` makes the roster explicit — `explore` cannot spawn a writer because it has no writer to name.

### D3. What a delegate inherits, and what it never gets

Answering ADR 0012's open question: **the policy is declared independently per agent type; the containment is inherited from the parent conversation; the approvals are never inherited.** Concretely:

- **Sandbox/containment**: the delegate runs inside the parent conversation's sandbox envelope — the same read/write roots, the same scratch/attachments/artifacts, the same operator switches. It cannot reach where the conversation cannot. (Files remain the hand-off surface, as the shared-sandbox design intends.)
- **Permissions**: the delegate's calls carry `agentId: "explore"` in the `ExecutionScope` (the kernel's `assertScope` requires it; ADR 0038 made the store filter on it). A standing grant given to `studio` does not match a call from `explore` — **this is already enforced and is the property #49 asks for**. The delegate's own `ask`s go through the same approval broker; the UI renders them with the agent's name (the broker's `PermissionRequest` carries the scope).
- **Grants by delegates**: stored under the delegate's agent id, like any agent. In `ask` mode that means the person is prompted once per delegate capability, which is the honest default; a per-definition `grantPolicy: "inherit-ask"` refinement (child's ask auto-answered when the parent was granted the same capability+resource in this conversation) is **deferred** — it is exactly the authority-derivation ADR 0030 deferred, and it needs its own decision once real usage shows the fatigue is real.
- **Trusted application context (ADR 0030 §5)**: the runtime, not any caller, derives the child scope from the parent conversation's settled row + the definition. The `task` call carries a name and a prompt — nothing else crosses. This is the "extend the trusted context" requirement, satisfied structurally: there is no path by which a model-supplied id becomes authority.
- **Model**: per-definition `modelPolicy`; inherit by default, override for cheap/fast delegates (the classification pattern). `useModel` inside a delegate render is Flue-forbidden; the override rides the definition.
- **Skills**: intersection of the definition's `skills.ids` with the conversation's selection chain. A delegate mounts skills through its own render, so a skill enabled for the conversation but not listed on the definition is invisible to it. (The Phase 12 "agent assignment" question is this list, per definition.)
- **MCP**: see D6.
- **Hooks**: see D7.

### D4. Tool exposure becomes agent-aware at the gate

Today the tools array is built once per submission from the conversation's gate. With delegates, "what the model sees" must answer **per acting agent**, and ADR 0024's rule extends cleanly: *the list comes from the rule that decides the call* — the rule now includes the definition's tool allowlist.

- The gate gains a **tool policy filter**: `list()` (and therefore the factory's `tools()` callback) resolves the acting agent's definition and hides tools outside its allowlist. Hiding is the same mechanism that hides exec/network-withheld capabilities today — one list, one rule, no second taxonomy.
- **Authorization is already per-agent correct** (scope.agentId); the filter only aligns visibility with it. A tool the policy hides cannot be called; a tool shown still needs the kernel's verdict like anything else.
- **Adoption (`discover`) is withheld from delegates in v1.** Discovery mutates the conversation's adopted set (`#discoveredToolKeys`, keyed by conversation) — a delegate adopting a tool would leak into the parent's array, and an append-only set with two writers is the bug ADR 0029 exists to prevent. A delegate's MCP surface is the static namespace allowlist on its definition, resolved at spawn from the catalog, intersected with the conversation's enablement chain. Revisit when a real delegate needs discovery.
- **The measurement this depends on** (Stage 0 spike): how the patched 2.0.3 runtime calls the parent sandbox factory's `tools()` callback for a delegate session — with what options, whether the acting agent identity is visible (the type exports hint at `SessionToolFactoryOptions`), and whether the render frame can be read via `currentExecutionContext()`. Two fallback designs, in order: (a) read the acting agent from the execution-context frame the interceptor already establishes; (b) extend the Flue patch to pass the delegate name into the factory options (the patch already touches the coordinator). Either keeps one gate per conversation and one filter.

### D5. Background agent tasks (agent-as-task) and the task surface

A background agent task is **another durable stream with an offset** — ADR 0045's mechanism, per the recorded decision — plus a product index so the UI can find it:

- **`TaskStore`** (new table `agent_task` in studio.db, migration): `id` (the instance id above), `agent_name`, `parent_conversation_id`, `origin_submission_id`, `title`, `status` (`queued | running | waiting_for_user | completed | failed | cancelled | unknown` — ADR 0033's status set), `created_at`, `settled_at`, `result_summary`. The store is an **index, not a second transcript** — status is projected from stream events through the existing observer seam, exactly as `ContextUsageTracker` projects usage.
- **Dispatch**: `dispatch(definition.agent, { id: taskId, message })` — fire-and-forget at admission, exactly like `deliverJobPing` and the titler. The task's result reaches the parent conversation the way every other piece of news does: a `studio.tasks.finished` signal through the `JobPings` hub (a third source beside shell and media jobs), and/or the model reads the task's stream or its artifacts. **No automatic resend anywhere** — ADR 0033's conservative rule holds; the idempotency-key reopen condition is recorded on the dispatcher should a future scheduler retry.
- **Cancellation**: `POST /api/tasks/:id/cancel` maps to Flue's `abortInstance` (the same call the stop control uses). A dead window cancels nothing; only the person or a timeout does.
- **Lifecycle discipline**: tasks register their children the way MCP servers must be outlived by their parent — the #89 Windows Job Object gap is fixed in Stage 1 (it is a prerequisite, not part of the feature: any child outliving the harness is the defect; agent tasks just make it louder).
- **UI**: the rail's work panel gains a Tasks section (status, agent name, Stop, link to the task's stream rendered read-only through the existing transcript reader). The transcript renders a task card on the `studio.tasks.finished` signal and on `task` tool calls, projected from the stream like every other chunk — no second rendering path.
- **Process jobs vs agent tasks**: `BackgroundJobs`/`MediaJobs` stay exactly as they are — they are *process* background work. Agent tasks are *model* background work. The rail shows both; the stores stay separate; the shared vocabulary is the status enum and the ping hub. (This is consolidation by interface, not by merging stores.)

### D6. MCP for delegates (summary of D4/D3)

One gate, one registry, one catalog, unchanged. Per delegate: namespaces resolved from the definition at spawn, intersected with the conversation's enablement chain (`#enablementContext`), registered into the same gate under the same keys so grants and definition hashes keep meaning one thing. Dispatch-time availability (ADR 0029 §3) already answers per call. No delegate touches `discover`.

### D7. Hooks and lifecycle events

Two layers exist; neither grows a third.

- **Flue's render hooks** (`useAgentStart`, `useDelivery`, turn boundary) remain the mechanism for anything that composes instructions or deliveries. Delegates get their own render, so a delegate's `onStart`-shaped behavior is authored in its definition's agent function — no new hook API needed for v1.
- **Studio's lifecycle seams** are code, not configuration: the turn boundary (`registerFlueTurnBoundary → prepareModelTurn`), the JobPings hub (endings), and the interceptor (every operation, already projecting subagent kinds). A definition's `lifecycle.onSettle` is a function the dispatcher invokes off the settlement event — the same subscription the titler uses.
- **The `hook` extension kind stays reserved and unbuilt.** User-authored hooks are a product surface with its own permission question (hook code runs with the harness's authority); declaring the kind in `ExtensionKind` was the honest placeholder, and building it is out of scope here. Record that this plan deliberately does not fill it.

### D8. Context-window management for delegates

Delegates are the *answer* to context pressure, not a new cost center: each runs in its own window, and only the final message returns to the parent. Policy:

- A delegate's compaction uses the same `compactionConfigFor` policy as the parent (same reserve rule), unless its definition overrides the model (and therefore the window).
- The parent's briefing discipline is a prompt rule with teeth: the system prompt's delegation section (replacing the "declares no subagents" paragraph) requires self-contained task prompts, and the `task` result the parent receives is the child's final message only — nothing else enters the parent's conversation (Flue's own design, verified in the docs and the patch).
- Large tool output from a delegate's tools follows the existing rules (truncate today; the RTK result-projection seam when meta-task §5 is decided — delegates do not change that decision, they raise its stakes).

### D9. Cloud vs local, and the Gateway

The local Harness is the only runtime; this plan keeps it the only runtime while making the architecture portable rather than split:

- **What is already portable by construction**: definitions (data), the contracts (capabilities/effects/status enums), the selection spine (a table + narrowest-first resolution), the grant model (a table + scope matching), the task index (rows + stream offsets). None of it assumes more than SQLite and HTTP.
- **What is Node-bound and stays so**: `LocalSandbox`, process spawn, the OS keyring, vendored binaries, stdio MCP. A future cloud target would replace the sandbox factory and the launcher behind the ports that already exist (`SandboxFactory` is Flue's seam for exactly this; the Rust `ServiceId` enum is the Host's seam; the `"gateway"` provider source is the model path's seam).
- **Nothing in this plan schedules cloud work.** It records the three seams and honors C-19: the capability seam delegates need is the one the relay will need, so D4's agent-aware tool policy is written once, target-agnostic.

### D10. The frontend

No new transport. The webview already reads any agent stream by path (`platform/harness/conversation.ts` addresses `/agents/<name>/<id>`); a task's transcript is that reader pointed at the task's stream. What gets built is product surface only: the Tasks section of the work panel, the task card in the transcript, agent-attributed approval cards (the broker payload already carries `scope.agentId` — the UI labels with the definition's `title`), and Settings' agent roster (read-only in v1: name, description, tools, skills — the same honest-list rule as MCP).

**Decided at S4.1 (2026-10-03; recorded as ADR 0058's amendment):** the plan's
one-sentence assumption above is true for background tasks and false for
delegates, and the decision says so per kind. Background tasks have agent
instances (the product mints the instance id at dispatch), so ADR 0045's
reader reaches their streams once the background agents' routers are mounted —
read-only guarded, because the same router admits prompts and the background
three must never be promptable. Delegate sessions have no instance id (the
Stage 0 404s), so a delegate's transcript view waits for the UI feature that
needs it and then picks between an in-process route from Flue's stream store
and a Flue change, tie-breaker recorded: no patch hunk unless the measurement
proves no seam exists.

---

## Part III — Keep / Refactor / Remove / Consolidate / Add

### 1. Keep as-is (verified working, load-bearing)

- The loop/durability/compaction/delegation primitive (Flue) and provider layer (Pi), including both patches.
- The admission model, scope tables, bootstrap channel, Host supervision (ADR 0028/0040/0044).
- The permission kernel, effects table, scope ladder, grant store, trust, modes (Ask/Auto), CallGate + bounds + snapshots-as-capture, destination rules, untrusted-content labels.
- The extend spine (selection/inventory/reconcile), MCP registry/supervisor/catalog with append-only membership and dispatch-time availability, the skills registry, the two bundled skills.
- The conversation index/titling/context-usage/compaction stack; projects, scopes (`request_folder`), plans, questions, approvals brokers.
- `BackgroundJobs`, `MediaJobs`, `JobPings`, the three delivery points for job news.
- The identity/correlation graph (`execution/context.ts`), Flue instrumentation, redaction, the error taxonomy and the architecture test that enforces it.
- The dispatch-only agent pattern as proven by title/improve/describe.
- The webview seam (`useConversation` state machine, offset-based reattach, `service_fetch/stream`).

### 2. Refactor (exists, must change shape for this architecture)

| Item | Change | Why |
|---|---|---|
| The four agent modules | onto `StudioAgentDefinition` (D1); `title`/`improve`/`describe` become background definitions; `studio` keeps its render | one shape for every agent; the registry needs it |
| `createAgentSandbox`'s tools callback | gains the agent-aware filter (D4) | delegate visibility must equal authority |
| `#discoveredToolKeys` + `refreshTools` | named as an explicit per-conversation `ToolMembership` class (same behavior) | it is the append-only membership ADR 0029 describes; naming it is what makes the delegate rules expressible |
| `AgentHost` locator | gains definition-registry access (still one call site, still asserted) | the render and factory must resolve definitions |
| `studio.ts` system prompt | the "declares no subagents" paragraph becomes the delegation section when the first delegate lands | the paragraph is the `task` tool's other half; it must describe the real roster |
| `ConversationTitler` / `ImageDescriber` / `TextImprover` dispatch wrappers | thin over a shared `dispatchBackgroundAgent()` helper | three copies of one pattern (function-value dispatch, id scheme, failure logging) |
| Grant store usage | add `list/revoke/revokeConversation` routes + Settings surface (closes #73) | per-agent grants are unacceptable without a revocation surface |
| Snapshot story | wire `SnapshotStore.restore()` behind an API (closes #86; #50) | Auto-mode delegates make undo load-bearing, and it currently cannot be invoked |
| Host child lifecycle | fix #88 (resolve the harness binary without bare `PATH` lookup) and #89 (Windows Job Object) | background agent work must not orphan children |
| Stale docs (Part I §6 list) | reconcile in Stage 0 | the plan's own safety depends on the record matching the tree |

### 3. Remove

Nothing structural. Three declared-not-wired pieces get explicit dispositions rather than deletion: `createRetryExecutionContext` (either wire it when the task dispatcher needs attempts or delete it with its test — decide in Stage 4, no third state); `durableDirectories()`/`settingsPath()` (same rule); the `"gateway"` provider source stays reserved (it is a named seam, not dead code). The system-prompt "no subagents" paragraph is replaced, not kept beside its replacement.

### 4. Consolidate

- **One tool door**: unchanged — the gate. D4 adds a filter to the existing door; it does not add a door.
- **One status vocabulary**: the ADR 0033 status set becomes the shared enum for process jobs, media jobs, and agent tasks (today `JobState` is its own 4-value union; map, don't merge stores).
- **One background-work rail**: process jobs + media jobs + agent tasks render in one panel with per-kind rows (consolidation at the UI, not the storage).
- **One definition of "what an agent can see"**: the ADR 0024 rule, extended once (D4) to cover agent policy — so the always-loaded/withheld/delegate-allowlist questions all answer from one place.
- **Meta-task §5's undecided gate design** (RTK + execution guard): schedule the decision (Stage 6), because delegates multiply both the pressure for result projection and the value of conversation-scoped state — but do not let it block Stages 1–5.

### 5. Missing (to be introduced)

1. `StudioAgentDefinition` contract, registry, validation (D1).
2. Agent-aware tool policy at the gate (D4) + the Stage 0 measurement that picks its mechanism.
3. Per-delegate identity in the tool frame (D4's mechanism) and `task`-kind projection already exist in observability — expose `taskId` on the product side.
4. `TaskStore` + migration + `/api/tasks` routes + task rail/card UI (D5).
5. `dispatchBackgroundAgent()` shared helper (D5).
6. The first delegates: **Explore** (read-only) and later **General** / **Plan** (D11).
7. Grants visibility/revocation surface (#73), snapshot restore (#86), child-lifecycle fixes (#88/#89) — prerequisites with their own stages.
8. Delegation briefing in the system prompt + the `task` family completing the ten-family tool table (`roadmap.md` Phase 10: "closed at nine of ten, `task` deferred to 13").

### 6. The final target architecture (one screen)

```
                    ┌────────────────────────────────────────────┐
   webview ──SSE──▶ │ Flue runtime (patched): loop, durability,  │
   (offset)         │ compaction, task tool, delegation depth 4  │
                    └──────────────┬─────────────────────────────┘
                                   │ render per agent (definitions)
        ┌──────────────────────────┼───────────────────────────────┐
        │                          │                               │
 conversation agents        delegate agents                background agents
 (studio; index rows,       (explore, general, plan;       (title, describe, improve;
  projects, compaction,      task instance ids,             dispatch-only; own streams)
  skills, MCP selection)     parent-scoped sandbox)
        │                          │                               │
        └──────────┬───────────────┴───────────────┬───────────────┘
                   │  every call                    │ every ending
                   ▼                                ▼
        ┌──────────────────────────────────────────────┐  JobPings hub → signals
        │ CallGate (one door)                          │  (jobs.finished / tasks.finished)
        │  1. agent-aware tool policy (visibility)     │
        │  2. PermissionKernel (scope.agentId, grants, │
        │     policy, trust, mode, definition-hash)    │
        │  3. sandbox supports (switches)              │
        │  4. snapshot if effects earn undo            │
        │  5. bounds (deadline, FIFO, idempotency)     │
        └──────┬───────────────┬───────────────┬───────┘
               ▼               ▼               ▼
          native tools     MCP (registry/     skills (Flue surface,
          (21, per family)  supervisor/        selection chain ∩ definition)
                           catalog, append-only
                           membership)
               │
               ▼
   Flue stream (flue.db)  +  studio.db (grants, selection, tasks index,
   transcripts, journal      usage, scopes, plans, questions, approvals)
```

Definitions are data; the runtime is one runtime; the door is one door. Adding an agent type is adding a definition and, if it is a delegate, one roster line — no new runtime code path.

### D11. The initial roster

| Agent | Kind | Tools | MCP | Skills | Permissions | Purpose |
|---|---|---|---|---|---|---|
| `studio` | conversation | all natives + adopted MCP + discover | per selection chain | per selection chain | per conversation mode; full effects | the continuing product agent (today's) |
| `explore` | delegate | `read`, `glob`, `grep`, `git`, `web_search`, `fetch` | none (v1) | none (v1) | read-only on the machine by allowlist **and** `maxEffects: ["read", "network"]`; mode `ask` | context-heavy research without flooding the parent |
| `general` | delegate | `read`, `write`, `edit`, `glob`, `grep`, `git`, `shell`, `web_search`, `fetch` | `*` — the conversation's adopted namespaces | none (v1) | everything reachable by ceiling; mode `ask` — its default asks ask under its own id | the `GeneralSubagent` equivalent, Studio-shaped |
| `plan` | delegate | `read`, `glob`, `grep`, `plan` | none | none | read-only by allowlist and ceiling (`["read"]`); mode `ask` | produces/updates the plan for the person to tick |
| `title` / `describe` / `improve` | background | none | none | none | no sandbox, no tools | existing, unchanged behavior |

The Explore agent is the Stage 3 vertical slice: read-only is the easiest permission story to prove (allowlist ∩ `maxEffects` ∩ kernel = three layers saying the same thing), and it is the delegate whose absence the parent's context pays for most.

**Amended 2026-10-07, at Stage 5** — three corrections Stage 5's implementation
forced, each a case where the one-line table above could not carry the full
decision:

1. **`explore`'s ceiling gained `network`.** The Stage 3 table named
   `web_search`/`fetch` under a `["read"]` ceiling — the two readers were
   visible tools that could never run, refused at the ceiling in every
   conversation regardless of grants. Reading the web is reading; the
   ceiling's job is the boundary nothing may cross (writing, running), and
   authorization for the network calls still stops at the kernel under the
   delegate's own id.
2. **`general`'s MCP allowlist is the wildcard `*`.** MCP namespaces are
   `mcp:<server id>` with the id user-minted; a static definition cannot
   name a person's servers and one that did would behave differently per
   machine. `*` means "the namespaces this conversation has adopted, and
   nothing more" — the gate still holds the enablement chain and the
   adopted set, so the star widens nothing the person did not switch on.
3. **`general`'s tools column is the concrete list.** "Natives minus
   destructive" answers one question; the allowlist answers two. Beyond
   the destructive pair (`delete`, `move`), the delegate also withholds
   the conversation-keyed mutators (`discover` by D4's name-rule,
   `request_folder`, `jobs` — all three write into parent-owned sets the
   child cannot see or clean) and the interactive family
   (`ask_user_question`, `plan`, `library_*`, `studio_*`, `ocr`) — the ask
   tool parks a run on a question the approval UX does not attribute, the
   plan tool is the planner's whole job, and the rest write
   person-curated or billed state. Naming one later is an allowlist line
   away, with its own reasoning at that moment.

And one consumption the table implied but nothing had wired: a delegate's
`mode` is its **own consent default** — since Stage 5 the kernel resolves a
delegate's default asks under the definition's mode, so `general` asks
before it changes or runs anything even when the parent conversation runs
Auto. The person handed off work, not attention; the asks render under the
delegate's agent id, and an answered one grants the delegate, not the
conversation.

---

## Part IV — Staged implementation

Rules that hold throughout (from the working rules): one task active; `pnpm check` green at every checkpoint; measure before deciding; every subsystem registers its error domain; durable product state gets a migration; nothing rebuilds Flue's loop, transcript, or journal.

### Stage 0 — Ground truth and the record (no behavior change)

1. **The delegation measurement** (the project's Phase-0 culture, applied): against a live 2.0.3 harness, declare one throwaway delegate on a test agent and measure — does the parent's sandbox factory run per delegate session; what does the `tools()` callback receive; is the acting agent visible in `options` or in the execution-context frame; does `useModel`-per-delegate work via the definition; what do `agent_start`/`tool` events carry for child sessions (`taskId`? `agentName`?). Write the findings into this plan before Stage 2 code exists.
2. **ADR 0058** — "Agent definitions and delegation": D1–D11 above, including the answers to ADR 0012's open question and ADR 0030 §5's trusted-context requirement. Amend ADR 0030 §2 (the stale `conversation:` prefix sentence) in passing.
3. **Docs reconciliation**: fix the stale-docs list (Part I §6) — domain-ownership, api-inventory, rules, directory-map, mental-model's version note, every dead `tasks/` pointer. Small edits, no rewrites.
4. **Decision**: disposition of `createRetryExecutionContext` and the durableDirectories/settingsPath trio (recorded, not necessarily wired).

**Tests**: none new. The suite stays green.

### Stage 1 — Prerequisites (each independently shippable)

1. **#73 — grants visibility and revocation**: `GET /api/permissions/grants` (+ filters by agent/project/conversation), `DELETE /api/permissions/grants/:id` (revoked-marked, audit-preserving), Settings surface. Tests: route auth (admission scope), revocation takes effect on the next call, revoked rows survive as records.
2. **#86/#50 — snapshot restore**: expose list/restore behind an authenticated route + UI affordance on the transcript. Tests: restore round-trips a write; Auto's undo guarantee becomes invocable.
3. **#88/#89 — child lifecycle**: resolve the Harness binary without bare `PATH` spawn; Windows Job Object with `KILL_ON_JOB_CLOSE` for MCP children (and anything else long-lived). Tests: integration, platform-gated as existing sandbox tests are.
4. **#66 — MCP timeout/cancellation tests** (the missing two tests the register names).

### Stage 2 — Definitions and the registry (still no model-visible change)

**Delivered 2026-10-03.** The four items below, with the shape one deviation
and one addition worth recording:

- The vocabulary landed as planned, with `maxEffects` validated non-empty
  (an empty ceiling is "nobody stated it", not "nothing") and the per-kind
  contract enforced in code beside the schema: a **delegate must** carry
  tools/skills/permissions (the Stage 0 measurement made the absence the
  visibility/authority gap), a **conversation or background agent must not**
  (studio composes live state; the background three hold nothing). The
  plan's `context`/`limits`/`lifecycle`/`delegates` fields stayed out: every
  consumer is Stage 3+, and a field nothing reads is the shape #31/#75/#76
  existed to close.
- `dispatchBackgroundAgent()` dispatches **by registry name, not function
  value** — the one deliberate departure from "three copies of one pattern":
  the registry mediates, so a dispatch cannot name an agent the harness does
  not know it has. The Windows double-bundle lesson is why `index.ts` (the
  one cycle-free pairing site) imports the agent modules and the definition
  files import nothing from them.
- The ADR 0038 graduation used `improve` (a real registered background id)
  as the second agent.
- Migration 30 + `TaskStore` (index, no routes, no writer yet — the
  migration-14 `model_id` shape), plus `AgentTaskStatus` as the shared
  settlement union and the `"agents"` error domain.

Gate held: full harness `CI=true pnpm check` green (typecheck, lint, build,
2,000+ tests), STUDIO `pnpm check` green (142 files / 1,357 tests), the
built bundle carries each module exactly once (`built-agent-modules.test.ts`
against a fresh build), and the mutation checks recorded in register #90.
The Stage 0 instrument lesson repeated itself once: a test written to pass
in the same millisecond it asserts (`settled_at` idempotency) passed with a
broken implementation — the sentinel-timestamp fix is in the test now.

1. `src/agents/definitions/` + `StudioAgentDefinition` + validation + the registry; `contracts/agents.ts` gains the definition vocabulary (agent ids stay the pinned literals — `EXPLORE_AGENT_ID` beside `STUDIO_AGENT_ID`).
2. Refactor the four existing agents onto definitions; extract `dispatchBackgroundAgent()`. **Zero behavior change is the gate for this stage** — every existing suite (titling, describe, improve, conversation flows) passes untouched.
3. Extend the ADR 0038 tests: a second agent id exists; grant isolation asserted across agents (the "second agent cannot inherit" test graduates from hypothetical to real).
4. TaskStore migration (table + status enum), no routes yet.

**Tests**: definition validation (unknown tool name, unknown skill, empty effects on a would-be delegate, depth), registry uniqueness (`agentName` collision refuses at load), the refactored agents' existing suites. — **All delivered**: `agents-registry.test.ts` (16), `task-store.test.ts` (9), plus the architecture pair (every capitalized `'use agent'` export registered and vice versa; no agent-module import outside `src/agents` save the composition root).

### Stage 3 — The first delegate (Explore), vertical slice

**Delivered 2026-10-03.** The six items below as planned, with the
mechanisms the Stage 0 measurement chose and one lesson the live run
forced:

- The mount is a loop over `agentRegistry.byKind("delegate")` in studio's
  render, mapped through the exported `delegateMount()` — so a Stage 5
  delegate is a definition file plus a registry entry, and `studio.ts`
  names it without changing. `AgentModelPolicy`'s two arms map to the
  declaration's optional fields by OMISSION, not by value: `{inherit:
  true}` mounts with no `model` field at all (Flue's word for "the
  parent's, verbatim").
- The Flue patch hunk (the stage's one budgeted line, ledger entry 9)
  carries the delegate's name onto the child session's execution context
  as `subagentName`; the interceptor maps it to
  `FlueExecutionLinks.subagentName` → `ExecutionContext.flueSubagentName`,
  and the gate reads it from `currentExecutionContext()` — (a)'s seam,
  made honest by (b)'s one line, exactly as the D4 mechanism record said.
- The gate's policy lives in `permissions/agent-policy.ts`, the one module
  all three readers import (the `tools()` filter, the scope substitution,
  the effects ceiling). The ceiling refusal happens in the `execute`
  closure BEFORE the kernel is consulted, so a violation is a refusal the
  model can read.
- The delegation section replaced the "declares no subagents" paragraph;
  the roster section remains Flue's own composed `## Available Agents`
  (byte-stability for an unchanged roster is Flue's, not ours — the
  section is composed from the mount each render).
- The scripted test model's delegation scenarios (`[delegate]`, `[task]`,
  `[report]`, `[try-write]`) each carry their own loop guard: the task
  prompt is the child's WHOLE conversation, so every re-entry carries the
  same user text and an unguarded tool branch is an infinite loop — the
  first run of the suite measured exactly that before the guards landed.

1. Mount `useSubagent(explorerSubagent)` in `Studio`'s render — unconditionally, cached-prefix-safe, roster section now non-empty.
2. Agent-aware tool policy at the gate (D4) using the Stage 0 mechanism; `discover` withheld from delegates; per-delegate MCP/skills resolution (both empty for Explore).
3. The delegate's scope carries `agentId: "explore"` (the factory already receives the acting identity via the Stage 0 mechanism); approval broker requests render with the agent's title.
4. Observability: confirm `kind: "subagent"` flows with `parentOperationId` to the parent turn; `taskId` linked.
5. System prompt: replace the "declares no subagents" paragraph with the delegation section (self-contained briefings; what `explore` is for; results return as the task's final message).
6. UI: task card rendering for `task` calls in the transcript (projection only — no new transport).

**Tests** (the stage's real deliverable):
- Integration: a delegated task runs, its final message returns, the parent transcript contains the tool result and nothing of the child's intermediate reasoning.
- Grant isolation: a `studio` standing grant does not authorize `explore` (the #49 property, asserted end-to-end); an `explore` grant does not reach `studio`.
- Visibility=authority: the delegate's tool array is exactly its allowlist (withheld natives asserted absent); a hidden tool call is refused as unknown.
- Read-only: every effect-bearing call from `explore` is refused at the policy layer regardless of grants (allowlist ∩ `maxEffects` ∩ kernel agree).
- Recovery: kill the harness mid-task; restart resumes the child to completion (Flue's delegated-task recovery, asserted against our composition).
- Depth: a delegate with `delegates: []` cannot delegate; a `task` naming an undeclared agent settles with the Flue error.

### Stage 4 — Background agent tasks

**Delivered 2026-10-03** (register row 97), with two deviations worth having
on the record:

- **D10 was decided, per kind.** The plan's one-sentence assumption above was
  true for background tasks and false for delegates; ADR 0058's amendment
  records the split and the tie-breaker for the delegate half. The S4.1
  cancel port needed no Flue change at all: `init(agent, {id}).abort()` is
  the stop control's own seam, resolved at use time — the Track E budget
  spent nothing.
- **The task rows are conversation-scoped only when the dispatch says so.**
  Every dispatch records its row (S4.3's gate), but the three background
  agents name no parent conversation — a title is not news to the
  conversation it names, and announcing it would wake every first exchange
  with news it already has. The settlement signal (`studio.tasks.finished`)
  and the environment block's running-task lines therefore key on the row's
  parent column: the mechanism is built, proven by integration test, and
  waiting for the first caller whose background work is genuinely
  conversation-owned. The replay rule (S4.5) is proven at the same seam: a
  replayed settlement finds the row terminal, re-dispatches nothing, and
  announces nothing.
- **Measured, not worked around:** a harness SIGKILLed under a running task
  recovers the row as `running` — still true — and the replacement run
  settles from the stream; the runtime's durability contract caps recovery
  attempts, so that settlement can be `failed` with its own recovery
  sentence. The row is the projection; the test asserts what the stream
  said.

1. ~~`dispatchBackgroundAgent()` + `TaskStore` routes~~ — delivered as above; cancellation via `init().abort()` (Flue's instance abort), no patch.
2. `studio.tasks.finished` through the JobPings hub (third source); environment block names running tasks beside running jobs — delivered, keyed on the row's parent.
3. Task rail section + task card in the transcript — delivered (the rail's background-work entry renders both kinds; the `task` tool call renders a delegation chip). The task transcript view itself is the D10-decided reader, landing with the UI that needs it.
4. Decide-and-record: no auto-resend (ADR 0033 rule); the idempotency-key reopen condition is recorded on the dispatcher — delivered (dispatch.ts docblock + the replay test).
5. Disposition of `createRetryExecutionContext` executed here if the task status projector needs attempts — not needed: the projector settles from settlements, not attempts (the Stage 0 disposition already deleted the function; the reopen condition on the dispatcher is what would restore it).

**Tests**: dispatch → run → settle → signal → card (integration, the finished-job-pings pattern); cancel mid-run (aborted settlement, rail updates); restart with a running task (lease recovery, status returns `running` then settles); purge semantics (deleting a parent conversation deletes its task rows and selection-scope rows; the task's stream goes with the Flue purge path).

### Stage 5 — The broader roster and assignment

**Delivered 2026-10-07** — register row 98, with the D11 amendments recorded
above (the explore ceiling, the MCP wildcard, the concrete allowlist, and the
mode consumption).

1. `general` and `plan` delegates per D11; the roster section of the system prompt covers all three — delivered. The registry holds seven agents, three of them delegates; the parent's mount loop named them from the day it was written. The delegation section teaches matching the delegate to the work beside Flue's composed roster.
2. Skills assignment: per-definition skill lists resolved through the selection chain; the Settings roster shows them — delivered as the mechanism (`delegateSkills`, one chain walk narrowed to the definition's named ids on the registry's record vocabulary), with all three delegates shipping empty lists in v1: no bundled skill is a natural delegate assignment yet, and the honest empty list is the answer the honest-list rule wants. The semantics are proven against the real chain and a real bundled skill.
3. MCP allowlists per delegate (parent-adopted ∩ definition) for `general` — delivered via the `*` wildcard (D11 amendment 2); the intersection is enforced by the gate against what the conversation actually holds.
4. Approval UX polish: agent-attributed cards; the approval list groups by agent — delivered. A delegate's ask renders `Permission — <Title> agent`; `studio`'s asks stay unattributed; the waiting footnote groups by agent without reordering the queue.

One mechanism the plan under-specified and Stage 5 wired: **the delegate's
own consent default**. `permissions.mode` existed on every delegate
definition since Stage 2 and nothing consumed it; the kernel resolved every
default ask under the conversation's posture. Since Stage 5 the runtime's
posture composition reads the acting agent — a delegate's default asks
resolve under its definition's mode, which is what makes `general`'s story
true in an Auto conversation, and the live test proves the whole chain:
Auto conversation → delegated write → ask attributed to `general` →
answered → grant keyed `agentId: "general"`.

**Tests** (all green in the delivered gate): per-agent skill mounting
(`delegate-skills.test.ts`, real runtime, real bundled skill, real selection
rows); `general`'s write path asking under its own agent id
(`delegation.test.ts`, live); the plan delegate writing rows the person can
tick, recorded `agent:plan` (store tests with the second writer; live in the
two-delegate run); parallel tasks — one batch, two delegates — with both
answers returned, the parent transcript clean of either child's work, and
the grant table untouched; the roster route's admission shapes and the
honest-list rule (`agents-routes.test.ts`); the STUDIO parsers, the
attribution tests, and the settings taxonomy.

### Stage 6 — Consolidation and the deferred decisions

1. Meta-task §5 decided once (RTK result-projection seam; execution guard as the gate's fourth stage) — delegates are now real consumers, so the decision is made with evidence instead of foresight.
2. `ToolMembership` naming refactor (if Stage 3 did not already force it), `#turnSnapshots`/access-log lifetimes re-audited with tasks in the picture (task streams live as long as conversations do).
3. Docs: this plan's "final architecture" section folded into `mental-model.md`/`directory-map.md`; roadmap Phase 13 closed with the ledger.
4. The C-19 note updated: the capability seam the relay needs now exists (D4/D9).

---

## Part V — What this plan deliberately does not do

- **No user-authored hooks.** The `hook` extension kind stays reserved; D7 is the boundary.
- **No cloud runtime work.** The seams are recorded (D9); the roadmap's Phase 15/18 own the rest. ADR 0030's multi-user deferrals stay deferred — this plan extends the trusted context *within* one machine, which is the precondition it named, not the multi-user feature itself.
- **No per-delegate grant inheritance** ("let the child use what the parent was granted"). It fails open in the wrong direction and contradicts ADR 0038's architecture; the honest default is the child asks. Revisit with usage data, as its own decision.
- **No new transcript store.** Flue's stream is canonical; the task index is a projection.
- **No second tool path.** Everything executable still enters through the gate; delegation adds a *viewer* rule and a *roster*, not a door.
- **No speculative agent config surface.** Definitions are code, reviewed like the skills folders they sit beside; a settings UI that edits them is Phase 18 product work at the earliest.
