# Task 46 - A command line, and a picture

Two gaps, both measured, both fixed. `shell` takes a full command line run
under an interpreter chosen for the machine, so `npm`, `pnpm`, `yarn`, and
`tsc` work on Windows for the first time. `read` returns images as
attachments, suggests near misses for a wrong path, and refuses a text-only
model with a sentence instead of base64.

The proof, run on this machine through the real gate, kernel, reader, and
tool:

```
=== 1. npm --version through shell ===
11.17.0

=== 2. a command naming two programs, checked against both ===
resources the kernel was asked about, in order: ["shell:npm","shell:node"]

=== 3. a command the parser refuses ===
refused: This line runs a program named by the variable $WHICH_TOOL, and the
program it holds cannot be approved in advance. Name the program directly.
approver asked during the refusal: 0 times (0 = refused before approval)

=== 4. an image through read ===
text block: Attached: opencode/screenshot-uk.png (image/png).
image block: mimeType = image/png | base64 length = 111284

=== 5. a wrong path suggests near misses ===
There is no file at opencode/screenshot-uk.pngg. Did you mean one of these,
in the same directory?
- screenshot-uk.png
```

**Disclosure on the demo's containment.** This machine has not had the
one-time elevated `pnpm sandbox:prepare "C:\Users\pooki"`, so the AppContainer
refuses every contained child (`sandbox.unavailable`) - the same environmental
state the suite's known failures are in. The demo constructs the sandbox with
containment non-enforcing, which is the state a host with no backend
legitimately runs in; every layer above the container - gate, kernel, reader,
policy, interpreter, spawn - is the production path. On a prepared host the
same calls run inside the container, and nothing in the diff changes that.

## 1. Part 0, confirmed

**The shim refusal.** `shimRefusal` sat in `src/tools/shell/resolve.ts`,
refusing `.cmd`, `.bat`, and `.ps1` (`SHIM_EXTENSIONS`), and its docblock
called this "the single most common thing a user will hit" for exactly the
named reason: npm-installed tools are `.cmd` shims on Windows. Reproduced
before anything was changed, by calling the tool's own resolution with `npm`:

```
REFUSED. kind: invalid_input
message: npm is a script that needs a command shell to run, and Project
Studio does not use one. Run the underlying program directly instead - for an
npm-installed tool that usually means node with the tool's own .js entry
point. (Found npm.cmd.)
```

**The sandbox does not need to change.** Confirmed in the real code:
`SandboxRunOptions` (`src/sandbox/local-sandbox.ts`) is
`{ executable, args, cwd, timeoutMs, maxOutputBytes, signal, stdin }` - an
absolute path and an argument vector, with the environment deliberately
absent because the sandbox builds it from policy. A shell is an executable
and a command line is one argument, so the isolation layer already expresses
everything this task needs, and `containCommand` rewrites that same shape
into the container's form. `src/sandbox/` is untouched, and `git status` on
the directory is empty.

What Part 0's frame missed is recorded in section 7: the sandbox type was
never the obstacle, but the *environment* the sandbox hands the child was.

## 2. Which interpreter, per platform, and why

Resolved once per process in `src/process/interpreter.ts` (`resolveInterpreter`),
never named by the model, and stated in the environment block so the model
writes syntax the machine will actually interpret. The order prefers syntax
models write:

| Order | Windows | POSIX | Why |
|---|---|---|---|
| 1 | `pwsh.exe` (PowerShell 7) | `/bin/bash` | `&&`, pipes, and quoting all work |
| 2 | the bash that ships with Git for Windows, derived from the git binary the harness already resolves | `/bin/sh` | POSIX syntax is what models reach for first, and `bash.exe` is rarely on Windows PATH even where Git is installed |
| 3 | a `bash.exe` on PATH, never the WSL one in System32 | | another POSIX interpreter; System32's is another machine's filesystem |
| 4 | Windows PowerShell 5.1 | | last full interpreter standing; `&&` is **not supported**, and the environment block says so in those words |
| 5 | `cmd.exe` | | final fallback |

