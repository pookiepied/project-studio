# T-004 — Close the architecture gate for real

**Parent:** `A-002` (with `A-003` AF-02..AF-04)
**Status:** In progress — requirements 1, 2, 6, 7 done (`edba5a5`)
**Opened:** 2026-08-15 · **Closed:** —

## Progress

**Done — commit `edba5a5`:**

- **(1)** `StudioDatabase` exposes `prepare`/`exec` and no `DatabaseSync`. Six
  domain repositories rewritten onto it. The raw handle lives in a `WeakMap`,
  reachable only via `storageHandle()`, which an architecture test bounds to
  `src/storage`.
- **(2)** Table ownership is enforced, scanning the strings handed to
  `prepare`/`exec`. It immediately found a violation the old gate could not
  see: `app_setting` is written by both `models/local/settings-store.ts` and
  `retrieval/settings.ts`. Pinned as a one-entry shrinking whitelist.
- **(6)** `application/ports.ts` deleted — zero importers, and its `StoragePort`
  re-exposed the handle anyway.
- **(7)** All checks are separator-agnostic and assert absence, or an explicit
  whitelist that may only shrink. 33/33 pass, and were confirmed to fail when
  the properties they name are broken. `A-003` AF-02 closed, along with the
  same defect in the UUID check.

**Remaining — 3, 4, 5, and the two open failures:** `StudioRuntime` still
publishes ten repositories and reaches for `getDatabase()`; transport and
agents still take the concrete runtime; `getStudioRuntime()` still exists;
`app_setting` still has two writers. AF-03 and AF-04 are undiagnosed.

Suite: 21 failures at the start of this work → 2.

## What and why

`008.3` is recorded closed, 13/13. `A-002` found it closed by exception with
tests written to assert the violations; `A-003` found the same tests cannot run
on Windows at all. The gate binds on neither platform.

This blocks `008.9` (grants) and `008.10` (shell/snapshots): both will
reintroduce cross-domain SQL, and nothing would catch it.

## Requirement

1. `StudioDatabase` exposes no `DatabaseSync`. Domain code reaches its own
   tables through a narrow statement surface and cannot reach another domain's.
2. Each application table has exactly one owning module, enforced by a test that
   fails when a second module names it.
3. `StudioRuntime` is constructed with its database rather than reaching for a
   process global, and does not close a connection it does not own.
4. `StudioRuntime` exposes a bounded façade. No public bags of repositories.
5. `createHttpApp` and the agent definition take ports. `getStudioRuntime()`
   is gone.
6. `application/ports.ts` is wired or deleted — not left as a boundary that
   only appears to exist.
7. Every architecture test asserts the **absence** of violations
   (`toEqual([])`), is path-separator agnostic, and fails when the property is
   broken. Per `tree/conventions.md` rule 5.
8. `CI=true pnpm check` green on Windows.

## Also in scope — the failures `A-003` left open

- **AF-03** — corrupt `studio.db` does not abort startup when a stale
  `-wal`/`-shm` pair is present. Diagnose to root cause. Do **not** close by
  adjusting the test: it is asserting the recovery property `008.1` claims.
- **AF-04** — `mcp-runtime` real-stdio failure; `architecture.test.ts` UUID
  centralization failure.

## Deliberately out of scope

- `B-001`'s seam question — decision required first.
- OS isolation implementation (`008.8`) — that is a separate task.
- Anything in `STUDIO Gateway/`.

## Notes

Sequencing matters: requirement 1 before 2, and 3 before 4, or the tests cannot
be written honestly at any intermediate point. Prefer several commits, each with
its own green suite, over one large one.

Do not add abstraction beyond what these eight points need. The previous attempt
produced `ports.ts`, which nothing imports.

## Links

- `A-002` SF-01..SF-04, SF-06; `A-003` AF-02..AF-04; ADR 0034; task 008 `008.3`.
