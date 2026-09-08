# The two filesystem tools that are missing, and what undo already does

A droppable task. Written 2026-09-08 from a read of the code. The first
section is the finding that decides the design, so read it before planning
anything.

## The finding: undo already exists, and it is not a recycle bin

Models using Studio have asked for `delete`, `mkdir` and `rename`, and the
argument offered for delete was that a tool could add a recycle bin where
`rm -rf` has none. That argument needs revising, because **a restore
mechanism is already built**.

`src/snapshots/` holds a per-turn snapshot system. `contracts/effects.ts`
marks the `write` effect `undo: true`, meaning "a restore point must exist
before this runs"; `tools/gate.ts:319` takes that point before any `write`
tool executes. The store is `snapshots/shadow-repo.ts`: a git repository whose
git directory lives in the Studio home and whose work tree is the user's
project, so the project gains a full history without gaining a second `.git`.
Its own docblock says the history "survives the `rm -rf` it exists to recover
from".

So a delete tool declaring `effects: ["write"]` inherits recovery for free,
with no trash directory, for anything inside the project. That is a better
mechanism than a recycle bin: it restores *edits* as well as deletions, and it
is per-turn, which is the unit a person actually thinks in.

**Your first job is to establish where that mechanism does not reach**, by
reading and measuring rather than assuming. The known suspects:

- Files outside the project - a path the user granted in settings. The shadow
  repo's work tree is the project. A delete there is very likely unrecoverable.
- Whether a person can actually *reach* a restore point today. A history
  nobody can navigate is not undo. Find out what surface exists (HTTP route,
  UI, tool, nothing) and say so plainly.
- The shadow repo shells out to git. Git is currently broken inside our
  Windows containment (`documentation/work/toolchain-onboarding-brief.md`),
  though this code runs from the harness process rather than a contained
  child. **Verify which**, because if snapshots are silently failing on this
  machine then undo does not exist right now and that changes everything.
- Exclusions. `info/exclude` has a hard floor for projects with no
  `.gitignore`. A deleted file that was excluded is not in the history. Find
  out what happens to a delete of an ignored file.

Only after that do you decide whether a trash directory is needed at all, and
for what. A plausible answer is "snapshots cover the project, and a trash
covers granted paths outside it" - but do not assume it, and do not build both
mechanisms for the same files.

## On the Windows Recycle Bin specifically

The user asked whether we can use the real one. Establish the answer rather
than repeating mine; my expectation, which you may overturn, is no, and for
two reasons worth checking:

1. It needs the Windows shell API (`SHFileOperation` / `IFileOperation`), which
   is a COM call, not a filesystem move. From Node that means a native module
   or spawning a helper - and spawning is what containment governs.
2. A contained child on this machine cannot currently even read
   `C:\Program Files\Git`. A COM call into the shell from inside an
   AppContainer is a much larger ask than that.

There is also a semantic problem independent of feasibility: the Recycle Bin
is per-user and per-volume, and a file deleted from a network path or a
different volume may not go there at all. A mechanism that silently sometimes
works is worse than one that never claims to.

If a Studio-owned trash turns out to be needed, its directory belongs beside
the other conversation and project data in `platform/paths.ts`, and it needs
an answer for retention: what purges it, when, and whether
`conversations/purge.ts` should know about it.

## The tools

**`delete`** - the one that matters. Removes a file or a directory.
`LocalSandbox.remove` already exists (`sandbox/local-sandbox.ts:447`), already
refuses to remove the workspace root, and already resolves through
`resolveWrite`, so containment is done. What the tool adds is the descriptor,
the effect declaration that earns the snapshot, the access-log record, and the
refusal messages.

Decide and justify: does deleting a directory need a stronger precondition
than deleting a file? `write.ts` has a precedent worth copying - replacing a
file requires that the conversation has read it first, on the reasoning that a
model that has not read a file does not know what it is discarding. The
equivalent for a recursive directory delete is worth thinking about, because
that is the call that loses the most in one step.

**`move`** - rename and relocate. Nothing else in the tool set can express it:
edit changes contents, write creates. Both paths resolve through
`resolveWrite`. Refuse a move that would overwrite an existing file unless
that is explicitly asked for.

**`mkdir`** - do not build it. `write.ts:93` already walks up and creates every
missing parent directory, so the only thing a mkdir tool buys is an empty
directory, which almost nothing needs. Say so in your report rather than
silently omitting it.

## What must not break

- The snapshot contract. A `write`-effect tool gets its restore point taken by
  the gate before it runs; nothing here may bypass or reorder that.
- `resolveWrite` as the only path resolution. No tool resolves its own paths.
- The workspace-root refusal in `LocalSandbox.remove`.
- The access log. It is the one answer to "what has this agent touched", and a
  delete is the most important entry it can hold.

## Testing

`pnpm test` from `STUDIO HARNESS`, **never two suites at once** - both rewrite
`dist/`, and a directly-started vitest run tests a stale bundle after a source
edit. Baseline is 1835 passing, 25 skipped, 0 failing.

Cover at minimum: a delete inside the project is restorable from the snapshot
afterwards (the real test, not a mock); the workspace root is refused; a move
that would clobber is refused; the access log records both.

## Report

Say what you measured, especially the four suspects in the first section. If
snapshots turn out to be broken on this machine, stop and report that instead
of building on top of it - it is a bigger finding than the tools are.
