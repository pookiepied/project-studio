# STUDIO HARNESS — Wellness Pass Audit

Date: 2026-08-18. Read-only audit of `src/` and `tests/` under STUDIO HARNESS, with
`README.md`, `documentation/decisions/*.md` (44 ADRs), `documentation/architecture/`,
`documentation/project-map.md`, `documentation/rules.md` as evidence. No source file was
modified. No git state was changed after the initial read-only inspection.

## Branch note — the run instructions contradict themselves

The task's opening rule demands branch `remove/cloudflare-gateway`; its closing rule
demands `main` and says to stop if otherwise. Observed state: `git branch --show-current`
printed `main`; `STUDIO HARNESS/src/providers/` exists; `STUDIO Gateway/` does not —
exactly what the closing rule requires. Both rules cannot be satisfied; per the task's own
"report both, do not pick a winner" rule this is recorded rather than resolved. The audit
proceeded on `main` because switching branches with 27 uncommitted foreign files under
`STUDIO/` would violate the no-touch rule. `git status --porcelain` showed exactly the 27
modified files under `STUDIO/` plus an untracked root `docs/`; none were touched.

## Baseline (recorded verbatim)

`pnpm typecheck`:

```
> project-studio-v2@0.1.0 typecheck D:\Creative Library\Workspace\Project Studio\STUDIO HARNESS
> tsc --noEmit
```

No output, exit 0. Clean.

`pnpm test` (tail):

```
 Test Files  83 passed | 1 skipped (84)
      Tests  1275 passed | 25 skipped (1300)
   Start at  14:57:49
   Duration  369.89s (transform 4.57s, setup 0ms, import 21.44s, tests 330.86s, environment 10ms)
```

Matches the expectation exactly (83 files, 1275 passed, 25 skipped). No F-01 for baseline.

---

## Category 1 — Dead and unwired code

Import graph built by static resolution of every relative import in `src/` and `tests/`
(script run outside the repo). `src/app.ts` transitively reaches **159 of 179** `.ts`
files under `src/`. The other 20:

| Module | Importers in src/ | Reachable from app.ts | Actually wired to |
| --- | --- | --- | --- |
| `agents/studio.ts` | 0 | no (separate entry) | Flue agent discovery — the generated server mounts it (`dist/server.mjs` bundles it; `flue build` reported `agents studio`). Wired. |
| `db.ts` | 0 | no | Flue's own entry (`flue build` reported `database src\db.ts`). Wired. |
| `contracts/agents.ts` | 1 (`agents/studio.ts`) | no | Via the agent entry. Wired. |
| `providers/connection-store.ts` | 1 (`providers/model-catalog.ts`) | **no** | **Tests only** (`tests/unit/connection-store.test.ts`, `tests/unit/model-catalog.test.ts`) |
| `providers/model-catalog.ts` | 0 | **no** | **Tests only** (`tests/unit/model-catalog.test.ts`) |
| `contracts/providers.ts` | 2 (both inside the dead `providers/` cluster) | **no** | **Tests only** (4 test files) |
| `application/harness-client.ts` | 0 | **no** | **Tests only** (5 integration tests) |
| `context/context-optimizer.ts` | 0 | **no** | **Tests only** (`tests/unit/context-optimizer.test.ts`) |
| `execution/outcomes.ts` | 0 | **no** | **Tests only** (`tests/unit/outcomes.test.ts`) |
| `credentials/memory-store.ts` | 0 | **no** | **Tests only** (9 test files) |
| `host/harness-launcher.ts` | 0 | **no** | **Tests only in this repo** (`tests/integration/harness-listener.test.ts`); designed as the seam the Tauri Host (in `STUDIO/`, out of scope) consumes |
| `host/readiness.ts` | 1 (`harness-launcher.ts`) | **no** | Only via the launcher + its test |
| `auth/login.ts` | 1 (`auth/cli.ts`) | no | `pnpm auth` CLI entry (`package.json:11`) — launcher/CLI-wired, not the server |
| `auth/google-login.ts` | 1 (`auth/login.ts`) | no | Via `pnpm auth` CLI |
| `auth/cli.ts` | 0 | no | `pnpm auth` CLI entry (`package.json:11`) |
| `models/local/cli.ts` | 0 | no | `pnpm providers` CLI entry (`package.json:12`) |
| `models/local/provider-service.ts` | 1 (`models/local/cli.ts`) | no | Via `pnpm providers` CLI |
| `sandbox/cli.ts` | 0 | no | `pnpm sandbox:*` CLI entries (`package.json:13-15`) |
| `sandbox/isolation/linux/apparmor.ts` | 1 (`sandbox/cli.ts`) | no | Via `pnpm sandbox` CLI |
| `snapshots/index.ts` | 0 | **no** | **Nothing at all** — not even a test imports it |

