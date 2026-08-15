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
| `submissionId` | Flue | Durable direct submission lifetime | Links to Flue admission and recovery |
| `conversationId`, `turnId`, `taskId`, `toolCallId` | Flue | Flue-defined | Preserve Flue's canonical event semantics |
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
