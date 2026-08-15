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

**70 numbers issued, 69 live** (#68 withdrawn). Categories per
`../README.md` §4. Numbers are permanent, so this count only ever grows.
The section headings below are the authority for how many are in each state;
they are recounted whenever one moves.

### Solved — 32, plus #24b

Fixed and verified. Suite went 21 failures → 2 → **0**.
Baseline at close of Stage 1–2: `CI=true vitest run` → **69 files, 1138
passed, 2 skipped, 0 failed**; `tsc --noEmit` clean; `flue build` clean.
Baseline at close of Stage 3: **70 files, 1139 passed, 2 skipped, 0 failed**;
`tsc --noEmit` clean **with `noUnusedLocals`/`noUnusedParameters` on**;
`flue build --target node` clean.
Baseline after #70 and #69: **73 files, 1147 passed, 2 skipped, 0 failed**;
`tsc --noEmit` and `flue build --target node` clean.

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
| 69 | `ExecutionScope` had no agent dimension: `agentId` held Flue's per-thread instance id and `conversationId` derived a second copy of it, so a `duration: "always"` grant could not outlive the conversation that made it and was indistinguishable from `duration: "conversation"`. | **ADR 0038.** The agent is named (`contracts/agents.ts`), the thread id becomes the conversation, and `conversationId` loses its default so no caller can collapse the two again. The grant store did not change — it was correct and was being told the wrong thing. Mutation-verified: restoring `agentId: id` fails `tests/unit/agent-scope.test.ts`, which covers the call site where the defect actually lived. Existing rows are deliberately not migrated — see the ADR |
| 24b | `observability/index.ts` module singleton — the one #24 left behind. | **ADR 0037**, Accepted: it is a process resource, not an ambient default. Unlike the storage globals it has guarded init, an explicit shutdown that clears it, a redaction reset, and it throws when read before init. Those three properties are now tests; two are mutation-verified. No architecture whitelist was added — behaviour is checked instead of shape |
| 34 | `PassthroughContextOptimizer` never wired. | ADR 0003 stands; the register entry was wrong and `roadmap.md:65` was right. Marked declared-not-wired at the source alongside #31, and its test moved out of `architecture.test.ts` — filed there it read as a guarantee about the running system, which nothing wired can make |
| 65 | `routes/mcp.ts` composed registry with supervisor in the transport layer. | `f25d715`; the join moved into `McpManagementService` |

### Answered — 4, on 2026-08-15

Recorded here rather than folded away, per ADR 0036: a decision that cannot be
found later gets re-litigated. **One of the four went against the
recommendation**, and that one changes the shape of the cycle — see #15.

| # | Answer | What it changes |
|---|---|---|
| 14 | **Delete `STUDIO Gateway/`.** Answered as "you decide what's best, no need for wrongful code or dead code, or duplicated things", which is (b). | 163 tracked files removed in Stage 4. Recovery is real, not asserted: tags `snapshot/phases-1-11-pre-remediation` and `pre-phase5-snapshot` both contain the tree, verified present before deletion. |
| 15 | **Implement the real sandbox — (a), not the recommended (b).** Windows and Linux only; **macOS is explicitly out of scope**, not deferred-with-intent. Stated reason: *"Real sandbox, or else we're going to take the heavy weight of half or bad implementation once again."* | The largest single change left in the cycle. `SandboxFactory` behind the ADR 0035 ports, `ProcessContainer` on Windows, `bwrap` on Linux. Turns #15 from a one-line status correction into a stage of its own, and reverses the 008.1 refusal of MXC. Un-blocks #32 in the opposite direction: `unsupported_isolation` stops being dead code and becomes the error the factory throws. Also changes what #41 must say — the containment text is corrected to *not yet contained*, not to *uncontained by policy*, because policy is no longer the final answer. |
| 17 | **Delete the five broken `refs/codex/*` refs.** | Stage 4. All five verified unreachable-and-broken by `git for-each-ref` before removal. |
| 18 | **Keep root `README.md`, minimal.** | Stays; its stale claims are corrected under #41 rather than removed with the file. |

**On #15 going against the recommendation.** The recommendation was written on
the premise that ADR 0034 had already settled the policy, so only the word
"Done" was wrong. The answer rejects the premise rather than the reasoning:
shipping in-process containment and calling the question closed is the same
half-implementation the rest of this cycle exists to undo. That is consistent
with how #24, #35 and #42 were handled, and the recommendation was the less
consistent position. Recorded as the reason, so this is not re-argued later.

### Needs Decision — 2

Each states options and a recommendation. **These block the items that follow
them.**

| # | Issue | Options | Recommendation |
|---|---|---|---|
| 12 | **B-01 Flue admission idempotency.** The patch hijacks `submissionId` as `project-studio:${key}` from a header; Flue already has idempotent `dispatch({dispatchId})` with 409. Both patches are hand-diffs against `dist/*.mjs` pinned by content hash — a version bump drops them silently, which is exactly how #1 happened. | (a) upstream a public Flue admission key; (b) move to `dispatch({dispatchId})`; (c) **Accept** lost-ack-as-unknown for 1.0, delete the two idempotency patches, keep automatic retry off | **(c).** It is the honest 1.0 position, deletes the most fragile code in the tree, and 008.1 already documents unknown-never-retried as the contract. (a) is right long-term, but it is upstream work we do not control. |
| 13 | **Gateway contract.** Phase 7 cannot close. The Worker is unsupported and no contract test proves compatibility. | (a) decide the full contract now; (b) **declare Phase 7 Harness-side-only for 1.0** — `studio-cloud` is BYOK-local, hosted Gateway is out of 1.0 | **(b).** You have already said the Gateway is paused and will be rebuilt simpler. Deciding a contract for an implementation we intend to replace is work with no consumer. |

### Needs Implementation — 11

Agreed, understood, work remains.

**Architecture gate and correctness — closed.** #19–#29 and #63–#65 are in
Solved above. Every architecture whitelist is `[]` except one documented
framework boundary (ADR 0035 §6). `observability/index.ts:49` remains, folded
into #24 below.

**Dead code and hygiene**

| # | Issue |
|---|---|
| 31 | ~~`isRetryableForUnknown`~~ (deleted in `e9a018e`), `createRetryExecutionContext`, `executionContext()`. **Reclassified in Stage 3:** neither remaining export is accidental. `createRetryExecutionContext` is ADR 0033's `attemptId` and is now marked declared-not-wired at the source; `executionContext()` is the declared pair of `authContext()` and is kept. |
| 32 | `sandbox/errors.ts:9` `unsupported_isolation` — never thrown since ADR 0034. **No longer a dead-code item.** The #15 answer resolves it in the direction opposite to the one Stage 3 was waiting for: the kind is not deleted, it becomes the error `SandboxFactory` throws on a host that supports no OS backend. Moved to Stage 4b. The other half of the Stage 3 finding stands and is not affected — `unavailable` and `internal` are also never thrown, and `unavailable` is read by `SandboxError`'s own `retryable` computation, so removing it would change behaviour. |
| 66 | `tests/integration/stop.test.ts` carries two complete MCP stdio server fixtures used by no test. The file is titled "008.2 stop, timeout, cancellation, and disconnect" and none of its four tests involves an MCP tool — the timeout and MCP-tool-cancellation half of 008.2 was set up and never written. The fixtures now live in `tests/fixtures/mcp-servers.ts` so the evidence survives; **that move does not close this.** |
| 70 | **One intermittent suite failure, now with a mechanism rather than a shrug.** A full run reported `1 failed | 1141 passed` and the failing test was lost to a truncated log. It did not reproduce in **eight** further full runs. Repetition was then abandoned for measurement: five verbose runs give per-test durations, and two things fall out. **(a)** `harness.test.ts` set `STARTUP_BUDGET_MS` to 60s while six of its nine tests run under a 30s timeout — vitest killed those tests 30 seconds before the startup diagnostic could fire, so a slow boot could only ever surface as a bare "test timed out" with none of the pid/exit-code/stderr report the file goes to trouble to build. Fixed: the budget is 20s, and the invariant *budget < enclosing timeout* is now stated where it can be read. **(b)** Margins are thinner than they look: `recovers after SIGKILL` runs 53–59s against a 90s timeout while other tests in the same suite vary 4× run to run (2.8s→12.7s). A 1.6× slowdown blows it. Raising that timeout is **not** proposed here — the file argues against exactly that, and doing it without knowing which test failed would be masking. Left open pending a captured failure or the #61 CI matrix. |

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
Stage 0  Decisions                    ← ANSWERED: #16, #25-fixture, #14, #15,
   |                                       #17, #18. OPEN: #12, #13, #69
   ↓
Stage 1  Correctness #25-#29          ← DONE (e9a018e, f25d715)
   ↓
Stage 2  Architecture #19-#24         ← DONE (14b36df, f25d715, d66e844)
   ↓
Stage 3  Dead code #30-#35            ← DONE for #30/#33/#34/#35/#24b;
   |                                       #32 deferred into Stage 4b with #15
   ↓
Stage 4  Repo + docs #36-#42          ← acts on #14 (delete Gateway) and #17
   ↓
Stage 4b OS isolation #15 + #32       ← NEW, created by the #15 answer. Real
   |                                    `SandboxFactory`: Windows `ProcessContainer`,
   |                                    Linux `bwrap`, no macOS. Spike first.
   ↓
Stage 5  Phase work #49-#62           ← phase completion, not stabilization
   ↓
Stage 6  Final architecture + organization pass
   ↓
Stage 7  Fresh audit → fix → declare Phases 1-11 complete
```

**#41 moves out of Stage 4 and into the end of Stage 4b.** It corrects text
that calls connected MCP code "contained". Writing that correction before the
sandbox exists means writing it twice, and the second version would contradict
the first inside one cycle — which is the failure mode #42 is about. Everything
else in Stage 4 is independent of the sandbox and proceeds now.

**Stage 4b is a stage, not an item.** The #15 answer replaced a status
correction with a security boundary. It gets its own comparative plan and a
spike before any adoption: `@microsoft/mxc-sdk` is real and published (0.7.0,
verified on npm), but 008.1 refused it for reasons that have not evaporated —
`ProcessContainer` needs Windows 11 24H2+, `bwrap` is absent on many Linux
hosts, and the SDK is itself pre-1.0. The answer settles *that we build it*,
not *that the SDK works*; what happens on a host that supports neither is a
design question the plan has to answer rather than discover.

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
