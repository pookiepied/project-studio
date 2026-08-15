# Meta-task — Phases 1-11 remediation

**Status:** Active · **Opened:** 2026-08-15 · **Retires:** when §6 passes
**Supersedes:** task 008, tasks 005/006/007, `KNOWN-ISSUES.md`, `STATUS.md`,
the `C-NN` open-questions register, and the A/B/F/T nodes now in `archive/`.

**This is the single source of truth for the remaining Phase 1-11 work.** If an
item is not in the register below, we are not doing it. When this closes, its
durable residue moves to `architecture/`, `decisions/`, and `phases/`, and this
file moves to `archive/`.

---

## 1. Scope

**In:** everything required to make Phases 1-11 of the Studio Harness correct,
verified, organized, and safe to build on — functional defects, architectural
corrections, dead code, repository and documentation cleanup, and the decisions
those depend on.

**Out:** Phases 12-18. Product UI screens. The replacement Gateway
implementation. New capabilities (§5) — recorded so they are not lost, designed
later.

**Standing rule for this cycle:** no "later" pile. An issue found now is
resolved now, or gets a decision now. The only permitted deferrals are genuine
future features, and they live in §5 rather than as open issues.

## 2. Issue register

65 issues. Categories per `../README.md` §4. Numbers are permanent.

### Solved — 30

Fixed and verified. Suite went 21 failures → 2 → **0**.
Baseline at close of Stage 1–2: `CI=true vitest run` → **69 files, 1138
passed, 2 skipped, 0 failed**; `tsc --noEmit` clean; `flue build` clean.
Baseline at close of Stage 3: **70 files, 1139 passed, 2 skipped, 0 failed**;
`tsc --noEmit` clean **with `noUnusedLocals`/`noUnusedParameters` on**;
`flue build --target node` clean.

**The 2 skipped tests are platform gates, both healthy.** One is the
"keyring unavailable" branch, skipped *because* the OS credential store is
available and its six real tests ran. The other is the POSIX process-group
kill, which cannot run on Windows — its Windows counterpart (`taskkill /T`)
now has its own test, so the behaviour is covered on both platforms and
neither test is vacuous.

