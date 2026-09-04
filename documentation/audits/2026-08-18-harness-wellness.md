# STUDIO HARNESS — Wellness Pass Audit

Date: 2026-08-18. Branch: `remove/cloudflare-gateway`. Scope: `src/` and `tests/`
under `STUDIO HARNESS` only. Read-only; no source files were modified.

## Baseline

- `pnpm typecheck` — **clean**, exit 0, no diagnostics.
- `pnpm test` — **1261 passed, 25 skipped, 0 failed** (1286 tests; 82 files:
  81 passed, 1 skipped). Duration 327.83s.

The 25 skips are enumerated in F-14. Nothing failed; there is no "finding #1"
from the baseline. The rest of this file is what the green does not say.

Method note: reachability was computed by parsing every static and dynamic
import in `src/` and `tests/` and BFS from `src/app.ts` (both value and type
edges), then cross-checked against the CLI entries in `package.json:11-15`
(`src/auth/cli.ts`, `src/models/local/cli.ts`, `src/sandbox/cli.ts`) and the
flue build conventions (see F-01).

---

## 1. Dead and unwired code

Reachability of every top-level module under `src/`, transitive from
`src/app.ts` (any edge kind; "value" = runtime import, not `import type`):

| Module | Files | Imported by ≥1 src file | Reachable from app.ts |
|---|---|---|---|
| admission | 5 | 5 | yes (5) |
| agents | 1 | 0 (flue-loaded, see F-01) | no — by convention |
| application | 5 | 4 | yes (4) |
| auth | 8 | 7 | yes (5; `cli.ts`, `google-login.ts` reachable only via CLI) |
| context | 1 | 0 | **no** (intentional, ADR 0003) |
| contracts | 5 | 5 | yes (4) |
| credentials | 3 | 2 | yes (2; `memory-store.ts` no — F-04) |
| db.ts | 1 | 0 (flue-loaded, see F-01) | no — by convention |
| execution | 2 | 1 (`outcomes.ts`: 0) | partial — **`outcomes.ts` no** (F-03) |
| extend | 21 | 21 | yes (21) |
| host | 2 | 1 (launcher ← readiness) | **no** (parent-side seam, F-01) |
| identity | 1 | 1 | yes |
| models | 23 | 22 | yes (21) |
| net | 3 | 3 | yes |
| observability | 10 | 10 | yes |
| permissions | 9 | 9 | yes |
| platform | 2 | 2 | yes |
| process | 3 | 3 | yes |
| retrieval | 12 | 12 | yes |
| sandbox | 19 | 18 | yes (17; `isolation/linux/apparmor.ts` CLI-reachable) |
| snapshots | 5 | 4 | yes (4; `index.ts` no — F-05) |
| storage | 4 | 4 | yes |
| tools | 24 | 24 | yes |
| transport | 4 | 4 | yes |
| vendor | 2 | 2 | yes |

The known MCP-subsystem shape (docs claimed unwired, then it was wired) is
**not** present: all of `src/extend/` is reachable from `src/app.ts` via
`application/studio-runtime.ts`.

### F-01 — Two modules are unreachable by import but are loaded by flue's build convention, not dead
- `src/agents/studio.ts` (0 src importers, 1 test importer) and `src/db.ts`
  (0 importers of any kind) look unwired to any import-graph analysis.
- They are not: the flue build discovers both (`pnpm build` output lists
  `agents studio` and `database src\db.ts`), and ADR 0035 §6
  (`documentation/decisions/0035-runtime-composition-and-ports.md:93-98`)
  records that `agents/studio.ts` is "loaded by Flue's own module resolution"
  with "no injection point". `src/db.ts:25-33` is flue's journal adapter.
- Severity: UNTIDY. The rescue lives in an ADR and a build log, not in code;
  any future "dead code sweep" that trusts imports will delete a live module.
- Fix in one sentence: an architecture test asserting both files exist and
  remain flue entry points, so the convention is enforced rather than remembered.

### F-02 — `application/harness-client.ts` is unwired: the client-side seam has no runtime consumer
- 0 src importers; 5 test importers (`tests/integration/*`). Not reachable
  from `src/app.ts`, which is correct — it is the *Host-side* client (ADR 0028
  `documentation/decisions/0028-harness-client-admission-and-local-access.md:26`),
  and no Host in this repo consumes it.
