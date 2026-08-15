> **Superseded — archived 2026-08-15.** Kept for provenance, not as current
> guidance. The live source of truth is
> `documentation/work/phases-1-11-remediation.md`.

# T-002 — Admission path repair

**Parent:** `A-003`
**Status:** Verified
**Opened:** 2026-08-15 · **Closed:** 2026-08-15

## What and why

`A-003` found that every Flue integration test failed with an opaque
`500 internal_error` from `agents.send` — no agent submission of any kind could
succeed. Two independent defects on `POST /agents/:name/:id`, the first masking
the second.

## Requirement

An agent submission reaches Flue and returns a valid admission receipt. The
Harness integration suite passes.

## What was implemented

**1. `patches/@flue__runtime@1.0.0-beta.9.patch`**

Replaced the call to the non-existent `parseIdempotencyKey(request)` with an
inline header read:

```js
const idempotencyKey = (request.headers.get("Idempotency-Key") ?? "").trim() || void 0;
```

Inline rather than a helper so the patch introduces no new top-level symbol for
a future Flue bundle to collide with. Hunk line counts are unchanged, so the
patch still applies against the same content hash.

**2. `src/application/studio-runtime.ts` — `sessionEnvironment()`**

`SessionEnv.exists` now maps a `SandboxError` to `false` instead of propagating
it.

Fixed at the adapter, not in the sandbox. `LocalSandbox.exists()` throws for
paths outside the workspace by design, and that is right for the model-facing
tool path where it is tested. Flue's `SessionEnv.exists` is a different
contract — a total predicate, called by the runtime itself on ancestor
directories while discovering `AGENTS.md` — and a throw there aborts the whole
submission.

Answering `false` leaks nothing: it is the same answer for every path outside
the workspace, present or not. The reasoning is recorded as a comment at the
seam, because the two `exists` behaviours now differ on purpose and the next
reader will otherwise "fix" the inconsistency.

## Verification

```
pnpm typecheck                 clean
pnpm build                     clean
CI=true npx vitest run         21 failed / 1104 passed  →  6 failed / 1119 passed
```

`tests/integration/harness.test.ts`: 0/8 → 7/8. The remaining failure is `AF-03`
(corrupt-database startup), a pre-existing defect unrelated to these two.

Also recovered: `mcp-flue`, `observability` (3), `stop` (2), `studio-flue`.

**Commit:** `655bf58`

## Notes

Neither defect was reachable by reading source alone, which is why two prior
audit rounds missed them. `parseIdempotencyKey` looks plausible at the call
site; the sandbox throw only manifests through Flue's ancestor walk.

The idempotency *design* is not validated by this repair — only the path is.
See `B-001`.

## Links

- `A-003` AF-01a / AF-01b, `B-001`.
