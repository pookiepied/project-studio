# ADR 0033: Execution Identity And Operation Correlation

Status: Accepted — steps 1-3 implemented; steps 4-5 open, see below

> **Status corrected 2026-08-15.** This read `proposed; Task 008.44 gate` while
> its core had been implemented and wired for some time, which invited a reader
> either to re-litigate a settled design or to assume none of it existed. Two
> things were stale: the word *proposed*, and the gate reference — `008.44` was
> renumbered to `008.4`.
>
> **Implemented and in use:** the typed `ExecutionContext`
> (`src/execution/context.ts`) carrying `requestId`, `operationId`,
> `parentOperationId`, `attemptId`, `kind`, `clientId`, `sessionId` and the Flue
> links; a root context created per request by the admission middleware
> (`src/transport/http/middleware/admission.ts`); Flue operation ids linked at
> turn boundaries (`src/observability/flue.ts`); the structured logger consuming
> it. That is steps 1-3.
>
> **Not implemented, deliberately:** step 4's public admission idempotency key
> is meta-task **#12**, answered as *delete the patches and accept
> lost-ack-as-unknown for 1.0* — and **carried out on 2026-08-15**. It had been
> built, by hand-diffing `dist/` in `@flue/sdk` and `@flue/runtime`; that is the
> mechanism that produced #1, a call to a function present in no release of
> beta.9 which made every submission return 500. The `idempotencyKey` parameter
> is gone from both clients rather than left as a hook that reaches nothing.
> What holds instead is this ADR's own conservative rule, now pinned by a test
> that asserts an identical resend creates a second submission and a second
> turn. The step returns when Flue admits a key upstream, which is a request to
> make of Flue, not a diff to reapply. Step 5's durable execution projection has no
> consumer yet, which is the condition the step itself names.
> `createRetryExecutionContext` exists with a test and no production caller; it
> is marked declared-not-wired at the source under meta-task **#31**.
>
> **Reopened and reaffirmed, 2026-09-02 (Flue 2 migration, Phase 6).** The
> step 4 condition has arrived: Flue 2.0 admits a caller-chosen
> `idempotencyKey` upstream, and the semantics were measured against a live
> 2.0 harness — a retried send with the same key converges on the original
> submission (same receipt, `deduplicated: true`), and reusing a key with a
> different payload rejects 409 `submission_conflict`. **The key is declined
> for the current shape, and the conservative rule is reaffirmed:** nothing in
> the tree resends a submission automatically, a lost acknowledgement
> surfaces as `unreachable` with the instruction to check the transcript
> before sending again, and the durable transcript read (ADR 0045) is the
> answer to the ambiguity. Adoption would put the key's lifecycle in the
> composer — minted per composed message, invalidated on any content or
> settings change (a mismatch is a 409), retired when a person deliberately
> resends after checking — which is a product decision of its own, not a
> rider on the envelope reshape. **Reopen condition, named:** any future path
> that resends a submission automatically (a scheduled send, a durable
> outbox, a reconnecting admission queue) must carry the key; the mechanism
> is now upstream and one option away. The decision is recorded with the
> same wording at the harness client (`src/application/harness-client.ts`).

> **Amended 2026-09-03 (Flue 2 migration, Phase 7): the identity 2.0 split,
> and the half this ADR was missing.** Flue 1.0 had one run identity. 2.0
> splits it, and both halves are now measured off live events rather than
> read off a type:
>
> - **`instanceId`** is the agent instance - the thread the work belongs to,
>   chosen by the caller. Here it IS the product's conversation id
>   (`cnv_<uuid>` as the webview mints it, or `<conversation id>-t<N>` for a
>   titling retry). Stable across every submission that thread runs.
> - **`submissionId`** is one admitted piece of durable work on that instance
>   (`sub_<ulid>`). 1.0's `dispatchId` is this: 2.0 gives direct and
>   dispatched submissions the same field, and the queued/running events'
>   `kind` (`"direct"` / `"dispatch"`) is what tells them apart.
> - **`conversationId`** is Flue's own `conv_<ulid>`, the durable stream
>   behind an instance, minted by the runtime. **It is not the product's
>   conversation**, and the table below saying "Flue-defined" hid that: a log
>   line correlated on it cannot be joined to anything a person can see.
>
> The event renames that go with it: `run_start`/`run_end` are
> `agent_start`/`agent_end`, and the delivered envelope is `v: 3`.
>
> **What this changes here, and it is not a rename:** `ExecutionContext` (and
> the structured logger) linked `submissionId` and Flue's `conversationId`
> and nothing else, so the half of the split that names the product's
> conversation was never linked at all. `FlueExecutionLinks` now carries
> `instanceId` and `agentName` as well (`flue_instance_id`,
> `flue_agent_name` in logs and span links) - the first because it is the
> only Flue id a person's conversation can be found by, the second because
> one instance runs two agents seconds apart (the conversation's turn, then
> the background titling run) and without it the two are indistinguishable in
> a trace. The `requestId` fallback for a Flue-rooted context prefers the
> instance over Flue's stream id for the same reason. `submissionId`'s row in
> the table below should be read as covering both kinds, not "direct" only.

