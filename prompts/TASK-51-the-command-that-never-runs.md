# Task 51 - The command that never runs

Studio can write files and cannot run anything. The `shell` tool has been
broken on Windows for the whole of its existence: every contained command
fails, which is why Task 48's Full Auto proof had to build a website without
a single command line, and why eight tests fail on a fully prepared machine.

This task makes the shell work, and takes those eight failures to zero.

The eight are not one bug. Seven share a story; the eighth is something else
and has to be diagnosed rather than assumed. All the measurements below were
taken on the machine you are working on, from an unsandboxed shell, and are
reproducible - re-take them rather than trusting them.

---

## Part 0 - What is actually true, measured

Confirm each of these before planning. They took an afternoon to establish
and every one of them narrows the work.

1. **Containment itself works.** A contained `cmd.exe` runs and exits 0. A
   contained `node.exe` running a script prints its output and exits 0. The
   AppContainer, the profile, the traverse corridor and the launcher are all
   fine. Do not go looking for a containment bug.
2. **The environment reaches the child correctly.** Inside a contained
   `cmd.exe`, `echo %PATH%` prints the granted PATH and `echo %PATHEXT%`
   prints the full extension list. The policy grant works.
3. **A contained child cannot see program directories.** In that same
   contained `cmd.exe`, `where node` answers `INFO: Could not find files for
   the given pattern(s)` and `node -v` answers `'node' is not recognized as
   an internal or external command`. `C:\Program Files\nodejs` is not
   readable by the AppContainer, so no program outside the workspace can be
   *found*, even with a perfect PATH.
4. **The launcher mangles quotes on an interpreter command line.** The shell
   tool asking a contained `cmd.exe` to run
   `"C:\Program Files\nodejs\node.exe" -e "console.log('hello')"` produces:

   ```
   '\"C:\Program Files\nodejs\node.exe\"' is not recognized as an internal
   or external command, operable program or batch file.
   ```

   The quotes arrived backslash-escaped. This is an argv round-trip through
   our own `studio-contain` launcher, and it means even a fully-qualified
   path fails.
5. **Git's bash cannot be contained at all.** On a machine with no PowerShell
   7, `resolveInterpreter()` picks the `bash.exe` that ships with Git for
   Windows, and a contained one dies at exit code 3221225794
   (`STATUS_DLL_INIT_FAILED`) before reading a line: it loads `msys-2.0.dll`
   from its own installation, which an AppContainer cannot read. There is
   already a mechanism for this - `demoteInterpreter()` in
   `src/process/interpreter.ts` - which gives up on it and moves to the next
   interpreter the machine has. That mechanism works and is not the problem.
6. **Windows PowerShell 5.1 is a poor fallback and that is not a bug to
   fix here.** It has no `&&`, and it refuses to run a quoted absolute path
   without a call operator in front of it. Its statement in the environment
   block already says so. Whether the fallback order should change is a
   consequence of Parts 1 and 2, not an input to them.

## Part 1 - The launcher builds a command line it can defend

`studio-contain` (`native/windows-appcontainer/`) receives an executable and
an argument vector and creates the process. Somewhere between the harness
handing it `["/d", "/s", "/c", '"C:\\...\\node.exe" -e "..."']` and
`CreateProcessW` receiving a command line, the quotes are being escaped as
if they were data inside another argument.

Find where, and fix it so that what the interpreter receives is what the
model wrote. Windows has no argv - a process gets one string and parses it
itself - so the launcher is necessarily building that string, and the rule
it uses has to match the rule `cmd.exe`, `bash.exe` and `powershell.exe`
each use to take it apart.

Two things this must not become:

- **Not `windowsVerbatimArguments` for every child.** The `git` and
  `ripgrep` calls the snapshot system and the search tools depend on are
  spawned through the same path and are correct today precisely because
  their arguments are escaped. Whatever changes must change for the
  interpreter case and leave those alone.
- **Not a special case for `cmd`.** Three interpreters take a command line
  and each parses it its own way. If the answer differs per interpreter,
  say so and put the difference where the interpreter is described
  (`src/process/interpreter.ts` already holds `args` per interpreter),
  not in a branch inside the launcher.

`cargo clippy --all-targets` must be clean, and the Rust half needs its own
test for whatever rule you land on.

## Part 2 - A contained command can find the programs it is allowed to run

This is the harder half and it is a design decision, not a repair. State the
options and their costs before you pick one; the answer belongs in an ADR
alongside 0041 and 0046.

The constraint: an AppContainer can execute a program whose image the
launcher opens with its own rights, but it cannot *read* the directory to
find one. So `node script.js` fails not because node cannot run but because
nothing can discover where node is.

What is already in the codebase and relevant:

- `ContainRequest.programRoots` exists and is honoured
  (`appcontainer.ts:203` grants each one read). The MCP launcher passes it
  (`extend/mcp/launcher.ts:167`); `LocalSandbox.plan()` does not, which is
  the gap ADR 0046 predicted.
- `src/sandbox/isolation/program-roots.ts` explains why it deliberately does
  *not* grant the executable's own directory: doing so means writing an
  access-control entry into `C:\Program Files`, which needs elevation the
  runtime must never take.
