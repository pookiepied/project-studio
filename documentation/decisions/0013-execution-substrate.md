# ADR 0013: The Execution Substrate

Status: Accepted

Written after the fact. The rule was applied while building `src/process/`,
`src/vendor/`, and the search and version-control tools, and cited from those
modules before this file existed. Recording it late is a debt paid, not a
decision made retroactively.

## Context

Two of the shipped tools start a child process. `grep` runs ripgrep; `git` runs
git. Both are real programs executing on the user's machine.

The obvious reading is that this makes them execution, and that they should
declare `effects: ["execute"]` alongside the `shell` tool. Follow that reading
and the design collapses in a specific way: reading a file's history requires
the same ceremony as running an arbitrary command, every search waits on the
isolation tier that does not exist yet, and the user is asked to approve so many
things that they stop reading the question. A permission system that produces
reflexive approval is worse than none, because it produces the appearance of
consent.

The opposite reading — that we control these tools so they are safe — is how
command injection has worked for forty years. It needs to be rejected on a
stated ground, not on confidence.

So the question has to be answered precisely: **what makes running a program
arbitrary execution, and what makes it not?**

## Decision

### A command is an executable path plus an argument vector, never a string

This is the whole rule. Everything else follows from it.

`src/process/exec.ts` is the only place in the harness a child process starts,
and it takes `{ executable, args }` — never a command line. `shell: false`
always. There is no code path that hands a string to an interpreter.

Because no shell is involved, shell metacharacters are inert. `;`, `&&`, `|`,
backticks, `$(…)`, and `%VAR%` are ordinary characters inside an argument; they
reach the target program as data and it treats them as data. The entire class of
injection that motivates isolation does not arise, not because we filtered it,
but because nothing is present to interpret it.

Three properties must all hold for a call to be substrate:

1. **The executable is one we chose.** Vendored ripgrep, or git resolved through
   `src/vendor/`. The model never names the program.
2. **The argument vector is one we built.** From a validated schema, in code we
   wrote, with the model's input appearing only in positions we placed.
3. **No interpreter sits between us and the program.**

A tool satisfying all three is doing what the program does — reading files,
reading a repository — and it declares *that* as its effect. `grep` is `read`.
`git` is `read` and `write`. Those are honest declarations, not concessions.

### Consequences enforced in code

The rule is only worth stating if it is checkable, so each property is defended
somewhere specific:

**No inherited environment.** The child environment is built from an allowlist
plus caller-supplied values. `PATH` is deliberately absent, so a spawned binary
cannot locate helpers the caller never approved. (`P-03` records what this costs:
network git operations will need named directories rather than inherited
`PATH`.)

**No `.bat` or `.cmd` on Windows.** Only `.exe` and `.com`. A batch file
re-enters a command interpreter, which reintroduces exactly what property 3
excludes — this is CVE-2024-27980, and it is a direct violation of the rule
rather than an unrelated hardening measure.

**Absolute executables only.** A relative path is resolved by someone, and
whoever resolves it chooses the program.

**Vendored binaries resolve against the installation, never the working
directory.** The harness runs with the user's project as its cwd. A cwd-relative
lookup would let any repository ship `vendor/win32-x64/rg.exe` and have us run
it, which breaks property 1 completely. This was a real bug, found and fixed.

**Dangerous options are refused per program.** Property 2 is about the vector we
build, but a program can be argued into running something else. Git's
`--upload-pack`, `--exec`, `--exec-path`, and the `filter-branch` filters all do
this, so they are blocked and `filter-branch` is refused outright. Ripgrep's
`--pre` and `--hostname-bin` do the same, so every model-supplied ripgrep value
is passed as `--flag=value` — a separate argv entry beginning with `-` would be
re-read as a flag by ripgrep's own parser, and a test asserts those two flags can
never appear.

That last one is the rule earning its keep: the bug existed, and it was found by
checking the code against this standard rather than by accident.

### Where the rule stops

`shell` is the tool where the user names the program. Property 1 fails by
design — that is the point of the tool — and properties 2 and 3 fail with it.

`shell` is therefore not substrate, and everything substrate is exempt from
applies to it: it declares `execute`, it needs the mode and snapshot machinery
before it can run unattended, and it is the tool the isolation tier exists for.

This is the distinction the ADR is really for. Without it, either everything is
execution and the product is unusable, or nothing is and `shell` gets treated
like `grep`.

## Consequences

**Good.** Search and version control run today, with no isolation provider and
no approval fatigue, and the reason they are safe is stated rather than assumed.
New tools have a standard to be checked against: name which of the three
properties holds, or declare `execute`.

**Costs.** The blocked-option lists are per program and must be revisited when a
vendored binary is upgraded — a new ripgrep flag that runs a preprocessor would
be a hole. The manifest hash pins what we shipped but is not an upstream
signature check (`V-01`), which is acceptable only while binaries are committed
and reviewed, and stops being acceptable the moment anything is fetched on
demand.

**What this does not claim.** Substrate is not a safety property of the program
being run. Git hooks execute the repository's own code during `commit` and
`checkout` (`T-07`), and that is accepted: they are the user's configuration
doing what git is designed to do. The rule is about who chose the program and who
built its arguments — not about what the program then does on the user's behalf.

## Related

- ADR 0012 — permission and containment; isolation exists to contain code we did
  not write, which is why substrate does not need it.
- ADR 0014 — where things live; the installation-relative resolution that keeps
  property 1 true.
