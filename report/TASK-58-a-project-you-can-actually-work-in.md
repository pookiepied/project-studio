# TASK 58 - A project you can actually work in

Brief: a project is filing, not a workspace. Its folders were rows nobody
read at the place a turn binds roots. This task makes a project conversation
run in the project's first folder (by `position`), joins the other folders
into the policy's roots, refuses the turn when that first folder is missing
instead of ever creating it, validates folder paths on write, names the
folders in the environment block, and closes the two holes in the Environments
pane: a machine-wide grant that could be taken but never given, and a pane
that went read-only on a machine with no projects.

---

## 1. Files changed, and what each change was

### Harness

- `src/sandbox/scope.ts` - `validateFolderPath`, a sibling beside
  `validateCustomScopePath`: absolute, real on this machine, **a directory**
  (the scope check does not ask that), not a volume root or system directory -
  the last one reached through `systemScopeRefusal`, so the list of paths that
  end containment stays shared rather than restated. Returns the normalized
  absolute form, which is what the store keeps.
- `src/projects/store.ts` - validation on write, in `create`, `addFolder`, and
  the `path` change of `updateFolder`, before the transaction opens so a bad
  path refuses the write as `StorageError("invalid")` instead of surfacing as a
  driver error from inside it. The normalized absolute path is what is stored.
  No migration; rows written before this are read as they are, and Part 1's
  turn refusal is what catches a bad old row at the moment it would matter.
- `src/application/studio-runtime.ts` - the override. `AgentHost` gains an
  optional `conversationProjectFolders` (optional like `conversationExtraRoots`,
  so the pre-existing test double still satisfies the host) and
  `StudioRuntime` implements it from the conversation index and the project
  store. `createAgentSandbox` now reads the conversation's project record,
  stands the sandbox in the project's **first** folder when the project has
  one, and composes the policy roots: the person's other folders join read and
  write roots beside the scope rows, deduplicated case-insensitively on
  Windows. `createSandbox` refuses the turn when the first folder is missing or
  is not a directory (`missingFolderRefusal`, a `SandboxError("unavailable")`
  naming the project, the folder, and the two remedies), checked at turn start
  rather than at the render because the two moments differ. The three
  conversation directories are still created - only the sandbox root's meaning
  changed.
