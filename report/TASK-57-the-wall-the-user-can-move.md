# TASK 57 - The wall the user can move

Brief: containment gets a door. A refusal for a path becomes a question the
person can answer, the answer is durable and revocable, and the settings page
shows every door opened. Two levers kept apart: scope (which paths a project
may reach) and level (whether it is contained at all).

---

## 1. Files changed, and what each change was

### Harness - new files

- `src/sandbox/scope.ts` - the vocabulary: `SandboxScopeMode`,
  `SandboxScopeSource`, `SandboxLevel`, `SandboxScopeRow`, path normalization,
  `systemScopeRefusal` (volume roots and system directories refused with a
  reason naming `trusted`), and `validateCustomScopePath` (absolute, existing,
  not a root or system directory).
- `src/sandbox/scope-store.ts` - `SandboxScopeStore`, the sole owner of
  `sandbox_scope`. `list` reads one project plus the machine-wide rows (empty
  project id); a conversation with no project reads machine-wide only.
  `resolveRoots` is what the policy build reads; a write grant joins both the
  read and write lists, because the policy refuses a writable root outside
  every readable one. `grant` upserts, `revoke` removes one row,
  `clearProject` is what a project delete calls.
- `src/sandbox/scope-questions.ts` - the refusal that becomes a question.
  `buildScopeQuestion` builds the three-option payload (this project /
  every project / don't allow) showing the resolved normalized absolute path,
  never the model's raw string, with no preselected option.
  `applyScopeAnswer` writes the grant for an allow, writes nothing for a
  decline, deferral, stop, or timeout, and records declines. `ScopeDeclines`
  is the per-conversation in-memory record so a declined path is not asked
  twice in that conversation. No second asking mechanism: the broker and the
  ask tool are untouched.
- `src/sandbox/presets.ts` - the eight presets (Git, Rust, Node caches,
  Python, Java, Android and Flutter, Go, .NET), each with candidates and a
  detector. `detectPresets` returns only what exists on the machine with the
  path found, Git first. No Docker preset: Docker is a level choice.
- `src/transport/http/routes/sandbox.ts` - `/api/sandbox`: `GET /scope`
  (always the `{project, machineWide, level}` shape), `POST /scope`,
  `DELETE /scope`, `GET /presets`, `PUT /projects/:id/level`. Project
  admission scope.
- `tests/unit/sandbox-scope.test.ts` - 27 tests holding the brief's claims.
- `tests/integration/sandbox-scope.test.ts` - 3 tests against real
  containment (proofs 1 and 2).

### Harness - changed files

- `src/storage/migrations.ts` - migration 21 `sandbox_scope`: STRICT table
  `(project_id, path, mode, source, preset_id, granted_at)`, primary key
  `(project_id, path)`, plus `project.sandbox_level` defaulting to
  `contained`. No foreign key: a machine-wide row has no parent.
- `src/projects/store.ts` - `ProjectRecord.sandboxLevel`,
  `sandboxLevelOf`, `setSandboxLevel`. Pre-migration rows read as contained.
- `src/sandbox/policy.ts` - `SandboxPolicy.trusted` (default false). Trusted
  means the project's own files are no longer the boundary.
- `src/sandbox/local-sandbox.ts` - trusted bypasses the boundary twice:
  `resolveRead`/`resolveWrite` resolve any path, and `run`/`plan` skip the
  isolation question and run the command uncontained. `assertSupports` still
  enforces the operator's exec/network switches under trusted.
- `src/application/studio-runtime.ts` - `createAgentSandbox` reads the scope
  rows and the level where the policy is built: the conversation's project
  comes from the conversation index (a projectless conversation reads
  machine-wide rows only and is never trusted), `readRoots`/`writeRoots` are
  filled from the store, and trusted sets the policy flag. New
  `conversationExtraRoots` (optional on `AgentHost`, so old test doubles
  still satisfy it) and `scopeDeclined`/`markScopeDeclined` over a runtime
  `ScopeDeclines`.
- `src/agents/studio.ts` - passes the extra roots into `environmentFacts`.
- `src/context/environment.ts` - `EnvironmentFacts.extraRoots` and a short
  paths-only statement in the block when scope exists beyond the workspace.
- `src/transport/http/create-app.ts` - optional `scopes` option; mounts
  `/api/sandbox` when present.
- `src/transport/http/routes/projects.ts` - optional `scopes` option;
  `DELETE /:id` clears the project's scope rows where the project goes.
- `src/app.ts` - composes `SandboxScopeStore` and hands it to the runtime
  (via the database it already owns) and the HTTP app.

### STUDIO - new files

- `src/features/settings/environments/useEnvironments.ts` - the pane's data:
  projects, selected project's scope info, detected presets, level/grant/
  revoke mutations, and the harness's own sentence for the last refused write.
- `src/features/settings/environments/EnvironmentsPane.tsx` - Settings,
  Coding, Environments, replacing the placeholder: this project's level
  (contained/trusted with the consequence beside it), detected toolchains
  with the path found and per-project grant/revoke, everything granted with
  its source and removal, and a custom absolute-path field. Refusals render
  the harness's verbatim reason.
- `src/features/settings/environments/environments.test.ts` - 8 parser tests.

### STUDIO - changed files

- `src/platform/harness/contracts.ts` - sandbox wire mirror: levels, modes,
  sources, `SandboxScopeRow`, `SandboxScopeInfo`, `DetectedPreset`, and
  parsers that refuse anything else.
- `src/platform/harness/client.ts` - `getScope`, `grantScope`,
  `revokeScope`, `listPresets`, `setSandboxLevel` over `/api/sandbox`.
- `src/platform/harness/index.ts` - re-exports.
- `src/features/settings/panes/registry.tsx` - maps `environments` to the
  built pane.
- `src/features/settings/panes/placeholders.ts` - the environments
  placeholder removed (a placeholder for a section that renders is a
  description nothing can show).
- `src/features/settings/providers/useProviders.test.ts` - the client stub
  gains the new methods (refusing, like the MCP half), no test changed.
- `src/features/plans/PlanPanel.tsx` - removed an unused `PlanSnapshot`
  import (pre-existing dead import that fails `tsc -b`; one word, reported
  here, behaviour unchanged).

---

## 2. Tests

Harness unit suite (`npx vitest run tests/unit`, build first), one run,
never concurrent with another suite:

- After: **95 files passed, 1571 passed, 1 skipped, 0 failed (1572 total)**.
  The 1 skip is the pre-existing symlink-privilege skip in `process.test.ts`.
- The +27 are `tests/unit/sandbox-scope.test.ts`. No existing test file was
  modified, so the parent tree measured 1544 passed with the same 1 skip.
  (`git status` verifies: no existing harness test file touched.)

Harness integration, real containment on this Windows machine:

- `tests/integration/sandbox-scope.test.ts`: **3 passed** - refused write
  without the grant, granted write with it (proof 1), Git/bash (proof 2,
  loud skip - see section 5).
- `tests/integration/sandbox-appcontainer.test.ts` (existing, unmodified):
  **16 passed** - no regression in containment behaviour.

STUDIO (`pnpm test --run`):

- After: **61 files passed, 596 passed, 0 failed**. The +8 are
  `environments.test.ts`. Parent measured 588 (the intervening commits added
  one rail test since the Task 56 report's 587).

Typechecks and builds: `tsc --noEmit` clean and `vite build` clean in
`STUDIO HARNESS`; `tsc -b` clean in `STUDIO`.

The brief's nine proofs, and the test holding each:

1. Granted path works under real containment - integration
   `sandbox-scope.test.ts`, "refuses a write outside the workspace without
   the grant" and "writes outside the workspace with the grant".
2. Git unblocks the interpreter - integration "starts bash contained with
   the Git read grant". Skips loudly on this machine (section 5).
3. Question writes the grant, decline writes nothing - "writes the grant
   for this project" and "writes nothing when the person declines".
4. Declined path not asked twice - "does not ask a declined path twice in
   one conversation" (plus `ScopeDeclines` read/write in the decline test).
5. System path refused with a reason naming trusted - "refuses a volume
   root" and "refuses a system directory" (both assert `/trusted/i`).
6. Question shows the resolved path - "shows the resolved path, not the
   model's raw string" (raw contains `..`, question contains the normalized
   absolute and no `..`).
7. Machine-wide rows apply with no project - "applies machine-wide rows to
   a conversation with no project".
8. Trusted removes containment, contained is default - "trusted resolves
   any absolute path and runs uncontained" and "contained is what an
   untouched project still gets" (plus migration tests for the default).
9. Existing permission behaviour unchanged - `permissions.test.ts` (38),
   `permission-scopes.test.ts` (13), `trust-and-modes.test.ts` (22),
   `approval-broker.test.ts` (8), `storage.test.ts` (28), and
   `architecture.test.ts` (32, including the one-owner-per-table gate over
   the two touched tables) all pass with no edits to any of them.

---

## 3. Negative controls (break, watch the named test fail, restore)

Each: the line was broken by hand, the named test was run and failed, the
line was restored and the file re-ran green.

- **NC-1.** Broken: `SandboxScopeStore.resolveRoots` read
  `listProject` instead of `list`, dropping machine-wide rows. Fired:
  "applies machine-wide rows to a conversation with no project"
  (`expected [] to include ...`). Restored.
- **NC-2.** Broken: `LocalSandbox.resolveRead` trusted bypass removed.
  Fired: "trusted resolves any absolute path and runs uncontained"
  (`SandboxError: That path is outside the workspace`). Restored.
- **NC-3.** Broken: `buildScopeQuestion` showed `rawPath` instead of the
  resolved path. Fired: "shows the resolved path, not the model's raw
  string" (question contained `..\outside\file.txt`). Restored.
- **NC-4.** Broken: win32 volume-root refusal shortened to name no remedy
  (no "trusted"). Fired: "refuses a volume root with a reason that names
  trusted" (`expected ... to throw /trusted/i but got 'That path is a
  volume root (C:\).'`). Restored. (First attempt broke the `/` branch,
  which cannot fire on Windows - corrected to the win32 branch.)
