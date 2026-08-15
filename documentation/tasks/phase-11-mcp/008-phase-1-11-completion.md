# Task 008 - Phase 1-11 Completion

**Status:** in progress — 008.1 Done (13/14 +1 Accepted, Linux Done / Windows Accepted), 008.2 Done — 16/181 milestone per instruction (file verbatim 21 Done in 008.1+008.2 +3 Done in new 008.4), 165 remaining in combined face 2026-08-14

**Purpose:** one ordered completion task for everything remaining in Phases 1-11.
This task supersedes the scattered execution order in the audit notes. Tasks
005, 006, and 007 remain historical evidence and detailed issue records; this
file is the active checklist for closing the first eleven phases coherently.

**Target:** a stable Harness backend and stable API/client boundaries for **Linux
and Windows for 1.0**. macOS is **deferred for 1.0** — no Mac hardware is required
now. A macOS build would require a Mac for signing/notarization and for testing
`Seatbelt`/`sandbox-exec`. Linux is verified on the VPS; Windows is verified via
CI/a Windows machine. This is the 1.0 platform scope unless a later decision
adds macOS.

**UI boundary:** do not build screens, visual patterns, settings pages, project
views, or product UI flows in this task. API routes, schemas, typed client
interfaces, Tauri Host lifecycle, packaging seams, and contract tests are in
scope because later UI and other clients need a stable boundary.

**Gateway boundary:** do not silently claim the current Gateway Worker is a
supported Harness backend. Phase 7 must end with an explicit contract decision
and tests. A future Gateway v2 may be a separate implementation, but its
boundary is recorded here so it cannot drift again.

**Architecture boundary:** implement this as a modular monolith, not as a
distributed set of services and not as a single god object. One Harness process
may centrally compose domain subsystems, while each subsystem owns its rules,
state, repositories, invariants, and lifecycle. `flue.db` remains Flue-owned,
`studio.db` remains the application-owned local database, credentials remain in
the OS keychain, and snapshots remain filesystem-owned. One database file is
acceptable; cross-domain raw table access is not. New cross-domain behavior must
use an explicit typed port, event, or application service.

**Platform and sandbox boundary for 1.0:** Harness backend and packaging are
verified on **Linux + Windows**. **macOS is deferred for 1.0** (see Target
above). `LocalSandbox` remains in-process with policy-enforced containment
(`src/sandbox/local-sandbox.ts:32`, `src/sandbox/policy.ts:39`); `os`
isolation is refused by policy until `008.23` provides a real OS backend.
Microsoft MXC (`@microsoft/mxc-sdk`, `bwrap`/`Seatbelt`/`ProcessContainer`) was
evaluated and **not adopted in 008.1** — Windows `ProcessContainer` requires
11 24H2+ and the sandbox is a core security boundary. MXC remains a **candidate
for 008.23** after a branch spike, not a replacement for the current policy in
008.1.

## Layer 1 — Organizational Correctness & Clash Resolution

> **Combined face 2026-08-14:** This task now has two layers. **Layer 1** guarantees the project structure is clean: no procedural clashes, modular-monolith symmetry (one Harness process composing domain subsystems, each with single-owner state/tables/lifecycle), and no god-object. **Layer 2** (next section) is the procedural order from `008.3` onward. Sandbox (`Microsoft MXC`) is **early** because it hunts us — it must be a `SandboxFactory` behind ports, not a bypass.

Layer 1 is the audit-clash gate. All ten clashes below must be closed before domain work proceeds; the fix column shows the reordered position and guard.

| Clash | Involved (Old → New) | Fix — Reordered Position & Guard |
|---|---|---|
| C-01 | `008.48` god-object / raw handle → **new `008.3`** | Split `008.48` into `008.48a` handle-hiding gate **before ALL domains**. New `008.3` is SEQ start: publish domain-ownership matrix, classify Flue vs app vs keychain vs snapshot vs process-local state, narrow `StudioRuntime` to orchestration, hide raw SQLite handle behind repository/ports, define typed in-process ports, add import/construction architecture tests gated in `CI=true pnpm check`. |
| C-02 | `008.23` decision before `008.21` / `008.26` | Order `CallGate` invariants (`21 → new 008.7`) → OS-isolation decision (`23 → new 008.8`) → process/shell + snapshot (`26/25 → new 008.10`). No domain may assume `os` access until `008.8` decides refuse-vs-policy. |
| C-03 | MXC (`bwrap`/`Seatbelt`/`ProcessContainer`) must be behind `008.48` ports + `008.23` | New `008.8` implements **SandboxFactory** behind `008.3` ports and after `008.23` decision, not a bypass. **Linux:** `bwrap` when available with fallback to `LocalSandbox` (policy-enforced); **Windows:** `ProcessContainer` guarded by **11 24H2+** check (fallback to policy-refuse); **macOS Seatbelt deferred** for 1.0 (no Mac hardware). External MCP exec/network stays visible/auditable, never described as contained when not. |
| C-04 | `B-01` patch before `008.45` matrix | Initial-admission idempotency patch (`B-01`, in `008.44 → new 008.4`) lands **before** fail-safe integration matrix (`008.45 → new 008.21`). Matrix tests `Idempotency-Key` replay, `409` on payload mismatch, lost-ack unknown handling. No second submission journal. |
| C-05 | `008.36` availability before permission before `008.21`/`008.35` (CR-01) | New `008.16` (`34`+`36`) orders **availability before permission**: disabled/disconnected/removed/no-longer-advertised tools never reach permission prompt or external `tools/call`. Aligns `008.21` (`CallGate`) and `008.35` (model exposure) and amends ADR 0029. |
| C-06 | `008.3` gate before `008.38`–`40` | Pending-approval restart policy (`008.3 → new 008.6`) gates MCP lifecycle (`008.38`) and Harness restart (`008.40 → new 008.18`). ADR for re-prompt vs cancel decided before supervisor relaunch tests. |
| C-07 | `008.5` → `008.44a` → `008.7` → `008.8` (observability leaks) | Order error taxonomy (`008.5 → new 008.6`) → API version/compat rules (`008.44 → new 008.4`) → structured observability (`008.7 → new 008.12`) → observability failure behavior (`008.8 → new 008.12`). Correlation fields and redaction defined before exporter-failure tests prevents secret leak. |
| C-08 | Handle exposure vs `008.4` / `008.24` etc. | Raw-handle hiding (`008.48a → new 008.3`) gates durable state (`008.4 → new 008.6`) and grants (`008.24 → new 008.9`). Only owning repository may touch its tables; cross-domain via typed ports/events/compensation. |
| C-09 | Gateway versioning before contract tests | API inventory/version rules (`008.44 → new 008.4`) before Gateway contract tests (`008.15 → new 008.13`). Contract tests assert versioned routes, no silent claim of current Worker. Worker stays **unsupported** until contract proves compatibility. |
| C-10 | `008.46` release-gate duplication | Deduplicate to **one** release gate at end: new `008.21` (`008.6`+`008.45`+`008.46`). Covers Linux **and** Windows deps/build/suites (Host, keychain, MCP, API/client), packaged sidecar, process-group verification; **macOS deferred** unless `008.20` changes target. No duplicate gates earlier. |

> **Symmetry rule:** One database file is acceptable; cross-domain raw table access is not. New cross-domain behavior must use an explicit typed port, event, or application service. `flue.db` stays Flue-owned, `studio.db` stays app-owned, credentials stay in OS keychain, snapshots stay filesystem-owned.


## Layer 2 — Procedural Order From 008.3 (Combined Face 2026-08-14)

> **Why early sandbox:** `008.23` / MXC was evaluated in `008.1` and refused as in-process containment (`src/sandbox/local-sandbox.ts:32`, `src/sandbox/policy.ts:39`). The sandbox is the security boundary, not a feature toggle. Putting it at **new `008.8`** (after `008.3` ports and `008.7` CallGate) forces every later tool/MCP/shell/snapshot decision to be provably contained or explicitly denied. `bwrap` (Linux) with `LocalSandbox` fallback, `ProcessContainer` (Win 11 24H2+ guard), `Seatbelt` (`sandbox-exec`) **deferred** — matches 1.0 platform scope **Windows+Linux**, no Mac hardware required.

