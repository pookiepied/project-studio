# F-001 — Retire the legacy Studio Gateway

**Parent:** P-07 / B-003
**Status:** Deferred
**Opened:** 2026-08-15 · **Closed:** —

## What was postponed

Removing `STUDIO Gateway/` from the repository, once the Harness no longer
needs it and any functionality worth keeping has been moved.

## Why postponed

The replacement contract is undecided (`B-003`). Deleting the reference before
the replacement exists loses working implementations of things worth reusing —
provider catalog and discovery, auth/rate-limit middleware, SSE translation,
usage projection.

## Standing constraints while it remains

- **Paused.** Do not extend it. Gateway work in progress at the `95c99f6`
  snapshot stops there.
- **Reference only.** It must not shape Harness architecture.
- **No permanent dependency.** Reused functionality is rewritten into Harness
  structure, not imported from the old tree.
- It is excluded from the Harness release gate.

## What retirement requires

1. `B-003` decided and a Gateway ADR recorded.
2. Contract tests passing against the replacement.
3. Anything worth keeping moved and tested in its new home.
4. Directory deleted in one commit that names what moved where.

## Links

- `B-003`, task 008 `008.13`, old `008.17` (Deferred).
