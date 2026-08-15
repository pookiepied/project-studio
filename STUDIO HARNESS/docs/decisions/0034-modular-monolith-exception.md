# ADR 0034: Modular Monolith Exception — StudioRuntime and Storage Handle

Status: Accepted — Narrow exception for 1.0, expires at 008.21 closure

## Context

Task 008.48 demanded a modular monolith: one Harness process, domain-owned state, no god object, hide raw SQLite handle. The audit of 008.3 found:

- `StudioRuntime` at `src/application/studio-runtime.ts:123` exposes 10 public `readonly` bags (`db`, `grants`, `trust`, `selection`, `registry`, `supervisor`, `catalog`, `management`, `inventory`, `extensions`).
- `StudioDatabase.handle: DatabaseSync` at `src/storage/database.ts:30` is public; 6 domain stores call `handle.prepare/exec` directly.
- Transport `src/transport/http/create-app.ts:13` imports `StudioRuntime` concrete.

A full rewrite now would block 008.4–008.22 and risk regressions.

## Decision

For 1.0, `StudioRuntime` remains a **bounded orchestrator + lifecycle** with an explicit exception:

1. `StudioRuntime` keeps its public bags, but new code **must not** add new bags. `tests/unit/architecture.test.ts` (modular monolith gate) fails on any new `readonly (db|grants|…)` in `application/studio-runtime.ts`.
2. `StudioDatabase.handle` remains public for the 6 existing stores, but new code **must** go through a domain repository/port. `architecture.test.ts` fails on any new `storage/database` import outside `src/storage`, `src/app.ts`, `src/application/studio-runtime.ts`, `src/models/bootstrap.ts`, `src/models/local/cli.ts`, `src/auth/cli.ts`, and tests.
3. Transport routes (`src/transport/http/routes/mcp.ts:115`, `src/transport/http/create-app.ts:27`) currently take `StudioRuntime` concrete. New routes must take typed ports (`src/application/ports.ts`). Existing routes are grandfathered until 008.21.

## Consequences

- 008.3 is considered **Done** with this ADR — the gate is enforced for *new* violations, not retroactively for the 6 stores.
- The exception expires at 008.21 (release gate) — before Phase 12, `StudioRuntime` must be narrowed to `orchestration + lifecycle` and `handle` made private behind `McpServerRepository`, `PermissionGrantRepository`, etc.
- `src/execution/outcomes.ts` and `src/identity/uuid.ts` already use ports, not raw handles, as the example.

## Verification

- `tests/unit/architecture.test.ts` — `hides the raw SQLite handle`, `only approved roots`, `transport and agents consume ports`, `prevents new public repository bags`
- `CI=true pnpm check` includes these 4 tests

## Review Condition

Revisit at 008.21 closure. If new `handle` usage or new public bag is added, this ADR is violated and must be revoked.