**Mutation-verified.** Each fix was reverted in place and the suite re-run to
confirm a test actually catches it. Eleven mutations: nine caught first time,
two survived and are recorded below (#28, #29) — #29 now has a test, #28 is
marked uncovered rather than claimed. One further gap found and closed: nothing
prevented the storage singleton returning to the file it was removed from.

| # | Issue | Proof |
|---|---|---|
| 1 | `@flue/runtime` patch called `parseIdempotencyKey()`, which exists in no version of beta.9. Every agent submission threw `ReferenceError`, was swallowed by the handler's catch, and returned 500. **No agent submission could succeed.** | `655bf58`; inline header read; hunk counts unchanged so the patch still applies |
| 2 | `LocalSandbox.exists()` throws outside the workspace; Flue calls `SessionEnv.exists` on *ancestor* dirs during `AGENTS.md` discovery, aborting the submission. Masked by #1. | `655bf58`; fixed at the adapter, sandbox rule left intact; `harness.test.ts` 0/8 → 7/8 |
| 3 | Development on a stale branch with 87 uncommitted files; no recoverable snapshot. | `95c99f6` + tag `snapshot/phases-1-11-pre-remediation`; `main` fast-forwarded, branch deleted |
| 4 | `StudioDatabase` exposed `handle: DatabaseSync`; any module could reach any domain's tables. | `edba5a5`; narrowed to `prepare`/`exec`; handle in a `WeakMap` behind `storageHandle()` |
| 5 | Architecture tests compared forward-slashed paths against native Windows paths — the 008.3 gate bound on **no file at all** on this platform. | `edba5a5`; one separator-agnostic helper; 33/33 pass |
| 6 | Four architecture tests asserted `offenders.length > 0` — green *because* the violation was present, and guaranteed to fail once fixed. | `edba5a5`; rewritten to `toEqual([])` or shrinking whitelists |
| 7 | No test enforced *table* ownership — only who held the connection. | `edba5a5`; new check scanning strings passed to `prepare`/`exec` |
| 8 | `application/ports.ts` — four port interfaces + `withCompensation`, **zero importers**; its `StoragePort` re-exposed the handle anyway. | `edba5a5`; deleted |
| 9 | UUID-centralization test had the same Windows path defect and reported the generator against itself. | `edba5a5` |
| 10 | No canonical documentation structure; competing sources of truth. | `397b624` + this restructure; `documentation/README.md` |
| 11 | Uncertain whether the repo was one Git repository or several. | Verified: one repo, one `.git`, no submodules. §4.1 |
| 16 | `pending_approval` durability — code and ADR disagreed. | `d66e844`; migration 009 + `PendingApprovalStore`; ADR 0036; 4 tests incl. cross-restart |
| 19 | `StudioRuntime` published 10 repositories. | `f25d715`; all ten private; `publicBags` whitelist is `[]` |
| 20 | `StudioRuntime` called `getDatabase()` for a process global. | `f25d715`; `database` is a required constructor option |
| 21 | `stop()` closed a connection it did not own; `app.ts` closed it again. | `f25d715`; `app.ts` is the sole owner |
| 22 | Transport and agents took the concrete runtime. | `f25d715`; transport takes `McpAdministration`; agents whitelist is `["agents/studio.ts"]`, a framework boundary per ADR 0035 §6 |
| 23 | `app_setting` written by two domains. | `14b36df`; `AppSettings` owns it; table-ownership whitelist is `[]` |
| 24 | Global singletons in `storage/database.ts`. | `f25d715`; `getDatabase`/`closeDatabase` deleted |
| 25 | Corrupt `studio.db` did not abort startup. | `f25d715`; **caused by #63** — with no graceful shutdown the WAL was never checkpointed, so a hot `-wal` survived and SQLite recovered from it. Fixing shutdown removes the stale sidecars; the test also removes them so it does not depend on that. Recovery and refusal each have a test in `storage.test.ts` (`e0f...` mutation-verified) |
| 26 | `mcp-runtime.test.ts` stdio tool through the gate failed. | `f25d715`; never an MCP failure — `stop()` returned while children were alive. See #64 |
| 27 | `outcomes.ts:35` accepted `idempotent` and never read it. | `e9a018e`; folded the dead `isRetryableForUnknown` into `outcomeFor` |
| 28 | `bounds.ts:84` — `signal.reason` not wrapped as `ToolError`. | `e9a018e`; translation to `ToolError` is covered and mutation-verified. The added `!signal.aborted` guard is **unreachable today and has no test** — marked as such in the source rather than counted as covered |
| 29 | `StudioRuntime` used `any` in `ModelToolResult`. | `e9a018e`; typed to text/image, and unsupported MCP blocks now degrade to text |
| 63 | No graceful shutdown on Windows. | `f25d715`; `SIGINT`/`SIGBREAK` + IPC `shutdown`; proven by a no-hot-WAL test |
| 64 | `stop()` returned with MCP children alive. | `f25d715`; `stop`/`stopAll`/`stop(id)` await real process exit |
| 30 | `tsconfig.json` set neither `noUnusedLocals` nor `noUnusedParameters`. | Stage 3; both on, tree clean. Note the correction in `stage-3-plan.md` §1: the flags catch **only** #33 — an *export* is invisible to them, so they were never going to enforce #31/#32/#34 |
| 33 | Unused imports in `observability/index.ts`, `permissions/trust.ts`, `tools/git/index.ts`. | Stage 3; those three plus six dead test-file locals the flags then surfaced |
| 35 | Unbounded sets in `studio-runtime.ts` and `tools/gate.ts`. | Stage 3. `studio-runtime.ts` fixed — see #67, they were one defect — and mutation-verified by `turn-boundary.test.ts`. **The `gate.ts` half of this issue was wrong and is withdrawn:** `#reportedWithheld` has a key space of (capabilities × switches), is per-`CallGate`, and dies with the sandbox |
| 67 | `TurnSnapshots` was rebuilt per Flue run, so its turn counter restarted and undo history repeated the label `"turn 1"`. | Stage 3; `#turns` (unkeyed `Set`) became `#turnSnapshots` keyed by project + conversation, so the entry is reused rather than replaced |
| 24b | `observability/index.ts` module singleton — the one #24 left behind. | **ADR 0037**, Accepted: it is a process resource, not an ambient default. Unlike the storage globals it has guarded init, an explicit shutdown that clears it, a redaction reset, and it throws when read before init. Those three properties are now tests; two are mutation-verified. No architecture whitelist was added — behaviour is checked instead of shape |
| 34 | `PassthroughContextOptimizer` never wired. | ADR 0003 stands; the register entry was wrong and `roadmap.md:65` was right. Marked declared-not-wired at the source alongside #31, and its test moved out of `architecture.test.ts` — filed there it read as a guarantee about the running system, which nothing wired can make |
| 65 | `routes/mcp.ts` composed registry with supervisor in the transport layer. | `f25d715`; the join moved into `McpManagementService` |

### Needs Decision — 6

Each states options and a recommendation. **These block the items that follow
them.**

| # | Issue | Options | Recommendation |
|---|---|---|---|
| 12 | **B-01 Flue admission idempotency.** The patch hijacks `submissionId` as `project-studio:${key}` from a header; Flue already has idempotent `dispatch({dispatchId})` with 409. Both patches are hand-diffs against `dist/*.mjs` pinned by content hash — a version bump drops them silently, which is exactly how #1 happened. | (a) upstream a public Flue admission key; (b) move to `dispatch({dispatchId})`; (c) **Accept** lost-ack-as-unknown for 1.0, delete the two idempotency patches, keep automatic retry off | **(c).** It is the honest 1.0 position, deletes the most fragile code in the tree, and 008.1 already documents unknown-never-retried as the contract. (a) is right long-term, but it is upstream work we do not control. |
| 13 | **Gateway contract.** Phase 7 cannot close. The Worker is unsupported and no contract test proves compatibility. | (a) decide the full contract now; (b) **declare Phase 7 Harness-side-only for 1.0** — `studio-cloud` is BYOK-local, hosted Gateway is out of 1.0 | **(b).** You have already said the Gateway is paused and will be rebuilt simpler. Deciding a contract for an implementation we intend to replace is work with no consumer. |
| 14 | **Delete `STUDIO Gateway/`?** 163 tracked files. Paused, not the intended architecture, but contains reusable pieces (provider catalog/discovery, auth and rate-limit middleware, SSE translation, usage projection). | (a) delete now; (b) **delete now, recover from git when the new Gateway starts**; (c) keep | **(b).** It is in git history and tagged; nothing is lost. Keeping 163 files of an architecture we have rejected is exactly the drift this cycle exists to stop. |
| 15 | **OS isolation (008.8).** Marked Done with 0% implementation — no `bwrap`, `ProcessContainer`, or Seatbelt code exists. | (a) implement `SandboxFactory` now; (b) **record Accepted**: in-process containment, uncontained-by-policy, honestly documented; implementation is a post-1.0 phase | **(b).** ADR 0034 already decided the policy; what is wrong is the word "Done". This is a scope correction, not new code. |
| 17 | **Broken `refs/codex/*` refs.** Five unreachable refs from another tool; git warns on every branch operation. Never previously documented. | (a) delete them; (b) keep | **(a).** They point at nothing reachable and are pure noise. Requires your go-ahead because ref deletion is destructive. |
| 18 | **Root `README.md`.** You asked whether it should go. | (a) delete; (b) **keep, minimal** | **(b).** It is the entry point for anyone opening the repository, and it is nine lines pointing at `documentation/`. Deleting it makes the repo open onto three unexplained folders. |

### Needs Implementation — 10

Agreed, understood, work remains.

**Architecture gate and correctness — closed.** #19–#29 and #63–#65 are in
Solved above. Every architecture whitelist is `[]` except one documented
framework boundary (ADR 0035 §6). `observability/index.ts:49` remains, folded
into #24 below.

**Dead code and hygiene**

| # | Issue |
|---|---|
| 31 | ~~`isRetryableForUnknown`~~ (deleted in `e9a018e`), `createRetryExecutionContext`, `executionContext()`. **Reclassified in Stage 3:** neither remaining export is accidental. `createRetryExecutionContext` is ADR 0033's `attemptId` and is now marked declared-not-wired at the source; `executionContext()` is the declared pair of `authContext()` and is kept. |
| 32 | `sandbox/errors.ts:9` `unsupported_isolation` — never thrown since ADR 0034. **Blocked on #15**, and larger than recorded: three kinds are never thrown, and one of them (`unavailable`) is read by `SandboxError`'s own `retryable` computation, so removing it changes behaviour. |
| 66 | `tests/integration/stop.test.ts` carries two complete MCP stdio server fixtures used by no test. The file is titled "008.2 stop, timeout, cancellation, and disconnect" and none of its four tests involves an MCP tool — the timeout and MCP-tool-cancellation half of 008.2 was set up and never written. The fixtures now live in `tests/fixtures/mcp-servers.ts` so the evidence survives; **that move does not close this.** |
| 70 | **One unidentified intermittent suite failure.** A full run on 2026-08-15 reported `1 failed | 1141 passed | 2 skipped` and the failing test was not captured — the run's output was truncated to its last six lines, which show only the totals. Four subsequent full runs on the same tree (one before the remaining Stage 3 work, three after) were green at `1145 passed | 2 skipped`. So: roughly one failure in five runs, identity unknown. Recorded rather than dismissed, because a suite that fails once in five is not a suite anything should be declared complete against, and §6.2 requires `pnpm check` to pass on two platforms. **Next full-suite run must be captured to a log in full**, not tailed. |
| 69 | **`ExecutionScope` has no agent dimension, and `always` cannot outlive a conversation.** Flue's initializer `id` is the agent *instance* — one per conversation thread — so `createAgentSandbox({ agentId: id })` puts a conversation identity in `agentId`, and `conversationId` derives a second copy of it. `grant-store.ts:108` filters on `agent_id`, so a `duration: "always"` grant is unreachable from any other conversation and is indistinguishable from `duration: "conversation"`. ADR 0015 keeps breadth and duration independent; duration currently has two values that mean the same thing. **Fails closed** — the user is asked again, never silently authorized — so this is correctness and approval fatigue, not a security defect. Pinned by `tests/unit/grant-identity.test.ts`. |

**Repository and documentation**

| # | Issue |
|---|---|
| 36 | Two documentation roots — `STUDIO HARNESS/docs/` and `documentation/`. **Resolved in this change**: ADRs, roadmap, known-issues and status moved to `documentation/`; `STUDIO HARNESS/docs/` deleted. Verify no path references broke. |
| 37 | Empty root `patches/` directory. Delete. **See §4.2 — the other two patches folders are load-bearing.** |
| 38 | `architecture/domain-ownership.md:30` says `bootstrap.ts:149` "will be moved in 008.3-04". It was not; the item is marked Done. |
| 39 | `architecture/api-inventory.md:3` says 3/5 Done; task 008 says 5/5. |
| 40 | `architecture/api-inventory.md:30` promises an `X-Project-Studio-API-Version: 1` header. `create-app.ts` has no such logic. Implement or stop documenting. |
| 41 | Stale containment claims in README, ADRs 0019/0022/0024 — 008.8 decided uncontained-by-policy, so text calling connected MCP code "contained" is false. |
| 42 | Over-claimed statuses in task 008 (008.3 Done-by-exception; 008.4 3/5 not 5/5; 008.4 B-01 against a build that never worked; 008.6 no migration; 008.8 0% implementation). Record the correction, do not silently re-tick. |

### Unable to Determine — 2

Investigated, not resolved. Recorded rather than dropped.

| # | Issue | What was tried / what is unknown |
|---|---|---|
| 44 | Whether `STUDIO/patches/@flue__sdk` (client) and `STUDIO HARNESS/patches/@flue__sdk` (harness) are identical or have diverged. Both are wired via `patchedDependencies`. Not diffed. |
| 45 | Whether the `@flue/cli` patch — which implements the FD-based admission bootstrap (§4.2) — is still required, or whether Flue beta.9 now offers a supported hook. Not investigated. |

### Withdrawn — 1

Filed, then disproved. Kept rather than deleted: the number is permanent, and
an issue that was wrong is worth as much as one that was right.

| # | Issue as filed | Why it is wrong |
|---|---|---|
| 68 | "Every conversation for the `studio` agent shares the id `conversation:studio`, so grants and approval scope are per *agent*." | Read from the default expression `` `conversation:${agentId}` `` rather than measured. Flue's initializer `id` is the agent **instance**, not the agent name — probed against a running harness across two threads, which reported `alpha` and `beta`, not `studio`. Conversations are isolated; the defect runs the other way and is #69. The probe also showed the initializer running **twice per submission**, independently corroborating #35/#67. |

### No Longer Relevant — 3

| # | Issue | Why |
|---|---|---|
| 46 | Task 008's Layer 1 clash-resolution table (C-01..C-10) and the 008.3-008.22 reordering. | It reordered work around a gate that was not closed and statuses that were not true. This register replaces it. |
| 47 | `KNOWN-ISSUES.md` letter series as a live register (64 entries, 10 Fixed / 1 Open / 1 Accepted, most undated). | Its open items are folded into this register. Archived. |
| 48 | The `A-NNN`/`B-NNN`/`F-NNN`/`T-NNN` node scheme introduced earlier today. | Its letters collided with `KNOWN-ISSUES`'s existing `T-NN`/`A-NN`/`D-NN` defect ids. Replaced by plain `#N`. Nodes archived. |

### Needs Implementation — Phase-work carried from task 008 — 14

The 165 open checklist items, grouped by their 008 section. Each is one issue
here; the sub-items stay readable in `archive/phase-11-mcp/008-*.md`. **These
come after #12-#42** — they are phase completion, not stabilization.

| # | 008 section | Items |
|---|---|---|
| 49 | 008.9 — Trust visibility, grants/approval API | 6 |
| 50 | 008.10 — Process/shell policy, snapshot/undo API | 8 |
| 51 | 008.11 — Provider registry, BYOK, streaming matrix | 8 |
| 52 | 008.12 — Observability: structured, failure, startup evidence | 9 |
| 53 | 008.13 — Gateway boundary | 14 — mostly closed by #13 |
| 54 | 008.14 — Native catalog, behavior, cross-platform, API | 11 |
| 55 | 008.15 — MCP management API and transport matrix | 9 |
| 56 | 008.16 — MCP handshake/catalog, availability-first ordering | 6 |
| 57 | 008.17 — MCP model exposure, results/trust | 5 |
| 58 | 008.18 — MCP lifecycle and Harness restart | 7 |
| 59 | 008.19 — MCP credential lifecycle, Host/client API | 6 |
| 60 | 008.20 — MCP platform matrix, scope, permission regression | 7 |
| 61 | 008.21 — Integration matrix, fault injection, release gate | 9 — Windows runner still absent |
| 62 | 008.22 — Documentation reconciliation and closure review | 6 — largely #36-#42 |

## 3. Execution order

Dependencies are real: each stage makes the next safe.

```
Stage 0  Decisions                    ← #16, #25-fixture ANSWERED; #12-#15, #17, #18 open
   ↓
Stage 1  Correctness #25-#29          ← DONE (e9a018e, f25d715)
   ↓
Stage 2  Architecture #19-#24         ← DONE (14b36df, f25d715, d66e844)
   ↓
Stage 3  Dead code #30-#35            ← DONE for #30/#33/#35; #32 blocked on #15,
   |                                       #34 on ADR 0003, #24b is a decision
   ↓
Stage 4  Repo + docs #36-#42          ← includes acting on #14 (Gateway)
   ↓
Stage 5  Phase work #49-#62           ← phase completion, not stabilization
   ↓
Stage 6  Final architecture + organization pass
   ↓
Stage 7  Fresh audit → fix → declare Phases 1-11 complete
```

**Stage 3 after Stage 2, not before.** Turning on `noUnusedLocals` while the
façade work is mid-flight produces errors for things about to be deleted
anyway.

**The whole-project organization pass is Stage 6, not now.** Your instinct is
right: reorganize around a stabilized implementation, or you reorganize twice.

## 4. Answers to the questions raised

### 4.1 Git structure — one repository

Verified, not assumed:

```
Project Studio/          ← ONE .git, no submodules, no .gitmodules
├── STUDIO HARNESS/      278 tracked files   plain directory
├── STUDIO/              129 tracked files   plain directory
├── STUDIO Gateway/      163 tracked files   plain directory
└── documentation/        39 tracked files
```

One branch, `main`. One history. Products are directories, not repositories —
they have no independent branches or commits, and a commit can span them.

Each product has its own `package.json` and `pnpm-workspace.yaml`, so they are
independent *builds* inside one repository. That is a normal monorepo and worth
keeping: the Harness and Client ship together and their contract changes in
lockstep.

### 4.2 The patches folders — do not delete

**The empty root `patches/` is safe to remove (#37). The other two are
load-bearing and deleting them breaks the build.**

| Folder | Contents | Status |
|---|---|---|
| `patches/` (root) | empty | **Delete** |
| `STUDIO HARNESS/patches/` | `@flue/cli`, `@flue/runtime`, `@flue/sdk` | **Required** — wired via `pnpm-workspace.yaml` `patchedDependencies` |
| `STUDIO/patches/` | `@flue/sdk` | **Required** — same mechanism |

The `@flue/cli` patch is not cosmetic: it implements the **FD-based admission
bootstrap**, reading the per-launch credential from a file descriptor so it
never appears in argv, env, logs, or a database. That is the 008.5 security
property. Removing it removes the credential channel.

The `runtime`/`sdk` patches carry the idempotency work — those two are what
decision #12 is about, and under recommendation (c) they go while the `cli`
patch stays.

### 4.3 Documentation — what changed

**Before:** two roots (`documentation/` and `STUDIO HARNESS/docs/`), ten
folders, and several competing registers — task 008, `KNOWN-ISSUES`, `STATUS`,
the `C-NN` questions, and the node scheme from earlier today.

**Now:** one root, five folders, one active register — this file. The system is
specified in `../README.md`: where each kind goes, what it contains, the format
for each, what "verified" requires, and why `audits/`, `blockers/`,
`follow-ups/`, `tasks/` and `tree/` are deliberately *not* folders.

The 34 ADRs moved to `documentation/decisions/`. Safe: code references them by
number ("ADR 0019"), never by path — verified by grep over `src/` and `tests/`.

Everything superseded is in `archive/` with a banner, including task 008, which
remains the readable detail behind issues #49-#62.

## 5. Future capability ideas — recorded, not scheduled

Out of scope for this cycle. Recorded here so they are not lost, and because
both have architectural implications worth knowing before Stage 6.

**RTK — tool-result compression.** `git`, `grep`, `glob` and similar produce
large outputs that consume context. Compress the result while keeping the
original retrievable.

*Architectural note:* this is the "output truncation versus artifact handles"
question already open in 008.14. It belongs at the `CallGate` result boundary,
where every native and MCP tool result already passes through one place — which
means the gate needs a result-projection seam it does not currently have.

**Execution guard — preconditions on tool calls.** Refuse an edit to a file the
agent has not read, and return a tool-level error saying what must happen
first.

*Architectural note:* this is a per-conversation *state* check, distinct from
permission (authority) and bounds (limits). The kernel decides authority and
holds no history. A guard needs conversation-scoped read/write facts, so it is
a fourth stage in the gate's order, not a rule inside the kernel.

Neither should be added as an isolated feature. Both want the same thing: a
gate that can carry state across calls within a conversation.

## 6. Closure conditions

This meta-task retires only when:

1. Every issue is **Solved**, **No Longer Relevant**, or explicitly **Accepted**
   with your confirmation and a recorded decision.
2. `CI=true pnpm check` passes in `STUDIO HARNESS` on Windows and Linux.
3. Every architecture whitelist is `[]` — no pinned violations remain.
4. No document describes behaviour the code does not have.
5. Phases 1-11 are **Verified** per `../README.md` §6, not merely implemented.
6. A fresh audit against the stabilized codebase finds nothing of this severity.

Then: durable residue to `architecture/`, `decisions/`, `phases/`; this file to
`archive/`; and the Tree System for future work is established on top of a
baseline that has earned it.