- **NC-5.** Broken: `applyScopeAnswer` deny branch returned
  `granted: true`. Fired: "writes nothing when the person declines"
  (`expected true to be false`). Restored.
- **NC-6.** Broken: `extraRootsStatement` returned `[]` unconditionally.
  Fired: "states the extra roots when the conversation has scope beyond
  its workspace" (block lacked `/home/user/.cargo`). Restored.
- **NC-7.** Broken: `resolveRoots` no longer implied read from write.
  Fired: "resolves a write grant as both readable and writable"
  (`expected [] to include ...`). Restored.
- **NC-8 (STUDIO).** Broken: `parseSandboxScopeRow` accepted any mode
  string. Fired: `environments.test.ts` "refuses a mode outside read and
  write" (`expected {... mode: 'execute'} to be null`). Restored.

---

## 4. Rules added that the task did not ask for

- **A write grant implies read** (`scope-store.ts` `resolveRoots`). The
  brief's schema allows `mode: 'write'` alone, and the policy refuses a
  writable root outside every readable root - so a lone write row would be
  an unbuildable policy. The reader puts write paths in both lists. Its
  test is "resolves a write grant as both readable and writable" (NC-7).
- **Whole-answer atomicity of a decline**: `applyScopeAnswer` records the
  decline and writes nothing in the same call - a decline that wrote a row
  and a decline that was forgotten are both refused by "writes nothing when
  the person declines" (NC-5).

