# ADR 0046 - The Shell Takes a Command Line

**Status:** Accepted · 2026-08-30
**Amends:** [ADR 0013](0013-execution-substrate.md) (the execution substrate)
and [ADR 0019](0019-running-a-chosen-program.md) (running a program the model
chose), for the `shell` tool only.
**Relates to:** [ADR 0041](0041-containment-is-the-kernel-s-job.md) -
containment is the kernel's job, and this change leans on that rather than
re-arguing it.
**Closes:** `T-13` (the Windows `.cmd` shim refusal), by a different route
than the one 0019 named.

## Context

The `shell` tool took `{ command, args }` - one program, one argument vector,
no interpreter. ADR 0013's three substrate properties were the frame: the
tool gave up property 1 (the model chooses the program) and kept 2 and 3
(we build the vector; no interpreter sits between us and the program).

Property 3 was load-bearing on Windows in a way that broke the tool's
purpose. `npm`, `pnpm`, `yarn`, and `tsc` are `.cmd` shims there, and the
harness refuses to run a `.cmd` without a shell (CVE-2024-27980) - so
`resolveProgram` refused them **by name**, with a message telling the model
to find the underlying `.js` entry point and run that under node. Measured on
the machine this harness is built on:

```
> shell { command: "npm" }
Refused (invalid_input): npm is a script that needs a command shell to run,
and Project Studio does not use one. Run the underlying program directly
instead - for an npm-installed tool that usually means node with the tool's
own .js entry point. (Found npm.cmd.)
```

Honest, and useless. The most common package manager on the most common
desktop could not run, and the suggested workaround (resolving a shim to its
underlying entry point) was exactly the version-dependent guesswork ADR 0019
declined to do. The same refusal made `read`'s sibling gap sting: a model
that could look at an image never got one. Both gaps are fixed here; this
ADR records the shell half and the argument it was checked against.

## Decision

**`shell` takes a full command line and runs it under one interpreter the
harness chooses for the machine.** The schema is `{ command, cwd, timeoutMs }`;
`args` is gone. The interpreter is resolved once per process in
`src/process/interpreter.ts`, never named by the model, and stated in the
environment block so the model writes the syntax the machine will actually
interpret.

The interpreter order prefers syntax models write, and every fallback is
stated rather than silent:

| Order | Windows | POSIX | Why |
|---|---|---|---|
| 1 | `pwsh.exe` (PowerShell 7) | `/bin/bash` | `&&`, pipes, quoting all work |
| 2 | the bash that ships with Git for Windows, found beside the git binary | `/bin/sh` | POSIX syntax, what models reach for first |
| 3 | a `bash.exe` on PATH, never the WSL one in System32 | | another POSIX interpreter |
| 4 | Windows PowerShell 5.1 | | `&&` is **not supported** - the environment block says so |
| 5 | `cmd.exe` | | last resort |

A machine with none of these gets a shell tool that refuses with that
sentence, and an environment block that says so.

### What the interpreter changes, and what it does not

**The argument, checked rather than accepted: an interpreter changes what a
command can express, not what it can reach.** The claim held for this
sandbox, and it holds for a structural reason. ADR 0041 applies containment
at process creation: the launcher wraps `{ executable, args }` in an OS
container whose token every descendant inherits. `cmd.exe` spawning
`npm.cmd` spawning `node` is three processes inside the same token, bound by
the same grants, as one process would be. Nothing about a pipe or a `&&`
widens the kernel's answer to "what may this touch". The interpreter adds
*syntax*, and the sandbox has never been the layer that bounded syntax.

Where the argument **bends**, measured on the prepared path: ADR 0041 notes
that a program which reads its own files at runtime needs its directory
granted (the Python stdlib case). `cmd.exe` reading `npm.cmd` is exactly
that case - the shim is data to the interpreter, not an image the launcher
opens - so running a shim-contained tool needs a **read program root on the
shim's directory**. The mechanism exists (`ContainRequest.programRoots`,
used by the MCP launcher) but `LocalSandbox.run` has no channel for it, and
`src/sandbox/` is deliberately untouched here. Until that channel exists,
`npm` under a *prepared* Windows host may fail with an access refusal that
names the nodejs directory; that is a follow-up on the sandbox's own terms,
not a reopening of this one.

### Permission moves with the syntax

One command line can name three programs, and `shell:npm` must not cover the
other two. So the tool now reads the line (`src/tools/shell/command.ts`) and
answers **"which programs does this run"**; the gate authorizes every one of
them, each under its own `shell:<name>` resource, in the order the line names
them. Two rules are absolute:

1. **Every program is checked, not just the first.** A line running `npm`
   and `curl` is two decisions.
2. **A line the reader cannot parse is refused, not run.** Command
   substitution, process substitution, heredocs, an unterminated quote, a
   variable or option standing where a program should, and an operator with
   nothing runnable on one side are all refusals that name what the reader
   could not see. A guessed program name is worse than a refusal: the refusal
   asks a person, the guess executes one.

The reader is interpreter-agnostic and simpler than every interpreter it
reads for, and the refusals are the honest cost: a backtick is command
substitution in bash and an escape character in PowerShell, and it is refused
in both. `resource` stays the first program's resource, for callers that want
one label; `resources` is the answer to "what does this call touch".

**`PATH` becomes a stated policy grant.** The old design resolved programs by
walking PATH in the harness and blanking PATH in the child; a shell cannot
work that way, because finding `npm` is the interpreter's job. The agent
sandbox's policy now carries `environment: { PATH }`, given deliberately at
the application layer - ADR 0039's rule kept (nothing is *inherited*; the
policy names what the child is given), and the permission model picks up the
slack: programs are approved by name, not by the path we resolved them to.

### The parts of 0013 and 0019 that stand

Everything substrate is untouched: `git`, `grep`, and the vendor resolver
still run programs we chose with vectors we built and no interpreter, and
ADR 0013's three properties still describe them. ADR 0019's consequences
survive nearly intact - a relative path is no longer *refused by the tool*
(a command line is the interface now, and the interpreter resolves programs
the way any user's shell would), but the environment still comes from policy
alone, non-zero exits are still reported rather than thrown, and timeouts are
still clamped rather than refused. The tool still declares `execute`, still
earns a restore point, and is still the one tool whose children exist only
because the model asked.

## Consequences

- `npm`, `pnpm`, `yarn`, `tsc`, and every other `.cmd` shim run on Windows.
  `T-13` is closed the other way: not by guessing an entry point, but by
  letting a shell do what a shell is for.
- The tool surface is unchanged in count: one `shell`, one door, `gate.ts`.
- `runProcess` still refuses `.cmd` and `.bat` directly (CVE-2024-27980);
  the interpreter is always a real `.exe` it accepts.
- The environment block no longer says "commands run without a shell" - it
  names the interpreter and, on the PowerShell 5.1 fallback, the missing `&&`.
- A command naming several programs may prompt once per program the user has
  not already approved. The command scope dialog still offers exactly the
  resource asked about; there is no wildcard step-up here.

## Related

- ADR 0013 - substrate; unchanged for `git`, `grep`, and everything we chose.
- ADR 0019 - the tool that gave up property 1; this amends its shape and
  closes its Windows problem.
- ADR 0041 - containment at process creation; the reason an interpreter is a
  syntax change and not a reach change.
