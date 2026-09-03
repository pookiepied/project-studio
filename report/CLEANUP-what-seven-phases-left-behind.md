# Cleanup - what seven phases left behind

**Date:** 2026-09-03. **Where:** the whole tree, read; four files changed.
**Method:** every number below was measured against the real tree and real
runs during this session, not taken from the brief or the phase reports.
The suite ran twice, whole; the two files that failed in run 1 were then run
alone for per-failure attribution. No git state command of any kind was run.

**The headline:** the seven phases left remarkably little behind. One dead
union member, one double read, and a line-ending policy that never existed.
The larger findings are about the tree's surroundings: the migration's paper
trail is entirely uncommitted, someone was committing feature work in this
repository while this task ran, and the line-ending "conversions" are not a
migration defect at all - they are `core.autocrlf=true` meeting a repository
with no `.gitattributes`.

---

## Part 1 - the repo root

**`opencode/` is now ignored.** Confirmed before acting: 6,631 files, 218 MB,
package name `opencode`, "AI-powered development tool". It is the third-party
project sitting untracked at the repo root, exactly as the brief described.
Added to `.gitignore` under the existing "External reference checkouts"
section (beside `Research/`, `temp/`, `temp-v2/`), with a comment saying what
it is and that it is not ours. The directory was not touched, and `git status`
is legible for the first time since it arrived.

**What else is untracked (found, left alone):**

- `docs/AUDIT-2026-08-18.md` and `docs/AUDIT-FRONTEND-2026-09-03.md` - the
  project's own audit documents. The second appeared during this session.
- `prompts/` - every phase brief, including this task's own brief. The whole
  migration's instructions live here, uncommitted.
- `report/` - every phase report, uncommitted.

Not foreign and not large, but worth saying plainly: **the entire written
record of this migration exists only on this machine's disk.** One disk
failure erases every report and every brief. Committing them is the user's
call and was not made here.

**Live parallel work, seen and untouched.** While this task ran, the tree
changed under it: a composer draft-persistence feature (`drafts.ts` plus
wiring in `Composer.tsx` and `main.tsx`) appeared uncommitted at 07:18, and
was committed by the user as `fdf0aa22` while this session was in progress,
followed by system-tray work (`2f6ab5ab`, `5dc78b40`, `STUDIO/src-tauri`).
None of it is phase debris, none of it was modified here, and the suite
numbers below include its effects, attributed where they move.

## Part 2 - the double read

Fixed as specified. `STUDIO/src/design/theme/appearance.ts`, the non-Tauri
branch of `loadAppearance`, now reads `localStorage` once into a local and
branches on it:

```ts
const legacy = readLegacy()
return legacy ? coerce(legacy) : DEFAULT_APPEARANCE
```

Nothing else about the settings store was examined for redesign. The
authority rule, the file location, and the migration path are correct and
were left exactly as found.

## Part 3 - the doors with no rooms

**Handled deliberately. Change nothing - and that is the finding.**