---

## 5. Anything found but not fixed

- **The Git unblock claim did not reproduce on this machine.** With the
  machine-wide read entry on `C:\Program Files\Git` present
  (`holdsRead(git, ALL_APPLICATION_PACKAGES)` is true), `bash.exe` run
  contained through `programRoots: [git]` still dies with
  `STATUS_DLL_INIT_FAILED` (3_221_225_794). The integration test measures
  this and skips loudly rather than failing the suite. Related and
  structural: a per-workspace policy grant on a system-owned directory
  fails with launcher error 5 (needs elevation the runtime never takes),
  and the AppContainer backend has no skip-if-machine-wide-covered for
  policy roots (the program-roots path does). So a ticked Git preset writes
  an honest scope row that containment cannot honour until the backend
  learns that skip. Fixing the backend was out of scope ("Deleting or
  reworking the AppContainer backend"), so the preset, the row, and the
  pane are built, and the grant itself is the open item.
- **`pending_question` is still not purged** with its conversation (noted
  in the Task 56 report; out of scope here). Scope rows need no purge:
  they belong to projects, and project delete clears them.
- **Ledger accumulation is visible**: `pnpm sandbox:list` shows 35+
  profiles, many stale `studio-shell-*`/`studio-mcp-launch-*` temp entries
  from test runs. The removal machinery exists (`sandbox:release --stale`);
  the accumulation itself predates this task.
- **`git diff --check` flags `migrations.ts` additions as trailing
  whitespace.** The file is CRLF in HEAD (1188 CRLF lines, verified against
  the git object), the added lines are CRLF too, and git without
  `core.whitespace=cr-at-eol` reads the CR as trailing space on added lines
  only. Endings preserved per the task rule; the flag is a repo-config
  artifact, not introduced whitespace.

---

## 6. Where the brief was ambiguous, and the decision made

- **Who asks the question.** "The run should be able to put the real
  question" is built as model-driven through `native/ask_user_question`
  plus `scope-questions.ts` (build the payload, apply the answer), not as
  automatic harness asking. The broker is untouched and no second asking
  mechanism exists. The retry is never automatic: `applyScopeAnswer`
  reports `granted`, and the caller says the command was retried, because
  the person granted a path and the next thing they see should say so.
- **Decline durability.** "Recorded, so the same question is not asked
  again in this conversation" is in-memory per conversation
  (`ScopeDeclines`, held by the runtime beside the access logs), not a
  database row. The next conversation asks again: "do not nag me" rather
  than "never ask anyone again".
- **Machine-wide identity** is the empty string exactly as specified; there
  is no second table and no foreign key (a machine-wide row has no parent).
  Project delete clears that project's rows via `clearProject` on the
  delete route.
- **Trusted is a policy bypass, not a wide grant.** Granting `/` or `C:\`
  to simulate trusted would be containment claiming to hold while holding
  nothing. Trusted resolves any path in-process and runs commands
  uncontained (`plan` returns the plain command), while the exec/network
  switches still apply.
- **Which project a conversation belongs to** is read from the
  conversation index inside `createAgentSandbox`, overriding the
  `projectKey` fallback. A projectless conversation reads machine-wide rows
  only and is never trusted (there is no project to trust it).
- **`GET /scope` always returns `{project, machineWide, level}`**, even
  with no project id (empty project list, contained level), so the client
  has one shape instead of a union.
- **The settings pane carries its own project picker.** Settings has no
  project context, so "this project" is the picker's selection; the
  machine-wide list is always shown beside it. Preset toggles grant for the
  selected project only - an "everywhere" toggle next to each preset would
  be a global change reachable from somewhere local.
- **Per-project environment variables, remote/container sandboxes, the
  walk-up class, and interpreter demotion** are untouched, as the brief's
  Part 8 requires. The trusted pane copy says Docker lives under level in
  the brief's own words.

---

## 7. Git

No branch was created and no commit was made, on `main` or anywhere else -
the task overrides section 11, and the work is left in the working tree. No
file outside the task's scope was touched except `PlanPanel.tsx` (one dead
import, section 1) and `useProviders.test.ts` (client stub methods, no test
changed). `Backend/`, `docs/`, `prompts/`, `opencode/` were not modified.
