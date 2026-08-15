> **Superseded — archived 2026-08-15.** Kept for provenance, not as current
> guidance. The live source of truth is
> `documentation/work/phases-1-11-remediation.md`.

# T-005 — Dead code and typing sweep

**Parent:** `A-002` (SF-05, SF-06)
**Status:** Planned
**Opened:** 2026-08-15 · **Closed:** —

## What and why

`tsconfig.json` sets neither `noUnusedLocals` nor `noUnusedParameters`, so dead
code does not fail the build and has accumulated unnoticed. One case is not
cosmetic: `execution/outcomes.ts:35` accepts an `idempotent` parameter and never
reads it, which means the retry-safety decision it exists to make is not being
made.

## Requirement

1. `noUnusedLocals` and `noUnusedParameters` on; `pnpm typecheck` clean.
2. `outcomes.ts` either uses `idempotent` to decide retry safety, or the
   parameter goes and callers stop implying a decision that is not happening.
   Whichever is chosen, a test covers it.
3. Genuinely unreachable exports deleted, not annotated:
   `isRetryableForUnknown`, `createRetryExecutionContext`, `executionContext()`,
   and `sandbox/errors.ts` `unsupported_isolation` (dead since ADR 0034).
4. `PassthroughContextOptimizer` — wire it or delete it. It is used only by its
   own test today, so that test proves nothing about the running system.
5. `#turns` in `studio-runtime.ts` and `#reportedWithheld` in `tools/gate.ts`
   bounded — both grow without limit for the life of the process.
6. Unused imports removed (`observability/index.ts`, `permissions/trust.ts`,
   `tools/git/index.ts`).

## Notes

Delete rather than suppress. An export nothing imports is not an API, and a
`void` or an underscore prefix hides the very signal that produced this task.

Check each deletion against `STUDIO/` and the CLI entrypoints — this repository
has consumers outside the Harness `src/` tree.

## Links

- `A-002` SF-05, SF-06.