PowerShell 5.1 is not chosen silently anywhere: the brief's warning about
trading one confusing failure for another is answered by stating the gap in
the block ("`&&` is not supported: separate commands with `;` or run them one
per call"). A machine with none of these gets a shell tool that refuses with
that sentence and an environment block that says so.

On this machine the choice resolves to `C:\Program Files\Git\usr\bin\bash.exe`
- Git for Windows is present, `pwsh` is not, and the derivation walked up
from the vendored-resolved `git.exe` (handling `cmd\`, `mingw64\bin\`, and
`bin\` layouts) to find bash.

## 3. How the command is read for permission

`src/tools/shell/command.ts` reads the line and answers one question: **which
programs does this run?** The tool's `parse` calls it, so a refusal happens
before authorization and the user is never asked to approve something that
cannot be approved. The gate (extended generically in `src/tools/gate.ts` via
an optional `resources` on `ToolDefinition`) authorizes every named program,
each under its own `shell:<name>` resource, in the order the line names them;
`resource` stays the first program, for callers that want one label.

The reader is deliberately simpler than any interpreter it reads for, and it
refuses rather than guesses. **What it cannot yet see, and refuses instead:**

- Command substitution - `$(…)`, backticks, PowerShell subexpressions -
  wherever they appear, including inside arguments.
- Process substitution (`<(`, `>((`) and heredocs (`<<`).
- A variable or option standing where a program should: `$TOOL build`,
  `%TOOL% run`, a bare `--version`.
- An unterminated quote.
- An operator with nothing runnable on one side (`npm && ; node`), including
  a line that opens with an operator.
- Control flow whose body opens with anything but a program
  (`if [ -f x ]; then …` - the test bracket is not a program either).

**What it sees and does not refuse:** redirection (`>`, `>>`, `2>&1`, `&>`,
with glued or spaced targets), environment assignment prefixes
(`FOO=1 npm test`, `$env:FOO=...`), PowerShell's call operator
(`& "C:\Program Files\x.exe"`), reserved words standing where a program would
(`then npm test` checks `npm`), line continuations (`\` and `^` before a
newline), and backgrounding (`cmd &`).

Names are normalized for the resource: a path reduces to its basename and a
script extension is stripped, so `node.exe`, `npm.cmd`, and
`C:\tools\gen.ps1` are one decision each - `node`, `npm`, `gen` - and one
approval matches the next call. The reader is interpreter-agnostic on
purpose; the honest cost is that a backtick is refused under PowerShell too,
where it is only an escape character.

Two rules from the brief held as stated: every program is checked (the demo
asked for both `shell:npm` and `shell:node`), and an unparsable command is
refused with zero approval requests (the demo's approver saw nothing).

## 4. What a text-only model gets for an image

A sentence, not base64:

```
<path> is an image, and the current model does not accept image input, so it
cannot be shown here. The user can switch to a model that accepts images, or
describe what the picture contains and ask again.
```

The check is the model catalog's own marking: Pi records
`input: ["text", "image"]`, carried onto the descriptor as
`capability.vision`, resolved per conversation in
`StudioRuntime.#modelAcceptsImages` through the bootstrapped model registry
(`bootstrappedModelRegistry()`, a new accessor on the bootstrap coordinator -
the composition root used to drop the registry it built). Only an explicit
`"unsupported"` refuses. `"unknown"` - the honest state for a user-declared
endpoint - attaches the image, because a catalog that has not described the
model is not evidence that the model is blind, and refusing on unknown would
lock every self-hosted endpoint out of the feature. That judgment call is
stated here rather than buried in the code.

A PDF is refused for a different reason (section 7, item 1): nothing
downstream can carry one.

The near-miss suggestions are siblings in the parent directory only -
substring in either direction on the full name and on extension-stripped
stems, plus a bounded edit distance (cutoff 2), ordered exact-or-substring
first then by distance, top three. No recursion, no stat storm. Outside the
sandbox the refusal stays information-free, as before.

## 5. The ADR amendment, and whether the containment argument held

`documentation/decisions/0046-the-shell-takes-a-command-line.md`, written in
the 0029 amendment shape (Amends 0013 and 0019 for the `shell` tool only;
Relates to 0041), indexed in the decisions README.

**The argument held, structurally.** Containment is applied by the kernel at
process creation (ADR 0041): the launcher wraps `{ executable, args }` in a
container whose token every descendant inherits. `bash` spawning `npm.cmd`
spawning `node` is three processes inside one token, bound by the same
grants as the single process the old tool started. A pipe widens what a
command can *express*, never what it can *reach* - the sandbox has never
been the layer that bounded syntax.

**Where it bends, measured rather than assumed:** ADR 0041 already records
that a program which reads its own files at runtime needs its directory
granted (the Python stdlib case). `cmd.exe` reading `npm.cmd` is exactly
that case - the shim is data to the interpreter, not an image the launcher
opens with its own rights - so under a *prepared* Windows host, running a
shim-backed tool wants a read program root on the shim's directory. The
mechanism exists (`ContainRequest.programRoots`, used by the MCP launcher)
but `LocalSandbox.run` has no channel for it, and `src/sandbox/` was
off-limits by the brief. Named in the ADR as the follow-up on the sandbox's
own terms, not fixed here.

**`PATH` became a stated policy grant**, which is the part of the story the
brief's Part 0 frame missed (section 7, item 2): the agent sandbox's policy
now carries `environment: { PATH }`, granted deliberately in
`createAgentSandbox`. ADR 0039's rule is kept - nothing is inherited; the
policy names what the child is given - and the permission model picks up the
slack the old resolved-path approval used to hold, by approving programs by
name instead of by the path we resolved them to. Every other child kind
(`tool`, `mcp-server`) keeps the blanked PATH from `buildEnvironment`.

## 6. Verification

- **`pnpm typecheck`: clean.**
- **Full suite (`pnpm test`, includes the flue build): 1366 passed,
  35 failed, 25 skipped, across 95 files.** Every one of the 35 failures is
  the same environmental refusal - `sandbox.unavailable`, "run
  `pnpm sandbox:prepare "C:\Users\pooki"` in an elevated terminal" - reached
  from: `sandbox-appcontainer.test.ts` (12, the containment suite itself),
  `mcp-launcher.test.ts` (8, servers are `os`-isolated children),
  `shell.test.ts` (13, the contained-spawn tests, including the npm-shim one),
  `mcp-flue.test.ts` (1) and `mcp-runtime.test.ts` (1), which time out
  waiting for an approval that cannot arrive because their stdio server
  could not launch under the unprepared container. Nothing else failed; in
  particular `architecture.test.ts` - which pins the spawn-point lists, the
  tool-registration rule, and the module boundaries this change walks past -
  is green.
- **`npm --version` through `shell`: 11.17.0**, shown at the top. This is the
  result the old tool refused with "needs a command shell".
- A command naming two programs was checked against both
  (`["shell:npm","shell:node"]`), a parser refusal was shown with zero
  approval requests, an image came back as text + image blocks with the bytes
  intact, and a one-character-typo path suggested the right file.
- **`src/sandbox/` unchanged in the diff** - `git status` on the directory is
  empty.
- Files changed: `src/tools/shell/{index,resolve,command}.ts`,
  `src/process/interpreter.ts` (new), `src/tools/{types,gate}.ts`,
  `src/context/environment.ts`, `src/models/bootstrap.ts`,
  `src/application/studio-runtime.ts`, `src/tools/native/index.ts`,
  `src/tools/filesystem/{index,read}.ts`, the three test files,
  ADR 0046 and the decisions index. Nothing in `STUDIO/`, `Backend/`,
  `docs/`, `prompts/`; no migrations; nothing under `~/.studio/`; no
  forbidden git commands; scratch scripts deleted after use.

## 7. Every place this brief was wrong, and what the work found

1. **"Images and PDFs come back as attachments."** PDFs cannot, honestly.
   Pi's catalog marks `input: ("text" | "image")[]` - there is no PDF
   marking to consult - and the agent loop forwards text and image blocks
   and nothing else (`studio-runtime.ts` states this in its own docblock, and
   degrades every other block kind to text). An `image` block wearing
   `application/pdf` would be a lie in the wire shape and a provider error at
   the far end. So a PDF gets a clear refusal ("PDFs cannot be shown to the
   model yet; extract the text you need with a command instead") and the
   report says so. If PDFs are wanted, the work is in the loop's content
   contract and the catalog's marking - both outside this task.
2. **"The sandbox does not need to change" was true of the type and
   incomplete about the machine.** `SandboxRunOptions` needed nothing, but
   with the policy environment as it stood the interpreter's child received
   `PATH=""` - `buildEnvironment` blanks it for every tool child, and an
   empty PATH is why the first live `npm --version` could never have worked
   even with the interpreter running. The fix is not in `src/sandbox/` (the
   policy's `environment` input already expresses the grant) but the brief's
   confirmation step, taken literally, would have shipped a shell that could
   not find `npm`. The PATH grant is now part of the decision, recorded in
   ADR 0046.
3. **The contained path on this machine refuses everything until a human
   runs one elevated command.** The brief anticipated this ("known and
   environmental on an unprepared machine") and the demo discloses it, but
   it is worth stating plainly: without `pnpm sandbox:prepare
   "C:\Users\pooki"`, executed once in an administrator terminal, the shell
   tool and every stdio MCP server refuse on this machine. That is the
   designed behavior refusing, not a defect - and it is the same state the
   suite's 35 failures are in.
4. **The npm-shim proof needs both halves of the environment.** The suite
   test (`itRunsNpm`) is gated on containment being available *and* npm being
   installed, because a test that silently passed on a machine missing either
   would be the exact untruth this codebase's skip-helpers exist to prevent.
   The standalone demo is the proof of record for this run.
5. **Three defects were found by the work's own tests before anything was
   green, none of them the brief's:** `2>&1` split at the `&` (the tokenizer
   now keeps redirect glue inside the token), `<(` was not matched by the
   substitution refusal without a `$` prefix, and a dotfile - whose
   extension-stripped stem is empty - suggested itself for every wrong path
   via `includes("")`. Each has a regression test.
6. **`read.ts` was committed with mixed line endings before this task** and
   remains mixed; `core.autocrlf=true` keeps the index LF, so nothing new
   landed off-norm. New files are LF, UTF-8, no BOM.
7. **The brief's "Reproduce it: call `shell` with `npm`"** was done through
   the tool's own resolution entry point rather than a full gate call,
   because on Windows the gate's spawn path is the containment refusal - the
   shim refusal fires first, at parse, exactly as designed. The reproduced
   message is quoted in section 1.
