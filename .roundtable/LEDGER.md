# Ledger

Append-only. Newest at the bottom. One entry per iteration, written by the lead
after adjudication — never by the implementer.

Each entry records what the gate said, not what an agent claimed.

---

## 2026-07-10 — Bootstrap

**Not a queue item.** Established the gate before any loop iteration, on the
principle that a queue without a gate produces confident unverified diffs faster.

**Doc purge.** Deleted 32 files / 11,091 lines: `Documentation/Unimportant Docs/`,
`Documentation/Tasks/Frontend Organize/`, `Documentation/Tasks/Project Studio Version 2/`.
Verified beforehand that no code outside `Documentation/` referenced them. Kept: the two
loop-engineer prompts and `Documentation/Tasks/Local Runtime and Frontend Reorg/`.
Recoverable from git history.

**Gate built.** Added `typecheck`, `deadcode`, `ratchet:lint`, `ratchet:cycles`, and
`gate` scripts to `STUDIO/package.json`. Added `STUDIO/scripts/ratchet.mjs`,
`STUDIO/knip.json`, and baselines in `STUDIO/gate/`.

Ratchets are strict — lint per-file, cycles per-cycle — because a total-only ratchet
lets an agent fix five violations in one file, add one in another, and report green.

`ratchet.mjs` invokes tool bin scripts via `process.execPath` rather than `npx`: Node
refuses to `execFile` a `.cmd` shim on Windows without a shell, and a shell would put
this repo's spaced path through cmd.exe quoting.

**Gate proven to fail.** Injected a raw `<button>` into `src/__ratchet_probe.tsx`.
Ratchet reported `233 (baseline 232)`, named the file, exited 1. Removed the probe;
exit 0. A gate never seen failing is a gate being guessed about.

**Baseline measured (not assumed):**

| Check | Result |
|---|---|
| `tsc --noEmit` | clean, 0 errors |
| eslint errors | 232, across 93 files, **all** the raw-`<button>` rule |
| eslint warnings | 23, all `react-refresh/only-export-components` |
| circular imports | 11 |
| unused files | 0 |
| unused dependencies | 0 |
| unused devDependencies | 1, unidentified → RT-009 |
| unused exports / types | 336 / 126 → RT-008 triage |

**Corrections to earlier assumptions.** Two claims made before measuring turned out
false, both in the codebase's favor. (1) "There is no typecheck" — `build` is
`tsc && vite build`, and `tsc --noEmit` is clean. (2) knip's initial "144 unused
files" was an artifact of missing entry points; with `knip.json` naming
`src/main.tsx` and `web/web-main.tsx`, the true count is **0**. Four of the five
design-system guardrails are already fully satisfied.

The real problem was neither: `npm run lint` exits nonzero unconditionally against a
232-error backlog, so it could not function as a pass/fail gate and would have been
skipped by humans and agents alike. The ratchet fixes that.

**Queue seeded** with the 11 cycles first (RT-001…RT-006) — several are `core/`
importing `features/`, an inversion of the intended layering — then the button
burn-down (RT-007), then triage items.

**Human decisions recorded:** smoke testing stays manual, by choice; new libraries
permitted; ratchets strict.

**Committed** on branch `roundtable/bootstrap` as three commits: doc purge, gate, round table.

---

## 2026-07-10 — RT-003 · Break the `runtime/execution` self-cycle · ACCEPTED

First loop iteration. Chosen as calibration: two files, so a flaw in the protocol
surfaces cheaply.

**Cause.** `executeLocalTools.ts` imported the value `executeBuiltinTool` from
`builtinTools.ts`; `builtinTools.ts` imported the type `ToolExecutionCallbacks` back.
The edge being type-only does not stop madge from seeing the loop.

**Fix.** `ToolExecutionCallbacks` and `ToolExecutionResult` moved to a new leaf module
`runtime/execution/types.ts`. `executeLocalTools.ts` re-exports them, so `runtime/index.ts`
and `features/chat/context/toolExecutionCallbacks.ts` needed no change and the public
`@/runtime` surface is identical.