Answers to the specific questions asked: `src/execution/` — `context.ts` is wired into
the server (via the admission middleware), `outcomes.ts` is test-only. `src/identity/` —
wired (6 importers, including `app.ts`'s chain). `src/admission/` — fully wired into the
server. `src/host/` — launcher-side only, not imported by `app.ts`; its consumer is the
desktop Host outside this repo, so "wired only into the launcher" is true in the sense
that the launcher itself is wired to nothing here. `src/transport/` — fully wired
(`create-app.ts` is imported by `app.ts:22`). The large genuinely-dead zone is
`src/providers/` (whole directory, plus its contract `contracts/providers.ts`).

## Category 2 — README-vs-code drift (false claims only)

Findings F-02 through F-06 below. Claims that verified true (vertical-slice items,
gateway adapter SSE mapping, two-database split, timeout semantics, observability table)
are not listed.

## Category 3 — ADR-vs-code drift

Prioritised 0037–0043. Verified clean: 0037 (`observability/index.ts:48-59` guarded init
+ `TelemetryError("already_initialized")` exactly as recorded), 0038
(`agents/studio.ts:22-25` passes `STUDIO_AGENT_ID` as `agentId` and
`` `conversation:${id}` `` as `conversationId`), 0039 (`process/environment.ts` exists and
is the shared owner), 0041 (`sandbox/isolation/registry.ts:40-43` registers win32 +
linux; `vendor/win32-x64/studio-contain.exe` and `vendor/linux-x64/rg` exist;
`isolation/kinds.ts` exists), 0040 and 0042/0043 describe `STUDIO/` and MCP-side code
outside this audit's scope. One contradiction found (F-07). Also relevant: every
`docs/decisions/*.md` link in the harness README is dead from the harness directory
(F-06).

## Category 4 — Hand-written metadata nobody verifies

One live instance (F-12). Checked and clean: `EFFECT_RULES` is
`Record<CapabilityEffect, …>` so the compiler keys the table to the union
(`contracts/effects.ts:112`); admission scopes derive their type from the constant
(`admission/scopes.ts:11-12`); `provider_connection_record.record_json` and the model
tables are schema-parsed on write and read (`storage/migrations.ts:301-314, 327-330`
documents it; `providers/connection-store.ts:1`, `providers/model-catalog.ts:1` import
valibot to do it) — the schema is the single source, not a pair.

## Category 5 — Cross-store orphans (12 tables in `storage/migrations.ts`)

No table declares a foreign key; every cleanup is manual. Per table:

| Table | Deletes rows | Owner-entity deletion covered? |
| --- | --- | --- |
| `custom_provider` | `models/local/settings-store.ts:124` | Yes — `provider-service.ts:247-253` deletes the keychain credential first via `disconnect()` |
| `provider_connection` | `settings-store.ts:172` | Yes — same choreography (`provider-service.ts:215-217`) |
| `app_setting` | `storage/app-settings.ts:80` | Yes |
| `permission_grant` | never deleted; revoked by marking (`grant-store.ts:245-251`) | Yes — `revokeNamespace` on MCP remove/edit (`application/mcp-management.ts:86,106`) |
| `workspace_trust` | never deleted; `trusted=0` by design (`migrations.ts:129-131`) | Yes |
| `extension_selection` | `extend/selection.ts:104` | Yes — `selection.forget("mcp", id)` on server removal (`mcp-management.ts:107`) |
| `mcp_server` | `extend/mcp/registry.ts:325` | Yes — keychain first, then row, grants, selection, stop (`mcp-management.ts:93-110`) |
| `pending_approval` | `permissions/pending-approvals.ts:54` | Yes — but see F-11 (promised staleness handling does not exist) |
| `provider_connection_record` | `providers/connection-store.ts:354` | Choreographed (keychain first, `connection-store.ts:150-158`) but **only invocable from tests** (F-01) |
| `provider_model_override` | `providers/model-catalog.ts:553` | **No — see F-08** |
| `provider_model_manual` | `providers/model-catalog.ts:547` | **No — see F-08** |
| `provider_default` | `providers/model-catalog.ts:589` | **No — see F-08** |

The wired MCP/provider paths (`custom_provider`, `provider_connection`, `mcp_server`)
are clean — the removal choreography is real and ordered. The defect is confined to the
unwired `src/providers/` cluster (F-08), which matches the brief's note that this class
was already confirmed once in `src/providers/`.

## Category 6 — Error taxonomy honesty

**Nothing found.** All 16 non-`unclassified` domains in
`contracts/errors.ts:25-82` are used by at least one `StudioError` subclass
(`admission/errors.ts:12`, `auth/errors.ts:44`, `net/destination.ts:37` +
`net/http.ts:60` → `network`, `extend/errors.ts:49`, `process/errors.ts:35`,
`permissions/errors.ts:34`, `vendor/errors.ts:26`,
`observability/telemetry-errors.ts:27`, `credentials/credential-store.ts:37`,
`snapshots/errors.ts:26`, `storage/errors.ts:32`, `models/studio-cloud/errors.ts:71` →
`gateway`, `contracts/models.ts:126,139` → `models`, `sandbox/errors.ts:33`,
`tools/errors.ts:39`, `retrieval/errors.ts:68`). Every subclass found declares a domain
from the union; none declares `unclassified`.

## Category 7 — Listening sockets vs `registerOwnPort()`

Two bind sites exist in the shipped process:

1. **Google sign-in loopback server** — `auth/google-login.ts:112`
   (`server.listen(0, "127.0.0.1")`), registered at `google-login.ts:131`, unregistered
   in a `finally` at `google-login.ts:100`. Correct.
2. **The harness's own main HTTP listener** — bound by the generated Flue entrypoint
   (`dist/server.mjs:1609-1621`, `serve({ fetch, port, … })`). **Never registered.** No
   occurrence of `registerOwnPort`/`own-ports` exists anywhere in `dist/server.mjs`, and
   nothing in `src/` is called back with the bound port except the readiness frame
   (`host/readiness.ts` consumers). This is precisely the failure `net/own-ports.ts:12-16`
   warns about: "a listening port that is not in this set is a port the `own-port` class
   cannot protect, and the guard then defends nothing while still looking present."
   Finding F-09.

## Category 8 — Admission coverage

`create-app.ts:28` installs the bearer-verifying admission middleware on `*` before any
route; no route is reachable unauthenticated. Per route group:

| Routes | Scope guard | Evidence |
| --- | --- | --- |
| Flue agent routes (`/`) | `agent:run` | `transport/http/create-app.ts:34` |
| All `/api/mcp` routes | `extension-management` | `transport/http/routes/mcp.ts:107` |
| `PUT /api/mcp/projects/:projectId/extensions/mcp/:id` | additionally `project` | `routes/mcp.ts:149-151` |
| All `/api/permissions` routes | `approval` | `routes/permissions.ts:48` |

**No unguarded route found** — every route is behind both the global middleware and a
named scope. Two honest weaknesses recorded as F-10: the fifth scope, `diagnostic`
(`admission/scopes.ts:8`), guards no route anywhere, and every session is granted every
scope by default (`admission/verifier.ts:111`, and `app.ts:60-69` passes no `scopes`), so
today the scopes are structural rather than discriminating.

## Category 9 — Skipped tests (all 25, from the JSON reporter)

| File | Count | Reason |
| --- | --- | --- |
| `tests/integration/sandbox-bwrap.test.ts` | 23 | Linux-only (`describe`/`describe.skip` selected at `sandbox-bwrap.test.ts:35-36`); entire bwrap containment suite is dormant on this Windows host |
| `tests/integration/credential-keyring.test.ts` | 1 | The sentinel test "is unavailable in this environment, so platform tests were skipped" — inverts to assert `available === false` (`credential-keyring.test.ts:76-79`); the 6 real keyring tests ran here since a platform store exists |
| `tests/unit/process.test.ts` | 1 | `it.runIf(process.platform !== "win32")` — POSIX process-group kill (`process.test.ts:215`) |

No skipped test asserts nothing: the sentinel deliberately asserts the environment fact,
and the rest never execute on this platform. No `expect(true)` placeholders found.
Platform-gated `runIf` tests that *ran* (win32/git/ripgrep-gated ones) are green and
meaningful. **No placeholder findings.**

## Category 10 — TODO / FIXME / "not yet" / "for now"

**Nothing found.** Every match in `src/` is prose describing behaviour ("requests that
have been sent and not yet answered", "a destination that has been parsed but not yet
judged") or a comment about the absence of TODOs. No unfinished-work marker survives in
shipped harness code.

---

# Findings

**F-01 — The entire `src/providers/` subsystem is reachable only from tests; its own
contract claims otherwise.**
Evidence: `providers/connection-store.ts` and `providers/model-catalog.ts` have no
importer outside `tests/unit/connection-store.test.ts` and `tests/unit/model-catalog.test.ts`
(import graph, Category 1); `contracts/providers.ts:366-372` says of `ProviderPort`:
"this is the ONLY seam the frontend talks to; in-process callers call it directly, and
the HTTP surface is a thin adapter over this" — but `transport/http/routes/` contains
exactly two files (`mcp.ts`, `permissions.ts`), neither touching providers.
Severity: **RISK** — nothing it does is wrong, but a whole shipped-and-tested subsystem
is dead in the product, and its contract documents an integration that does not exist.
Fix: wire `ProviderPort` into `StudioRuntime` + an HTTP route module, or delete the
cluster and its tests.

**F-02 — README claims local/BYOK is not operational; it ships and works.**
Evidence: `README.md:228` ("`local` (BYOK) | No | Recognized by config; bootstrap fails
with `ProviderConfigurationError` until secure OS credential storage and the BYOK runtime
ship") and `README.md:356-358` ("Until secure storage and the local runtime land,
selecting `local` fails…") vs `models/bootstrap.ts:85-86` (`case "local":` builds the
adapter), `bootstrap.ts:135-156` (`createLocalAdapter` with `KeyringCredentialStore` +
`createLocalRuntime`), and the passing integration suite
`tests/integration/local-byok.test.ts` ("Stored key to the wire against a mock
OpenAI-compatible server").
Severity: **BROKEN** — the primary doc states the opposite of the code, now.
Fix: rewrite the source table and the trailing paragraph to describe the shipped local
path.

**F-03 — README "Deferred Boundaries": four of eight listed deferrals have quietly
shipped.**
Evidence: `README.md:341-351` defers (1) production session-backed gateway auth, (3)
secure OS credential storage, (4) local BYOK runtime, (5) MCP connection registry. All
four exist: (1) `models/bootstrap.ts:186-199` — `SessionAccessTokenProvider` over
`SessionStore`/`StudioAuthClient` is the default gateway auth when no dev token is set;
(3) `credentials/keyring-store.ts` ships and is used at `bootstrap.ts:148,193`; (4) see
F-02; (5) `extend/mcp/registry.ts` + `supervisor.ts` + `transport/http/routes/mcp.ts`
are wired into the server (`app.ts:101-105`).
Severity: **BROKEN** — the section the audit brief calls highest-value no longer
describes reality; a reader would believe auth, storage, BYOK, and MCP registry are
unbuilt.
Fix: move items 1, 3, 4, 5 out of "Deferred Boundaries" into the shipped-surface
sections.

**F-04 — README persistence defaults are wrong for both databases.**
Evidence: `README.md:312` ("`src/db.ts` is Flue's, defaulting to `./data/flue.db`") vs
`db.ts:25-27` (default is `flueDatabasePath()` from `platform/paths.ts`, the Studio
home — the file's own comment, `db.ts:14-19, 22-23`, says the `./data` default was a
bug that was fixed); `README.md:316` ("`src/storage/` … defaulting to
`./data/studio.db`") vs `storage/database.ts:74-77` and its comment at `database.ts:68-73`
("In the user's Studio home, never relative to the working directory").
Severity: **BROKEN** — both stated defaults would put databases inside the user's open
repository, the exact defect the code comments say was already fixed once.
Fix: update both README lines to the Studio-home paths.

**F-05 — README "Structure" tree is stale: 13 existing `src/` directories are absent and
`tools/` is reduced to one file.**
Evidence: `README.md:29-129` lists no `admission/`, `execution/`, `extend/`, `host/`,
`identity/`, `net/`, `platform/`, `process/`, `providers/`, `retrieval/`, `snapshots/`,
`transport/`, or `vendor/` (all exist — Category 1 listing), and shows `tools/` containing
only `workspace-summary.ts` (`README.md:109-110`) while `tools/` actually contains seven
subsystems (filesystem, git, search, shell, web, native, plus gate/bounds/types). The
tree's own preamble ("There are no placeholder directories", `README.md:131`) makes the
omission read as "these do not exist".
Severity: **BROKEN** — the section is the map a new contributor is told to trust.
Fix: regenerate the tree from the actual directory listing.

**F-06 — The harness README links ADRs and a `docs/` tree that do not exist in STUDIO
HARNESS.**
Evidence: `README.md:127-128` lists `docs/` with `docs/decisions/` in the Structure tree,
and `README.md:367-372` link `docs/decisions/0001-…md` through `0006-…md`;
`Test-Path "STUDIO HARNESS/docs"` and `"STUDIO HARNESS/docs/decisions"` are both False.
The ADRs actually live at repo root `documentation/decisions/` (44 files).
Severity: **BROKEN** — every ADR link from the primary doc is dead, and the doc tree
points somewhere that was never created (or was removed).
Fix: repoint at `../documentation/decisions/` and drop or create `docs/`.

**F-07 — ADR 0034 names `src/application/ports.ts`, which does not exist, and describes
transport as taking `StudioRuntime` concrete, which it no longer does.**
Evidence: `documentation/decisions/0034-modular-monolith-exception.md:15` ("Transport
`src/transport/http/create-app.ts:13` imports `StudioRuntime` concrete") and `:25` ("New
routes must take typed ports (`src/application/ports.ts`)") vs
`transport/http/create-app.ts:12-14` (options take `McpAdministration`, the port ADR 0035
§2 introduced) and no `src/application/ports.ts` anywhere (file list, Category 1); the
port lives at `application/mcp-management.ts:40-48`.
Severity: **UNTIDY** — an ADR is a historical record, but anyone using it as an index of
current seams is pointed at a file that was never created under that name.
Fix: add a status note to 0034 (as 0028 did at its line 113) naming where the port
actually landed.

**F-08 — Deleting a provider connection orphans its rows in all three model tables.**
Evidence: `providers/connection-store.ts:150-159` (`remove()` deletes the keychain entry
and `provider_connection_record` only — no `DELETE FROM provider_model_manual`,
`provider_model_override`, or `provider_default`), while the only deletes for those
tables are per-model and per-slot (`providers/model-catalog.ts:547, 553, 589`). A
re-added connection with the same id silently resurrects orphaned overrides, manual
models, and possibly a default pointing at a credential that was deleted.
Severity: **RISK** — the orphaning path is real but currently reachable only through the
test-only cluster (F-01); it becomes live the moment providers are wired.
Fix: have connection removal also delete the three child tables' rows for that
`connection_id` in one transaction.

**F-09 — The harness's main HTTP listener never registers with `own-ports`.**
Evidence: the generated entrypoint binds via `serve({ fetch, port, … })` at
`dist/server.mjs:1609-1621`; `registerOwnPort` occurs nowhere in `dist/server.mjs` and
nowhere in `src/` outside `auth/google-login.ts:131`. `net/own-ports.ts:12-16` states
the consequence verbatim: an unregistered listener "defeats the guard silently … the
guard then defends nothing while still looking present. See `L-01`." Today no model
request can reach it because `net/` refuses every loopback destination
(`google-login.ts:127-129` documents this), so the hole is latent, exactly the
"registered then, missing for exactly as long as it mattered" failure the file predicts.
Severity: **RISK** — wrong the moment any loopback destination becomes reachable.
Fix: register (and unregister on close) the bound port from the readiness seam —
`host/readiness.ts` is where the port is already known.

**F-10 — The scope system is currently decorative: one scope guards nothing and every
client receives every scope.**
Evidence: `admission/scopes.ts:8` declares `DIAGNOSTIC`, which no route checks (grep
across `src/`: only `scopes.ts:19` lists it); `admission/verifier.ts:111` defaults
sessions to `ALL_ADMISSION_SCOPES`, and `app.ts:60-69` constructs the session without
overriding `scopes` — so the only real authorization decision today is possession of the
bearer credential.
Severity: **RISK** — ADR 0028 §7's layered authorization (`documentation/decisions/
0028-harness-client-admission-and-local-access.md:199-208`) exists structurally but
discriminates nothing; a future route author may assume scope separation is enforced.
Fix: derive default scopes from `clientType` and either guard a route with `diagnostic`
or remove it from the constant.

**F-11 — `pending_approval` staleness is promised by a comment and implemented nowhere.**
Evidence: `storage/migrations.ts:255-256` ("`asked_at` is what orders the queue and what
lets a stale row be recognised as stale"), but `asked_at` is only ever used for
`ORDER BY` (`permissions/pending-approvals.ts:60`); nothing reads it to expire, flag, or
purge stale rows, and rows are otherwise immortal (deleted only when answered/cancelled,
`pending-approvals.ts:54`).
Severity: **UNTIDY** — no wrong behaviour today (durability is the design, ADR 0036),
but the stated staleness contract is unimplemented and misleading.
Fix: either implement a staleness sweep at startup or delete the second half of the
sentence.

**F-12 — The six capability slots are hand-written twice with nothing forcing agreement.**
Evidence: `contracts/providers.ts:253-260` (`capabilitySlotSchema` picklist:
textGeneration, imageGeneration, videoGeneration, speechGeneration, transcription,
embeddings) beside `contracts/providers.ts:272-309` (`defaultSelectionSchema` object
hand-repeating the same six as optional fields). Adding a seventh slot to the picklist
compiles cleanly while `DefaultSelection` silently cannot express it; the duplicated
comment block at `contracts/providers.ts:22-26` (the same sentence twice) shows the
hand-maintenance already slipping.
Severity: **RISK** — the exact ADR-0020 pattern (two copies, no verifier), one `as`-free
but unguarded.
Fix: derive the `defaultSelectionSchema` keys from the slot list (or generate the picklist
from the object's keys).

**F-13 — `revokeConversation` has no production caller, so conversation-scoped grants
accumulate forever.**
Evidence: `permissions/grant-store.ts:290-297` ("Drops conversation-scoped grants when a
conversation ends"); the only caller in the repo is
`tests/unit/permissions.test.ts:372`. No code path invokes it when a conversation or
agent instance ends (`grep revokeConversation` across `src/`: definition only).
Severity: **UNTIDY** — revoked-by-omission is not a security hole (grants are
conversation-narrow and fail closed), but the store grows without bound and the docstring
describes a lifecycle that never happens.
Fix: call it from the runtime's conversation-end path, or delete the method.

---

# IS THIS STABLE?

**Yes — conditionally.** The wired core (admission chain, MCP lifecycle choreography,
storage hygiene for every reachable path, error taxonomy, migration guard) is genuinely
solid: clean typecheck, 1275 green tests, every route scoped, every reachable delete
path ordered keychain-first, all 16 error domains honest. The conditions come from the
three findings that most justify caution:

1. **F-03/F-02 — the README can no longer be trusted as the record of what exists.**
   Four "deferred" boundaries shipped, the local/BYOK row is inverted, and both stated
   database defaults describe a bug the code says was already fixed once. Building on
   this repo while treating the README as truth means re-implementing shipped subsystems
   or mis-scoping new ones.
2. **F-01 — a whole tested subsystem (`src/providers/`, its contract, its three tables)
   is dead in the product.** It is one wiring decision away from live, and when it goes
   live it carries F-08 (guaranteed cross-store orphans) with it.
3. **F-09 — the own-port guard's own file documents the exact silent defeat the main
   listener commits today**, latent only because loopback is wholly refused for now.

Stable to build on; do not build on its documentation.