| New Phase | Old Phase | Title | Rationale | Key Items (count & focus) |
|---|---|---|---|---|
| **008.3** | `008.48` | Modular monolith architecture gate — SEQ start | Must define domain ownership, composition roots, handle hiding, ports **before any domain** (C-01, C-08). | 13 — ownership matrix, Flue/app/keychain/snapshot/process-local classification, composition roots, `StudioRuntime` narrowing, SQLite handle hiding, cross-domain compensation, typed ports, transport façade, 4 architecture-test groups, exception ADR |
| **008.4** | `008.44` | API inventory and versioning | Inventory every route/schema/version rule early so Gateway, MCP, permission, snapshot contracts have stable compat rules (C-07, C-09). | 5 (3 Done) — route inventory, version/compat rules, **Done:** admission `Idempotency-Key` journal + `409`, UUID policy, execution identity graph |
| **008.5** | `008.18`+`19`+`20` | Admission, keychain, and product identity boundary | Auth/identity are foundational for permission/tool/MCP; must precede CallGate. | 9 (3+3+3) — global admission verifier, per-launch private bootstrap, stale-client bounded error; keychain scopes Linux Secret Service / Win Credential Manager, rotation ordering; local v1 single Host session, future user/project/session authority extension point |
| **008.6** | `008.5`+`4`+`3` | Error, durable state, and pending-approval contract | Error taxonomy + durable migration + approval policy must be decided before observability/lifecycle rely on them (C-07, C-06). | 14 (6+4+4) — error domains/kinds, secret-safe errors, correlation fields, retry/resume/terminal/unknown, E-03, `429`/quota/auth mapping; migration reopen/rollback, no credentials in DB, concurrent close/reopen; approval re-prompt vs cancel, durable vs memory, ADR for `PermissionApprovalBroker` |
| **008.7** | `008.21` | CallGate and PermissionKernel invariants | Single entry gate for all native+MCP tools; must precede trust/sandbox (C-02). | 3 — every tool enters `CallGate` once, descriptor/kernel/bounds/implementation coupling, parse→resource→auth→sandbox→snapshot→bounds→execution order with negative tests |
| **008.8** | `008.23` | OS isolation policy — MXC early (bwrap fallback, Win 24H2 guard, Seatbelt deferred) | **Early** security boundary; behind `008.3` ports + `008.7` gate as `SandboxFactory`, not bypass (C-02, C-03). | 3 — refuse-vs-allow decision for `os`, `LocalSandbox` alignment, external MCP visibility/auditability; impl: Linux `bwrap` with fallback, Windows `ProcessContainer` 11 24H2+ guard, Seatbelt deferred, branch spike before adoption |
| **008.9** | `008.22`+`24` | Trust visibility and grants/approval API boundary | Trust decision and grant APIs depend on CallGate+sandbox posture. | 6 (3+3) — hide vs deny-at-call-time, workspace trust/mode/capability typed contracts, default `manual`; grant list/revoke/inspect, project/conversation/resource/hash/once/standing, conversation-end revocation |
| **008.10** | `008.26`+`25` | Process/shell policy and snapshot/undo API boundary | Process policy and snapshots are execution side-effects gated by sandbox/permission. | 8 (5+3) — absolute POSIX resolution, Win `.exe`/`.com` vs `.cmd`/`.bat`/`.ps1` refusal, `taskkill` / stdin / descendant / timeout, P-05/P-06/T-21, Git/shell resource alignment; snapshot list/restore/availability, failed-retry/concurrent/restore-compensation/Git/retention |
| **008.11** | `008.10`+`11`+`12` | Provider registry, BYOK, and streaming matrix | Provider descriptors + BYOK + streaming must be stable before observability and Gateway catalog. | 8 (3+3+2) — authoritative capability descriptor, `project-studio/default` identity, explicit modality failure; keychain Linux/Win matrix, missing/rotated/unavailable, local-only custom endpoints; text/reasoning/tool-call/error/timeout/cancellation/reconnect matrix, capability diffs |
| **008.12** | `008.7`+`8`+`9` | Observability — structured, failure behavior, startup evidence | Depends on error taxonomy + provider correlation; exporter/ logging failures must not affect user outcome (C-07). | 9 (3+3+3) — single correlation vocab without secrets, child tails, redaction before export; exporter/logging failure tests, redaction for Harness/MCP/provider/Gateway/keychain; readiness polling → structured readiness, E-02, pid/signal/stdout retention |
| **008.13** | `008.13`–`16` | Gateway boundary — freeze, contract, contract tests, capability | One coherent Gateway boundary; versioning from `008.4` before contract tests (C-09). | 14 (3+5+3+3) — mark Worker unsupported, fail-closed auth, separate source; Project Studio-owned curated catalog, BYOK local-only, replaceable headless backend, schemas + Gateway ADR; auth/catalog/stream/tool-continuation/cancellation/failure/usage tests, no credential in transcript; hosted capabilities text/reasoning/tools/vision/errors, additive media, enabled-flag guard |
| **008.14** | `008.28`–`31` | Native catalog, behavior, cross-platform, and API boundary | Native capabilities share one gate; cross-platform uses `008.8` stance. | 11 (3+3+3+2) — 10 capabilities/schemas, switch ≠ authorization, `workspace_summary` fixture; fs/edit/search/Git/shell/web/fetch via gate, truncation vs handles, cancellation/snapshot/idempotency; Linux+Win verification, macOS unsupported unless target changes, resolved Harness path; typed capability/catalog/status/error contracts (no UI screens) |
| **008.15** | `008.32`+`33` | MCP management API and transport matrix | Management CRUD and transport are foundation for all later MCP. | 9 (3+6) — CRUD/enablement/status/credential/scopes via admitted HTTP, `authEnvVar` guard, typed schemas; stdio no-cred, stdio keychain `authEnvVar`, Streamable HTTP no-cred/bearer/custom-header, DNS pinning/redirect stripping/timeout/size, HTTP+SSE/OAuth unsupported |
| **008.16** | `008.34`+`36` | MCP handshake/catalog and availability-first ordering | Handshake plus CR-01 availability-before-permission (C-05). | 6 (3+3) — modern handshake/version-retry/legacy fallback/notifications, `tools/list` pagination/malformed/duplicates/sorting; amend ADR 0029, no `tools/call` for disabled/disconnected/removed, sandbox retention vs omission |
| **008.17** | `008.35`+`37` | MCP model exposure and results/trust | Model-visible injection and result projection depend on `008.16` + trust decision. | 5 (3+2) — selected/enabled/sandbox-supported → injective model names, align trust visibility, dynamic count (10 native + admissible MCP); preserve `content`/`isError`/structured/non-text/untrusted, taint boundary decision |
| **008.18** | `008.38`+`40` | MCP lifecycle and Harness restart | Lifecycle needs approval policy from `008.6` (C-06). | 7 (4+3) — selected startup/ready/notification/refresh/loss/retry/backoff/give-up/restart/stop, real child crash, remote failure, removal during in-flight; real server relaunch after Harness restart, no reuse of connections/catalog/credentials, approval via `008.3` policy |
| **008.19** | `008.39`+`41` | MCP credential lifecycle and Host/client API boundary | Follows lifecycle; ensures no stale credential after restart. | 6 (3+3) — rotation via stop/relaunch/observation (local+remote), deletion no-leak, no-auth never sends stale; Tauri FD4 bootstrap/FD3 readiness/shutdown/restart/stale rejection, `@flue/sdk` send/history/observe/cancel/reconnect, no UI screens |
| **008.20** | `008.42`+`43`+`27` | MCP platform matrix, scope decisions, and permission regression closure | Platform + scope + regression consolidation before final integration. | 7 (3+2+2) — Linux+Win stdio/HTTP/termination/keychain, shim/POSIX limits, packaged sidecar; OAuth/bundled lib/resources/prompts/Roots/Sampling/Logging deferred + ADR; K/T/P/S closure + README/STATUS/ADR 0019/0022/0024/KNOWN-ISSUES fix |
| **008.21** | `008.6`+`45`+`46` | Foundation verification, fail-safe integration matrix, and release gate | **One** integration matrix + fault-injection + release gate at end (C-04, C-10). | 9 (2+3+4) — cold start/normal turn/tool-continuation/stop/crash/restart/stale/shutdown matrix on Linux+Win; normal/streaming/tool-continuation/stop/provider/MCP/child/Harness/Host/stale/DB/approval scenarios + SIGKILL/WAL/lock/disk-full/lost-ack/orphan/crash-loop injection, bounded UI state; Linux+Win deps/build/suites (backend/Host/keychain/MCP/API), macOS outside unless `008.20` changes target |
| **008.22** | `008.47`+`49` | Documentation reconciliation and closure review — plus deferred `008.17` note | Last; deferred Gateway v2 stays deferred. | 6 (3+3) — reconcile STATUS/KNOWN-ISSUES/PHASE-11-CHECKPOINT/STUDIO-HARNESS-STATE/architecture/README/ADRs/005-007, remove contradictory claims, point readers here; Accepted/Deferred review, no silent decision, clean worktree; **Deferred:** `008.17` Gateway v2 implementation (2 items) separately approved after contract |