**Gate.** before: 11 cycles · after: 10 · typecheck clean · lint 232, unchanged.
Baseline diff removes exactly one line, the target cycle. Verified by the lead, not
taken on report.

**Cold review.** PASS. Independently confirmed the re-export chain resolves and that
`types.ts` imports no sibling — the cycle is broken, not relocated.

**Lead verification.** Re-ran the gate, read the baseline diff, and checked `types.ts`
import list directly. Both agents' central claims held.

**Findings raised to queue.** `types.ts` imports `@/features/chat/context/types`, so
`runtime/` now visibly depends on `features/` → RT-011. Not introduced by this change;
the coupling travelled with the type. **Madge does not flag it because it is not a
cycle.** The gate is blind to layering violations that do not close a loop. Stale
comment in `builtinTools.ts` → RT-012.

**Protocol deviation.** Implementer ran in the main working tree, not an isolated
worktree as SKILL.md prescribes: a fresh worktree has no `node_modules`, so the agent
could not have run the gate without a full reinstall. Tree was clean and committed, so
git was the undo. Unresolved — either the skill should stop promising worktrees, or
bootstrap must handle dependency install.

**Awaiting human smoke test before merge.**

---

## 2026-07-10 — External audit received · branch merged to main · RT-014

**Process failure, recorded.** The audit task, the gate, and the charter were committed to
`roundtable/bootstrap`. The external agent ran against `main` and saw none of it, so it
executed the original master prompt instead of the seven-slice brief. Output landed in
`Documentation/frontend-loop-engineer/` — twelve docs plus a thirteenth structural audit.

Lesson: any agent or tool pointed at this repo sees `main`. Work hidden on a branch is
work hidden from the loop. **All queue work now happens on `main`,** one commit per item,
gate green at every commit, `git revert` as the undo. Branching was never the safety net;
the commits are.

Merged `roundtable/bootstrap` into `main` as a fast-forward — main was a strict ancestor,
zero divergence, no conflict possible. Committed the audit verbatim and unedited so the
agent's claims stay separable from our conclusions about them.

**Audit assessment: strong observations, unsafe prescriptions.**

Verified independently and holding: 232/23 lint counts; 12 `alert()` and 24 `console.*` in
`src/`; `core/storage/fileConfigService.ts:9` importing `migrateModelId` from
`features/models`; `core/daemon/useDaemon.ts:9-10` importing from `@/app`;
`tsconfig.node.json` including only `vite.config.ts`. It under-reported Tauri imports in
`app/`+`ui/` (named 5, there are 8) — wrong in the safe direction.

Those last two inversions matter: **neither closes a cycle, so madge cannot see them.**
Confirms the gate's blind spot, and confirms that reading beats tooling for layering.

Rejected pending audit: doc 13 proposes moving `claudeBridgeService.ts` into `cliBridges/`,
a subsystem it never opened. Its "Target Top-Level Shape" omits `cliBridges/` and six live
feature folders (`activity`, `computerUse`, `manage`, `memories`, `models`, `settings`).
As a sketch, harmless. Handed to an implementer as a spec, it deletes live code.

**RT-014 accepted.** Carved `Button`, `IconButton`, `SegmentedControl`, `Toggle` out of the
raw-button rule — narrower than the audit's proposed blanket `ui/primitives/*` exemption,
which would have forgiven 8 real violations in composite components. Ratchet reported
exactly 3 improvements; baseline 232 → 229. Gate exits 0.

**New finding, escalated as RT-013.** `Button.tsx` never appeared in the baseline because it
renders `<motion.button>`, and the selector matches only `name.name='button'`. 29 such
elements exist across 13 files, all uncounted. An agent working RT-007 could satisfy the
gate by converting a raw `<button>` into a `<motion.button>`. Closing the hole raises the
baseline ~28. Charter forbids raising a baseline without human sign-off. **Awaiting decision;
RT-007 is blocked until then.**

---

## 2026-07-10 — RT-013 · Close the `<motion.button>` bypass · ACCEPTED

Human approved the baseline raise. Added a second selector matching any
`JSXMemberExpression` whose `property.name` is `button`, so `<motion.button>` — and any
other `X.button` — is caught. The original selector only matched `name.name='button'`,
which a member expression does not have.