- Severity: RISK. It is the contract the packaged Tauri Host is supposed to
  call (KNOWN-ISSUES A-04, `documentation/archive/KNOWN-ISSUES.md:194-203`);
  with no consumer it can drift against the server's actual routes and no test
  of the real pairing will fail.
- Fix in one sentence: wire the integration test that pairs `launchHarness()`
  with `FlueHarnessClient` against the built server, or move it next to the
  launcher under `src/host/` where its orphan status is obvious.

### F-03 — `execution/outcomes.ts` is unwired: the outcome taxonomy nothing reports
- 0 src importers; 2 test importers. `outcomeFor()` and `ExecutionOutcome`
  (`src/execution/outcomes.ts:4-86`) are not called anywhere in `src/`.
- ADR 0033 (`documentation/decisions/0033-execution-identity-and-operation-correlation.md:12-16`)
  describes outcome correlation as delivered; the switch at the center of it is
  reachable only from tests. The two sources disagree — the ADR says this is
  the recovery vocabulary, the import graph says nothing uses it.
- Severity: RISK. Any producer meant to emit these outcomes either does not
  exist or maps outcomes another way, and nothing will flag the divergence.
- Fix in one sentence: either wire `outcomeFor` into the failure paths that
  ADR 0033 names, or mark the file explicitly as a reserved contract the way
  `context-optimizer.ts:14-23` does.

### F-04 — `credentials/memory-store.ts` is a test fixture living in `src/`
- 0 src importers; 8 test importers. `InMemoryCredentialStore`
  (`src/credentials/memory-store.ts:17`) implements the real
  `SecureCredentialStore` interface but nothing in the product can select it.
- Severity: UNTIDY. It reads as a third deployment option; it is a fixture.
- Fix in one sentence: move it under `tests/` (or a `src/…/testing.ts` marked
  `@internal`) so `src/` contains only shippable stores.

### F-05 — `src/snapshots/index.ts` is a barrel nothing imports
- 0 importers in `src/` or `tests/`; every consumer imports the specific
  module (`store.js`, `turn.js`, …) directly. Not reachable from `app.ts`.
- Severity: UNTIDY. A public façade that nobody uses is a second place a
  future export list must be kept in sync for no reader.
- Fix in one sentence: delete the barrel or make the subsystem's consumers
  import through it, one or the other, not both.

`context/context-optimizer.ts` is also unreachable (0 src importers) but is
documented in place as deliberately unwired (`src/context/context-optimizer.ts:14-23`,
ADR 0003), so it is not reported as a finding; it is the honest version of
what F-02 and F-03 are not.

---

## 2. Doc-vs-code drift

Premise check first: **`docs/STATUS.md` and `docs/ROADMAP.md` do not exist
anywhere in the repository** (verified by recursive search; the only
`KNOWN-ISSUES.md` is `documentation/archive/KNOWN-ISSUES.md`, superseded
2026-08-15, banner at lines 1-3, which points to
`documentation/work/phases-1-11-remediation.md` — that file exists). Claims
below were checked against code regardless of the archive banner.

### F-06 — Documents that cite STATUS.md / roadmap.md as authorities cite files that do not exist
- `documentation/archive/KNOWN-ISSUES.md:270-271` (K-04): "STATUS.md, ADR 0018:
  the same claim, in the same words."
- `src/context/context-optimizer.ts:18`: "`roadmap.md` records the same thing."
- Severity: RISK. Both citations look like verifiable references; a reader who
  follows them lands on nothing and cannot tell whether the claim or the file
  was abandoned.
- Fix in one sentence: repoint the citations at files that exist (the ADRs
  themselves, or `documentation/work/phases-1-11-remediation.md`).

### F-07 — KNOWN-ISSUES S-02 ("No isolation provider exists yet · Open") is false: two providers ship
- Claim: "IsolationLevel has three values and only `in-process` is
  implemented" (`documentation/archive/KNOWN-ISSUES.md:827-839`).
- Code: `src/sandbox/isolation/registry.ts:40-43` registers
  `windowsAppContainer` (win32) and `linuxBwrap` (linux), and
  `registry.ts:56` derives `ISOLATION_ENFORCED` from that registry;
  `src/sandbox/isolation/backend.ts:177` returns real OS-level results.