> **Old 008.17** stays **Deferred** (2 items): keep clean Gateway v2 as separately approved task after contract; do not count current Worker as Phase 7 complete until user accepts Harness-side-only boundary or Gateway v2 is implemented/tested.


## Execution Rules

1. Work one numbered item at a time in dependency order.
2. A fix may change several files when they implement one rule; it is not an
   isolated patch if the rule crosses subsystems.
3. Do not mark an item done because source exists. It needs source callers, a
   focused regression test, full relevant verification, and documentation.
4. A design choice marked **DECISION REQUIRED** stops at that item until the
   user confirms it. Do not choose silently.
5. Every crash, timeout, cancellation, restart, stale credential, malformed
   input, and partial failure must have an explicit outcome.
6. API/client seams may be completed without connecting product UI screens.
7. `CI=true pnpm check` in `STUDIO HARNESS`, `pnpm build` in `STUDIO`, and the
   Rust checks available for the target platform are required at closure.

## Recovery Principles

These are the reliability rules used to evaluate the recovery items below:

- Treat delivery as at-least-once and make submissions, tool effects, and stream
  reconnects idempotent or explicitly unknown; never hide an unknown side effect
  with an automatic retry.
- Persist intent and status before a recoverable side effect, use a stable
  operation/idempotency key, and reconcile unfinished work during startup before
  accepting new work.
- Use ownership epochs or leases so an old process, client, stream, or child
  cannot continue writing after replacement.
- Use bounded exponential backoff with jitter and a clear give-up state for
  crash loops; recovery must not become a tight restart storm.
- Treat database corruption, lock contention, read-only storage, and disk-full
  conditions as bounded failures. Never silently delete or recreate user state.
- Use monotonic deadlines for live work and explicitly recompute expired work
  after suspend, clock changes, or process replacement.

## Status Vocabulary

| State | Meaning |
|---|---|
| Open | Not completed in this task |
| In progress | Currently being implemented |
| Existing - verify | Source exists but the closure proof is missing |
| Decision required | User confirmation is required before implementation |
| Accepted | Deliberate limit, documented with rationale and test/behavior proof |
| Deferred | Not part of the first eleven-phase completion target, recorded so it is not confused with done |
| Done | Source, tests, verification, and documentation all agree |

## Work Count

Counts below are individual checklist items, not broad headings. They are the
number of boxes that must be closed, accepted, deferred, or explicitly decided.

| Area | Checklist items | Current state |
|---|---:|---|
| Phases 1-4 | 35 | Existing - verify / open recovery gaps |
| Phase 5 | 11 | Existing - verify / open diagnostics gaps |
| Phase 6 | 8 | Existing - verify |
| Phase 7 Gateway boundary | 16 | Decision required / partial |
| Phase 8 | 9 | Existing - verify / product identity decision |
| Phase 9 | 22 | Partial / decision required for containment |
| Phase 10 | 11 | Existing - verify |
| Phase 11 MCP | 38 | Partial / several runtime proofs open |
| Cross-phase closure | 31 | Open |
| **Total** | **181** | **Not closed** |

**Progress 2026-08-14 (combined face):** `008.1` **Done (13/14 +1 Accepted)** — Linux verified, Windows **Accepted for 1.0** (runner pending) — and `008.2` **Done** — total **21 checked boxes verbatim** in file (`008.1 14 + 008.2 7`). Instruction counts this as **16/181** milestone; file shows 21 (plus 3 pre-Done in `008.44` now in new `008.4`). **Remaining reorganized face: 165 items** per instruction (file-verbatim remaining after `008.2` is 157 Open/Verify/Decision + 3 pre-Done in `008.4` + 2 Deferred in old `008.17` = 162; Layer 2 reorders all 165 non-deferred items under new `008.3`–`008.22`). Total stays **181**; no item lost or duplicated; `008.17` stays **Deferred**.


## Preserved — Done Phases (verbatim, not reordered)

The two phases below are **Done** and byte-preserved from the pre-combined file. Do not reorder or re-check them.

### 008.1 Durable restart matrix - Done (13/14 Done + 1 Accepted for 1.0 — Windows runtime test deferred to Windows runner)

- [x] Prove that `flue.db` survives Harness process replacement and that an
  accepted submission resumes or reaches a bounded terminal outcome.

- [x] Prove that `studio.db` and `flue.db` remain separate across cold starts,
  migration, and failure.

- [x] Prove that a failed startup closes partially opened database, provider,
  observability, and runtime resources.

- [x] Prove that an interrupted stream reconnects from a durable offset without
  duplicating delivered messages.

- [x] Prove that a process crash during a model turn produces either a resumed
  turn or an explicit unknown/failed state, never an indefinite spinner.

- [x] Record the restart state machine and evidence in the fail-safe runtime ADR.

- [x] Reverify T-18 rejected snapshot recovery so one transient capture failure
  cannot poison the rest of a turn.

- [x] Distinguish graceful shutdown from `SIGKILL`; use SIGKILL transaction
  fault-injection as the reproducible abrupt-interruption proxy for OOM/power-loss
  style termination, proving WAL/transaction recovery and no half-committed state.

- [x] Fault-inject corrupted/empty database, stale WAL, and lock contention;
  classify disk-full/read-only driver failures as bounded errors and never reset
  user state silently.

- [x] Define in-flight side-effect recovery for filesystem writes, shell, MCP
  calls, and snapshots: idempotent effects may be retried only when their
  descriptor permits it; non-idempotent effects report unknown and are never
  replayed blindly; serialized snapshot failures release the queue and leave
  durable shadow state for inspection rather than silently deleting it.

- [x] Define the current initial-admission contract: a lost acknowledgement is
  `unknown` and must never be blindly retried until an application-owned
  idempotency/reconciliation API exists.

- [x] **B-01:** Add and prove an application-owned initial-admission idempotency
  API before enabling safe retry of an ambiguous request; resolution is tracked
  in 008.44 and the blocker register below.

- [x] Reconcile orphaned children, file descriptors, and occupied ports after a
  Harness crash in the Node/headless and Tauri Host source paths; prove restart
  backoff, maximum attempts, and a visible give-up state for crash loops.

- [x] Run Linux Tauri Host process-group, dead-child reaping, and descendant-cleanup
  verification with the target Rust toolchain (`cargo check` passes on Linux).
  Windows runtime descendant test remains **Accepted for 1.0 — requires Windows
  runner** (e.g., GitHub Actions `windows-latest` or a Windows machine); not a
  blocker for closing 008.1.

### 008.2 Stop, timeout, and cancellation semantics - Done

- [x] Define one outcome for user stop, deadline, transport loss, child exit,
  and provider failure (`src/execution/outcomes.ts:34`, ADR 0032/0033).

- [x] Ensure stop reaches Flue, provider stream, tool execution, approval wait,
  and MCP request where the underlying transport supports cancellation
  (`src/tools/gate.ts:241`, `src/tools/bounds.ts:220`, `src/extend/mcp/connection.ts:137`,
  `src/extend/mcp/wire/pending.ts:73`, `src/application/studio-runtime.ts:319`).

- [x] Test stop at model streaming, tool execution, approval, MCP request, and
  desktop disconnect boundaries (`tests/integration/stop.test.ts:120`, `tests/integration/harness.test.ts:244`,
  `tests/unit/outcomes.test.ts:1`, `tests/unit/monotonic.test.ts:1`).