## Context

One user message can create a model turn, tool calls, MCP requests, hooks,
skills, compaction, provider requests, and subagent work. Retries and recovery
can create multiple attempts for the same logical request. The client may
disconnect while the Harness continues, and the front end will eventually need
to show what happened without treating logs as the execution source of truth.

The repository already has several useful identifiers. Flue emits and persists
`submissionId`, `conversationId`, `turnId`, `taskId`, `toolCallId`, and
`operationId`. OpenTelemetry supplies `traceId` and `spanId`. Project Studio
also owns UUID generation for its own records. Replacing all of these with one
new UUID would lose semantics and create two competing identity systems.

## Decision Proposal

Use one linked execution graph rather than one universal identifier:

| Identity | Owner | Lifetime | Purpose |
|---|---|---|---|
| `requestId` / root execution id | Project Studio | Stable for one logical client request | The front-end and admission correlation key |
| `attemptId` | Project Studio | New for each execution/retry attempt | Distinguishes retries without losing the root family |
| `operationId` | Flue when present; Project Studio for non-Flue operations | One logical child operation | Identifies model, tool, MCP, hook, skill, compaction, provider, or subagent work |
| `parentOperationId` | Project Studio correlation | Parent operation lifetime | Reconstructs the operation tree |
| `instanceId` | Flue, chosen by the caller | The agent instance (here: the conversation) | The one Flue id a person's conversation can be found by |
| `agentName` | Flue | One agent's identity | Separates a conversation's turn from a background run on the same instance |
| `submissionId` | Flue | Durable submission lifetime, direct or dispatched | Links to Flue admission and recovery |
| `conversationId`, `turnId`, `taskId`, `toolCallId` | Flue | Flue-defined | Preserve Flue's canonical event semantics. `conversationId` is Flue's own stream id (`conv_<ulid>`), NOT the product's conversation |
| `traceId`, `spanId` | OpenTelemetry | Trace/span lifetime | Live telemetry and distributed instrumentation; not durable task identity |
| `idempotencyKey` | Admission contract | Stable for one retryable admission | Prevents duplicate initial submissions; semantically distinct from telemetry IDs |

`requestId` and `idempotencyKey` may have the same value for a one-request/one-
admission boundary, but the types and meanings remain separate so a future
preparation, scheduled task, or multi-admission execution does not accidentally
reuse a transport key.

## Execution Context

Every Project Studio-owned effectful entrypoint accepts or receives a typed
context equivalent to:

```text
ExecutionContext {
  requestId
  operationId
  parentOperationId?
  attemptId
  kind
  clientId
  sessionId
  instanceId?
  agentName?
  submissionId?
  conversationId?
  turnId?
  taskId?
  traceId?
  spanId?
}
```

The context carries identity and relationships only. It never carries tokens,
provider secrets, raw message content, or tool arguments. Child operations copy
the root and attempt context, assign their own operation identity, and point to
their parent. A retry keeps the root `requestId`, creates a new `attemptId`, and
records the retry reason.

## Recovery And Status

The execution graph must represent at least `queued`, `running`, `waiting_for_user`,
`completed`, `failed`, `cancelled`, `unknown`, and `blocked`. A disconnected
client changes observation, not execution ownership. A Harness restart creates a
new attempt or terminalizes the operation according to the Flue recovery result;
it does not create a new root request family.

Unknown external effects remain unknown. The graph makes them discoverable and
correlatable; it does not make shell, network, MCP, or provider effects
reversible. Idempotency policy still belongs to the capability or admission
owner.

## Storage And Presentation

- Flue's canonical conversation and durable event stream remain authoritative for
  Flue execution facts.
- Project Studio may maintain a compact execution index/projection for lookup,
  status, and future front-end views; it must not become a second transcript.
- Structured logs include the execution fields plus OpenTelemetry correlation.
- The front end consumes a typed status/event projection, not raw log scraping.
- The operation graph is modular: domains emit/consume the context through typed
  ports; no global god object or universal event table owns every domain rule.

## Required Rules For New Features

Every new effectful capability must declare:

1. Which operation kind it creates.
2. Which parent operation it receives.
3. Whether it is retryable or idempotent.
4. Which Flue id it links when Flue owns the operation.
5. Which terminal, unknown, blocked, or user-action status it emits.
6. Which fields are safe for logs, API projections, and persistence.

No new feature may generate an unrelated root ID, silently drop the execution
context, or use `traceId` as a durable retry/idempotency identity.

## Implementation Order

1. Define the typed context and operation-kind contract.
2. Propagate it through the Harness/Flue turn boundary and structured logger.
3. Link existing Flue event identifiers instead of duplicating them.
4. Add the public admission idempotency key at the Flue owner boundary.
5. Add a durable Project Studio execution projection only when the API/client
   consumer requires queryable task status.

This ADR does not require the full task graph, subagent product, or front-end
timeline to be built in Task 008. It makes their identity and recovery boundary
explicit so later phases cannot invent incompatible tracking systems.
