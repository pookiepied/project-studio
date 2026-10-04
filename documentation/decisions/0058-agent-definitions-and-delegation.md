# 0058 — Agent Definitions And Delegation

**Status:** Accepted
**Date:** 2026-09-29
**Answers:** [ADR 0012](0012-permission-and-containment.md)'s open question —
"whether a subagent's policy is derived from its parent's or declared
independently", left by its Consequences to Phase 13/14 — and [ADR
0030](0030-local-execution-identity-and-deferred-multi-user.md) §5's deferred
subagent authority derivation, within the local boundary that ADR names. The
multi-user half of §5 stays deferred.
**Builds on:** [ADR 0024](0024-capabilities-are-on-and-the-list-is-honest.md)
(the list the model sees comes from the rule that decides the call), [ADR
0029](0029-mcp-session-tool-membership.md) (append-only MCP tool membership),
[ADR 0033](0033-execution-identity-and-operation-correlation.md) (the identity
vocabulary; the conservative resend rule and its reopen condition), [ADR
0038](0038-a-grant-belongs-to-an-agent.md) (a grant belongs to an agent), [ADR
0039](0039-a-child-inherits-nothing-it-was-not-given.md) (a child inherits
nothing it was not given), [ADR
0045](0045-a-run-outlives-the-window-that-started-it.md) (a run is addressed),
[ADR 0048](0048-a-capability-is-announced-before-it-is-loaded.md) (a
capability is announced before it is loaded), [ADR
0057](0057-the-gate-is-the-boundary.md) (the gate is the boundary).
**Evidence:** the Stage 0 measurement (2026-09-29, recorded as "Stage 0
findings" in `work/agent-platform-plan.md`) — a live built 2.0.3 harness
driven disarmed and armed, the instrument thrown away after the reading; the
installed `@flue/runtime` 2.0.3 dist read at the delegation sites
(`runTaskForTool`, `executeTask`, `createTaskSession`,
`resolveSubagentDefinition`, `composeSystemPrompt`); and
`patches/@flue__runtime@2.0.3.patch` read in full — **it has no delegation
hunks**, so every delegation behavior below is stock 2.0.3, and everything
marked *measured* ran on it.

## Context

ADR 0012 decided the kernel decides, and left two questions to "Phase 13/14
[to] exist before they can be answered honestly": how a project binding
supplies `readRoots` in practice, and whether a subagent's policy is derived
from its parent's or declared independently. The first was answered by ADR
0021's project model and ADR 0057's scope question. The second is this ADR.

ADR 0030 deferred subagent authority derivation behind "a trusted application
context, grant-store schema changes, and a separate product/API decision;
caller-supplied ids are not accepted as a substitute". ADR 0038 gave the
grant its third column and asserted, before any second agent existed, that "a
second agent cannot inherit the first one's approvals". ADR 0039 gave child
processes the inheritance rule. What none of them had was a subagent that
exists. Flue 2.0.3 ships the machinery unused: `useSubagent` /
`defineSubagent` / `GeneralSubagent`, the always-registered `task` tool, and
the `## Available Agents` roster section the patch deliberately keeps. The
agent-platform plan commits to delegates; Stage 0 measured the machinery
before this ADR committed anything to it.

What the measurement found, in the sentences this ADR leans on:

- The `task` tool is in the model's array with no roster declared, the
  empty-roster paragraph is byte-identical in the model's context, and a call
  naming no declared agent returns a **successful** tool result — `Subagent
  "nobody-here" is not declared. Available subagents: (none).`,
  `isError: false` — a factual miss, not an error outcome. The runtime's own
  comment documents the shape ("a name outside the roster answers with a
  factual miss (same pattern as `activate_skill`), not an error outcome");
  measured, it holds.
- One `createSandbox` per conversation, *measured*, and never per delegate:
  the child session is built on the parent's already-built `Sandbox`
  (`parentEnv`, with a `cwd` override wrapped by `createCwdSandbox` when the
  task names one), and every tools-callback invocation — parent's and
  child's — logged the same workspace cwd. The delegate shares the parent's
  environment because the runtime passes it, not because anyone remembered.
- The delegate's model-visible toolset is the **parent's full gate list** —
  twenty-two entries, everything the conversation's gate holds plus the
  framework's `task` — with no filter of any kind. Visibility and authority
  disagree by the whole roster until something closes the gap.
- The execution-context frame during a delegate's work carries the task
  identity — `kind: "subagent"` on the wrapping operation, the `taskId`, the
  child's own `conv_<ulid>` stream, a linked `parentOperationId` — but
  **never the delegate's name**; `agentName` stays the parent's throughout,
  inherited from the admission root. The name exists only in Flue's
  `task_start`/`task` records (no harness code subscribes to Flue events),
  in the task tool result's `details` (model-visible, not harness-readable),
  and in Flue's internal child-conversation row.
- The delegate's transcript is not addressable through the product's agent
  routes (*measured* 404 on every candidate id — the task session name, the
  child's `conv_<ulid>`, the taskId): the routes serve agent *instances*, and
  a delegate is not one. `GET /agents/studio/<anything-that-is-not-an-instance>`
  answers `stream_not_found` with "Streams are created when their agent
  instance receives its first prompt".

## Options

**(a) Read the acting agent from the execution-context frame.** The frame
exists, is correct, and is parent-linked — measured. But it identifies the
*task*, not the *delegate*: no field carries the name, and nothing ours can
read supplies it. Making (a) work means a new our-side seam — an event
subscription (nobody subscribes today) or a read of Flue's conversation
records (Flue-internal state) — which is more surface than the problem and
the first step toward coupling our code to Flue's storage. Rejected on
evidence, not taste.

**(b) Extend the patch.** One hunk in `createTaskSession` — a function in the
coordinator bundle the patch already touches — putting the delegate's name on
the child session's execution context, which every operation of that session
then carries to our interceptor. Our side adds one link field and reads it
where the filter and the scope substitution already live. Chosen.

## Decision

### 1. Policy is declared per agent type; containment is inherited; approvals are never inherited

ADR 0012's question, answered in its own three-way split:

- **Policy — declared, per definition.** `StudioAgentDefinition` (the plan's
  D1) carries the delegate's tool allowlist, effects ceiling, permission
  mode, model policy, skills, and MCP namespaces as data, validated at load
  (the `defineSubagent` pattern: fail at module load, not first render). A
  delegate is a declaration, not a runtime fork, and nothing derives its
  policy from its parent's.
- **Containment — inherited, from the parent conversation.** The delegate
  runs inside the parent conversation's sandbox envelope: the same
  read/write roots, the same scratch/attachments/artifacts, the same operator
  switches. Measured structural: one sandbox per conversation, the child
  built on the parent's environment, every tools assembly against the same
  workspace. It cannot reach where the conversation cannot; files remain the
  hand-off surface between parent and child.
- **Approvals — never inherited.** The delegate's calls carry the
  *delegate's* `agentId` in the `ExecutionScope` — the substitution is the
  acting definition's name, application-derived, never model- or
  caller-supplied — and ADR 0038's store filter does the rest: a standing
  `studio` grant does not match an `explore` call, in either direction. The
  delegate's own `ask`s go through the same approval broker, rendered with
  the definition's title. The per-definition `grantPolicy: "inherit-ask"`
  refinement (a child's ask auto-answered when the parent was granted the
  same capability and resource in this conversation) stays deferred — it is
  ADR 0030 §5's authority-derivation question in miniature, and it deserves
  its own decision with usage data rather than a rider here.

### 2. The trusted context: the runtime derives the child scope; nothing supplied becomes authority

The `task` call carries a name and a prompt — *measured*, that is its entire
schema (`{prompt, agent, cwd?, attachments?}`), with `agent` schema-required
and resolved against the roster the parent's render declared. The child scope
is derived by the runtime from the parent conversation's settled row — the
scope the parent's factory built — plus the definition. The `cwd` a model may
pass names a working directory inside the shared environment, not an
identity; the runtime resolves it against the parent's environment and hands
the child a wrapped view, and whether a resolved-but-outside path is refused
is Flue's containment rule — not measured here, not relied on, and not an
identity either way. There is no path by which a model-supplied value becomes
authority: an unknown name is a factual miss that names the real roster; a
known name resolves to a definition the application wrote; the one scope
substitution is that definition's own name. This is ADR 0030 §5's "extend the
trusted context" requirement, satisfied structurally, within the local
boundary that ADR names. The multi-user deferral itself stays deferred.

### 3. Identity: what the runtime mints, what the product keys

Measured, on the `task`-tool path: `taskId = task_<ulid>`, runtime-minted;
the delegate runs a **task session** (`task:<parentSession>:<taskId>`) under
the parent's instance, with a fresh `conv_<ulid>` durable stream; there is no
per-delegate instance id. The plan's D2 assigned
`<parent conversation id>-task-<n>` to this path; the measurement splits what
D2 merged:

- **Model-driven** (Stage 3, the `task` tool): no instance id and no
  product-minted name — the tool executes inside Flue, so no product code
  sees the dispatch. The TaskStore row keys on the runtime's `taskId`; the
  parent conversation and the originating submission are columns, not the
  key.
- **Application-driven** (Stage 4, `dispatchBackgroundAgent`): the caller
  mints the instance id, exactly as the titler mints `<conversation
  id>-t<N>` — and there D2's `<conversationId>-task-<n>` is right, because
  `dispatch(Agent, { id })` takes the id from the caller.

One principle holds across both paths: **an id the runtime mints is never the
model's to choose, and an id the product mints is never the model's to
guess.** Delegation depth is Flue's own cap — `MAX_DELEGATION_DEPTH = 4`,
verified in the installed source — and each definition's `delegates:` roster
makes the reachable set explicit.

### 4. Tool visibility becomes agent-aware at the gate — one filter, the existing door

The rule extends ADR 0024's once: *the list comes from the rule that decides
the call*, and the rule now includes the definition's tool allowlist. The
measurement makes it load-bearing rather than tidy: today the delegate's
array is the parent's full list, so visibility and authority disagree by the
whole roster of natives until the filter lands.

The mechanism is the measured one. One hunk in `createTaskSession` — in the
coordinator bundle the patch already touches — adds the delegate's name to
the child session's execution context, the object every operation of that
session already flows through. Our `FlueExecutionLinks` gains the field
beside `taskId`, so the execution-context graph carries the acting agent for
every delegate operation — which is what the TaskStore projection and the
approval cards read. The factory's tools callback resolves the acting
definition and filters; the execute closures substitute the scope's
`agentId` the same way. One gate, one filter, no second tool path — the
filter is a viewer rule inside the same callback that applies ADR 0048's
withhold, and the delegate's *own* declared tools need no filter, because
they are the definition's by construction.

`discover` is withheld from delegates in v1 (the plan's D4/D6). Discovery
mutates the conversation's adopted set (`#discoveredToolKeys`, keyed by
conversation); a delegate adopting a tool would leak into the parent's array,
and an append-only set with two writers is the bug ADR 0029 exists to
prevent. A delegate's MCP surface is the static namespace allowlist on its
definition, resolved at spawn from the catalog, intersected with the
conversation's enablement chain.

One measured cost to design for: the tools callback runs **per model-turn
assembly** — five to six times in one two-turn submission, parent's and
child's turns both. The filter is a lookup against the acting definition, not
a rebuild; anything heavier re-pays itself every turn.

### 5. Dispatch, resend, and the reopen condition

Model-driven delegation happens inside one submission — measured, the child's
entire run is wrapped by the parent's `task` tool execution, under the
`kind: "subagent"` frame with its `parentOperationId` — so there is nothing
to resend: the submission's own durability is Flue's, and ADR 0033's
conservative rule holds unchanged. Application-driven background tasks
dispatch by function value through Flue's `dispatch` (the titler's proven
pattern), fire-and-forget at admission. **No automatic resend anywhere**; the
idempotency-key reopen condition is recorded on the dispatcher: any future
path that resends a task submission automatically must carry the key.

### 6. The roster section is replaced, not kept beside its replacement

The empty-roster paragraph is the `task` tool's other half — the patch kept
it deliberately, and the measurement found it byte-identical in the model's
context. When the first delegate lands, the paragraph is replaced by the
roster list in the same change that declares the delegate: measured armed,
the section lists the delegate, and the factual-miss text then names the real
roster (`Available subagents: explore.`). The two are one fact in two places,
and a roster that differs between them is the dishonesty ADR 0024 exists to
prevent — the list and the rule must be asked from one place.

## Consequences

- ADR 0012's Consequences note ("Not yet decided … whether a subagent's
  policy is derived from its parent's or declared independently") is
  answered, not re-opened: declared per type; containment inherited;
  approvals never.
- ADR 0030 §5's subagent deferral is answered within the local boundary it
  named. The multi-user deferral itself stays deferred.
- The plan's D2 id scheme is corrected by measurement, per §3 above. The
  plan's D10 assumption — that a task's transcript is the existing reader
  pointed at the task's stream — has no path to point at yet (measured 404
  on every candidate id: the routes serve instances, a delegate is not one).
  Stage 3/5 must either serve the child conversation through a seam Flue
  exposes or take it upstream; recorded as open rather than designed around.
- The delegate's unfiltered toolset (measured) is why §4's filter is Stage
  3's gate and not a polish item: nothing ships a delegate before visibility
  equals authority.
- The observability layer's `kind: "subagent"` projection with a parent link
  is confirmed live, not just claimed; the TaskStore's status projection (the
  plan's D5) builds on the same seam the measurement watched.
- The Stage 0 instrument was thrown away after the reading (the plan's
  findings record the disposal); the behaviors this ADR states as measured
  are re-derived by Stage 3's tests, which assert them against the real
  delegate.

## Amendment — the D10 design point, decided (2026-10-03, at S4.1)

The Consequences note above records D10 as open: a task's transcript is not
addressable through the product routes, measured. Stage 4's first row was the
deadline for deciding it, and it is decided now, split by the two task kinds
the TaskStore actually indexes — the split the Stage 0 measurement drew and
the plan's D2 correction already made:

**Background agent tasks** (the `title` / `improve` / `describe` dispatches,
and every future `background`-kind dispatch): **the existing reader, decided —
ADR 0045's transcript reader, pointed at `agents/<agentName>/<instanceId>`.**
These tasks *have* agent instances — the product mints the instance id at
dispatch, which is the whole reason the TaskStore's id column is the instance
id — so the 404 the measurement recorded does not apply to them; it recorded
delegate ids only. What is missing is the mount: 2.0 has no catch-all router,
and `create-app.ts` mounts the studio agent alone. The mount lands when the
product surface that reads a task's transcript is built, with one guard that
keeps the security property the background modules' docblocks state — the
agent router's `POST /:id` admits a prompt, and the background three must
never be promptable — so the mount carries middleware refusing every method
but GET/HEAD before the router. A transcript read is not a conversation
start; the two move through the same URL shape and only one of them is
admission.

**Delegate task sessions** (the model-driven `task` tool's children):
**deferred until the UI feature that reads one is built, with the tie-breaker
recorded now.** A delegate has no agent instance — the measured 404s stand —
so the reader has no id to point at, and this is the one place the plan's
original D10 sentence stays false. The two options are unchanged: an
in-process product route served from Flue's own stream store, or a Flue
change. The tie-breaker: prefer the in-process route if a seam reaches the
stream store without a patch hunk; spend the stage's one budgeted patch hunk
on a Flue change only if the measurement proves no seam exists. The
tie-breaker is recorded so the decision is a measurement away, not a design
session away, and so it does not spend the patch budget by default.