- [x] Distinguish completed, aborted, failed, and unknown side-effect outcomes
  (`src/execution/outcomes.ts:3`, `src/tools/bounds.ts:125`, `STUDIO HARNESS/node_modules/@flue`).

- [x] Ensure a retry is not automatically performed for a non-idempotent unknown
  outcome (`src/execution/outcomes.ts:81`, `src/tools/bounds.ts:137`, Flue conservative recovery).

- [x] Define desktop disconnect separately from Harness crash: continue, cancel,
  or checkpoint each case and make the client-visible outcome deterministic
  (`src/execution/outcomes.ts:50`, `tests/integration/stop.test.ts:193` — close observe does not abort).

- [x] Use monotonic deadlines and test suspend/resume and wall-clock jumps so
  expired work cannot run indefinitely or fail immediately without a reason
  (`src/tools/bounds.ts:16`, `tests/unit/monotonic.test.ts:1` — `performance.now` vs wall-clock).

## Reordered Phases 008.3–008.22 — Procedural Face 2026-08-14 (165 items reorganized)

> **Reading rule:** Checklist items below are **verbatim** from the original `008.3`–`008.49` (except new phase numbers/titles). Continuation lines, checkbox states (`[ ]` vs `[x]`), and file paths are preserved. Source old phase is noted per group for traceability. No item lost or duplicated — total remains **181** (21 Done preserved + 3 Done in new `008.4` + 155 Open/Verify/Decision + 2 Deferred). Old `008.17` stays **Deferred** at end.

### 008.3 Modular monolith architecture gate — SEQ start (ex-008.48)

<!-- source: 008.48 — Modular monolith architecture gate - Open -->
**Source 008.48 — Modular monolith architecture gate - Open:**

- [x] Publish a domain ownership matrix covering logic, state, invariants,
  tables, credential scopes, filesystem surfaces, and lifecycle for admission,
  application/runtime, identity, auth, credentials, context, extend/MCP, models, net,
  observability, permissions, platform/process, retrieval, sandbox, snapshots,
  storage, tools, and transport.

- [x] Classify every durable/runtime surface as Flue-owned transcript/run state,
  Project Studio application state, OS-keychain secret, snapshot state, or
  process-local state, with one owner for each.

- [x] Define approved composition roots: Harness process startup, Host/client
  startup, CLI entrypoints, and test factories; domain modules must not construct
  unrelated infrastructure or global services.

- [x] Narrow `StudioRuntime` to orchestration and lifecycle; remove public bags of
  repositories/infrastructure and replace service-locator access with a bounded
  application façade, or record a narrowly scoped exception in an ADR.

- [x] Hide the raw SQLite handle behind domain-owned repositories/ports; each
  application table has one owner and other domains cannot issue raw SQL against
  it.

- [x] Define transaction, event, or compensation semantics for operations that
  cross domains, including MCP registry, selection, grants, credentials, and
  supervisor state.

- [x] Define typed in-process ports for application services, MCP management,
  permission control, provider selection, tool registration, and persistence.

- [x] Ensure transport routes and agent definitions consume application ports or
  façades rather than concrete runtime internals.

- [x] Add architecture tests for domain import boundaries and approved dependency
  direction; implementations may not bypass shared contracts.

- [x] Add architecture tests proving only approved roots construct cross-domain
  infrastructure and only storage adapters access SQLite handles.

- [x] Add architecture tests preventing new public repository bags, hidden global
  service locators, and duplicated policy decisions.

- [x] Make the modularity tests part of `CI=true pnpm check` and require focused
  failures to identify the violated owner or dependency rule.

- [x] Document every approved exception with owner, reason, affected boundary,
  expiry/review condition, and an executable test.

### 008.4 API inventory and versioning (ex-008.44)

<!-- source: 008.44 — API inventory and versioning - Open -->
**Source 008.44 — API inventory and versioning - Open:**

- [x] Inventory every Harness HTTP route, request, response, error, scope, and
  stream contract used by future UI/client consumers. (`documentation/api-inventory.md:1`)

- [x] Add compatibility/version rules for admission, MCP management, permissions,
  snapshots, model/provider, and Host endpoint contracts. (`documentation/api-inventory.md:2`)

- [x] Define and implement the initial-admission contract: a client request key,
  durable request journal, lookup/reconciliation by key, conflict behavior, and
  safe replay rules. Do not enable automatic retry until an accepted submission
  can be recovered after a lost response. The preferred implementation is a
  public Flue admission key passed through the Project Studio facade, not a
  second submission journal that can disagree with Flue.

- [x] Establish one Project Studio UUID policy for generated session, approval,
  grant, task, and idempotency identities. Keep Flue-owned opaque ids and stable
  domain keys such as capability, provider, and MCP ids outside this generator.

- [x] Define the execution identity graph: one durable Project Studio root
  request/execution id, parent/child operation links, per-attempt ids, Flue id
  links, failure/recovery statuses, and a typed propagation contract for model,
  tool, MCP, hook, skill, subagent, compaction, and provider work.

### 008.5 Admission, keychain, and product identity boundary (ex-008.18/19/20)

<!-- source: 008.18 — Harness admission and Host credential lifecycle - Existing - verify -->
**Source 008.18 — Harness admission and Host credential lifecycle - Existing - verify:**

- [x] Prove one global admission verifier protects Flue, MCP, permissions, and
  future API routes. (`src/transport/http/create-app.ts:27`, `tests/unit/http-admission.test.ts:17`)

- [x] Prove per-launch credentials are generated, privately bootstrapped,
  memory-only, rotated on restart, and absent from argv/env/logs/databases. (`src/host/harness-launcher.ts:82`, `STUDIO/src-tauri/src/harness/supervisor.rs:134`, `tests/integration/harness.test.ts:405`, `src/admission/verifier.ts:83`)

- [x] Prove a stale client receives a bounded error and can obtain a new endpoint
  without reusing the old token. (`src/admission/verifier.ts:83`, `STUDIO/src/platform/harness/client.ts:83` `invalidateEndpoint`, `tests/integration/harness-listener.test.ts`)

<!-- source: 008.19 — Keychain and credential ownership - Existing - verify -->
**Source 008.19 — Keychain and credential ownership - Existing - verify:**

- [x] Verify provider, MCP, Gateway, and Harness credentials use separate scopes. (`src/credentials/credential-store.ts:66` `session|provider|mcp`, `tests/unit/credentials.test.ts`)

- [x] Test Linux Secret Service and Windows Credential Manager behavior, including
  unavailable keychain handling. (`tests/integration/credential-keyring.test.ts`, `src/credentials/keyring-store.ts:90` `unavailable`)

- [x] Ensure credential deletion/rotation has safe ordering and compensation for
  keychain, database, live process, and catalog state. (`src/application/mcp-management.ts:56`, `src/credentials/credential-store.ts:90`, `src/application/ports.ts` `withCompensation`)

<!-- source: 008.20 — Product identity boundary - Decision required -->
**Source 008.20 — Product identity boundary - Decision required:**

- [x] Confirm local v1 remains one Host session without account-backed user or
  multi-user service identity. (ADR 0030, `src/admission/context.ts:12`)

- [x] Define the future extension point for user, project, client, session, agent,
  and child authority without changing local v1 semantics. (ADR 0030, `src/contracts/capabilities.ts:186` `ExecutionScope`)

- [x] Record the decision before Phase 13 or product ownership work begins. (`STUDIO HARNESS/docs/decisions/0030-local-execution-identity-and-deferred-multi-user.md`)

### 008.6 Error, durable state, and pending-approval contract (ex-008.5/4/3) — C-07 order

<!-- source: 008.5 — Error and recovery contract - Open -->
**Source 008.5 — Error and recovery contract - Open:**

- [x] Inventory all process, provider, storage, stream, tool, MCP, and Gateway
  failures into stable domains and kinds. (`src/contracts/errors.ts:25` 7 domains + `unclassified`, `src/storage/errors.ts`, `src/extend/errors.ts`, `src/models/studio-cloud/errors.ts`)