- The two sources disagree. The code is the newer truth (ADR 0041's Linux
  work); the doc still describes the world before it.
- Severity: UNTIDY (stale in the favorable direction — the shipped state is
  stronger than documented).
- Fix in one sentence: close or rewrite S-02 against `registry.ts:26-38`,
  which already narrates the Linux addition.

### F-08 — KNOWN-ISSUES A-05 ("Pending approval state is process-memory · Accepted") is false: approvals are durable
- Claim: "`PermissionApprovalBroker` intentionally keeps pending requests in
  memory" (`documentation/archive/KNOWN-ISSUES.md:205-210`).
- Code: `src/app.ts:73-75` constructs the broker with
  `new PendingApprovalStore(database)`; migration 9 creates `pending_approval`
  (`src/storage/migrations.ts:246-265`); `src/permissions/pending-approvals.ts:54`
  deletes decided rows. ADR 0036 (`documentation/decisions/0036-user-decisions-are-durable.md:26`)
  audited this as delivered.
- Severity: UNTIDY (doc is older than ADR 0036 and contradicts it).
- Fix in one sentence: mark A-05 superseded by ADR 0036 the way the file's own
  banner marks the whole document.

### F-09 — KNOWN-ISSUES E-01 ("Node version is below the declared engine") is no longer true
- Claim: "the development machine runs 22.18.0"
  (`documentation/archive/KNOWN-ISSUES.md:971-977`).
- Code/environment: `node --version` → `v24.19.0`; `package.json:8` requires
  `>=22.19.0`; the test run printed no engine warning.
- Severity: UNTIDY (stale in the favorable direction).
- Fix in one sentence: close E-01.

### F-10 — ADR 0013's core invariant ("the only place a child process starts") is false four times over
- Claim: "`src/process/exec.ts` is the only place in the harness a child
  process starts" (`documentation/decisions/0013-execution-substrate.md:37`).
- Code, all outside `src/process/`:
  - `src/extend/mcp/stdio-channel.ts:159` — `spawn(options.command, …)`
  - `src/host/harness-launcher.ts:95` — `spawn(process.execPath, [serverPath], …)`
  - `src/auth/google-login.ts:285` — `spawn(command.file, command.args, …)` (browser)
  - `src/sandbox/isolation/windows/launcher.ts:61`,
    `src/sandbox/isolation/linux/network.ts:198`,
    `src/sandbox/isolation/linux/bwrap.ts:224`,
    `src/sandbox/isolation/linux/apparmor.ts:168,188` — `execFileSync`
- The two sources disagree. The ADR's *rule* (executable + argv, never a
  string, `shell: false`) may still hold at each site — but the claim of one
  chokepoint, on which the whole "enforced in code" section rests, does not.
- Severity: RISK. A security reviewer who trusts ADR 0013 audits one file and
  stops.
- Fix in one sentence: either funnel the remaining spawns through
  `src/process/` or amend ADR 0013 with the honest list of substrate entry
  points and the property each maintains.

### F-11 — KNOWN-ISSUES' verified claims have drifted by line number (claims true, citations stale)
All of these were confirmed present in code, at different lines than cited:
- `git-network` policy rule: cited `policy.ts:107`, actual
  `src/permissions/policy.ts:120`.
- shell `X_OK` check: cited `resolve.ts:47`, actual
  `src/tools/shell/resolve.ts:51`.
- exit-code-after-clip: cited `index.ts:108`, actual
  `src/tools/shell/index.ts:111`.
- `#pending` cleared on rejection (T-18): cited `turn.ts:95`, actual
  `src/snapshots/turn.ts:92,110-112`.
- CLI typed errors (E-03): cited `cli.ts:59,66`, actual
  `src/models/local/cli.ts:66,73` (and `ProviderConfigurationError` is at
  `src/contracts/models.ts:90` as claimed).
- ADR 0035:25 "`src/app.ts:57`" — `new StudioRuntime` is now `src/app.ts:76`.
- Severity: UNTIDY. `documentation/decisions/README.md:12` says ADRs reference
  files by name, not path, precisely because files move — but KNOWN-ISSUES
  uses line numbers throughout, and every one checked has moved.
