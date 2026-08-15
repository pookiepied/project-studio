> **Superseded — archived 2026-08-15.** Kept for provenance, not as current
> guidance. The live source of truth is
> `documentation/work/phases-1-11-remediation.md`.

# B-001 — Flue initial-admission idempotency

**Parent:** P-11 / A-001 (task 008, `008.4`)
**Status:** Blocked
**Opened:** 2026-08-13 · **Closed:** —

## What is blocked

Safe retry of an initial agent submission. Until an accepted submission can be
recovered after a lost response, a lost acknowledgement must be reported as
`unknown` and never blindly retried.

Downstream: `008.21` (fail-safe integration matrix) requires this to land first
(clash C-04).

## Why it is blocked

The contract needs the idempotency key handled where Flue *durably admits* the
submission. Project Studio cannot solve this by writing a second local row
around the SDK call: a crash between Flue's admission and that row still leaves
an unknown duplicate. Flue beta.9 exposes no public admission key on the direct
attached path.

## Current state — corrected 2026-08-15

Recorded in task 008 as **Done via versioned patches**, on the evidence that 8
Harness tests pass.

`A-003` found that evidence invalid. The runtime patch called
`parseIdempotencyKey(request)`, which exists in no version of beta.9, so every
admission threw `ReferenceError` and returned 500. The tests were passing
against a build in which admission never worked.

`T-002` repaired the call so the path functions again. **That restored the
Harness; it did not validate the design.** B-001 returns to Blocked.

## Two unresolved problems

1. **Wrong seam.** The patch hijacks `submissionId` as `project-studio:${key}`
   from an `Idempotency-Key` header. Flue already has idempotent
   `dispatch({dispatchId})` with a 409 on conflict
   (`agent-execution-store-*.d.mts:424`). `008.4` B-01 says "not a second
   journal" — a second journal is what was built.

2. **Version fragility.** Both patches are hand-written diffs against
   `dist/*.mjs` of a beta dependency, pinned by content hash. A version bump
   drops them silently. Exactly this class of failure produced the outage
   `A-003` found.

## What would unblock it

Any one of:

- A public Flue admission-key capability (preferred — upstream it).
- Moving to `dispatch({dispatchId: requestId})` and deleting the header patch,
  if the direct attached path can be expressed as a dispatch.
- An explicit **Accepted** decision that lost-ack stays `unknown` for 1.0, the
  patches are removed, and automatic retry stays off. This is the honest
  fallback and costs the least.

**Decision required** before `008.21`. Do not choose silently.

## Guard to add regardless

A test that fails loudly if either patch stops applying. The current failure
mode — patch silently dropped, every request 500s, suite still green because
the suite was never run — must not be reachable again.

## Links

- `A-003` AF-01a, `A-002` SF-07, `T-002`, ADR 0033.