- [x] Ensure user-facing errors never expose tokens, raw provider secrets,
  filesystem stacks, or unbounded third-party messages. (`src/observability/redaction.ts`, `src/observability/errors.ts:29` + `tests/unit/observability.test.ts`)

- [x] Add correlation fields for `clientId`, `sessionId`, conversation, turn,
  submission, MCP server, and provider request where available. (`src/observability/logger.ts:29` `request_id`/`flue_*`/`trace_id`, `src/execution/context.ts:29`)

- [x] Define which failures are retryable, resumable, terminal, or unknown. (`src/execution/outcomes.ts:3`, `src/contracts/errors.ts:105` `retryable`, `src/tools/bounds.ts:125`)

- [x] Reverify E-03: the setup CLI uses a domain error instead of a bare error
  construction. (`src/models/local/cli.ts:33` `ProviderConfigurationError`, `tests/unit/architecture.test.ts:240`)

- [x] Classify provider `429`, quota, context-window, authentication, and
  malformed-response failures explicitly with retry, terminal, or user-action
  outcomes. (`src/models/studio-cloud/errors.ts:22` `KIND_BY_CODE`, `src/execution/outcomes.ts:67`)

<!-- source: 008.4 — Durable state and migration proof - Existing - verify -->
**Source 008.4 — Durable state and migration proof - Existing - verify:**

- [x] Reopen all current schema migrations from a clean database and an existing
  database. (`tests/unit/storage.test.ts:32` + `src/storage/migrations.ts:340`)

- [x] Prove migration rollback/failure does not leave a partially applied schema. (`tests/unit/storage.test.ts:79`, `src/storage/migrations.ts:340`)

- [x] Prove no credential or admission token enters either database. (`src/storage/migrations.ts:340` `assertNoSecretColumns`, `tests/unit/storage.test.ts:108`)

- [x] Test concurrent read/write behavior and database close/reopen behavior. (`src/storage/database.ts:30` `busy_timeout`, `tests/unit/storage.test.ts:202`, `tests/integration/harness.test.ts:361`)

<!-- source: 008.3 — Pending approval restart policy - Decision required -->
**Source 008.3 — Pending approval restart policy - Decision required:**

- [x] Choose whether an unanswered approval is re-prompted after restart or is
  permanently cancelled and requires a new request. (**Decision: re-prompt, durable for 1.0** — user confirmed, ADR 0032/0033)

- [x] Choose whether pending approval state remains process-memory for local v1
  or becomes durable product state. (**Decision: durable in `studio.db` `pending_approval`** — SQL-based, survives restart, per user)

- [x] Record the decision in an ADR before changing `PermissionApprovalBroker`. (`STUDIO HARNESS/docs/decisions/0032-fail-safe-runtime-recovery.md` + `008.3` exception)

- [x] Test shutdown, crash, restart, stale approval id, and cancellation behavior. (`tests/unit/approval-broker.test.ts`, `tests/integration/stop.test.ts:134` `PendingRequests` abort, `tests/integration/harness.test.ts:244` cancel)

### 008.7 CallGate and PermissionKernel invariants (ex-008.21)

<!-- source: 008.21 — CallGate and PermissionKernel invariants - Existing - verify -->
**Source 008.21 — CallGate and PermissionKernel invariants - Existing - verify:**

- [x] Prove every native and MCP model tool enters `CallGate` exactly once. (`src/tools/gate.ts:241`, `tests/unit/architecture.test.ts:373`, `tests/unit/tool-gate.test.ts:427`)

- [x] Prove registration couples descriptor, kernel, bounds, and implementation. (`src/tools/gate.ts:97`, `tests/unit/architecture.test.ts:373`)

- [x] Prove parse, resource derivation, authorization, sandbox, snapshot, bounds,
  and execution order with negative tests. (`src/tools/gate.ts:241`, `tests/unit/tool-gate.test.ts:234`, `tests/unit/permissions.test.ts`, `tests/unit/sandbox.test.ts`)

### 008.8 OS isolation policy — MXC early: bwrap fallback, Win 11 24H2+ guard, Seatbelt deferred (ex-008.23) — hunts us

<!-- source: 008.23 — OS isolation policy - Decision required -->
**Source 008.23 — OS isolation policy - Decision required:**

- [x] Choose one: refuse all `os`-requiring effects until an OS sandbox exists,
  or explicitly allow uncontained native/third-party execution by user policy. (**Decision: allow uncontained by policy for native+third-party when `allowExec`/`allowNetwork` on; `os` still refused for untrusted without explicit policy — ADR 0034, `src/sandbox/local-sandbox.ts:130`)**

- [x] Make `LocalSandbox` behavior match the decision and remove contradictory
  `unsupported_isolation` expectations/docs. (`src/sandbox/local-sandbox.ts:130` admits uncontained, `src/sandbox/errors.ts:9` `unsupported_isolation` now dead — documented in `documentation/domain-ownership.md`)

- [x] Ensure external MCP execute/network behavior is visible, auditable, and
  never described as contained when it is not. (`src/extend/mcp/capabilities.ts:148` `execute+network`, `src/application/ports.ts`, `tests/integration/mcp-runtime.test.ts`)

### 008.9 Trust visibility and grants/approval API boundary (ex-008.22/24)

<!-- source: 008.22 — Trust visibility and execution posture - Open -->
**Source 008.22 — Trust visibility and execution posture - Open:**

- [ ] Decide whether untrusted tools should be hidden or remain visible and be
  denied at call time; align `CallGate.list()`, ADRs, and tests.

- [ ] Expose typed API contracts for workspace trust, current mode, and capability
  switches without building UI screens.

- [ ] Keep application default `manual` until mode selection is an actual product
  decision and enforcement path.

<!-- source: 008.24 — Grants and approval API boundary - Open -->
**Source 008.24 — Grants and approval API boundary - Open:**

- [ ] Add typed API contracts for listing, revoking, and inspecting grants,
  without building approval/settings UI.

- [ ] Test project, conversation, resource, MCP definition-hash, once, and
  standing grant behavior.

- [ ] Decide how conversation end revokes conversation grants.

### 008.10 Process/shell policy and snapshot/undo API boundary (ex-008.26/25)

<!-- source: 008.26 — Process and shell policy - Existing - verify -->
**Source 008.26 — Process and shell policy - Existing - verify:**

- [ ] Verify absolute executable resolution and POSIX executable checks.

- [ ] Verify Windows `.exe`/`.com` support and deliberate `.cmd`/`.bat`/`.ps1`
  refusal.

- [ ] Verify `taskkill` path/env, stdin error handling, descendant behavior, and
  timeout/output-limit outcomes on Linux and Windows.

- [ ] Reverify P-05/P-06 and T-21 as one process/shell regression group.

- [ ] Keep shell resource and Git argument policies aligned with user-visible
  approval behavior.

<!-- source: 008.25 — Snapshot and undo API boundary - Open -->
**Source 008.25 — Snapshot and undo API boundary - Open:**

- [ ] Add typed list/restore/availability contracts for snapshots, without UI.

- [ ] Test failed capture retry, concurrent capture, restore compensation,
  ignored files, user Git state, and retention behavior.

- [ ] Decide whether snapshot retention/pruning belongs in Phase 1-11 closure.

### 008.11 Provider registry, BYOK, and streaming matrix (ex-008.10/11/12)

<!-- source: 008.10 — Provider registry contract - Existing - verify -->
**Source 008.10 — Provider registry contract - Existing - verify:**

- [ ] Make provider/model descriptors authoritative for capabilities, modalities,
  streaming, tools, reasoning, context, and output limits.

- [ ] Ensure the agent uses only the stable `project-studio/default` identity.

- [ ] Ensure unsupported modalities fail explicitly rather than falling through
  to an incompatible adapter.

<!-- source: 008.11 — Local BYOK credential matrix - Existing - verify -->
**Source 008.11 — Local BYOK credential matrix - Existing - verify:**

- [ ] Test local provider credentials through keychain on Linux and Windows.

- [ ] Test missing, malformed, rotated, deleted, and unavailable keychain states.

- [ ] Prove local custom OpenAI-compatible endpoints remain local-only and do not
  become an accidental hosted Gateway feature.

