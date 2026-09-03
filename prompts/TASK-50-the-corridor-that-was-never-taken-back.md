# Task 50 - The corridor that was never taken back

Containment on Windows grants a *traverse* entry on every ancestor of a
workspace, so a contained program can resolve its own path. Those entries are
never revoked. On the machine this was found on, 610 of them accumulated in
three days, the DACL on `C:\Users\pooki` reached 65,568 bytes against a
Windows hard limit of 65,535, and containment stopped working entirely -
`SetEntriesInAclW` returns error 87 because the list is physically full.

Every measurement in this brief was taken on that machine. None of it is
hypothetical, and the failure mode is permanent until someone edits the ACL
by hand.

---

## Part 0 - Confirm the mechanism before changing anything

1. `src/sandbox/isolation/windows/appcontainer.ts:83` - a prepared container
   holds `traversed: Set<string>`, populated at line 142 from
   `ensureTraversable`'s `granted`.
2. Line 247 - `releaseIsolation` revokes ancestors by reading
   `container?.traversed ?? []`, where `container` comes from `this.#prepared`,
   an **in-memory map of the running process**.
3. `pnpm sandbox:release --stale` (`src/sandbox/cli.ts`) runs in a fresh
   process, so `#prepared` is empty, `container` is `undefined`, and that loop
   iterates nothing. The profile is deleted - the SID is recovered separately
   through `deriveExisting` - and the ancestor entries stay.
4. `src/sandbox/isolation/windows/ledger.ts:45` - `ProfileEntry` is `name`,
   `workspaceRoot`, `createdAt`. The corridor is not in it, so nothing on disk
   records which ancestors were granted.
5. `traversal.ts:131` - `ensureTraversable` skips an ancestor entirely when
   `holdsTraverse(ancestor, ALL_APPLICATION_PACKAGES)` is true. That is the
   machine-wide entry `sandbox:prepare` installs.

Verify all five. The comment above line 247 says leaving these behind "would
be the 'only ever adds' growth this method exists to prevent" - the intent was
right and the state it depends on does not survive the process. If any of the
five is not what this brief says, stop and report.

---

## Part 1 - Release must be able to revoke what it granted

`release` needs to know the corridor without having minted it. The ledger is
the natural place: it already exists, already survives the process, and is
already written when the profile is minted.

Persist the granted ancestors alongside the profile, and revoke from that
record. Keep the existing entries readable - a ledger written before this
change has no corridor field, and must not crash a release or be silently
treated as "nothing to revoke". An entry that cannot say what it granted
should say so in the listing, because on this machine those entries are the
ones that leaked.

The ledger's own docblock is careful that it is a log of what we know we did,
never a claim about the machine. Keep that. This adds to what we know we did.

---

## Part 2 - Prefer the entry that needs no revoking

