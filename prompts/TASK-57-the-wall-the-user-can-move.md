# TASK 57 - The wall the user can move

Containment is closed by default and has no override. That was right when it
was written and it is wrong now: a real toolchain keeps state outside the
project it is building, and a wall with no door turns every one of those into
a dead end the person cannot open.

This task adds the door. A refusal for a path becomes a question the person can
answer, the answer is durable, and the settings page shows every door that has
been opened and lets them be closed again.

Read all of it before writing anything. Part 0 is what already exists; most of
the mechanism is built and this task is mostly about deciding and remembering.

---

## Part 0 - What exists, and must not be rebuilt

**The policy already carries the roots.** `SandboxPolicy` in
`src/sandbox/policy.ts` has `readRoots` and `writeRoots`, and both backends
already honour them: `src/sandbox/isolation/windows/appcontainer.ts` grants an
access-control entry per root, and `src/sandbox/isolation/linux/bwrap.ts` binds
each one. Nothing about the enforcement needs writing. What is missing is that
nobody ever puts anything in those arrays.

**A CLI already grants read directories.** `pnpm sandbox:prepare --read <dir>`
exists in `src/sandbox/cli.ts`, with `--undo`. Read it before designing
anything: the machine-level half of this problem is solved there, and this task
is the per-project, per-user half.

**A ledger already records what containment left behind**
(`src/sandbox/isolation/windows/ledger.ts`), because a profile named
`studio-9f86d081…` names nothing a person can act on. Its docblock is the model
for how this task should think about visibility. Follow it.

**Task 55 shipped `native/ask_user_question`.** That is the tool this task uses
to turn a refusal into a decision. Read `src/tools/ask/questions.ts` and
`src/application/question-broker.ts`. Do not build a second asking mechanism.

**The settings slot exists.** `STUDIO/src/features/settings/sections.ts` has a
`coding` group with an `environments` section, and its placeholder already
names the contents: "Local, container, or remote", "Environment variables per
project", "Sandbox profile". This work belongs there.

**Projects exist.** `src/projects/store.ts` has `ProjectRecord` with `id`,
`name`, `icon`, `description`, `folders`, `createdAt`. Scope attaches to a
project id.

**Migration 20 is the highest.** Yours is 21. Migrations 1-20 are frozen.

### What was measured, so you do not re-measure it

Run under real containment on the development machine, and the reason this task
exists:

- **Working now:** node, npm, npx, git, python (venv, `pip install` from PyPI,
  import and use), dotnet, curl, TypeScript (`npm i typescript` then
  `npx tsc`).
- **Failing for a path outside the project:** cargo (`could not create home
  directory: 'C:\Users\...\.rustup'`). This is the class this task fixes.