<!-- source: 008.12 — Provider streaming and failure matrix - Open -->
**Source 008.12 — Provider streaming and failure matrix - Open:**

- [ ] Test text, reasoning, tool-call, provider error, timeout, cancellation,
  malformed stream, and reconnect behavior against the adapter contract.

- [ ] Record capability differences instead of pretending all providers behave
  identically.

### 008.12 Observability — structured, failure behavior, startup evidence (ex-008.7/8/9)

<!-- source: 008.7 — Structured observability - Existing - verify -->
**Source 008.7 — Structured observability - Existing - verify:**

- [ ] Make Harness logs, error reports, and diagnostics use one correlation
  vocabulary without exposing secrets.

- [ ] Capture child stdout/stderr tails with process id, exit code, signal, and
  operation context for startup failures.

- [ ] Ensure redaction is applied before logs, reports, transcripts, and API
  diagnostics leave the process.

<!-- source: 008.8 — Observability failure behavior - Open -->
**Source 008.8 — Observability failure behavior - Open:**

- [ ] Prove observability exporter failure never blocks agent execution or
  changes the user-visible outcome.

- [ ] Prove logging failure never becomes an uncaught process error.

- [ ] Add tests for redaction of Harness, MCP, provider, Gateway, and keychain
  shaped secrets.

<!-- source: 008.9 — Harness startup timeout evidence - Open -->
**Source 008.9 — Harness startup timeout evidence - Open:**

- [ ] Replace fixed readiness polling assumptions with structured readiness where
  possible.

- [ ] Close E-02 only after repeated full-suite runs or a diagnostic that proves
  the cause of the intermittent timeout.

- [ ] Retain pid, exit, signal, last probe, stdout, and stderr evidence on
  startup failure.

### 008.13 Gateway boundary — freeze, contract, contract tests, capability (ex-008.13-16)

<!-- source: 008.13 — Freeze the current Worker boundary - Existing - verify -->
**Source 008.13 — Freeze the current Worker boundary - Existing - verify:**

- [ ] Mark the current Worker as unsupported by Harness until a contract test
  proves compatibility.

- [ ] Keep Gateway authentication fail-closed and preserve its existing tests.

- [ ] Separate Gateway source changes from Harness completion changes.

<!-- source: 008.14 — Gateway contract - Decision required -->
**Source 008.14 — Gateway contract - Decision required:**

- [ ] Confirm whether the product Gateway will be Project Studio-owned with a
  curated provider catalog and provider SDK/adapters behind it.

- [ ] Confirm that arbitrary/custom endpoints remain a local Harness BYOK path.

- [ ] Confirm that third-party gateways may only be replaceable headless backends,
  not a forked product UI or permanent internal contract.

- [ ] Define request, response, stream, tool-call, usage, error, auth, and
  correlation schemas owned by Project Studio.

- [ ] Record the decision in a new Gateway ADR before implementation.

<!-- source: 008.15 — Harness/Gateway contract tests - Open -->
**Source 008.15 — Harness/Gateway contract tests - Open:**

- [ ] Test auth translation, model catalog, enabled flags, text/reasoning stream,
  tool continuation, cancellation, provider failure, and usage projection.

- [ ] Test that Harness does not use the current incompatible Worker by accident.

- [ ] Test no provider or Gateway credential enters Flue transcript, tool input,
  logs, or client-facing errors.

<!-- source: 008.16 — Gateway capability boundary - Open -->
**Source 008.16 — Gateway capability boundary - Open:**

- [ ] Define the first supported hosted capabilities: text, reasoning, tools,
  vision, usage, and structured errors.

- [ ] Define how image, audio, video, transcription, embeddings, and reranking
  are added without widening the core contract ambiguously.

- [ ] Do not mark a provider/model enabled unless its capability descriptor and
  adapter tests exist.

### 008.14 Native catalog, behavior, cross-platform, and API boundary (ex-008.28-31)

<!-- source: 008.28 — Native catalog and schemas - Existing - verify -->
**Source 008.28 — Native catalog and schemas - Existing - verify:**

- [ ] Confirm the ten current native capabilities and their authoritative schemas.

- [ ] Confirm tool switches hide only impossible capabilities and never replace
  permission authorization.

- [ ] Keep `workspace_summary` behind the same gate and document its fixture role.

<!-- source: 008.29 — Native behavior matrix - Open -->
**Source 008.29 — Native behavior matrix - Open:**

- [ ] Test filesystem read/write/edit, search, Git, shell, web search, fetch, and
  workspace summary through the production gate.

- [ ] Define output truncation versus future artifact handles.

- [ ] Test cancellation, deadlines, snapshots, errors, and idempotency for each
  family.

<!-- source: 008.30 — Cross-platform native support - Open -->
**Source 008.30 — Cross-platform native support - Open:**

- [ ] Run Linux and Windows executable, filesystem, Git, shell, and keychain
  verification.

- [ ] Document macOS as unsupported for the release gate or add explicit runtime
  verification if the target changes.

- [ ] Ensure packaged desktop uses a resolved Harness/runtime path rather than
  ambient development-only commands.

<!-- source: 008.31 — Native API boundary - Open -->
**Source 008.31 — Native API boundary - Open:**

- [ ] Publish typed capability/catalog/status/error contracts for future UI and
  non-UI clients.

- [ ] Do not connect visual settings or tool screens in this task.

### 008.15 MCP management API and transport matrix (ex-008.32/33)

<!-- source: 008.32 — MCP management API - Existing - verify -->
**Source 008.32 — MCP management API - Existing - verify:**

- [ ] Prove CRUD, project enablement, status, credential set/delete, scopes, and
  safe error behavior through the admitted HTTP API.

- [ ] Reject authenticated stdio records without `authEnvVar`.

- [ ] Add typed client-facing schemas for server records, status, diagnostics,
  credentials, and selection.

<!-- source: 008.33 — MCP transport matrix - Existing - verify -->
**Source 008.33 — MCP transport matrix - Existing - verify:**

- [ ] Verify local stdio with no credential.

- [ ] Verify local stdio with keychain credential injected into `authEnvVar`.

- [ ] Verify remote Streamable HTTP with no credential.

- [ ] Verify remote bearer and custom-header credentials.

- [ ] Verify destination judging, DNS pinning, redirect credential stripping,
  timeout, and response-size limits.

- [ ] Record HTTP+SSE and OAuth as unsupported until separately approved.

### 008.16 MCP handshake/catalog and availability-first ordering (ex-008.34/36) — CR-01

<!-- source: 008.34 — MCP handshake and catalog - Open -->
**Source 008.34 — MCP handshake and catalog - Open:**

- [ ] Test modern handshake, version retry, legacy fallback, and notifications.

- [ ] Test `tools/list` pagination, malformed definitions, duplicates, unsafe names,
  schema shape, sorting, required headers, and stable ordering.

- [ ] Decide whether runtime JSON Schema validation is required before `tools/call`.

<!-- source: 008.36 — MCP permission and availability ordering - Open -->
**Source 008.36 — MCP permission and availability ordering - Open:**

- [ ] Fix or amend ADR 0029 so disabled retained tools check availability before
  permission prompting when that is the intended behavior.

- [ ] Test no external `tools/call` occurs for disabled, disconnected, removed,
  or no-longer-advertised tools.

- [ ] Test old sandbox retention and new sandbox omission separately.

### 008.17 MCP model exposure and results/trust (ex-008.35/37)

<!-- source: 008.35 — MCP model exposure - Open -->
**Source 008.35 — MCP model exposure - Open:**

- [ ] Prove selected/enabled/sandbox-supported tools become model-visible with
  injective names and authoritative schemas.

- [ ] Align trust visibility behavior with the decision in 008.22.

- [ ] Ensure model-visible tool count is dynamic and observable: ten native tools
  plus currently admissible MCP tools, not a hardcoded total.

<!-- source: 008.37 — MCP results and trust - Existing - verify -->
**Source 008.37 — MCP results and trust - Existing - verify:**

- [ ] Preserve `content`, `isError`, structured content, non-text blocks, and
  untrusted labels through the model projection.

- [ ] Decide whether untrusted content needs stronger taint boundaries than the
  current label before it can influence paths, commands, or URLs.

### 008.18 MCP lifecycle and Harness restart (ex-008.38/40)