- Fix in one sentence: strip line numbers from prose docs or regenerate them,
  keeping name-level references per the ADR README's own rule.

Claims checked and still true (not findings, listed to bound the drift):
P-05/P-06 (taskkill resolution `src/process/exec.ts:116-148`, stdin guard),
A-02 (port registration, see §6), A-03 (scope guard now derived,
`src/credentials/credential-store.ts`), K-05/K-06/K-07 (kernel door checks),
T-14/T-15/T-17/T-18 (effect table `src/contracts/effects.ts:112-141`,
deadline plumbing, transaction lock, pending retry), D-01/D-02 (guard runs
inside the transaction and on every open,
`src/storage/migrations.ts:433-463`), H-02 (`src/db.ts:25-27` resolves via
`flueDatabasePath()`), A-04/ADR 0040 (launcher FD 3/4, `127.0.0.1`, port 0 —
`src/host/harness-launcher.ts:89-92`), ADR 0022 (`src/net/destination.ts`
host/port classification), ADR 0020 (single effects table), ADR 0035 §5
(`app_setting` single owner `src/storage/app-settings.ts`, consumers at
`src/models/local/settings-store.ts:178` and `src/retrieval/settings.ts`).

---

## 3. Hand-written metadata nobody verifies

### F-12 — Every SQL table shape exists twice — DDL and a hand-written Row interface — joined only by `as` casts
The pattern ADR 0020 removed for effects (`src/contracts/effects.ts:6-31`)
is alive in storage: the `CREATE TABLE` text in `src/storage/migrations.ts`
and a separately maintained TypeScript interface, with `as unknown as`
bridging what the compiler cannot see:
- `mcp_server`: DDL `src/storage/migrations.ts:218-231` vs
  `interface ServerRow` `src/extend/mcp/registry.ts:204` vs the INSERT
  column list `registry.ts:270-286` vs `toRecord` — **four** hand-maintained
  copies, cast at `registry.ts:310,318`.
- `custom_provider` / `provider_connection`: DDL
  `src/storage/migrations.ts:39-56` vs
  `src/models/local/settings-store.ts:34` (`CustomProviderRow`) and its
  `ConnectionRow`, cast at `settings-store.ts:69,80,135`.
- `permission_grant`: DDL `src/storage/migrations.ts:75-88` (+3 index
  migrations) vs `interface GrantRow` `src/permissions/grant-store.ts:43`,
  cast at `grant-store.ts:119,236,319`.
- `pending_approval`: DDL `src/storage/migrations.ts:258-263` vs
  `interface Row` `src/permissions/pending-approvals.ts:25`, cast at :61.
- `app_setting`: DDL `src/storage/migrations.ts:58-62` vs the inline
  `{ value: string }` shape cast at `src/storage/app-settings.ts:66`.
A migration that adds or renames a column updates the DDL; nothing forces the
Row interfaces, the INSERT lists, or `toRecord` to follow, and typecheck
passes while the runtime reads `undefined`.
- Severity: RISK. This is the A-03 shape (`KNOWN-ISSUES.md:173-192`) and the
  T-22 shape (`KNOWN-ISSUES.md:574-584`) in the one subsystem ADR 0020 did
  not reach.
- Fix in one sentence: derive each Row interface from one source (a
  hand-written type *beside* the DDL with a test that opens a migrated
  `:memory:` database and asserts the column names against the interface's
  keys), so the two halves cannot silently disagree.

Nothing found in the compiler-enforced pairs: `EFFECT_RULES` is a
`Record<CapabilityEffect, …>` (`src/contracts/effects.ts:112`), the refusal
messages a `Record<DestinationRefusal, …>` (`src/net/destination.ts:29`),
credential scopes derive their guard from one list (KNOWN-ISSUES A-03 fix),
and `ISOLATION_ENFORCED` is derived from the registry rather than set beside
it (`src/sandbox/isolation/registry.ts:48-56`).

---

## 4. Cross-store orphans

Nothing found. Every owner-deletable table has a cleanup path, verified:

