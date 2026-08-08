# ADR 0017 — Bounding A Tool Call

**Status:** accepted
**Closes:** `T-02`, and the Phase 9 "idempotency and unknown-outcome handling"
item. **Unblocks:** `shell`.

## Context

`runProcess` bounds a *subprocess*. Nothing bounded a *call*.

Three consequences, and they are not variations of one problem:

1. A tool that hangs in pure JavaScript never reaches a subprocess, so no
   existing bound applies. The gate hands control to tool code and has no way
   of getting it back.
2. The caller's `signal` was checked once, before execution. Cancellation
   therefore worked at the boundary and not during a call — "stop" stopped the
   next call, not the running one.
3. Nothing limited how many calls run at once. A model asking for forty greps
   started forty ripgrep processes.

All three have to be answered before `shell` ships, because `shell` is the tool
that makes each of them ordinary rather than theoretical.

## Decision

**One module, `src/tools/bounds.ts`, applied by the gate to every call.** Not
optional — the options tune it, they do not switch it off. A gate with no bound
on how long a call may take is the gap this exists to close.

### The deadline covers queue time as well as execution

From the caller's side the wait is part of the call. A bound that excluded
queueing would let a saturated gate hold a call open indefinitely while
technically honouring its timeout.

Default two minutes, matching `runProcess` so the two do not disagree.
Per-capability overrides exist because a `git clone` and a `read` do not
deserve the same patience, and giving everything the slowest tool's deadline
makes a hang indistinguishable from work.

### Bounds wrap execution, and nothing before it

Parsing, resource resolution, authorization, and the snapshot all sit outside.

Authorization is the reason. It can put a question in front of a person, and a
human deciding is not a call running slowly. Putting approval under the
deadline would cancel calls for the offence of being thought about.

### Cancellation is composed, not checked

`execute` receives a signal derived from the caller's signal *and* the
deadline. Tools that reach a subprocess forward it to `runProcess` and are
genuinely interrupted.

Tools that do not are **abandoned, not stopped**. The caller is released; the
work may still run to completion. That is a real limit of userland JavaScript
— there is no way to interrupt a synchronous loop — and the honest response is
to say so rather than to imply more control than we have. Recorded as `T-11`.

### What the model is told, and why `idempotent` finally earns its keep

The distinction that matters is not *why* a call ended but **whether anything
happened**:

| Situation | What the model is told |
|---|---|
| Abandoned in the queue | Nothing was done. Running it again is safe. |
| Abandoned mid-flight, idempotent | It may have finished; running it again is safe. |
| Abandoned mid-flight, not idempotent | It may or may not have finished — check the current state first. |

`CapabilityDescriptor.idempotent` has been declared since ADR 0012 and read by
nothing. This is the moment it exists for. A model that retries an abandoned
`git commit` because the error did not warn it makes two commits, and the error
message is the only place that warning can go.

Queue-abandonment is separated from mid-flight abandonment because it is
*knowably* safe. Collapsing them would tell a model that its never-started
non-idempotent call might have happened, which is a false warning — and false
warnings are how real ones stop being read.

### Concurrency is a FIFO queue, not a rejection

Eight at once by default. High enough that ordinary parallel reads are not
serialised — batching independent calls is a real latency win and this must not
undo it — and low enough that forty simultaneous greps do not start forty
processes.

Queued rather than refused: a refusal makes the model retry, which is more load
at exactly the wrong moment. FIFO rather than priority, because a model's calls
have no meaningful priority relative to each other and inventing one makes "why
is this slow" unanswerable.

An aborted waiter is **removed from the queue**, not merely rejected. A waiter
left behind is admitted later and holds a permit nobody releases, so the gate
deadlocks a few calls at a time, only under load. There is a test for exactly
that.

## Consequences

- `shell` is unblocked on this side. It still needs modes (`T-03`).
- `CallGate.inFlight` reports active and queued counts — the beginning of the
  audit surface Phase 9 still owes.
- Two new `ToolError` kinds, `timed_out` and `cancelled`. The gate previously
  reported cancellation as `execution_failed`, which put "the user pressed
  stop" and "the tool crashed" in the same bucket.
- An abandoned call's promise is explicitly caught, so a rejection arriving
  after the race does not surface as an unhandled rejection unrelated to any
  live call.