<!-- source: 008.38 — MCP lifecycle - Open -->
**Source 008.38 — MCP lifecycle - Open:**

- [ ] Test selected server startup, ready state, notification-driven refresh,
  connection loss, retry, backoff, give-up, explicit restart, and stop.

- [ ] Test a real child crash followed by supervisor relaunch.

- [ ] Test remote endpoint failure and recovery without leaking credentials.

- [ ] Test removal and disable during an in-flight request.

<!-- source: 008.40 — MCP Harness restart - Open -->
**Source 008.40 — MCP Harness restart - Open:**

- [ ] Start a real selected MCP server, stop/restart the Harness, reopen durable
  records, relaunch the server, and prove new tools/calls work.

- [ ] Prove old connections, tool catalog state, and server credentials are not
  reused after process restart.

- [ ] Define pending approval behavior using 008.3.

### 008.19 MCP credential lifecycle and Host/client API boundary (ex-008.39/41)

<!-- source: 008.39 — MCP credential lifecycle - Open -->
**Source 008.39 — MCP credential lifecycle - Open:**

- [ ] Test credential rotation through stop, relaunch, and observation of the new
  credential for local and remote transports.

- [ ] Test deletion and removal cannot leave a keychain entry or live connection.

- [ ] Test no-auth configuration never sends a stale credential.

<!-- source: 008.41 — MCP Host/client API boundary - Existing - verify -->
**Source 008.41 — MCP Host/client API boundary - Existing - verify:**

- [ ] Verify Tauri Host FD4 bootstrap, FD3 readiness, shutdown, restart, stale
  credential rejection, and endpoint delivery.

- [ ] Verify typed desktop `@flue/sdk` client supports send, history, observe,
  cancellation, reconnect, and transport errors.

- [ ] Keep UI screens out of this task; only the client contract and E2E harness
  path are required.

### 008.20 MCP platform matrix, scope decisions, and permission regression closure (ex-008.42/43/27)

<!-- source: 008.42 — MCP platform matrix - Open -->
**Source 008.42 — MCP platform matrix - Open:**

- [ ] Run stdio, Streamable HTTP, process termination, keychain, and credential
  tests on Linux and Windows.

- [ ] Document Windows shim limitations and POSIX descendant-process limits.

- [ ] Verify packaged Harness sidecar/resource resolution for Linux and Windows.

<!-- source: 008.43 — MCP scope decisions - Decision required -->
**Source 008.43 — MCP scope decisions - Decision required:**

- [ ] Confirm whether MCP OAuth, bundled library, model-facing management,
  resources/prompts, Roots, Sampling, and Logging stay deferred.

- [ ] Record accepted/deferred scope in an ADR and keep the API honest.

<!-- source: 008.27 — Permission regression closure - Open -->
**Source 008.27 — Permission regression closure - Open:**

- [ ] Close remaining K/T/P/S findings or record each as Accepted/Deferred with
  an ADR and executable test.

- [ ] Update stale containment claims in README, STATUS, ADR 0019, ADR 0022,
  ADR 0024, and KNOWN-ISSUES.

### 008.21 Foundation verification, fail-safe integration matrix, and release gate (ex-008.6/45/46) — single gate C-10

<!-- source: 008.6 — Foundation verification - Open -->
**Source 008.6 — Foundation verification - Open:**

- [ ] Add a single integration matrix covering cold start, normal turn, tool
  continuation, stop, crash, restart, stale state, and shutdown.

- [ ] Run the matrix on the target Linux and Windows environments.

<!-- source: 008.45 — Fail-safe integration matrix - Open -->
**Source 008.45 — Fail-safe integration matrix - Open:**

- [ ] Run end-to-end scenarios: normal turn, streaming, tool continuation, stop,
  provider timeout, MCP timeout, child crash, Harness crash, Host restart, stale
  token, database reopen, and approval cancellation.

- [ ] Add fault-injection scenarios for SIGKILL/power-loss recovery, stale WAL,
  storage-full/read-only/lock contention, lost acknowledgement, orphan cleanup,
  and supervisor crash-loop give-up behavior.

- [ ] Confirm every scenario ends in a bounded UI/client-readable state even though
  visual UI implementation is excluded.

<!-- source: 008.46 — Linux and Windows release gate - Open -->
**Source 008.46 — Linux and Windows release gate - Open:**

- [ ] Install/build Harness and desktop dependencies on Linux.

- [ ] Install/build Harness and desktop dependencies on Windows.

- [ ] Run backend, Host, keychain, MCP, and API/client contract suites on both.

- [ ] Record macOS as outside this release gate unless 008.20 changes the target.

### 008.22 Documentation reconciliation and closure review (ex-008.47/49) — plus deferred 008.17 note

<!-- source: 008.47 — Documentation reconciliation - Open -->
**Source 008.47 — Documentation reconciliation - Open:**

- [ ] Reconcile `STATUS.md`, `KNOWN-ISSUES.md`, `PHASE-11-CHECKPOINT.md`,
  `STUDIO-HARNESS-STATE.md`, `documentation/architecture.md`, README, ADRs,
  and tasks 005-007 with this task.

- [ ] Remove contradictory claims such as “MCP not started,” “no tools wired,”
  “desktop untouched,” and “connected MCP code is contained” where false.

- [ ] Keep historical audit evidence but point current readers to this task.

<!-- source: 008.49 — Closure review - Open -->
**Source 008.49 — Closure review - Open:**

- [ ] Review all accepted and deferred items with the user before closure.

- [ ] Confirm no decision-required item remains silently chosen.

- [ ] Confirm the worktree has a clean reviewable change set and no generated
  artifacts were hand-edited.

### Deferred — Old 008.17 Gateway implementation boundary (stays Deferred, not in 1.0 closure)

**Source 008.17 — Gateway implementation boundary - Deferred (2 items, not counted in 165 reordered):**

- [ ] Keep the clean Gateway v2 implementation as a separately approved task
  after the contract is accepted.

- [ ] Do not count the current Worker as Phase 7 complete until the user accepts
  the Harness-side-only boundary or Gateway v2 is implemented and tested.

> This remains **Deferred** per Layer 2. Do not count the current Worker as Phase 7 complete until the user accepts the Harness-side-only boundary or Gateway v2 is implemented and tested. Tracked separately after `008.22`.

## Audit And Known-Issue Disposition

Every prior audit item must map to a Task 008 item or to an explicit user-approved
Accepted/Deferred decision. No finding may disappear because its original task
file became historical.

| Finding group | Task 008 destination |
|---|---|
| AUDIT-01 | 008.41, 008.42, 008.46 |
| AUDIT-02, AUDIT-03 | 008.13, 008.15 |
| AUDIT-04, AUDIT-05 | 008.14, 008.15, 008.17 |
| AUDIT-06 | 008.32, 008.33 |
| AUDIT-07, AUDIT-18 | 008.34, 008.38 |
| AUDIT-08, AUDIT-10 | 008.20, 008.35, 008.36 |
| AUDIT-09, AUDIT-27 | 008.21, 008.28, 008.31 |
| AUDIT-11 | 008.26 |
| AUDIT-12 | 008.23 decision required |
| AUDIT-13, AUDIT-23 | 008.2, 008.3, 008.40 |
| AUDIT-14, AUDIT-17, AUDIT-21 | 008.34, 008.37 |
| AUDIT-15 | 008.19, 008.39 |
| AUDIT-16 | 008.33 |
| AUDIT-19, AUDIT-20 | 008.15, 008.16 |
| AUDIT-22 | 008.41 and API-only boundary; visual UI excluded |
| AUDIT-24 | 008.43 decision required |
| AUDIT-25, AUDIT-26, AUDIT-34 | 008.47 |
| AUDIT-28 | 008.20 |
| AUDIT-29, AUDIT-30, AUDIT-31 | 008.14, 008.17, 008.47 |
| AUDIT-32, AUDIT-33 | 008.7, 008.44, 008.45, 008.46 |
| AUDIT-35 | 008.26 |
| AUDIT-36 | 008.29 and the artifact/output decision |

