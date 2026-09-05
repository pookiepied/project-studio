# TASK 58 - A project you can actually work in

A project is filing today, not a workspace. It has a name, a mark, a
description, folders, and conversations under it - and none of that reaches the
place where a turn decides which directory it runs in. Every conversation, in a
project or not, runs in its own empty conversation directory.

This task makes a project conversation run in the project's folders, and closes
the two holes in the Environments pane that Task 57 left behind.

There is a second task beside this one, Task 59, for the real folder picker.
Do not do that work here. The two split cleanly: this task is TypeScript in
the harness and the frontend, Task 59 is a Tauri plugin and a capability grant.

---

## Part 0 - What already exists, so you do not rebuild it

Read these before writing anything. Several of them already say what to do.

**The store already knows this is coming.** `src/projects/store.ts`, in its
opening comment: *"A folder row decides what a project offers when a turn binds
sandbox roots (the same layer as today's single workspace root); everything
that authorizes a call still flows through the kernel alone."* That is this
task, stated a year early. Keep the distinction it draws: folders offer, the
kernel authorizes.

**The agent already left the seam open.** `src/agents/studio.ts:135`:

```ts
const kind = workspace === conversationWorkspaceDirectory(id) ? "conversation" : "project";
```

with the comment *"Today they are always equal - a project conversation does
not yet override the roots - so this reports 'conversation' for every run,
which is the truth. When the override lands, the comparison starts answering
'project' on its own, with nothing here to remember to change."* Land the
override and that line starts telling the truth by itself. Do not rewrite it.

**The sandbox already takes what you need to give it.**
`StudioAgentSandboxOptions` has `projectRoot` and `projectId`, and
`createAgentSandbox` already fills `readRoots` and `writeRoots` from the scope
store. A second folder is an extra root, not a new mechanism.

**The environment block already says opposite things for the two kinds.**
`workspaceStatement` in `src/context/environment.ts` has a `project` branch that
has never once been rendered. Read it. It tells the model the files are the
person's, that they existed before this conversation, and not to scatter working
files through the tree. That text is correct and stays.

**What the frontend has.** `NewProjectDialog` creates projects and they reach
the harness. `ProjectPage` renders folders and files new conversations under
the project. `ProjectSection` lists them in the sidebar. The plumbing is real;
what it plumbs is not.

**What Task 57 shipped.** `sandbox_scope`, the eight presets, the Environments
pane, `SandboxPolicy.trusted`, and `project.sandbox_level`. Machine-wide rows
(the empty project id) already apply to every project and to projectless
conversations, and that has a test. Do not change that.

---

## Part 1 - A project conversation runs in the project's folders

The change is in `Studio()` in `src/agents/studio.ts` and in
`createAgentSandbox`.

When the conversation is filed under a project that has at least one folder:

- The sandbox root is the project's **first** folder, by `position`.
- Every other folder joins the policy's read and write roots.
- `kind` becomes `project` by the comparison already written there, because
  the workspace no longer equals `conversationWorkspaceDirectory(id)`.

When the conversation is filed under no project, or under a project with no
folders, nothing changes: the conversation directory, and `kind` stays
`conversation`. A project with no folders is a label, which is what the
`NewProjectDialog` comment already calls it.

Two details that are easy to get wrong:

**The conversation directory does not disappear.** `createSandbox` in
`studio-runtime.ts` creates three directories: the workspace, the attachments
directory, and the artifacts directory. The last two are conversation-scoped
and are still needed for a project conversation - an attachment does not belong
in the person's repository. Only the first one changes meaning.

**Never create a project folder.** The conversation workspace is created
because it is ours and it starts empty. A project folder is the person's, and a
project folder that is not there is a mistake to report, not a directory to
make. If the first folder does not exist when a turn starts, refuse the turn
with a message naming the project and saying the folder is missing. Do not
silently fall back to the conversation directory: a model told it is in a
project, writing into an empty directory it believes is a repository, is worse
than a refusal.

**The order is `position`, not insertion or name.** The store already keeps
`position` and the frontend already lets folders be reordered. First means
first as the person arranged it.

---

## Part 2 - A folder path has to be real

Today `ProjectStore.create` and `addFolder` store whatever string arrives. No
absoluteness check, no existence check, nothing. That is survivable while a
folder is decoration. It stops being survivable the moment a folder becomes a
sandbox root.

Validate a folder path on write, in the store, for both `create` and
`addFolder` and for the `path` change in `updateFolder`:

- Absolute. A relative folder means something different depending on where the
  harness was launched from.
- Exists, and is a directory.
- Refused if it is a volume root or a system directory.

That last rule already exists: `systemScopeRefusal` in `src/sandbox/scope.ts`,
which Task 57 wrote and which now guards every scope grant. Use it rather than
writing a second list of system paths - two lists that disagree is the bug
this avoids. `validateCustomScopePath` in the same file does absolute, exists,
and the system refusal together, and it is the right shape to reuse. Read it
before deciding whether to call it or to write a folder-specific sibling beside
it; if you write a sibling, it must call `systemScopeRefusal` rather than
restate it.

Existing rows are not migrated. Validation is on write. A project created
before this task may hold a path that nothing checked - Part 1's refusal is
what catches it, at the moment it would matter.

---

## Part 3 - Tell the model where it is

With `kind` finally answering `project`, the block's project branch renders for
the first time. Two things to add to it, and nothing more:

**Name the folders.** A project with three folders should say so, with their
paths, the same way `extraRootsStatement` lists extra roots. One line per
folder. The model should not have to run a command to learn the shape of the
thing it was opened into.

**Say which one is the working directory.** With several roots, "your working
directory" is now a choice someone made rather than the only place there is.

Do not add advice about how to behave in a project. `workspaceStatement`'s
project branch already carries it, it was written carefully, and it has been
waiting to be used.

---

## Part 4 - The two holes in the Environments pane

Both are in `STUDIO/src/features/settings/environments/EnvironmentsPane.tsx`
and both were found by using the pane rather than by reading it.

**A machine-wide grant cannot be created.** Machine-wide rows render with a
Remove button, and nothing anywhere makes one. The only surface that ever wrote
the empty project id is the scope question, which has no caller (see Part 6).
So the pane can take away a grant it can never give. Add the giving half: a
preset and a custom path must both be grantable machine-wide as well as for the
selected project. The harness side already supports it - `POST /api/sandbox/scope`
takes an empty `projectId` and the store handles it.

**With no projects, the pane is read-only.** Every grant control is inside a
`projectId === null ? null : ...`, so on a machine with no projects the preset
buttons and the whole custom-path field are absent. The person sees seven
detected toolchains and no way to act on any of them. With machine-wide
grants available this fixes itself, provided the controls stop being gated on
having a project.

Keep the two scopes visibly different. A machine-wide grant applies to every
project and to conversations with no project, which is more than most people
mean by "allow this" - the control should say which one it is doing, in words,
at the moment of the click.

---

## Part 5 - Verification

Every claim below needs a test, and every load-bearing test needs a negative
control: break the line, watch the named test fail, restore it, watch it pass.
Report each one.

1. A conversation filed under a project with folders runs with the first folder
   as its sandbox root, and `kind` is `project`.
2. The other folders are readable and writable.
3. A conversation with no project is unchanged: conversation directory,
   `kind` is `conversation`.
4. A project with no folders is unchanged in the same way.
5. A first folder that does not exist refuses the turn, and the message names
   the project.
6. A project folder is never created by the harness. (Point the root at a path
   that does not exist and assert it still does not exist after the refusal.)
7. The attachments and artifacts directories are still created for a project
   conversation.
8. A relative folder path, a missing one, a volume root and a system directory
   are all refused on write, with the system cases naming `trusted`.
9. Machine-wide scope rows still apply to a project conversation - Task 57's
   test for this must still pass, unedited.
10. The block names every folder and says which one is the working directory.
11. The pane can create a machine-wide grant, from a preset and from a custom
    path.
12. The pane offers grant controls with no project selected.

One of these is an integration test against real containment, not a unit test
against the policy object: a command run in a project conversation can write
the second folder. `tests/integration/sandbox-scope.test.ts` is the pattern -
create the directories the test needs and remove them afterwards.

---

## Part 6 - Out of scope

Do not do these here, however tempting:

- **The folder picker.** That is Task 59. `NewProjectDialog.addFolder` still
  fabricates `D:/Work/<slug>` paths in this task. Leave it, and do not create
  a project against a real path by hand to test - Part 5 works at the store and
  runtime level.
- **Wiring the scope question.** `buildScopeQuestion` and `applyScopeAnswer`
  have tests and no caller. That is known, it is written down in the Task 57
  commit, and it is its own task.
- **Per-project environment variables**, remote or container sandboxes, the
  walk-up class (Next.js, esbuild), and interpreter demotion. All still open,
  none of them this.
- **Changing what `trusted` means**, or the AppContainer backend.
- **Migrating existing folder rows.** Validation is on write.

---

## Part 7 - Rules

The standing ones, restated because they are the ones that get missed:

- No `any`, no non-const `as`, no non-null `!`.
- UTF-8, no BOM. Em dash in comment prose only. No en dashes, smart quotes,
  curly apostrophes, ellipsis characters, or emoji in source.
- Preserve each line's existing CRLF or LF ending. No scripted
  search-and-replace across files.
- Applied migrations are frozen and append-only. If this task needs one it is
  migration 22 - but read Part 2 again first, because validation on write needs
  no schema change.
- Run vitest suites one at a time, never concurrently. `pnpm build` in
  `STUDIO HARNESS` before running its suite.
- `Backend/`, `docs/`, `documentation/`, `prompts/`, `opencode/` are read-only.
  Write exactly one file outside the code: your report at
  `report/TASK-58-a-project-you-can-actually-work-in.md`.
- No git commands that move HEAD or the index: no `checkout`, `switch`,
  `stash`, `reset`, `clean`, `commit`, `rebase`. Leave the work in the tree.
- Do not write to the D: drive, and do not touch anything under `~/.studio`
  except by reading. For anything destructive set `PROJECT_STUDIO_HOME` to a
  throwaway directory.
- Report what you found and did not fix, what the brief got wrong, and every
  rule you added that this task did not ask for.