A machine with the `ALL APPLICATION PACKAGES` entry on an ancestor never takes
the per-workspace path for it, so there is nothing to accumulate and nothing
to take back. That is what `sandbox:prepare` is for, and on the machine this
was found on it had been applied to `C:\` and `C:\Users` but never to the user
directory - which is exactly where the 610 entries landed.

Work out whether the shortfall can be reported before it becomes a leak, so a
user learns their home directory wants one setup command *before* a few
hundred runs, not after. Do not silently widen what `prepare` grants, and do
not make the runtime elevate itself.

---

## Part 3 - The growth has to be bounded even when release never runs

All 610 leaked entries came from the test suite's temp workspaces. A suite
that mints containers and leaves them is the ordinary case, not misuse, and
the design cannot depend on a maintenance command being run by hand.

Decide how a contained workspace stops costing an ACE forever, and justify it.
Reusing one identity where the isolation argument still holds, releasing at a
point that actually runs, and reporting when the corridor is near its limit
are all legitimate. What is not legitimate is a fix that only works when
someone remembers to run a command.

Whatever you choose, a user already in the broken state needs a way out. On
this machine the leftovers are unresolvable `S-1-15-2-*` entries and the
account's real entries are four rows. A repair path must never remove an ACE
this system did not add.

---

## Part 4 - The interpreter cannot read its own installation

Found after the brief was written, by repairing the machine and running the
suite. Once containment actually works, `tests/unit/tools/shell.test.ts`
fails 10 times with exit code `3221225794` - `STATUS_DLL_INIT_FAILED`. The
contained process launches and cannot load its own libraries. Before the
repair this was invisible: the container refused before a program ever ran.

Task 46 predicted it and could not fix it, because its brief put
`src/sandbox/` out of bounds. Its ADR 0046 records the finding: a contained
program that reads its own files at runtime needs a read grant on its
program directory (ADR 0041 already records the same case for the Python
standard library). `ContainRequest.programRoots` exists and the MCP launcher
uses it. `LocalSandbox.run` has no channel to it.

Give it one. The interpreter's own directory is the case that matters -
on the machine this was written on the shell resolves to Git for Windows'
`bash.exe` under `C:\Program Files\Git`.

Read, never write, and only the program's own directory: a grant wide enough
to make the test pass by giving the container the filesystem would defeat
the point of containing it at all. `grantsFor` and the existing read/write
root handling are the shape to follow.

Those 10 failures passing, from a prepared machine, is the proof for this
part.

---

## Non-negotiable

- **Never remove an access-control entry Studio did not create.** Named
  accounts, capability SIDs, inherited entries, and resolvable package SIDs
  are somebody else's. Removing the wrong one silently breaks an unrelated
  application on a user's machine, and it is not recoverable from our side.
- **A release that cannot identify what to revoke reports it.** Do not guess
  at a corridor, and do not treat an unknown as an empty set - that is
  precisely the bug.
- **`sandbox:prepare` stays the only elevated step**, and stays as narrow as
  it is: traverse and read-attributes, non-inheriting, on named ancestors
  only.
- Applied migrations are never rewritten, and nothing under `~/.studio/` is
  deleted or moved on the user's behalf beyond the sandbox ledger this task
  owns.

---

## Not this task

- `src/permissions/`, `src/transport/`, the approval flow. Tasks 47 and 48 own
  those and are running.
- Any tool under `src/tools/`.
- Linux and macOS containment beyond keeping them compiling and their tests
  green. The leak is the Windows ACL.
- Conversation deletion and the orphaned conversation folders. Different
  problem, still open, not this.

---

## Verification

Measured, in bytes, on a real machine.

**Read this before you measure anything.** An agent shell on this project runs
sandboxed, and the user's `AppData` directory is redirected to a private copy
inside that sandbox. Reading a DACL there returns the sandbox's view, not the
machine's - during the investigation that produced this brief, the same path
read 188 bytes from an ordinary elevated shell and 57,140 bytes from an agent
shell, and three rounds of "the fix did not work" were that discrepancy rather
than the fix. The profile root itself is not redirected, which is what makes
the trap convincing.

So: take every measurement from a shell you have confirmed is unsandboxed,
say in the report how you confirmed it, and never conclude from an agent-shell
reading alone that entries are present or absent.

1. Record the DACL size on the user directory:
   `(Get-Acl 'C:\Users\<user>').GetSecurityDescriptorBinaryForm().Length`
2. Run a contained workspace a number of times - twenty is enough to see the
   slope.
3. Release, and show the size returning to the starting number. Not smaller,
   not larger, and not merely "release exited 0" - the previous cleanup exited
   0 having revoked nothing, which is how this survived.
4. Show the count of `S-1-15-2-*` entries before and after.

Also show a release against a workspace whose directory has been deleted,
since that is the case `--stale` exists for and the case the in-memory
corridor could never serve.

Run the two vitest suites one at a time. The baseline on the repaired machine
is **10 failed / 1423 passed / 25 skipped**, all 10 in
`tests/unit/tools/shell.test.ts` and all of them Part 4's
`STATUS_DLL_INIT_FAILED`. Part 4 should take that to zero. Report the number
you actually observe, and account for any failure that is not one of those 10.

---

## Rules

`Backend/`, `docs/`, `prompts/` and `report/` are read-only context. Never
`git checkout`, `switch`, `stash`, `reset`, `clean`, `commit` or `rebase`. No
`any`, no non-const `as`, no non-null `!`. UTF-8, no BOM, LF. No en-dashes,
smart quotes, curly apostrophes, ellipsis characters or emoji in source. Edit
by hand, never with a script. No green placeholder tests.

Report to `report/TASK-50-the-corridor-that-was-never-taken-back.md`,
including every place this brief was wrong.