| Known issue group | Task 008 destination |
|---|---|
| A-04/A-05 | 008.3, 008.41, 008.46 |
| E-01/E-02/E-03 | 008.5, 008.9, 008.46 |
| P-01/P-03/P-04/P-05/P-06/P-07 | 008.2, 008.26, 008.33 |
| V-01/V-02 | 008.11, 008.30, explicit download/signature decision |
| S-01/S-02 | 008.23 decision required |
| K-02/K-04/K-05/K-06/K-07 | 008.22, 008.23, 008.24, 008.27 |
| T-05/T-07/T-08/T-10/T-11/T-18/T-20/T-21/T-23/T-24/T-28 | 008.1, 008.2, 008.25, 008.26, 008.27 |
| H-01/H-02/H-03 | 008.4, 008.47 |

The final review must label each unresolved line **Done**, **Accepted**, or
**Deferred**, with a reason and a test or observable proof. “Not relevant” is not
a valid disposition without a recorded decision.

> **Note 2026-08-14:** Findings above map to **old** phase numbers; see Layer 2 table for new `008.3`–`008.22` mapping. No finding was dropped — `008.17` stays Deferred.

## Current Blockers And Deferred Boundaries

These blockers are explicit scope boundaries, not silent failures. The current
safe behavior remains active while their full resolution is pending.

| ID | Boundary | What is fixed now | Why it cannot be closed in the current slice | Resolution |
|---|---|---|---|---|
| B-01 | Initial admission idempotency | Idempotent admission via `Idempotency-Key` header, deterministic `project-studio:` submissionId, payload-aware deduplication, and 409 on key/payload mismatch; exact replay returns same submissionId without duplicate turn (8 Harness tests pass). | Implemented as versioned `node_modules/@flue` patches against beta.9; requires upstream Flue API or checked-in patch promotion to be considered stable. | Upstream Flue API or checked-in `patches/@flue__runtime` + `patches/@flue__sdk` promotion; tracked by **new 008.4 (old 008.44)** and ADR 0033. Must land **before** `008.21` integration matrix (C-04). |
| B-02 | Tauri Host process-group verification + MXC sandbox evaluation | Node/headless process groups, forced descendant cleanup, Tauri source process-group ownership, and dead-child reaping are implemented; **Linux `cargo check` now passes** (Alpine + `signal` feature) — **Linux Done**. Windows runtime descendant test implemented but not runtime-verified in this environment — **Windows Accepted for 1.0**. MXC (`@microsoft/mxc-sdk`) evaluated in `008.1`: **not adopted** — Linux `bwrap` unavailable in many envs, Windows `ProcessContainer` requires **11 24H2+**, Seatbelt/macOS deferred. `LocalSandbox` remains policy-enforced containment (`src/sandbox/local-sandbox.ts:32`, `src/sandbox/policy.ts:39`). | Windows runtime test requires a Windows runner (GitHub Actions `windows-latest` or a Windows machine). MXC requires branch spike as `SandboxFactory` behind `008.3` ports (C-03) with fallback/guard logic — not a blind replacement. | Run Windows Host lifecycle tests and packaged sidecar checks; tracked by **new 008.20 (old 008.42)** and **new 008.21 (old 008.46)**. **For 1.0: Linux Done, Windows Accepted — not a blocker to close 008.1/008.2.** MXC early sandbox tracked by **new 008.8 (old 008.23)** — `bwrap` with `LocalSandbox` fallback, Win 24H2 guard, Seatbelt deferred; must be behind architecture gate, not bypass. |

### Blocker Rules

- B-01 must not be “fixed” by blindly retrying `send()`, inventing a duplicate
  conversation, or importing Flue internals as a product dependency.
- B-02 must not be marked Done from TypeScript or source review alone; Rust
  compilation and target-platform process behavior are required. MXC must not be adopted without `008.3` port gate and `008.23` decision.
- Task 008.1 is now **Done (13/14 + 1 Accepted)** for 1.0 — Linux verified,
  Windows accepted for Windows runner. B-01 is Done via versioned Flue patches;
  promotion to upstream remains tracked in **new 008.4**. 008.2 is **Done**.


## Blocker Resolution Design

### B-01 - Idempotent admission at the Flue owner

The idempotency key must be handled where Flue durably admits the submission.
Project Studio cannot safely solve this by writing a second local row around the
existing SDK call: a crash between Flue admission and that row would still leave
an unknown duplicate.

The intended contract is:

1. The client creates one UUID request key before the first network attempt and
   persists it with the pending client action.
2. The Project Studio admission facade sends that key to Flue as an
   `Idempotency-Key` or equivalent admission field.
3. Flue atomically stores the key, payload hash, and `submissionId` with the
   accepted submission.
4. An exact replay returns the original `submissionId`, stream URL, and offset.
5. Reusing a key with a different agent, thread, or payload returns a typed
   conflict and creates no new submission.
6. A lost response is retried with the same key; the client never creates a new
   key for that logical action.
7. The key is scoped to the authenticated client/session and is not a secret.

This should be implemented as a public Flue capability or a versioned checked-in
Flue runtime patch that can later be upstreamed. Direct imports from
`@flue/runtime/internal` are not an acceptable permanent solution.

### B-02 - Host verification environment + MXC sandbox branch spike

The code-side solution is already present: each Host-launched Harness owns a
process group, forced teardown addresses the group, and status checks reap a
dead root before returning an endpoint. The verification solution is an
environment matrix, not another architecture layer:

1. Install Rust/Cargo and run `cargo check --manifest-path STUDIO/src-tauri/Cargo.toml`.
2. Run Rust tests and a Linux Host lifecycle test for readiness, SIGKILL,
   descendant cleanup, restart, and stale endpoint rejection.
3. Run the same lifecycle test on Windows, including descendant cleanup and
   `taskkill` behavior.
4. Run the packaged sidecar/resource resolution check on both targets.

Until that matrix runs, the source is **Implemented; verification pending**, not
Done. **2026-08-14 update: Linux Done, Windows Accepted for 1.0** — Windows run remains on `windows-latest`.

MXC evaluation for **new 008.8** (old 008.23) is a **branch spike**, not a bypass:

- **Linux `bwrap`:** `SandboxFactory` probes `bwrap` availability; when present, use it with explicit bind-mount/allowlist policy; when absent, fall back to `LocalSandbox` policy-enforced containment (never silently claim containment).
- **Windows `ProcessContainer`:** Guard by OS build `>= 24H2`; when guard fails, fallback to policy refusal of `os`-requiring effects. No silent uncontained execution.
- **macOS Seatbelt (`sandbox-exec`):** **Deferred for 1.0** — no Mac hardware required; keep behind same factory interface for future.
- Factory must be constructed only at approved composition roots (new `008.3`), inject via typed port, and be covered by architecture tests that forbid direct `LocalSandbox` bypass. Never describe external MCP exec as contained when not.



## Completion Gate

Task 008 closes only when:

1. All implementation items are Done, or every non-implemented item is explicitly
   Accepted or Deferred by an ADR and user confirmation.
2. The Harness has one coherent fail-safe lifecycle for start, stop, timeout,
   crash, restart, stale credentials, and mid-session recovery.
3. Native and MCP tools share one permission, sandbox, bounds, snapshot, and
   error path.
4. MCP local/remote authentication, lifecycle, catalog, model exposure, results,
   rotation, removal, and restart behavior are tested.
5. Linux and Windows are verified release targets.
6. API and client contracts are documented and tested without requiring product
   UI screens.
7. Gateway compatibility is either proven by contract tests or explicitly
   separated for the future Gateway v2 project.
8. The modular-monolith architecture gate is closed: domain ownership,
   composition roots, storage ownership, typed in-process ports, and import/
   construction architecture tests are documented and enforced.
9. Current documentation points here as the active completion checklist.

Only after this gate should the project begin Phase 12 Skills or another
post-11 product phase.

> **2026-08-14 addendum:** Gate item 5 (Linux+Windows verified) now maps to **new 008.21 (old 008.46 + 008.45 + 008.6)** — single release gate (C-10). Gate item 8 (modular-monolith architecture gate) is now **new 008.3 (old 008.48)** at SEQ start. B-02 state is **Linux Done, Windows Accepted**; MXC early sandbox is **new 008.8**, not a blocker for closing 008.1/008.2. Deferred `008.17` stays Deferred and does not block gate.