**Baseline 229 → 257.** This is a raise, and the charter forbids raising a baseline to make
a red gate green. It is permitted here for the opposite reason: the gate was *falsely*
green. 28 raw buttons existed and were never counted. We did not add debt; we stopped
lying about it.

Verified the ratchet still exits 1 on a real regression (an earlier reading of exit 0 was a
shell artifact — `$?` after a pipe reports `tail`, not the script).

RT-007 unblocked. Before this, an agent could have satisfied the burn-down by rewriting a
`<button>` as a `<motion.button>`: a counted violation traded for an invisible one, scored
by the gate as progress.

---

## 2026-07-10 — Layering made machine-checkable · cliBridges audited

**Upward-import sweep.** 27 imports violate the intended layering: 12 from `core/`, 5 from
`runtime/`, 3 from `lib/`, 7 from `ui/`. **madge saw 8 of them** — only the ones that close
a cycle. The other 19 were invisible to every tool in the repo.

Worst offender, found by neither madge nor the external audit:
`core/platform/overlayService.ts:24` imports `useLiveSession`, a React hook, from
`features/voice/`. A core platform service depending on a feature's React hook.

**Fix: `no-restricted-imports`,** built into ESLint, no new dependency. `core/`, `lib/`,
`runtime/` may not import `@/features` or `@/app`; `ui/` may not import `@/features`.
Type-only imports count — `import type` still couples the layers.

Baseline 257 → 284. A raise, and the correct kind: 27 violations existed and were never
counted. The rule and the independent grep sweep agree on the number exactly, which is the
cross-check that makes the count trustworthy.

Verified by probe: a new upward import into `core/` produces a regression and exit 1.

**This is the most important change so far.** RT-001, RT-002, RT-011 and RT-015 were each a
one-off repair of a violation nothing prevented from recurring. Layering is now a gate.

**cliBridges audited.** 185 lines, 5 files, imports only Tauri and itself. Zero upward
imports, 19 dependents. The healthiest module in the tree — and the one we were most afraid
to touch, because it had once been misfiled as dead code. Doc 13's proposal to move
`claudeBridgeService.ts` into it turns out to be sound; I held it for the right reason
(unread) and was wrong about the conclusion.

---

## 2026-07-10 — RT-015f · Remove `runtime/` → `features/` upward imports · ACCEPTED

First item scored by the new layering gate. `ActiveToolCall`, `TaskItem`,
`ToolApprovalDecision`, `ToolDisplayClass` (and the `TodoItem` alias) hoisted from
`features/chat/context/types.ts` to a neutral leaf, `src/types/tools.ts`, which imports only
`@/core/permissions` — downward. Chat re-exports them, so all ~21 importers were untouched.

**Gate.** lint 284 → 279 · cycles 10 → **9** · typecheck clean. Both baselines lowered in the
same commit.

**The cycle fell out for free.** RT-004's cycle —
`chat/context/index.ts > ChatProvider > runClaudeTurn > runtime/index.ts > InlineToolSteps.tsx`
— disappeared without being targeted. It was a symptom; the upward import was the disease.
This is the argument for fixing layering before chasing individual cycles, and it retires
RT-004 and RT-011 outright.

**Cold review.** PASS. Byte-compared each moved type against `HEAD` (unchanged), confirmed
the barrel still re-exports everything, confirmed `types/tools.ts` has no upward import,
grepped the diff for `eslint-disable` (none), and verified the baseline diff removes exactly
the five named entries — with `InlineToolSteps.tsx` going 2 → 1 rather than to 0, because its
second violation is a raw `<button>` from a different rule.

**Lead verification.** Ran the gate, read the baseline diff, checked `types/tools.ts`'s import
list, grepped for `eslint-disable`. All independent of both agents' reports.

**Implementer behaved correctly under an incomplete instruction.** The item authorized
lowering the lint baseline only. It found the cycles baseline was also beatable, did **not**
touch it, and said so. That is the right instinct — an agent that quietly re-baselines what it
was not asked to is the failure mode this whole system exists to prevent. The lead lowered
cycles 10 → 9 afterward, since the charter requires locking in an improvement or it is
reversible.