- `documentation/work/install-requirements.md` already records that Windows
  needs one elevated setup step at install time, and why the app cannot
  self-elevate.

So the runtime cannot grant what is needed, and something at install time
might. Options worth weighing, at least:

- The installer grants `ALL APPLICATION PACKAGES` read on a **narrow, named**
  set of directories - the toolchain Studio itself ships or depends on -
  rather than on everything a user's PATH happens to contain.
- Studio ships or vendors the programs a contained command may run, under a
  directory it owns and can grant without elevation.
- The shell resolves the program itself (`src/tools/shell/resolve.ts`
  already resolves programs through PATH) and passes the resolved directory
  as a program root - which works only where that directory is grantable,
  and must fail with a sentence saying so where it is not.

Whatever you choose: it must not widen what every AppContainer on the
machine may read, it must not make the runtime elevate, and a program that
cannot be reached must produce a refusal that says which program and why -
never a bare "not recognized" from a shell.

## Part 3 - The eighth failure, diagnosed rather than assumed

`tests/integration/mcp-flue.test.ts > runs a real selected tool through
approval and removes it after disable` fails with `No approval arrived`.

**It is not containment.** A contained `node.exe` running a script from a
temp directory exits 0 and prints its output - measured. So the echo server
can start, and the failure is somewhere after that: the stdio channel, the
tool list reaching the model, the test adapter's own branch (it only calls
an MCP tool when it can see one whose name starts with `mcp__`), or the
approval never being raised because the call never happens.

Find the real cause and fix it. If it turns out to be a test that encodes a
stale expectation rather than a defect, say so with evidence and change the
test - but a green test that stopped checking anything is worse than the
failure.

**Where the fix must live, and why this is worth knowing now.** Studio is
migrating to Flue 2.0 after this task, and 2.0 makes MCP a first-class part
of the runtime (`useMcpConnection`). That does **not** make this work
disposable, and the reason is precise: 2.0's MCP is **remote only**. Its
`McpConnectionDefinition` requires a `url` that parses as an absolute URL,
its `transport` is `'streamable-http' | 'sse'`, and the word `stdio` does
not appear anywhere in its documentation or its type definitions. Verified
against the published 2.0.3 package, not inferred from a summary.

This test starts a **local stdio server** - a `node` child process, spawned
and contained by us. Nothing in 2.0 replaces that. So:

- Fix it in the parts that survive: the stdio launcher, process lifecycle,
  the tool list reaching the model, containment. That code stays ours.
- Do **not** invest effort in `src/extend/mcp/wire/*` - framing, JSON-RPC
  correlation, era probes, handshake, backoff. That layer is what
  `useMcpConnection` replaces for remote servers, and it is scheduled for
  deletion in the migration. If the cause turns out to be in there, fix it
  as narrowly as possible and say so in the report, so the migration knows
  the fix is throwaway.

## What the coming migration does and does not touch here

Studio moves to Flue 2.0 after this task. Checked against the published
package so this work is not written twice:

- **Parts 1 and 2 are entirely ours and survive untouched.** The Windows
  launcher, the AppContainer, program roots, and how a command line is built
  are Studio's own code. 2.0 changes how a sandbox is *declared*
  (`useSandbox(factory, { cwd })` instead of `createAgentSandbox`), not what
  a sandbox factory does inside.
- **Part 3's stdio path is ours and survives too**, for the reason given in
  that section.

Write this code for the tree as it is. Do not pre-adapt anything to 2.0, and
do not leave a compatibility shim behind for it - the migration is its own
task and will read this report.

## Not this task

- The permission system. It is finished and verified; do not touch
  `src/permissions/`, the approval broker, or the webview's prompt.
- `sandbox:prepare`, the ledger, and the corridor. Task 50 landed those and
  they work.
- The interpreter preference order, unless Parts 1 and 2 make a different
  order provably better - in which case change it and show the measurement.
- Anything in `STUDIO/`. This is harness and native work.

## Verification

The number that matters is eight to zero, on this machine, with the suites
run one at a time:

- `pnpm typecheck` clean.
- `pnpm test` (which builds first - the integration tests spawn `dist/`, and
  running `vitest` directly against a stale build is how two earlier reports
  mis-attributed failures).
- `cargo clippy --all-targets` with zero warnings.

Then the thing the tests are a proxy for: **a real turn, in the running app,
in Full Auto, that runs a command.** Ask Studio to create a small Node
project and run it - a file written, then `node` actually executed, with its
real output in the transcript. Task 48 could not do this and said so; this
task's report has to show it, with the output the command produced.

State the interpreter your machine chose and whether it was demoted.

## Rules

`Backend/`, `docs/`, `prompts/` and `report/` are read-only context. Never
`git checkout`, `switch`, `stash`, `reset`, `clean`, `commit` or `rebase`.
No `any`, no non-const `as`, no non-null `!`. UTF-8, no BOM, LF. No
en-dashes, smart quotes, curly apostrophes, ellipsis characters or emoji in
source. Edit by hand, never with a script. No green placeholder tests.

Measurements of the machine must come from a shell you have confirmed is
unsandboxed, and say how you confirmed it.

Report to `report/TASK-51-the-command-that-never-runs.md`, including every
place this brief was wrong.