| Table | Deleted by | Belongings cleaned with it |
|---|---|---|
| `mcp_server` | `registry.remove` `src/extend/mcp/registry.ts:323-328` | keychain credential, grants by namespace, selection rows, live processes — `src/application/mcp-management.ts:93-111` (credential first, :97-101) |
| `custom_provider` | `settings-store.ts:122-127` | credential via `disconnect` + `provider_connection` row + stale default-model, `src/models/local/provider-service.ts:215-225,247-256` |
| `provider_connection` | `settings-store.ts:170-175` | credential deleted first (`provider-service.ts:216`) |
| `permission_grant` | soft-revoke only (`revoked_at`, `grant-store.ts:278`) | by design (audit history) |
| `pending_approval` | on decision `src/permissions/pending-approvals.ts:54` | — |
| `extension_selection` | `forget` `src/extend/selection.ts:104` | called in MCP remove path (`mcp-management.ts:107`) |
| `app_setting` | `src/storage/app-settings.ts:80` | — |
| `workspace_trust` | never deleted | by design: absence means "never asked", migration 4 comment (`migrations.ts:125-131`) |
| `schema_migration` | never deleted | by design: audit rows (`migrations.ts:440-445`) |

No `ON DELETE CASCADE` exists anywhere (no FKs are declared); nothing needs
one, because each removal path is explicit and was verified to be complete.

---

## 5. Error taxonomy honesty

Nothing found, in both directions.

- Every declared domain has at least one raising class: `admission`
  (`src/admission/errors.ts:12`), `auth` (`src/auth/errors.ts:44`),
  `credentials` (`src/credentials/credential-store.ts:37`), `models`
  (`src/contracts/models.ts:91,104`), `gateway`
  (`src/models/studio-cloud/errors.ts:71`), `storage`
  (`src/storage/errors.ts:32`), `observability`
  (`src/observability/telemetry-errors.ts:27`), `permissions`
  (`src/permissions/errors.ts:34`), `sandbox` (`src/sandbox/errors.ts:33`),
  `network` (`src/net/destination.ts:37`, `src/net/http.ts:60`), `tools`
  (`src/tools/errors.ts:39`), `process` (`src/process/errors.ts:35`),
  `vendor` (`src/vendor/errors.ts:26`), `snapshots`
  (`src/snapshots/errors.ts:26`), `retrieval`
  (`src/retrieval/errors.ts:68`), `extend` (`src/extend/errors.ts:49`).
- Every `StudioError` subclass (18 across `src/`, per exhaustive grep for
  `extends StudioError`) declares a `readonly domain` drawn from the union at
  `src/contracts/errors.ts:25-82`; the abstract declaration
  (`errors.ts:127`) makes an out-of-union domain a type error.
- `unclassified` intentionally has no class — it is the measured gap for raw
  errors (`errors.ts:21-23`), not an orphan.

---

## 6. Listening sockets and own-ports

Exactly one listener exists in `src/`: the Google sign-in callback server,
`src/auth/google-login.ts:112` (`server.listen(0, "127.0.0.1", …)`), which
registers at `google-login.ts:131` and unregisters in its `finally` at
`:100`. Verified, matches the standing rule (`src/net/own-ports.ts:12-17`,
KNOWN-ISSUES A-02).

### F-13 — The harness's primary HTTP listener never registers with own-ports; the guard is blind to the control plane it exists to protect
- The server socket is bound by the flue framework, not `src/` — `src/app.ts:162`
  default-exports the app with no `listen`, and the port/host are chosen by the
  environment the launcher sets (`PORT=0`, hostname `127.0.0.1`,
  `src/host/harness-launcher.ts:89-90`) and published in the readiness frame
  (parsed only on the parent side, `src/host/readiness.ts:23`).
- Grep for `registerOwnPort` across `src/` returns exactly the definition
  (`src/net/own-ports.ts:21`) and the google-login call sites. Nothing in the
  harness process ever knows or registers its own port.
- Consequence: `classifyHostPort` (`src/net/destination.ts:217-225`) can never
  return `own-port` for the main listener, so the branch at
  `destination.ts:201-208` that refuses "Project Studio's own service …
  whoever wrote the address" is unreachable for it. A user-authored MCP HTTP
  server pointing at the harness's own port is judged `loopback` — allowed
  with an approval (`destination.ts:343-349` documents loopback-for-user as a
  policy row) — instead of refused outright.