- `src/agents/studio.ts` - the render reads the project's folders from the
  host, stands in `folders[0] ?? conversationWorkspaceDirectory(id)`, and hands
  the folders to `environmentFacts`. The `kind` comparison line is untouched;
  two stale sentences in the surrounding comments ("Today they are always
  equal", "will pass its project's roots ... later") were updated to describe
  the landed state.
- `src/context/environment.ts` - `EnvironmentFacts.projectFolders` and a
  `projectFoldersStatement` rendered in the project branch only: one line per
  folder, the same shape as `extraRootsStatement`, with the first marked
  "(your working directory)". No advice was added; the branch's existing text
  was already right.

### STUDIO

- `src/features/settings/environments/EnvironmentsPane.tsx` - a grant-scope
  chooser ("This project" / "Everywhere") above the detected toolchains;
  preset grant buttons and the custom-path field are no longer gated on having
  a project (with none, grants are machine-wide and every button says so);
  button labels name the scope at the moment of the click ("Grant for this
  project" / "Grant everywhere" / "Granted for this project (revoke)" /
  "Granted everywhere (revoke)" / "Granted here and everywhere (revoke)");
  revoke takes up what the label named, wherever the covering rows live.
  The level row stays per project, as it is.

The one file written outside the code is this report.

---

## 2. Tests

New files:

- `tests/unit/project-workspace.test.ts` (12) - the runtime-level claims
  against a real `StudioRuntime`, real store, real directories: first folder as
  root, kind divergence, other folders read and written, the wall still holding
  outside the roots, the conversation's own directories, the missing-folder and
  file-impostor refusals (and that neither creates anything), machine-wide rows
  reaching a project conversation, position ordering, the unchanged
  conversation cases, and the workspace-writability fix below.
- `tests/integration/project-folders.test.ts` (1) - the brief's required
  integration test against real containment: through the project conversation's
  own tool surface (factory, gate, kernel, Full Auto, AppContainer), a shell
  command writes the project's second folder; the same kind of command one step
  beyond the folders is refused.
- `STUDIO/src/features/settings/environments/EnvironmentsPane.test.tsx` (8) -
  the pane claims, with the hook mocked.

Changed files:

- `tests/unit/projects-store.test.ts` - rewritten onto real directories
  (17 tests, was 6). The behavior change requires it: every folder path the old
  tests wrote was fabricated (`D:/Work/...`) and Part 2 refuses exactly that.
  The old claims all survive on real paths (order, cross-project independence,
  detach-not-delete, row survival), the relocate test now relocates to a real
  directory and separately pins that a row whose folder left the disk still
  reads, and the validation describe adds: relative, missing, a file, volume
  root, system directory (both naming `trusted`), empty, `addFolder` and
  relocation validating the same way, the normalized form stored, duplicate
  create refused atomically, and pre-validation rows read un-migrated.
- `tests/unit/environment-block.test.ts` - +5 (16): every folder named with the
  working directory marked; no folder list for a conversation, for a label-only
  project, or for the conversation kind even when facts carry folders; the
  facts assembly with folders.

Suites, one at a time:

- Harness `pnpm build` then `npx vitest run tests/unit`: **1601 passed, 1
  skipped, 0 failed** (the skip is the pre-existing symlink-privilege skip in
  `process.test.ts`). `tsc --noEmit` clean.
- Harness integration, real containment: `tests/integration/sandbox-scope.test.ts`
  **3 passed (file unedited)**, `tests/integration/project-folders.test.ts`
  **1 passed**, `tests/integration/sandbox-appcontainer.test.ts` **16 passed**,
  `tests/integration/conversation-mode.test.ts` **5 passed** - 25 total.
- STUDIO `pnpm test --run`: **62 files, 604 passed, 0 failed**. `tsc -b` clean.

The brief's twelve proofs, and the test holding each:

1. First folder as root, `kind` answers project - "runs with the first folder
   as its sandbox root, so the kind comparison answers project" (the root and
   `conversationWorkspaceDirectory` diverge, which is the comparison's input),
   plus "derives the project's first folder when the factory is called without
   a root" and "takes the first folder by position".
2. Other folders readable and writable - "reads and writes the project's other
   folders, and the first", and the integration test's contained command.
3. No project unchanged - "stands in its own conversation directory".
4. Project with no folders unchanged - "a project with no folders is the same:
   a label, not a place".
5. Missing first folder refuses the turn naming the project - "refuses the turn
   when the first folder is missing, names the project, and never creates it"
   (message contains the project name, the folder, and "missing").
6. The harness never creates a project folder - the same test asserts the path
   still does not exist after the refusal, and that not even the conversation's
   tree was created.
7. Attachments and artifacts still created - "still creates the conversation's
   own directories" (all three, workspace included).
8. Relative, missing, volume root, system directory refused on write, system
   cases naming `trusted` - the "folder paths are validated on write" describe.
9. Machine-wide rows still apply, Task 57's test unedited -
   `sandbox-scope.test.ts` ran unmodified (3 passed), and the runtime-level
   half is "applies machine-wide scope rows to a project conversation".
10. The block names every folder and says which is the working directory -
    "names every folder and says which one is the working directory".
11. Machine-wide grant creatable from a preset and a custom path - "grants a
    preset machine-wide when no project is selected", "switching the scope to
    everywhere grants machine-wide instead", "grants a custom path
    machine-wide from the same choice".
12. Grant controls with no project selected - "offers grant controls with no
    project on the machine, as machine-wide".

---

## 3. Negative controls (break, watch the named test fail, restore)

Each: broken by hand, the named test run and failed, restored and re-run green.

- **NC-1.** Broken: the factory ignored its own derivation
  (`firstFolder ??` removed from the root computation). Fired: "derives the
  project's first folder when the factory is called without a root". Honest
  finding: the render-mirroring test did **not** fire, because the render
  passes the same root the factory would derive - which is why the bare-call
  test exists. Restored.
- **NC-2.** Broken: the other folders dropped from `readRoots`/`writeRoots`.
  Fired: "reads and writes the project's other folders, and the first", and
  the integration test "runs a command that writes the project's second
  folder" (the contained child was refused). Restored; both green.
- **NC-3.** Broken: the missing-folder refusal removed from `createSandbox`.
  Fired: both refusal tests (the turn started instead of refusing). Restored.
- **NC-4.** Broken: `create` stored `folder.path` unvalidated. Fired: seven
  validation tests (relative, missing, file, volume root, system directory,
  empty, normalized form). Restored.
- **NC-5.** Broken: `validateFolderPath` skipped `systemScopeRefusal`. Fired:
  "refuses a volume root with a reason that names trusted" and "refuses a
  system directory ...". Restored.
- **NC-6.** Broken: `projectFoldersStatement` returned `[]` unconditionally.
  Fired: "names every folder and says which one is the working directory".
  Restored.
- **NC-7.** Broken: the workspace root dropped from the write set (the fix
  below reverted). Fired: "its own workspace stays writable when a machine-wide
  write grant exists" and "reads and writes ... and the first". Restored.
- **NC-8 (STUDIO).** Broken: the preset grant ignored the everywhere scope.
  Fired: "switching the scope to everywhere grants machine-wide instead".
  First run with the break passed - the hoisted mocks leaked call history
  between tests, so the assertion passed on an earlier test's machine-wide
  call; fixed by an explicit `vi.clearAllMocks()` in `beforeEach`, then the
  control fired. Restored.
- **NC-9 (STUDIO).** Broken: the custom-path section re-gated behind
  `projectId === null ? null : ...` (Task 57's hole put back). Fired: "offers
  grant controls with no project on the machine, as machine-wide". Restored.
- **NC-10 (STUDIO).** Broken: granted labels collapsed to one scope's wording.
  Fired: "says where a path is granted, and revokes it where it lives" and
  "says so when a path is granted at both scopes". Restored.

---

## 4. Rules added that the task did not ask for

- **The workspace root always leads the write roots** (`createAgentSandbox`).
  Found while landing the folders, by a scratch check: `createSandboxPolicy`
  replaces its default write set with whatever arrives, so under Task 57's
  composition, once any scope write row existed for a conversation, the
  conversation's own workspace - ours, created empty, the one place a scratch
  file belongs - dropped out of the writable set, and every write to it died
  with "outside the workspace". The fix is one entry at the composition point,
  where the root is known. It covers projectless conversations (which is where
  the defect was live) and project conversations (where the first folder must
  be writable by construction). Test: "its own workspace stays writable when a
  machine-wide write grant exists"; negative control NC-7.
- **The conversation's workspace directory is still created for a project
  conversation** (all three directories are). The brief says the conversation
  directory "does not disappear" and only the root's meaning changes; the test
  pins all three so a later tidying cannot silently drop one.
- **Pane mock isolation** (`vi.clearAllMocks()` per test in the new pane test):
  without it, call assertions can pass on an earlier test's leaked call - found
  the hard way during NC-8.

---

## 5. Anything found but not fixed

- **The brief got one thing wrong**: "the frontend already lets folders be
  reordered". `ProjectPage` renders folders in stored position order and
  offers no reorder control anywhere in `STUDIO/src/features/projects`; the
  HTTP layer has no position route either. The store keeps `position`, orders
  by it, and `addFolder` appends after the last - so "first by position" is
  honored, but the person cannot yet arrange anything. Reordering is a real
  gap for whoever owns the next task list.
- **`system-prompt.ts` and `system-prompt-tools.test.ts` carry uncommitted
  modifications in the tree that are not this task's and not mine.** The
  system-prompt rewrite was already modified when this task began; the test
  file's expected phrases were updated to match it during the session. Both
  were left exactly as found, and both test suites pass with them in place.
- **The interim cost of validation on write, taken deliberately per the
  brief**: `NewProjectDialog` still fabricates `D:/Work/<slug>` paths, and the
  store now refuses them - so creating a project *with folders* from the
  dialog fails with "That path does not exist" until Task 59's real picker
  lands. A project with no folders still creates fine, and nothing was
  changed in the dialog here.
- **A non-first folder that goes missing** is not checked at turn start; only
  the first folder is, per the brief. A run in that project fails reads and
  writes against the missing folder at the fs level instead of with the
  project-naming refusal.
- **Case variants can duplicate a root**: `create`'s duplicate check is
  case-insensitive, but `addFolder` relies on SQLite's case-sensitive TEXT
  unique index, so `C:\Work` and `c:\work` can both be added to one project
  (pre-existing). Containment and the dedupe in composition treat them as one
  path; the block could name both spellings.
- **Overlap between folders and scope grants is stated twice**: a project
  folder separately scope-granted appears both in the folders statement and in
  the extra-roots statement. Truthful and rare; left alone.
- Carried from Task 57's report, still open and still out of scope: the scope
  question has tests and no caller, `pending_question` is not purged with its
  conversation, the AppContainer per-workspace grant on system-owned
  directories needs elevation the runtime never takes, and bash's
  `STATUS_DLL_INIT_FAILED` under the Git read grant.

---

## 6. Where the brief was ambiguous, and the decision made

- **Who derives the override.** Both the render (for the environment block and
  `kind`) and `createAgentSandbox` (for the policy) read the project's folders
  - the render through the new `AgentHost` member, the factory from the same
  stores - so one run reads one source twice rather than carrying a second
  copy. The factory's own derivation also covers calls that arrive without a
  render-passed root, which is the bare-call test and NC-1's subject.
- **Where the refusal lives.** At turn start (`createSandbox`), not the render:
  the render is the earlier moment, and the folder can be removed - or its row
  written - in between. The error is `SandboxError("unavailable")` (retryable),
  because after the person creates the folder or repoints the project, a resend
  can succeed.
- **`validateFolderPath` as a sibling, not a call.** It must ask "is a
  directory", which the scope check does not, and its sentences should speak of
  folders; the one rule that must not drift - which paths end containment -
  stays shared through `systemScopeRefusal`, exactly the brief's condition for
  a sibling.
- **"Every other folder" joins read and write roots both**, and the first
  folder is the workspace root and therefore both by construction. A write
  grant implying read (Task 57's rule) already held for scope rows; the
  policy's "writable inside readable" invariant is what the composition feeds.
- **The pane defaults the chooser to "This project"** because machine-wide
  applies to every project *and* to conversations with no project, which is
  more than most people mean by "allow this" - the brief's own words, made into
  the default and into the Everywhere option's hint. With no projects the
  chooser is absent, everything grants machine-wide, and the no-project row
  says so in words.
- **The grant button's click revokes what the label named**: if a path is
  covered at both scopes, one click takes both rows up; the label says
  "Granted here and everywhere (revoke)".
- **No migration was needed** (validation is on write), so migration 22 was
  not touched and nothing in `storage/migrations.ts` changed.

---

## 7. Git

No commands that moved HEAD or the index; no commits, no stashes. The work is
left in the working tree. `Backend/`, `documentation/`, `prompts/` were not
touched. The two files modified in the tree by someone else
(`src/context/system-prompt.ts`, `tests/unit/system-prompt-tools.test.ts`)
were left exactly as found.