**Awaiting human smoke test before further items.**

---

## 2026-07-10 — Human-led reorganization (out-of-band), verified and adopted

**Author: the human, with Codex. Not dispatched through the loop.** 141 files changed,
uncommitted, on top of `5347457`. The lead's job here was not to plan it but to audit it, so
this entry records verification, not authorship.

**Shape of the change.** Page components moved into per-feature `pages/`; the app shell
(`TitleBar`, `NavPopup`, `AccountMenu`, `NotificationBell`) and global overlays
(`ContextMenu`, `OfflineModal`, `UpdateBanner`, `CommandPalette`) moved from `ui/` to `app/`;
chat-specific widgets left `ui/primitives/` for `features/chat/components/`; four new leaf
directories appeared under `core/` (`models`, `attachments`, `cache`, `conversations`).

**Gate.** typecheck clean · vite build passes · lint 279 → **257** · cycles 9 → **2**.
Both baselines lowered in the same commit.

**RT-015 is closed. All 22 upward imports are gone**, and the reconciliation is exact:
015a=1, 015b=5, 015c=3, 015d=2, 015e=1, 015g=3, 015h=7 → 22, which is precisely the lint
drop. `no-restricted-imports` now reports **zero** violations across the tree. Every one of
the 257 remaining errors is a raw button (RT-007).

**RT-001, RT-002 closed** (the `core → features` inversions they described no longer exist).
**RT-005 half-closed**: `modelService > localModelDetection` is gone; `daemonService >
localUsageService` remains. **RT-006 remains** — `BrowserPanel ↔ NativeBrowserHost`, now one
of only two cycles left in the codebase.

**Verification performed, independent of any agent's account.**
- No gate tampering: `eslint.config.js`, `scripts/ratchet.mjs`, `knip.json`, `gate/` untouched.
- No new silencing: `eslint-disable` count 66 → 66; zero `no-restricted-imports` disables.
- Rename-aware baseline diff: 23 files are pure moves at identical counts; two are renames
  (`ExternalLink`→`MarkdownExternalLink`, `HarnessPermissionModal`→`LocalCapabilitiesModal`)
  at identical counts; **no existing file got worse.**
- Two files improved on the move (`AccountMenu` 4→3, `FloatingIsland` 3→2) — both shed exactly
  one upward import.
- The four new `core/` directories were checked for upward imports: none.
- `CommandPalette`'s 3 errors vanishing was investigated rather than assumed benign. At `HEAD`
  it contained **no raw buttons**; all 3 errors were upward imports. Relocating it to `app/`,
  the top layer, made them legal. Sound, not laundering.

**On re-baselining a red gate.** The charter forbids re-baselining to turn a red gate green.
This is the one admissible exception and it is worth naming precisely: the ratchet is keyed by
file path and **cannot see a rename**, so 25 relocated files read as "new violations" while the
identical debt disappears from the old paths. Re-keying identical debt to new paths while the
total *falls* is not forgiveness. The test applied was `no existing file got worse` plus a
basename-matched move ledger — both clean. **A falling total alone would not have been enough**,
and must never be treated as sufficient on its own.

**The architectural claim is now evidence.** Fixing layering dissolved seven of nine cycles
without any of them being targeted. Both survivors are intra-feature tangles with no layering
component. Cycles were the symptom; direction of dependency was the disease.

**Two new findings, queued, not acted on.**
- RT-017: five barrel files are now orphaned by the move (`core/daemon/index.ts`,
  `core/skills/index.ts`, `features/chat/services/index.ts`,
  `features/workspace/{rightWorkspace,services}/index.ts`).
- RT-009 answered: the "unused devDependency" is **`madge`**, and it is a **false positive** —
  `scripts/ratchet.mjs` invokes it, and `knip.json` ignores `scripts/**`. The gate's own tool
  is invisible to the gate's own detector. Fix the config, do not remove the dependency.

**Human smoke test now mandatory and overdue.** Three unverified changes (RT-003, RT-015f, and
this) have touched the tool-execution path and every page-level import in the app.