- `own-ports.ts:14-16` states the rule itself: "a listening port that is not
  in this set is a port the `own-port` class cannot protect, and the guard
  then defends nothing while still looking present." The main port is exactly
  that case; the two sources (the rule and the wiring) disagree.
- Severity: RISK. It needs a user to approve a destination they should never
  be asked about, but the entire class exists because "a person typing it has
  misunderstood rather than decided" (`destination.ts:358-361`).
- Fix in one sentence: have the harness process register its actual port once
  the runtime learns it (readiness publish or first request), or have the
  flue-patched entry point call `registerOwnPort` before serving.

---

## 7. Skipped and empty tests

All 25 skips, from a `--reporter=json` run of the affected files:

| File | Count | Tests | Reason |
|---|---|---|---|
| `tests/integration/sandbox-bwrap.test.ts` | 23 | 20 under `linux` suite + 3 under `refusing` suite | Linux-only; `describe` is `describe.skip` off-Linux (`tests/integration/sandbox-bwrap.test.ts:35-36`, gated by `tests/contained.ts:40-43`) |
| `tests/integration/credential-keyring.test.ts` | 1 | "is unavailable in this environment, so platform tests were skipped" | inverse-conditional placeholder (`credential-keyring.test.ts:76-79`) |
| `tests/unit/process.test.ts` | 1 | "kills descendants with the process group on forced termination" | POSIX-only `it.runIf(process.platform !== "win32")` (`process.test.ts:215`) |

### F-14 — On this machine the entire Linux containment suite is skipped, and one skipped test asserts nothing
- The 23 sandbox-bwrap skips are platform-conditional by design
  (`tests/contained.ts:26-43` documents the choice), so the green baseline
  contains **zero assertions about Linux containment on the machine that
  produced it** — the suite that names 20 of the 23 is the only executable
  spec for `src/sandbox/isolation/linux/bwrap.ts`.
- The keyring placeholder (`credential-keyring.test.ts:77-79`) runs only when
  the store is *unavailable* and then asserts `expect(available).toBe(false)`
  — a tautology with the skip condition. It is the documented
  skip-rather-than-fail convention, but it is also the only test in this
  inventory that asserts nothing meaningful.
- Severity: RISK (coverage claim), UNTIDY (the placeholder).
- Fix in one sentence: run the Linux suite in a Linux CI leg so the skips are
  environmental rather than permanent, and leave the placeholder as a
  `describe`-level annotation instead of a test.

No `expect(true)`, `.todo`, `xit`, or empty-body tests exist anywhere under
`tests/` (grep-verified); the one conditional early-return
(`tests/unit/sandbox.test.ts:118`, symlink privileges) leaves the test green
with its mechanism unexercised on restricted hosts — same shape, lesser
degree, noted here rather than as its own finding.

---

## 8. TODO / FIXME / "not yet"

Nothing found. Grep for `TODO|FIXME|not yet|XXX` across `src/` returns only
incidental prose, and two of those are comments explaining why a TODO is
*not* used (`src/sandbox/isolation/registry.ts:54`,
`sandbox/isolation/linux/bwrap.ts:417`). The nearest real item is a doc
reference to a nonexistent file (F-06), reported above.

---

## IS THIS STABLE?

**Yes — the baseline is green, the safety-critical invariants I could test
held up under inspection, and nothing found is BROKEN — but three findings
should be settled before feature work leans on them.**

The three that most justify the hedged yes:

1. **F-13** — the own-port guard, the one defense against the agent reaching
   the harness's control plane, cannot fire for the harness's own listening
   port. The guard is present, tested, and defends nothing where it matters
   most.
2. **F-12** — every database table's shape is maintained by hand in two to
   four places joined only by `as` casts. The codebase has already shipped
   this exact shape of bug twice (A-03, T-22); the storage layer is the
   largest remaining instance of it.
3. **F-10** — ADR 0013's "one place a child process starts" is false in four
   modules. Every subsequent containment and injection argument in that ADR
   inherits the weakening; a reviewer or contributor trusting it audits one
   file out of seven.

The favorable rest: cross-store cleanup is genuinely complete (§4), the
error taxonomy is honest in both directions (§5), no TODO debt exists (§8),
and the unwired modules (F-02, F-03) are seams waiting for consumers, not
rot in the serving path.
