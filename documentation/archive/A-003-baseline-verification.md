> **Superseded — archived 2026-08-15.** Kept for provenance, not as current
> guidance. The live source of truth is
> `documentation/work/phases-1-11-remediation.md`.

# A-003 — Baseline verification of Phases 1-11

**Parent:** Phases P-01..P-11, jointly
**Status:** Verified
**Opened:** 2026-08-15 · **Closed:** 2026-08-15

## What and why

Before remediating Phases 1–11 against `A-001` and `A-002`, establish what the
codebase *actually does* by running it, rather than reading what it is recorded
as doing.

This turned out to be the whole point. Both prior audits were conducted by
reading source. Neither ran the suite to completion, and the state of the suite
was not what the task file claimed.

## What was checked

`STUDIO HARNESS`, on Windows 11, Node 22.18.0, pnpm 10.23.0:

- `pnpm install` — no `node_modules` was present; the tree had never been
  installed in this environment.
- `pnpm typecheck` — clean.
- `pnpm build` — clean.
- `CI=true vitest run` — **21 failures across 7 files, of 1127 tests.**

## Findings

### AF-01 — Every Flue integration test failed with an opaque 500 — Fixed

15 of the 21 failures were the same error: `FlueApiError: 500 [internal_error]`
from `agents.send`. This is the primary path of the entire product — no agent
submission of any kind could succeed.

Two independent defects, stacked, the first masking the second:

**AF-01a — the Flue patch called a function that does not exist.**
`patches/@flue__runtime@1.0.0-beta.9.patch` inserted
`const idempotencyKey = parseIdempotencyKey(request);` into
`handleAgentRequest`. No such helper exists in beta.9 — confirmed by grep over
the installed package: exactly one occurrence, the call site. Every request
threw `ReferenceError`, was caught by the handler's own `catch`, and was
returned as a generic 500.

This is the mechanism by which `008.4` B-01 is recorded **Done** on the
evidence that "8 Harness tests pass": the tests were passing against a build in
which admission had never worked. See `B-001`.

**AF-01b — a sandbox probe threw where a boolean was required.**
With AF-01a fixed, the real failure appeared: Flue's `discoverSessionContext`
walks *ancestor* directories looking for `AGENTS.md`, calling
`SessionEnv.exists` on each. `LocalSandbox.exists()` deliberately throws for a
path outside the workspace, and the adapter passed that through, aborting the
submission.

Fixed at the adapter rather than in the sandbox: `LocalSandbox` keeps its
strict rule for the model-facing tool path, where it is tested and correct; the
`SessionEnv` adapter now satisfies Flue's contract, which is a total predicate.

Note the security comment in `local-sandbox.ts` justifying the throw — that
answering "no" would let an agent probe the filesystem — does not hold at this
seam and is weaker than it reads. A constant `false` for everything outside the
workspace reveals nothing about what is there; the throw actually reveals
*more*, since it distinguishes "outside the boundary" from "not found".

**Fixed by:** `T-002`, commit `655bf58`. Failures 21 → 6.

### AF-02 — The architecture tests do not run on Windows — Open

Four checks in `tests/unit/architecture.test.ts` compare paths with
`path.includes("src/storage")` and `path.replace(SRC_ROOT, "src")` against
native Windows paths containing backslashes. They cannot match, so the checks
either misfire or pass vacuously depending on the assertion.

This matters beyond portability: it means the 008.3 gate was never enforced on
this machine at all. Combined with `A-002`'s finding that the same tests were
written to assert the violations, the gate has no force on either platform.

**Destination:** `T-004`.

### AF-03 — A corrupt `studio.db` does not abort startup as its test requires — Open

`harness.test.ts` "does not rewrite Flue state when application database startup
failure" expects the Harness to exit; it starts.

Opening a corrupt `studio.db` *in isolation* throws `StorageError` correctly, so
the store-open path is right. The test differs in one way: a `-wal`/`-shm` pair
from the previous run is still present when the main file is replaced with
garbage. Recovery-from-stale-WAL is the likely mechanism and is exactly the
fault-injection scenario `008.1` records as proven.

Not diagnosed to root cause in this audit. It is a real divergence between the
recovery behaviour claimed and the recovery behaviour observed, and it should
not be closed by adjusting the test.

**Destination:** `T-004`. Related: `KNOWN-ISSUES` storage series.

### AF-04 — Two further failures not yet diagnosed — Open

- `mcp-runtime.test.ts` — real stdio tool through the gate.
- `architecture.test.ts` — "centralizes Project Studio-owned UUID generation".

**Destination:** `T-004`.

### AF-05 — The environment was never installed — Observation

No `node_modules` existed. Every prior "verification" of these phases was
therefore either performed elsewhere or not performed. Recorded because it
explains how AF-01 survived several audit rounds: a defect that makes every
integration test fail is invisible if the integration tests are never run.

## Verification

```
CI=true npx vitest run     # before: 21 failed / 1104 passed / 2 skipped
CI=true npx vitest run     # after:   6 failed / 1119 passed / 2 skipped
pnpm typecheck             # clean, before and after
pnpm build                 # clean, before and after
```

Commits: `95c99f6` (snapshot), `655bf58` (fixes).

## Consequences for the task record

`documentation/tasks/phase-11-mcp/008-phase-1-11-completion.md` records `008.1`
and `008.2` as Done and B-01 as resolved. Those claims rest on tests that could
not have passed. They need re-verification, not a checkmark. Handled in `T-006`.

## Links

- `A-002` — sanitary check; independently reached the same conclusion about the
  gate from source review.
- `B-001` — Flue admission idempotency.
- `T-002` — the fixes.
- `T-004` — remaining failures and the real gate.
