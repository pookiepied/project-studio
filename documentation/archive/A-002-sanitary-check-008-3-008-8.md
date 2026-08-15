> **Superseded — archived 2026-08-15.** Kept for provenance, not as current
> guidance. The live source of truth is
> `documentation/work/phases-1-11-remediation.md`.

# A-002 — Sanitary check of 008.3–008.8

**Parent:** Phases P-01..P-11, jointly (via `A-001` / task 008)
**Status:** Verified — findings stand
**Opened:** 2026-08-14 · **Closed:** 2026-08-15

## What and why

`008.3` (modular monolith gate), `008.4`, `008.5`, `008.7` and `008.8` were all
marked **Done**, with `008.3` at 13/13. A source-level check was run against
those claims because `008.9` (Trust & Grants) depends on `008.3` having
actually hidden the database handle.

It had not. The findings below were independently re-confirmed against the
codebase on 2026-08-15 and are carried forward as the requirement for `T-004`.

## The central finding

**The gate is recorded as closed by exception, not by fix, and its tests were
written to pass while the violations are present.**

`tests/unit/architecture.test.ts`:

```ts
// "transport and agents consume ports, not concrete runtime internals"
expect(offenders.length).toBeGreaterThan(0);   // :475 — green BECAUSE it is broken

// "prevents new public repository bags"
expect(publicBags.length).toBeGreaterThanOrEqual(7);  // :482 — an 11th bag still passes
```

Both invert the property they are named for. Fixing the code makes them fail.
This is the specific failure mode that `tree/conventions.md` rule 5 now forbids.

## Findings

### SF-01 — `StudioRuntime` is still a god object — Open

`src/application/studio-runtime.ts:123` exposes ten public bags: `db`, `grants`,
`trust`, `selection`, `inventory`, `extensions`, `registry`, `supervisor`,
`catalog`, `management`. `008.3-04` required these narrowed to a façade; it was
closed with ADR 0034 recording an exception instead.

### SF-02 — The raw SQLite handle is public — Open

`src/storage/database.ts:30` exposes `handle: DatabaseSync`. Six domain files
issue raw SQL through it (`extend/mcp/registry.ts`, `extend/selection.ts`,
`models/local/settings-store.ts`, `permissions/grant-store.ts`,
`permissions/trust.ts`, `retrieval/settings.ts`).

The test whitelists exactly those six and asserts only that no *seventh*
appears. The rule `008.3-05` states — one owner per table, no cross-domain raw
SQL — is not enforced by anything.

**This is what blocks `008.9`.** A typed `PermissionPort` added now would be a
second port over the same leaky handle, and `008.16`'s availability-before-
permission ordering cannot be made safe underneath it.

### SF-03 — `application/ports.ts` is a dead file — Open

Defines `McpManagementPort`, `PermissionPort`, `StoragePort`, `HarnessPorts`,
`withCompensation`. **Zero importers outside itself.** `StoragePort` re-exposes
`StudioDatabase`, handle included, so it would not hide anything even if used.

Created to satisfy a checklist item. Either wire it or delete it; a port nobody
consumes is worse than no port, because it reads as though the boundary exists.

### SF-04 — Global singletons and a service locator — Open

`storage/database.ts:147` (`let shared`), `db.ts:33`, `observability/index.ts:49`,
and `getStudioRuntime()` at `studio-runtime.ts:366`. `transport/http/create-app.ts:7`
takes `StudioRuntime` concrete; `agents/studio.ts:9` reaches for the global.

`closeDatabase()` is called from both `app.ts` and `StudioRuntime.stop()`. Not
currently a crash — the second call is a no-op — but a domain object closing a
process-global connection is the wrong ownership direction.

### SF-05 — Dead and unused code, invisible because the compiler is not asking — Open

`tsconfig.json` sets neither `noUnusedLocals` nor `noUnusedParameters`, so none
of the following fails the build:

- `execution/outcomes.ts:35` — `idempotent` parameter accepted and never read.
  The retry-safety decision it exists to make is not being made.
- `execution/outcomes.ts:84` `isRetryableForUnknown` — never imported.
- `execution/context.ts:112` `createRetryExecutionContext` — never imported.
- `transport/http/middleware/admission.ts:79` `executionContext()` — never imported.
- `sandbox/errors.ts:9` `unsupported_isolation` — never thrown since ADR 0034.
- Unused imports in `observability/index.ts:13`, `permissions/trust.ts:3`,
  `tools/git/index.ts:11`.
- `context/context-optimizer.ts:11` `PassthroughContextOptimizer` — used only by
  its own test; never wired into the runtime.

### SF-06 — Two unbounded sets — Open

`studio-runtime.ts:143` `#turns` is added to by every `createAgentSandbox()` and
never deleted, so `prepareModelTurn()` iterates every sandbox ever created.
Same shape at `tools/gate.ts:200` `#reportedWithheld`.

### SF-07 — The Flue patch is at the wrong seam — Partly superseded

The `Idempotency-Key` header patch hijacks `submissionId` as
`project-studio:${key}`, while Flue already offers idempotent
`dispatch({dispatchId})` with a 409 on conflict. `008.4` B-01 itself says "not a
second journal", which is what was built.

`A-003` then found the patch was not merely at the wrong seam but non-functional
— it called a helper that does not exist, so every submission 500'd. Repaired in
`T-002` to restore the path; the seam question is unresolved and carried in
`B-001`.

### SF-08 — Documentation contradicts the code it describes — Open

- `architecture/domain-ownership.md:30` says `bootstrap.ts:149` "will be moved in
  008.3-04". It was not; the item is marked Done.
- `architecture/api-inventory.md:3` says 3/5 Done; task 008 says 5/5.
- `architecture/api-inventory.md:30` promises an `X-Project-Studio-API-Version: 1`
  response header. `create-app.ts` has no such logic.
- `008.8` is marked Done with zero isolation implementation — no `bwrap`,
  `ProcessContainer`, or Seatbelt code exists; `bwrap` appears only in prose.
  The *decision* is done; the implementation is 0%, which is a defensible
  Accepted but is not Done.

## Verdict on the phases as recorded

| Item | Recorded | Actual |
|---|---|---|
| 008.3 modular gate 13/13 | Done | **Over-claimed.** Exception ADR, not fix; 4 tests inverted |
| 008.4 API inventory 5/5 | Done | **3/5.** Inventory good; version header absent from code |
| 008.5 admission 9/9 | Done | **Mostly.** `bootstrap.ts` still global; `withCompensation` unused |
| 008.6 error/durable/approval 14/14 | Done | **Half.** `pending_approval` table promised, no migration; still a `Map` in `approval-broker.ts:32` |
| 008.7 CallGate 3/3 | Done | **Done.** `gate.ts:241` order is correct |
| 008.8 OS isolation 3/3 | Done | **Decision only.** Implementation 0% |

**Does `008.3` unblock `008.9`–`008.11`? No.** Until the handle is private and
`StudioRuntime` is a façade, `008.9` grants and `008.10` shell/snapshots will
reintroduce cross-domain SQL with nothing to catch it.

## Links

- `A-003` — baseline verification; found the gate is additionally unenforced on
  Windows, so it binds on neither platform.
- `T-004` — the remediation this audit specifies.
- `B-001` — Flue admission idempotency (SF-07).
- ADR 0034 — the exception this audit disputes.
