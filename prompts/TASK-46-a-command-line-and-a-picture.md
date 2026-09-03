# Task 46 - A command line, and a picture

Two gaps, both measured, both small.

`shell` spawns one program with an argument vector and no interpreter. On
Windows that means `npm`, `pnpm`, `yarn` and `tsc` cannot run at all - they are
`.cmd` shims and the resolver refuses them by name. `read` handles text files
only, so a model that could look at an image never gets one.

Fix both. Nothing else on the tool surface moves.

---

## Part 0 - Confirm the two facts before changing anything

**The shim refusal.** `shimRefusal` in `src/tools/shell/resolve.ts` refuses
`.cmd`, `.bat` and `.ps1` and tells the caller to run the underlying `.js`
with node. Its own docblock calls this "the single most common thing a user
will hit". Reproduce it: call `shell` with `npm` on Windows and quote what
comes back.

**The sandbox does not need to change.** `SandboxRunOptions`
(`src/sandbox/local-sandbox.ts`) is `{ executable, args, cwd, ... }` - an
absolute path and an argument vector. A shell is an executable and a command
line is an argument, so the isolation layer already expresses what this task
needs. Confirm that in the real code and say so.

If either fact turns out to be wrong, stop and report rather than building on
it.

---

## Part 1 - `shell` takes a command line

**The schema.** `{ command, args }` becomes `{ command }`, a full command line.
`cwd` and `timeoutMs` stay. Rewrite the description: it currently says pipes,
redirects and `&&` are not interpreted, which will be the opposite of true.

**`resolve.ts` inverts.** It stops resolving the program the model named and
starts resolving the interpreter. `shimRefusal` is deleted - `npm` runs
because the shell runs it.

**Which interpreter.** Decide per machine, and prefer a shell whose syntax
models actually write. Windows PowerShell 5.1 does not support `&&`, so
picking it silently would trade one confusing failure for another. Whatever
you choose, **state it in the environment block** so the model writes the right
syntax instead of guessing - that block exists for exactly this, and it
currently says there is no shell, which must change with the code.

**Permission.** `shellResource(name)` produces `shell:node`, one rule per
program, and a command line can name three. Something must read the command
and answer "which programs does this run".

Two rules that are not negotiable:

- Every program the command names is checked, not just the first. A line
  running `npm` and `curl` needs both.
- A command the reader cannot parse is **refused, not run**. A parser that
  guesses is worse than one that admits it is confused, and this is the seam
  where a wrong guess becomes an unreviewed execution.

Start simpler than a full grammar if you like. Be explicit in the code about
what it cannot yet see.

**The ADR.** ADR 0013 states the no-interpreter property as load-bearing, and
ADR 0019 covers running a program the model chose. Read both and write an
amendment in `documentation/decisions/`, the way ADR 0029 amended 0024. Do not
change an accepted ADR in place.

The argument to make, and to check rather than accept: containment is the
sandbox's job (ADR 0041). An interpreter changes what a command can express,
not what it can reach. If you find that is false for our sandbox, that is a
finding and the task stops.

---

## Part 2 - `read` sees images and PDFs

**Images and PDFs come back as attachments**, not as text. Pi's catalog marks
which models accept image input; a model that does not must get a clear
refusal rather than a wall of base64. Say in the report how a text-only model
is handled.

**A wrong path suggests near misses.** A path that does not exist is the most
common failure `read` has, and a suggestion turns a dead end into a successful
retry. Keep it cheap - siblings in the parent directory, nothing recursive.

**Already done, leave alone:** line truncation. `read.ts` truncates at
`MAX_LINE_LENGTH` and pages with `DEFAULT_LINE_LIMIT`.

---

## Explicitly not this task

- **A directory mode for `read`.** `glob` lists paths already.
- **A formatter or LSP after `edit`.** A formatter rewrites lines nobody asked
  to change, and an LSP is a subsystem with no consumer yet.
- **`web_search` and `fetch`.** Held deliberately.
- **`git`.** It keeps its own tool and `classifyGit` keeps its read/write
  distinction. Do not fold it into the shell.
- **A second execution tool.** One door, `gate.ts`, as now.
- **Anything under `src/sandbox/`.** If this task makes you want to change the
  isolation layer, stop and report why.

---

## Constraints

- No `any`, no non-const `as`, no non-null `!`.
- `~/.studio/` is the user's. Nothing deletes or moves anything under it.
- Migrations are append-only, never rewritten.
- UTF-8, no BOM, LF. Em dash in comment prose only; no en dashes, smart
  quotes, curly apostrophes, ellipsis characters, or emoji in source.
- Never leave a green placeholder test.
- Edit by hand, never with a script.
- Forbidden: `git checkout`, `git switch`, `git stash`, `git reset`,
  `git clean`, `git commit`, `git rebase`. `Backend/`, `docs/`, `prompts/`
  and `report/` are the user's - read, never modify, never `git add`.
- The working tree holds a lot of uncommitted work that is not yours, and
  active frontend work in `STUDIO/`. Change only what this task names.

## Verification

- `pnpm typecheck` in `STUDIO HARNESS`, clean.
- The harness vitest suite, with counts. The AppContainer sandbox failures are
  known and environmental on an unprepared machine; name anything else.
- **Run `npm --version` through `shell` and show the output.** That single
  result is the proof this task worked.
- Show a command that names two programs being checked against both.
- Show a command the parser refuses, with its message.
- Read an image through `read` and show what comes back.
- `src/sandbox/` unchanged in the diff.

## Report

`report/TASK-46-a-command-line-and-a-picture.md`:

- Part 0 confirmed, with the code and the reproduced refusal.
- Which interpreter, per platform, and why that one.
- How the command is read for permission, and what it cannot yet see.
- What a text-only model gets when asked to read an image.
- The ADR amendment, and whether the containment argument held.
- Every place this brief was wrong. Task 38's section 9 is the standard.
