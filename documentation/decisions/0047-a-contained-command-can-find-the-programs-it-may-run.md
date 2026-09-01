# ADR 0047 - A Contained Command Can Find the Programs It May Run

**Status:** Accepted · 2026-08-31
**Extends:** [ADR 0041](0041-containment-is-the-kernel-s-job.md) - containment
is the kernel's job, and this closes the one gap that decision left open.
**Relates to:** [ADR 0046](0046-the-shell-takes-a-command-line.md) - the shell
takes a command line, whose "what the argument bends" note predicted exactly
this gap.
**Supersedes in part:** the "not the executable's own directory" rule in
`program-roots.ts`, which holds for direct launches and does not hold for
interpreter children.

## Context

A contained `node.exe` runs: the launcher opens its image with its **own**
rights before the container token applies (ADR 0041). But an interpreter is
itself contained, and every program the model's command line starts is
spawned *from inside the container*, by the interpreter, under the container's
token. For the container to find `node` at all, two things must be true that
no grant covers today:

1. `C:\Program Files\nodejs` must be **readable**, so PATH search can find
   `node.exe` - a contained `where node` answers `INFO: Could not find files
   for the given pattern(s)` against a perfectly correct granted PATH,
   because the directory cannot be listed.
2. The image of the program the interpreter starts must be readable, so
   `CreateProcess` inside the container succeeds at all.

Measurement behind this: the directory `C:\Program Files\nodejs` carries a
protected, non-inheriting DACL with no `ALL APPLICATION PACKAGES` entry
(checked with the launcher's `check` subcommand and with `icacls`), while
`C:\Program Files`, `C:\Windows`, and `C:\Windows\System32` all carry the
inherited entry - which is why System32 tools run and node does not.

The runtime cannot fix this. Adding an entry to `C:\Program Files\nodejs`
needs `WRITE_DAC` on a directory owned by Administrators, and an unelevated
process holds none - measured as launcher error 5. ADR 0041 states the
runtime must never elevate. `install-requirements.md` already records that
Windows needs one elevated step at install time; this ADR says what that
step must now cover.

## Decision

**Program discovery is two halves: the runtime resolves and grants what it
can, and the install grants what it cannot.**

### The runtime half: resolve, then grant the resolved directory

The shell resolves every program a command line names through the **policy
PATH and PATHEXT** - the same PATH the child receives, so what the runtime
resolves is what the interpreter will find - and hands each resolved program's
**directory** to containment as a read program root, by the workspace's own
SID, the narrower trustee.

Read, never write: these are program files. Reached the same way as an MCP
server's program roots (`program-roots.ts`), and recorded in the same ledger
so a `release` takes them back - which the MCP path had already been leaking,
and the shell path would have leaked per command.

A directory that is already readable by the container is skipped, checked by
trustee: the workspace SID, or `ALL APPLICATION PACKAGES` for the
system-owned directories that already carry the entry. Skipping is what keeps
this rule from attempting a write it cannot make on `C:\Windows\System32`,
whose programs already run.

A directory that cannot be granted refuses the command. The refusal names the
program, its directory, why it cannot be granted (system-owned; an unelevated
runtime cannot add an entry there), and the exact command that fixes it:

```
pnpm sandbox:prepare --read "C:\Program Files\nodejs"
```

Never a bare `not recognized` from the shell: that sentence reads as a typo in
the model's line, and the model would rewrite the line instead of the
machine.

**A name that resolves nowhere is left to the interpreter.** The reader
(`command.ts`) is interpreter-agnostic, and a name with no file behind it is
either a builtin the interpreter runs without touching the disk
(`Get-ChildItem`, `echo`) or a typo the interpreter's own `not recognized`
answers honestly. Guessing which is exactly what that reader exists not to
do.

### The install half: read grants on a narrow, named set

`pnpm sandbox:prepare --read <directory...>` grants `ALL APPLICATION PACKAGES`
**read** on the directories named, and with none named defaults to the
directory of the Node runtime the harness itself runs on - the one toolchain
Studio depends on by construction, since Studio *is* a Node application.

Named, not derived from PATH: a machine's PATH holds thirty-odd directories,
from Docker to CUDA, and granting read on everything a user's PATH happens to
contain would widen what every AppContainer on the machine may read by the
whole set. The default is one directory, because that is what Studio itself
depends on; anything beyond it is opt-in, per machine, by the same command.

The traverse half of prepare is unchanged. Traverse stays traverse-and-
read-attributes on system-owned ancestors; the read grant is a different
right for a different need, and inherits, because a program tree is a tree.

### The options that were weighed, and what each costs

**A. Install-time grants on a named set (chosen, for the system-owned half).**
One elevated step at install, which `install-requirements.md` already
requires for the traverse corridor - the same step extended, not a second
one. Cost: the widened set is machine-wide for every AppContainer, bounded by
how narrow the list is kept; the list must be maintained as toolchains
change; and a machine whose installer never ran keeps refusing until someone
runs the named command. That last cost is a refusal with a remedy, which is
the shape the whole containment design prefers.

**B. Vendor the toolchains under a directory Studio owns (rejected).**
A directory the installation owns needs no elevation, so the runtime could
grant it itself. Costs: a second Node runtime shipped and maintained -
security updates land on Studio's release schedule instead of the vendor's;
version drift against projects that pin their own; tens of megabytes per
platform in the installation; and it still covers nothing the user installed
themselves. The vendor directory stays what it is: binaries Studio ships and
reviews (`rg`, the launcher), not runtimes the user already maintains.

**C. Runtime resolution and grant (chosen, for the user-owned half).**
No elevation, no list to maintain, and it covers exactly what the command
names rather than everything that might be run someday. Cost: one ACL write
per distinct program directory per workspace - bounded by how many programs a
project's lines actually name, memoized per container, recorded, revocable -
and a refusal wherever the directory is system-owned, which is what the
install half exists to close.

B was rejected as a *primary* answer; A and C compose, and each covers the
gap in the other.

## Consequences

- `node`, `npm`, `pnpm` and every user-owned toolchain run through the
  contained shell on any machine, with no setup step at all.
- On a machine whose toolchain lives under `C:\Program Files` - this one -
  the shell refuses with the remedy until the one elevated `--read` grant is
  made, and works immediately after.
- The grant list a workspace accumulates is now wider than the policy roots,
  so `release()` takes the program roots back too, from the same ledger the
  corridor is read from. The MCP path's program roots, which were never
  revoked by any release, come back with it.
- A refusal can no longer be mistaken for a typo: the sentence names the
  program, the directory, and the command that fixes it.