A click on an unbuilt section renders `PlaceholderPane` (beside the panes in
`panes/Pane.tsx`), fed from `panes/placeholders.ts`: the section's title, a
one-line description, and a list of what the section will hold, closing with
"Waiting on the harness. The layout is settled; the values are not wired."
An id that resolves to nothing lands on General ("a stale link, not a
crash", in `registry.tsx`'s own words). No blank region, no crash, no console
error. The taxonomy is pinned by `sections.test.ts`.

**The brief was wrong twice here.** There are not sixteen sections; there
are fifteen. And there are not three built panes; there are four - Providers
is real (`providers/ProvidersPane.tsx`, 352 lines, with its own test file and
a `providers/` directory of nine supporting modules; it was counted as
missing because it does not live beside the other panes).

The classification, real first:

| # | Section | Status |
|---|---|---|
| 1 | General | Real pane |
| 2 | Appearance | Real pane |
| 3 | Providers | Real pane (the one the brief missed) |
| 4 | Archived chats | Real pane |
| 5 | Keyboard shortcuts | Placeholder |
| 6 | Account | Placeholder |
| 7 | Personalization | Placeholder |
| 8 | MCP servers | Placeholder |
| 9 | Connectors | Placeholder |
| 10 | Browser and computer use | Placeholder |
| 11 | Skills | Placeholder |
| 12 | Hooks | Placeholder |
| 13 | Git | Placeholder |
| 14 | Worktrees | Placeholder |
| 15 | Environments | Placeholder |

The eleven placeholders are the input the brief wanted for the next tasks.
One measured note for whoever builds the MCP pane: the placeholder copy
already promises "Add a server by command or URL", which matches the stdio
stack the migration deliberately kept (Part 0.3 of the brief) - the pane's
eventual shape should honor that.

## Part 4 - the debris

### Test debris

Measured in the Windows temp directory Node actually uses
(`C:\Users\pooki\AppData\Local\Temp`, via `os.tmpdir()` - Git Bash's `$TEMP`
points elsewhere and shows nothing):

- `studio-mcp-flue-*`: **0**. The debris the brief named is already gone
  (Phase 6 reported zero after its runs; Phase 7 removed one more; none has
  returned).
- `project-studio-v2-*`: **1 found, removed.** Not the brief's pattern, but
  the same species: `tests/integration/harness.test.ts:290` creates its temp
  homes under this name, and one from a 02:28 run today (984 KB, two
  SQLite databases with hot WAL files) had been left behind. Removed without
  incident; nothing held it.
- After the two full suite runs below: **0**, both patterns. The run 1
  failure did not leave a directory this time - the debris needs the primary
  failure AND a slow graceful stop together, and today it did not travel
  with one.

### The teardown itself (named, not changed)

The brief asked whether `afterEach` swallows an unlink error. **It does
not.** In both teardowns (`mcp-flue.test.ts:287`,
`harness.test.ts:441`), `rm` is called with `recursive: true, force: true`,
and `force` only ignores nonexistent paths - an EBUSY or EPERM on the file a
surviving descendant holds open rejects the promise, propagates out of
`afterEach`, and vitest reports it as a second failure. Phase 7's run 1
recorded exactly that: `EBUSY: resource busy or locked, unlink
'...studio-mcp-flue-qOJD6L\flue.db-shm'` reported on teardown. So the debris
is not a silenced failure; it is the *remainder of a partial recursive
removal* - `rm` deletes what it can, hits the locked file, throws, and
abandons the rest. The cleanup fails loudly and still cannot succeed, which
is a different diagnosis than the brief's, and the one worth having before
anyone "fixes" the teardown by adding a catch (which would convert a loud
partial failure into a silent one). Not changed here; the underlying
intermittent is out of scope by the brief's own rule.

### Dead code

**Deleted (one item):**

- `"workflow"` from `ExecutionOperationKind`
  (`STUDIO HARNESS/src/execution/context.ts`). Evidence it was dead: the
  literal `"workflow"` appears nowhere else in the harness source or tests;
  the only producer of operation kinds, `operationKind()` in
  `observability/flue.ts`, maps 2.0's operation types and cannot return it -
  Flue 2.0 removed workflows entirely (the migration plan says so in one
  line, and Phase 2/3 recorded `workflow` being removed from
  `FlueExecutionOperation` while adding `coordinator`); nothing switches on
  the kind by name; no test pins the member. It is 1.0 vocabulary that
  survived the 2.0 port in a union nobody reopened - precisely the shape the
  brief predicted, except that its source is the Phase 2/3 mapping, not the
  Phase 7 rename. `pnpm typecheck` clean after the deletion; suite totals
  unchanged.

**Suspected, investigated, NOT deleted - the harness list.** For each: the
name appears exactly once in the whole harness (source, tests, configs,
app/server entry) - at its own declaration. All of them predate the
migration (checked by `git log` per file; none was touched by any of the
seven phase commits). Dead by the reference test, yes - but not *left behind
by the seven phases*, and deleting them is general refactoring wearing a
cleanup brief, so they are reported and left:

- `auth/session.ts`: `needsRefresh`, `assertSession` - no callers; and
  `accessTokenExpiryMs` has no caller either once `needsRefresh` goes. They
  serve a proactive token-refresh flow that does not exist anywhere in the
  tree; the auth module itself is alive (`pnpm auth` -> `auth/cli.ts` ->
  `login.ts`), and its CLI docblock says the desktop app will later drive
  the same flow. Unfinished-feature scaffolding rather than debris; if the
  refresh flow never comes, these three are the next dead-code pass.
- `contracts/conversations.ts`: `ConversationPatch`, `ProjectFolderSpec`,
  `ProjectPatch` - unused type aliases over schemas that ARE used
  (`conversationPatchSchema` by the conversations routes,
  `projectFolderSpecSchema` inside `projectCreateSchema`,
  `projectPatchSchema` by the projects routes).
- `contracts/effects.ts`: `ruleFor`. `contracts/errors.ts`:
  `isStudioErrorOfDomain`. `contracts/providers.ts`: `ProviderSource`
  (alias over a used schema). `tools/types.ts`: `AnyTool`, `effectsOf`.
- `extend/mcp/wire/era.ts`: `ERA_IS_CACHED_PER_CONNECTION` - a constant
  whose value is `true`, referenced nowhere; a design statement expressed as
  a symbol. MCP is out of this task's reach by the brief's Part 0.3, and its
  files predate the migration.
- `models/local/config.ts`: `resolveCustomProviders`.
- `observability/index.ts`: `isObservabilityInitialized`, `getLogger` -
  superseded in practice by the `getObservability()` handle pattern; the
  file's last touch was a pre-migration dead-code pass that itself left
  them.
- `observability/redaction-rules.ts`: `REDACTION_RULE_IDS`.
- `providers/connection-store.ts`: `ProviderConnectionStore` (alias).
  `providers/model-catalog.ts`: `ProviderModelCatalog` (alias).
  `providers/library/index.ts`: `libraryProtocolFor`.

**The same sweep on the STUDIO frontend** (541 exported symbols scanned, all
five candidates pre-migration, all left):

- `design/tokens/typography.ts`: `TYPE` - the type-scale table, unreferenced
  by any component.
- `domain/session/gallery/scene.ts`: `SCENE_START`, `SCENE_SCRIPT` - the
  demo scene's opening state and its timeline; `SCENE_DONE` next to them is
  used, these two are not.
- `features/chat/transcript/projection.ts`: `hasVisibleContent` - born dead
  in TASK-36 ("the first turn is a turn", commit `0f3e8859` is the only
  commit in its history), never called, and NOT orphaned by Phase 6 despite
  living in a Phase 6 file - `git log -S` shows no other commit ever touched
  the name.
- `features/voice/waveform.ts`: `ridgePath`.

**Checked and confirmed alive - the traps:**

- `src/db.ts` - no importer anywhere, and that proves nothing: Flue loads it
  by convention at the source root (its own docblock says it is the first of
  our modules to execute in the built bundle). Untouched.
- `createRetryExecutionContext` - no production caller, and a docblock that
  says so and names the caller's arrival (retry). Not dead by its own
  declaration.
- `src/reliability/model-retry-policy.ts` - installed on `globalThis` and
  read by nothing, which is the documented Phase 8 regression
  (`pnpm-workspace.yaml` says exactly this in words). Dormant by design
  until the hunks are re-derived.
- The agent modules (`agents/studio.ts`, `agents/title.ts`) - loaded by the
  `@flue/vite` `'use agent'` scan, not by imports.
- The `dispatchId`-carrying fixture in `tests/unit/conversation-export.test.ts`
  - deliberately beta-9, standing for the pre-migration wire the export
  exists to rescue (Phase 7's finding, confirmed).
- The `dispatchId` mention in `execution/context.ts`'s docblock - deliberate
  2.0 mapping documentation, correctly worded.

**The old identity vocabulary:** `runId`, `run_start`, `run_end`,
`dispatchId` appear nowhere in harness source, harness tests, STUDIO source,
or Rust source except the two deliberate mentions above. The brief's
likeliest source of debris (the Phase 7 rename) turns out to have left
nothing: Phase 7's own report was right - the renames were already done by
Phases 2-5. Every "1.0" comment the sweep found in both trees is correctly
worded historical context (verified one by one; the only false positives
were `WindowsPowerShell\v1.0` paths and version strings).

## Part 5 - line endings

**Counted: 680 tracked source files across `STUDIO HARNESS/` and `STUDIO/`**
(TypeScript, TSX, Rust, JSON, Markdown, YAML, TOML, CSS, HTML, SVG - via
`git ls-files --eol`, which reads the committed bytes and the worktree
separately).

| Layer | LF | CRLF | mixed | binary |
|---|---|---|---|---|
| Index (what is committed) | 604 | **46** | **8** | 22 |
| Worktree (before the fix below) | 331 | 318 | 9 | 22 |

**The number is not zero, and the brief's diagnosis is right.** The
committed bytes themselves carry CRLF in 46 files and mixed endings in 8 -
the MCP cluster is the densest (`wire/framing.ts`, `wire/jsonrpc.ts`,
`wire/lifecycle.ts`, `http-channel.ts`, `launcher.ts`,
`wire/definition-hash.ts`, plus five of their unit tests), then the
filesystem tools, observability, net, `storage/migrations.ts`, 17 more test
files, and on the STUDIO side `src-tauri/build.rs`, `src-tauri/src/main.rs`,
`src/index.css`, `icons/studio-icon.svg`, and `src-tauri/.gitignore`. The
worktree's 318 CRLF files are a second layer of the same story.

**The mechanism, named:** this machine runs `core.autocrlf=true`, and the
repository has no `.gitattributes` - nothing in the repo states the LF
standard the phase rules enforce by hand. Git therefore converts on checkout
(worktree CRLF), and any file committed before that setting existed - or by
a path that bypassed normalization - keeps its CRLF in the index forever,
because git will not silently rewrite a blob that already contains CR.
Phase 7's three-file normalization treated three symptoms and missed the
disease.

**What was done:** a `.gitattributes` was added at the repo root - `* text=auto eol=lf`, the binary population named explicitly (icons, vendored
ripgrep, media), and the vendored trees marked binary. Declared attributes
take precedence over `core.autocrlf`, so the standard is now the repo's
property rather than each machine's setting. Verified after adding: `git
status` shows no phantom modifications, and `git check-attr` confirms the
rules land on text and binary files alike.

**What was deliberately NOT done:** the renormalization pass
(`git add --renormalize`). Reasons: it would rewrite all 54 files' blobs at
once, which is the bulk-edit shape this brief warns about; it needs a commit
to land, and committing is forbidden here; the user was committing to this
repository while this task ran, and 54 phantom-staged files would have
collided with their work. The 54 files convert one at a time, on their next
real edit, under the new attributes. The full list of the 54 is reproducible
with `git ls-files --eol -- "STUDIO HARNESS" STUDIO | grep -E "i/(crlf|mixed)"`.

One self-inflicted artifact, disclosed: the `.gitignore` edit left that
file's worktree copy uniformly CRLF where the committed blob was mixed (its
`Research/`, `temp/`, `temp-v2/` lines were the three LF lines in an
otherwise-CRLF file), so the diff shows those three lines as touched. Under
the new attributes the user's next commit normalizes the whole file to LF
and the artifact disappears. `STUDIO HARNESS/src/execution/context.ts` is LF
throughout; `appearance.ts`'s worktree CRLF is ordinary `autocrlf` state
over an LF blob.

## Verification

Every count from the brief's list, with attribution:

- `pnpm typecheck` (harness): **clean**. `tsc -b` (frontend): **clean**.
- **Frontend suite: 48 files, 465 tests, all green.** The brief says 47
  files, 456 tests; the delta is exactly the user's `drafts.test.ts`
  (committed mid-session as part of `fdf0aa22`). Nothing frontend moved
  because of this task except the one-line `appearance.ts` fix, which the
  suite covers.
- **`pnpm test` (harness, builds first), run whole twice:**
  - **Run 1: 1496 passed, 11 failed, 25 skipped** (1532 total, 101 files,
    702.98s).
  - **Run 2: 1497 passed, 10 failed, 25 skipped** (1532 total, 653.04s).
  - **Per-failure attribution, run 2 (10):** the floor exactly, all in
    `tests/integration/harness.test.ts`, verbatim: retries transient wording
    the old classifier missed until the budget is spent / recovers when a
    transient refusal clears on the second attempt / announces every
    scheduled retry on the wire while the provider keeps refusing / announces
    exactly one retry when the refusal clears, then completes cleanly / ends
    a cancelled retry visibly rather than letting it simply stop / follows
    the class when the failure changes between attempts / spends a transport
    failure's short budget and gives up announcing nothing further / grants
    the final retry at exactly the transport budget boundary / keeps a
    rate-limited turn going past the old budget and cancels a long wait
    cleanly / re-derives the attempt count across a restart instead of
    starting over. All ten pin the patched-runtime behaviour that returns
    when Phase 8 re-derives the hunks. No deadline raised, no test touched.
  - **Per-failure attribution, run 1 (11):** the same ten, plus one
    above-floor failure in one further file. The run 1 log capture kept only
    its tail, so the failing file's name was not captured - what pins the
    attribution is everything measured around it: `harness.test.ts` run
    alone reproduces exactly its ten (10 failed, 16 passed), `mcp-flue.test.ts`
    run alone passes 2/2 (32.8s), and run 2 - whole, hours later - lands on
    exactly the floor with `mcp-flue` green inside it. That is the
    documented intermittent: `mcp-flue > runs a real selected tool through
    approval and removes it after disable`, now failed in five of the eight
    full runs on record, passing alone every time it was tried. Nothing
    above the floor reproduced, and nothing above the floor is attributable
    to this task's changes.
  - **The test population did not move: 1532 in both runs, the same total
    Phase 7's runs summed to.** The `"workflow"` deletion removed no test
    (verified before deleting: no test references the member).
- **`cargo clippy --all-targets`: zero warnings** (this compile includes the
  user's in-flight tray module). **Rust suite: 65 passed, 0 failed** -
  unchanged from every phase.
- Rules held: no `any`, no non-const `as`, no non-null `!`; the four changed
  files are UTF-8, no BOM; edits by hand (the only scripts written were
  read-only analysis probes, deleted afterwards); no test was added,
  weakened, or deleted.

## Every place this brief was wrong

1. **"Sixteen sections."** Fifteen (3+2+1+3+2+3+1, counted from
   `sections.ts` and pinned by its test).
2. **"Three panes exist: General, Appearance, Archive."** Four: Providers is
   a fully built pane, in `providers/` rather than beside the others - which
   is also why the placeholder count balances (11 + 4 = 15, every section
   resolves to something).
3. **"if `afterEach` swallows an unlink error."** It does not. `force: true`
   covers only ENOENT; EBUSY propagates and is reported (Phase 7's run 1 is
   the receipt). The debris is a partial recursive removal, not a silenced
   one.
4. **Part 5's premise that Phase 7's normalization addressed the
   conversions.** 46 CRLF and 8 mixed files remain in the committed bytes;
   the three Phase 7 normalized were symptoms. The disease is
   `core.autocrlf=true` on this machine plus a repository that never declared
   its standard - now declared.
5. **"The identity rename in Phase 7 is the likeliest source" of dead code.**
   The renames left nothing. The one true migration leftover is the
   `"workflow"` operation kind, orphaned by the Phase 2/3 port of the
   operation mapping. Everything else dormant in both trees predates the
   migration (per-file `git log` on every candidate).
6. **"`mcp-flue` ... has failed in four of seven observed full runs."** Now
   five of eight.
7. **"Frontend suite green (47 files, 456 tests)."** True when written;
   48/465 by the time this task ran, the delta being the user's own
   `drafts.test.ts`. The brief could not have known - but a number in a
   verification list that moves for reasons outside the task is exactly what
   the "attribute the movement" rule is for.
8. **The brief's snapshot of `git status` was already stale at session
   start.** `drafts.ts` was untracked on disk (07:18) before this session's
   first status, the user committed it mid-task, and the tray work landed on
   top. None of the tree this task inherited matched the quiet tree the
   brief describes; the work still holds, but the parallel activity is part
   of this record.

## What this task changed, complete

1. `.gitignore` - `opencode/` added, with a comment (Part 1).
2. `.gitattributes` - new, the LF standard and the binary list (Part 5).
3. `STUDIO HARNESS/src/execution/context.ts` - `"workflow"` removed from
   `ExecutionOperationKind` (Part 4).
4. `STUDIO/src/design/theme/appearance.ts` - the double read, read once
   (Part 2).
5. This report.

Everything else measured, named, and left for the person who owns the
decisions this task was told not to make.