- **Failing because it reads above the workspace root:** Next.js/Turbopack
  (`failed to canonicalize path`), esbuild (`Cannot read directory "../../.."`),
  and Node's own `realpathSync.native` (`EPERM`). **This task does not fix
  that class.** Canonicalising needs directory listing on every ancestor up to
  the volume root; `C:\` grants app packages `(Rc,S,X,RA)` with no read-data,
  and granting it there is a machine-wide change to the drive root. Measured:
  granting listing on an intermediate directory does not help, because the
  ancestors above it still refuse.
- **Git for Windows' `bash.exe` cannot be contained** because it loads
  `msys-2.0.dll` from `C:\Program Files\Git`. This is the highest-value single
  grant in the whole task: it is the cause of the interpreter demotion chain,
  and the demotion chain is what made a `tar` failure cost a session its
  package manager (see commit 8cfdcfe).

---

## Part 1 - Two levers, and they are not the same

The settings pane shows both, and must never present one as the other.

**Scope** - which paths this project may read and write beyond its own folder.
Additive, per path, each one a decision the person made and can unmake.

**Level** - whether this project is contained at all. `contained` (the default)
or `trusted`. The escape hatch for the walk-up class, and for Docker.

Docker belongs under `level`, not under scope, and the brief is explicit about
it because it looks like it belongs in the preset list: a contained process
that can reach the Docker daemon can mount any path on the machine, so a
"Docker" path preset would be a containment bypass wearing a preset's clothes.
If someone needs Docker, they are choosing `trusted`, and the UI should say so
in those words.

---

## Part 2 - The refusal that becomes a question

This is the part that removes the pain, and it is the part to build first.

When a command is refused because it needed a path outside its roots, the run
should be able to put the real question to the person:

> cargo needs to write `C:\Users\pooki\.rustup`, which is outside this project.
> - Allow it for this project
> - Allow it for every project
> - Don't allow it

Answering writes the scope entry and the command can be retried. Declining is a
real answer and is recorded, so the same question is not asked again in this
conversation.

### The constraint you must respect

`src/sandbox/errors.ts` deliberately does **not** put the attempted path in
`SandboxError`'s message, and its docblock says why: a blocked path is
model-produced and may embed content the model was working with, so the message
names the boundary rather than the attempt.

That rule stands for the message. The question is a different surface: the
person cannot grant a path they are not shown. So the path may appear in the
question, and it must be the **resolved, normalized absolute path** the sandbox
computed - never the raw string the model wrote. If those two differ, the
resolved one is the truth and the only one shown.

### What must not happen

Do not auto-grant. Do not offer a "remember for everything" that is preselected.
Do not let a declined path be asked again in the same conversation. Do not make
the retry automatic and invisible - the person granted a path, and the next
thing they see should say the command was retried.

---

## Part 3 - The catalog

A **preset** is a named bundle of paths with a detector. It grants nothing. It
exists so that a person who has Rust installed does not have to know that Rust
keeps a toolchain in `.rustup`.

Two rules decide the whole design:

**A preset that cannot be detected is not shipped.** Paths vary by OS, by
version, and by install method - pyenv against system Python, nvm against
system Node, winget against scoop against an installer. A preset with a wrong
path either grants something nobody intended or silently grants nothing while
looking correct, and the person cannot tell which. So each preset carries a
detector, the pane shows only what is actually on the machine, and it shows the
path it found.

**Ship the ones a working developer actually hits.** Not thirty. The list below
is the opening set, chosen from what the measurements above show breaks or is
likely to:

- **Git** - `C:\Program Files\Git` and the platform equivalents, read only.
  First in the list because it is the one that unblocks the interpreter.
- **Rust** - `~/.rustup`, `~/.cargo` (write; cargo writes both).
- **Node caches** - the npm cache, the pnpm store, the yarn cache (write).
- **Python** - the user site-packages and pip cache; and, when a global
  interpreter is in use, its own installation directory read-only.
- **Java** - `~/.m2`, `~/.gradle` (write).
- **Android and Flutter** - the Android SDK, the Flutter SDK, the Gradle cache.
  One preset, because nobody has one without the others.
- **Go** - the module cache and `GOPATH`.
- **.NET** - the NuGet package folder.

That is eight. Add a ninth only if you measure it failing.

Note what is deliberately absent. **IDEs are not presets**: the agent does not
launch VS Code, Android Studio, or a JetBrains IDE, and granting their config
directories buys nothing. What matters is the toolchain those IDEs drive, which
is already in the list. **Docker is not a preset**, for the reason in Part 1.

**Custom paths are first-class**, not a fallback. A text field that takes an
absolute path and a mode (read or write), validated: the path must exist, must
be absolute, and must not be a volume root or a system directory. Refuse
`C:\`, `C:\Windows`, `/`, `/etc`, `/usr` and their equivalents, and say why -
a grant on those is not a scope, it is the end of containment, and the person
who wants that wants `trusted` instead.

---

## Part 4 - Storage

Migration 21. One table, `sandbox_scope`:

```
project_id   TEXT NOT NULL     -- or the empty string for "every project"
path         TEXT NOT NULL     -- absolute, normalized
mode         TEXT NOT NULL     -- 'read' | 'write'
source       TEXT NOT NULL     -- 'preset' | 'custom' | 'question'
preset_id    TEXT              -- which preset, when source is 'preset'
grantedAt    INTEGER NOT NULL
PRIMARY KEY (project_id, path)
```

STRICT. The empty project id for a machine-wide grant rather than a second
table: the two are the same decision at different scopes, and one reader that
takes both is simpler than two that must be kept in step.

`source` earns its column. A person looking at this list needs to tell "I ticked
Rust in settings" from "I said yes to a question mid-run" - the second is the
one they may not remember making, and it is the one they are most likely to want
to revoke.

The level lives on the project, not here: add a `sandbox_level` column to the
project record's table in the same migration, defaulting to `contained`.
Nothing about an existing project changes.

**Read it where the policy is built.** `createAgentSandbox` in
`src/application/studio-runtime.ts` is where `createSandboxPolicy` is called
and where `readRoots`/`writeRoots` should be filled from this table. A
conversation with no project reads the machine-wide rows only.

---

## Part 5 - The settings pane

Settings, Coding, Environments. The section exists and is a placeholder; replace
it.

Three parts, in this order:

1. **This project's level.** Contained or trusted, with one sentence saying what
   trusted means in plain words - the project's own files are no longer the
   boundary. Not a toggle buried in a row; a decision with its consequence next
   to it.
2. **Detected toolchains.** Each preset the machine actually has, with the path
   it found, a checkbox, and whether it is on for this project or everywhere.
   A preset that is not detected is not shown; a line saying "we look for these"
   is better than a checkbox that does nothing.
3. **Everything granted, and where it came from.** Every row of
   `sandbox_scope` for this project and machine-wide, with its `source`, and a
   way to remove each one. This is the ledger's lesson: the removal already
   worked, what was missing was seeing what existed.

Follow the existing design system. Take interaction patterns from whatever
reference is at hand, never colours, spacing, or typography.

---

## Part 6 - Telling the model

Same rule as the rest of the harness: the model is told what is true, so it
stops guessing.

The environment block (`src/context/environment.ts`) already states containment
and what it means. Add to it, when the conversation has any scope beyond its
workspace, a short statement of what those extra roots are. A run that knows it
can write `~/.cargo` does not spend a call discovering it.

Keep it short - the block is paid for on every conversation. Paths only, no
explanation of how they got there.

---

## Part 7 - Verification

`documentation/rules.md` holds: `pnpm build` before the suite, suites one at a
time and never concurrently, and every load-bearing test gets a negative
control - break it, watch the named test fail, restore it. Report each control
and which test it fired.

Prove these specifically:

1. **A granted path actually works.** With a scope row for a directory outside
   the workspace, a contained command can write there; without it, the same
   command is refused. This is the whole task and it must be an integration
   test against real containment, not a unit test against the policy object.
2. **Git unblocks the interpreter.** With `C:\Program Files\Git` granted read,
   `bash.exe` starts contained rather than dying with
   `STATUS_DLL_INIT_FAILED`. Skip on a machine without Git for Windows, loudly.
3. **The question writes the grant**, and a declined question writes nothing.
4. **A declined path is not asked twice** in one conversation.
5. **A refused system path is refused with a reason.** `C:\`, `C:\Windows`, `/`
   and `/etc` are rejected by the validator and the message says to use
   `trusted` instead.
6. **The question shows the resolved path**, not the model's raw string. Give
   it a path with `..` in it and assert the normalized form is what appears.
7. **Machine-wide rows apply to a conversation with no project.**
8. **Level `trusted` removes containment** for that project's conversations,
   and `contained` is what an untouched project still gets.
9. **Existing permission behaviour is unchanged.** The approval tests, the trust
   and mode tests, and the storage tests must pass without edits. If you find
   yourself editing one, stop and say so in the report.

---

## Part 8 - Out of scope

- The walk-up class. Next.js and esbuild are not fixed here and the brief must
  not pretend otherwise. `trusted` is the answer for them today.
- Remote and container sandboxes. The Environments placeholder names "local,
  container, or remote" and only local is in this task.
- Per-project environment variables, the placeholder's second line.
- Any change to the interpreter demotion logic; it was settled in 8cfdcfe.
- Deleting or reworking the AppContainer backend.

---

## Rules for this session

You do not commit and you do not switch branches. No `git checkout`, `switch`,
`stash`, `reset`, `clean`, `commit`, or `rebase`. This overrides section 11 of
`documentation/rules.md`. Leave the work in the working tree.

`Backend/`, `docs/`, `prompts/`, `opencode/` are read-only. Your one writable
file outside the source is your report at
`report/TASK-57-the-wall-the-user-can-move.md`.

Never delete or move anything under `~/.studio/` - that is the user's real
data. For any destructive test point `PROJECT_STUDIO_HOME` at a throwaway
directory. Never touch `*.beta9-journal` files. Do not write to the D: drive.

**This task grants access to the user's real filesystem.** Every test that
grants a path grants it to a directory the test created and removes afterwards.
Do not grant a real toolchain directory from a test unless the test only reads
it, and never grant a system directory from anywhere.

No `any`, no non-const `as`, no non-null `!`. UTF-8 with no BOM. Preserve each
file's existing line endings. No scripted search-and-replace across files -
hand edits, one at a time. Em dashes in comment prose only; no en dashes, smart
quotes, curly apostrophes, ellipsis characters, or emoji in source.

Applied migrations are frozen. Yours is 21, append-only.

Kill processes by PID only, never by name.

Your report covers: files changed and what each change was; test counts before
and after; every negative control and which test it fired; any rule you added
that the task did not ask for; anything found but not fixed; and every place
this brief was ambiguous with the decision you made, so it can be argued with.
