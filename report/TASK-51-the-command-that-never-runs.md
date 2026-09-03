# TASK 51 - The command that never runs

Brief: make the shell tool work on Windows, take the eight failures to zero,
and prove it with a real Full Auto turn that runs a command. This task did
that: `pnpm typecheck` clean, `cargo clippy --all-targets` with zero
warnings, `cargo test` 6/6, and the full vitest suite green - the eight
failures gone, no test weakened. A real turn, under Full Auto, in a real
model (DeepSeek V4 Flash through the machine's own provider connection),
wrote a package.json and an index.js and then ran `node index.js` through
the contained shell; its real output, `Hello from the workspace!`, is in
the conversation transcript. Every measurement below was taken on this
machine, from an unsandboxed shell - confirmed by three facts: the
environment carries the real profile (`APPDATA`/`USERPROFILE` resolve to
`C:\Users\pooki`, no Studio redirection variables are set), the security
descriptor of `C:\Users\pooki\AppData\Roaming` measures 108 bytes here
versus the 57,140 install-requirements.md recorded for the redirected agent
shell, and that directory is the user's real one with its 102 application
folders, not a private copy.

---

## 1. Part 0 - what was actually true, re-measured

Every claim in the brief was reproduced before planning. Five of the six
held; two needed correction, and one of the corrections matters.

1. **Containment itself works.** Confirmed: a contained `cmd.exe` runs and
   exits 0; a contained `node.exe` spawned directly by the launcher runs a
   script file from the workspace and prints its output, exit 0.
2. **The environment reaches the child.** Confirmed: `echo %PATH%` and
   `echo %PATHEXT%` inside a contained `cmd.exe` print exactly what the
   policy granted. (The first attempt at this measurement printed a mangled
   PATH - that mangling came from MSYS path conversion in the measuring
   shell itself, not from the launcher, and re-measuring with a
   Windows-formed PATH printed it intact.)
3. **A contained child cannot see program directories.** Confirmed: with a
   granted PATH containing `C:\Program Files\nodejs`, `where node` answers
   `INFO: Could not find files for the given pattern(s)`, `node -v` answers
   `not recognized`, and `dir` on the directory sees nothing. The cause is
   measurable: `C:\Program Files\nodejs` carries a protected,
   non-inheriting DACL with no `ALL APPLICATION PACKAGES` entry, while
   `C:\Program Files`, `C:\Windows`, and `System32` all carry the inherited
   entry - which is why System32 tools run and node does not.
4. **The launcher mangles quotes on an interpreter command line.**
   Confirmed exactly as written: the line
   `"C:\Program Files\nodejs\node.exe" -e "console.log('hello')"` produced
   `'\"C:\Program Files\nodejs\node.exe\"' is not recognized`, exit 1. The
   launcher joins every argument with `CommandLineToArgvW` escaping;
   `cmd.exe` reads the raw remainder after `/c` and reads `\"` as data.
5. **Git's bash cannot be contained.** Confirmed in substance, **corrected
   in mechanism and exit code**. From the production path - the launcher
   spawned by Node, the way the harness and every test spawn it - a
   contained Git-for-Windows bash dies at 3221225794
   (`STATUS_DLL_INIT_FAILED`) before reading a line, exactly as the brief
   says, and `demoteInterpreter` fires on it. But the same binary, spawned
   by the same launcher from an msys shell or from PowerShell, exits **127**
   with no output instead: msys2's runtime fails differently depending on
   what spawned its grandparent, and on this machine today Git's own
   directories are `ALL APPLICATION PACKAGES`-readable (inherited from
   `C:\Program Files`), so the DLL itself loads fine and the failure is not
   a DLL load failure at all. Two consequences worth recording: the brief's
   exit code is the production one and the demotion mechanism works as
   designed there; and a developer invoking the launcher by hand from a Git
   Bash sees a different, silent 127 that nothing demotes on. The second is
   a curiosity of measurement, not a defect in the shipped path.
6. **PowerShell 5.1 is a poor fallback.** Confirmed and sharper than the
   brief states: 5.1 does not merely lack `&&` - it refuses a quoted
   absolute path without a call operator, as a ParserError, which is why
   the shell tests failed in PowerShell's own voice (`At line:1 char:36`
   on every `${NODEQ}` line).

One more Part 0 finding the brief did not know: **`bashFromGit` derived the
wrong installation root on this machine.** PATH resolves git from
`C:\Program Files\Git\mingw64\bin\git.exe`, and the single-strip regex left
the root at `Git\mingw64`, where no bash lives - so the derivation that was
supposed to find the bash beside git fell through to `bashFromPath`, which
returned `usr\bin\bash.exe`. The walk now strips the program's own name and
then every installer-layout directory (`usr`, `cmd`, `mingw64`, `bin`)
repeatedly, and resolves `Git\bin\bash.exe` as intended.

## 2. Part 1 - the launcher builds a command line it can defend

The mangling happened in `spawn.rs`'s join: every argument was quoted and
escaped per `CommandLineToArgvW` whether the child parsed an argv or a
command line. The fix is a declared join mode, not a per-child branch:

- `native/windows-appcontainer/src/spawn.rs` grows `Join`: `Argv` (the
  escaping every program we chose - `git`, `rg` - is correct under, and the
  mode bash and both PowerShell hosts need, because their hosts parse the
  line into an argv before `-Command`/`-c` read it) and `CommandLine`
  (arguments joined verbatim with single spaces, an argument holding
  whitespace wrapped in one pair of quotes, nothing escaped - the mode
  `cmd.exe` needs, because `/s /c` then strips exactly that one pair and
  runs the line the model wrote).
- `run` takes `--join argv|command-line` (default `argv`), documented in
  the launcher's usage text.
- The difference is declared **where the interpreter is described**:
  `src/process/interpreter.ts` grows `takes: "argv" | "command-line"` on
  each interpreter entry (`cmd`: `command-line`; bash, `sh`, `powershell`,
  `pwsh`: `argv`), threaded as `lineJoin` through `SandboxRunOptions` /
  `ContainRequest` / `ContainmentRequest` into `containArgs`, which emits
  `--join command-line` before `--`. There is no branch on the launcher
  side and no special case for cmd beyond the mode it declares.

The measured proof, live through the launcher: the exact line that failed
in Part 0 measurement 4 now runs and prints `hello`, exit 0, through a
contained `cmd.exe`. `cargo test` carries six tests asserting the join in
both modes, including the two invariants that must not break: the argv
join still escapes a path with spaces for `git`, and a no-whitespace
interpreter line gets no wrap (so `/s` has no leading quote to strip).
`cargo clippy --all-targets -- -D warnings` is clean.

**The interpreter order changed, on the brief's explicit condition.** With
bash uncontainable and no PowerShell 7, the demotion chain lands on
whichever fallback follows bash. With PowerShell 5.1 next, that chain could
not run a single line the shell's own tests write: 5.1 refuses a quoted
absolute path without `&` and has no `&&`. Measured on this machine,
`cmd.exe` runs quoted paths, `&&`, pipes and redirection alike - so cmd now
outranks 5.1 (`pwsh`, then Git's bash, then a PATH bash, then `cmd`, then
`powershell`), and 5.1 stays last. Both PowerShell statements now also say
that a quoted absolute path needs the call operator - the gap the
environment block never named.

## 3. Part 2 - a contained command can find the programs it may run

The decision is recorded as **ADR 0047 -
`documentation/decisions/0047-a-contained-command-can-find-the-programs-it-may-run.md`**,
alongside 0041 and 0046, with the three options and their costs. In brief:

- **Runtime half (no elevation):** the shell resolves every program a line
  names through the **policy PATH and PATHEXT** - the same PATH the child
  gets, in `src/tools/shell/resolve.ts` (which, contrary to the brief's
  description, did not resolve anything anymore; ADR 0046 had removed the
  resolver, and this task rebuilt one there for a different purpose) - and
  hands each resolved directory to containment as a read program root, by
  the workspace's own SID. A directory already reachable - by the workspace
  or by the machine-wide `ALL APPLICATION PACKAGES` entry, checked with the
  launcher's own `check` - is skipped, which is what keeps the rule from
  attempting a grant it cannot make on `System32`. A directory that cannot
  be granted refuses the command with the sentence: which directories, why
  (system-owned; an unelevated runtime cannot add the entry), and the exact
  command that fixes it - never a bare `not recognized`.
- **Install half (one elevated step):** `pnpm sandbox:prepare --read
  [directory...]` grants `ALL APPLICATION PACKAGES` **read** on named
  toolchain directories, defaulting to the Node runtime this process runs
  on - the one toolchain Studio depends on by construction - and measuring
  the grant back afterwards. `--read --undo` takes exactly those grants
  back. On this machine the step was run for real, elevated once:
  `C:\Program Files\nodejs` now carries the entry, verified by `icacls` and
  by the launcher's `check`, after which a contained `cmd.exe` answers
  `where node` with `C:\Program Files\nodejs\node.exe` and runs `node -v`
  to `v24.19.0`.
- **Vendoring the toolchains was rejected** and the reasoning is in the
  ADR: a second Node to maintain, version drift against projects, and it
  still covers nothing the user installed themselves.

**The grants are bounded and reversible.** The gap ADR 0046 predicted -
`LocalSandbox.plan()` passing no program roots - is closed by threading
`programRoots` through `SandboxRunOptions` and `plan()`. And the work
exposed a leak that predates it: **MCP program roots were never revoked by
any `release()`** - granted in `contain()`, absent from `release()`'s
revocation. The ledger (`windows/ledger.ts`) now records `programRoots`
beside the corridor at grant time (merging, first-seen, "absent means
unknown" respected), `release()` revokes them (skipping roots that are
policy roots, which the policy loop already took back), and a hold observed
on the workspace's own SID is attributed to the workspace on the same rule
the corridor's measured sweep uses. One deliberate non-fix, for the
migration to know: the grants written by containments that ran before the
ledger field existed cannot be swept the way the corridor's are, because
there is no way to enumerate "which directories might hold a grant"; they
are found only when the same workspace's containment observes the hold.

## 4. Part 3 - the eighth failure, diagnosed

**Root cause, with evidence.** The test fails with `No approval arrived`
because the `mcp__` tool never reaches the model, and the test adapter -
which calls an MCP tool only when it can see one - falls through to its
echo branch. Measured live in a scratch harness: after the turn, the
supervisor reports the echo server `ready` (the reconcile pass starts it),
the turn's text is `Echo: use mcp` (the fallback), and a tool call never
happens.

The cause is `createAgentSandbox` deriving the sandbox's `projectId` from
the sandbox root (`projectKey(projectRoot)`). Until commit 16f02de9 ("A
conversation that outlives the window"), the fallback sandbox root *was*
the runtime's project - the harness cwd - so the derived key coincided with
the one the registry, the selection store, the catalog and the reconcile
pass all use. That commit gave every projectless conversation a workspace
directory of its own under the Studio home; the derived key stopped
matching, `refreshTools()`'s enabled set came back empty, and every MCP
tool a user had enabled for their project vanished from every conversation.
The server itself still started, because the reconcile pass asks the
runtime's project - which is exactly why the failure looked like "the
channel died" and was not.

**The fix lives in the part that survives the migration.** It is one
change in the tool-list seam: `refreshTools()` filters enablement by
`this.#projectId` - the runtime's own project, the same id the selection
store, the catalog's `isServerEnabled`, and the reconcile pass already
use. Nothing in `src/extend/mcp/wire/*` was touched; the stdio launcher,
containment, and process lifecycle are untouched by this fix. The change
is not a migration throwaway: "the tool list reaching the model" is the
seam 2.0's remote-only MCP does not replace for local servers, and the
enablement scope is a Studio decision, not a wire concern.

**The test was right and was not changed.** After the fix it passes
end-to-end unchanged: the approval arrives, the tool runs, the disable
half finds the tool gone from the next turn's list (a fresh sandbox per
run), and the fallback echo answers. One adjacent mystery worth naming:
`/api/permissions/pending` on a copied real store also lists durable
approvals from *other*, past conversations - which is the durability
design working, not a leak, and the scratch diagnostic that found it
initially misread it.

## 5. What the coming migration does and does not touch here

As the brief predicted: Parts 1 and 2 are entirely ours (launcher,
AppContainer, program roots, join rules, the prepare command) and survive
2.0 unchanged. Part 3's fix is in the tool-list seam that stays ours for
local stdio servers. Nothing was pre-adapted to 2.0 and no shim was left.

## 6. Verification

- `pnpm typecheck` - clean.
- `cargo test` - 6 passed, 0 failed. `cargo clippy --all-targets -- -D
  warnings` - zero warnings. The launcher was rebuilt into
  `vendor/win32-x64/studio-contain.exe` from the final source (binary
  newer than both Rust sources; this is the binary the tests assert
  against).
- `pnpm test` (which builds first) - the eight failures are zero, and the
  full suite is green: **1471 passed, 0 failed, 25 skipped** on the run
  with this task's scratch diagnostics still present, re-confirmed on the
  final run after every scratch file was deleted. No test was weakened;
  `mcp-flue.test.ts` passes exactly as written.
- The suites were run one at a time; `pnpm test` builds first, so the
  integration tests exercised the fresh `dist/`.
- Machine state left clean afterwards: the measurement profile
  (`studio-task51-measure`) deleted, its grants revoked, its temp
  workspace removed, stale probe profiles released with the command built
  for exactly that, and `sandbox:list` reports none recorded.

**The thing the tests are a proxy for.** A real turn, Full Auto, in the
harness the app runs (`dist/server.mjs`, the user's real provider
connection, the conversation row carried `permissionMode: "full-auto"`):
asked to create a small Node project and run it. The transcript, read from
the run journal:

1. `write` `package.json` - "Created
   `...\conversations\full-auto-proof\workspace\package.json`"
2. `write` `index.js` - `console.log("Hello from the workspace!");` -
   "Created ...index.js"
3. `shell` `cd "C:\...\workspace" && node index.js` - tool outcome,
   `isError: false`: **`Hello from the workspace!`**
4. The model's answer reports the same output; the submission settles.

No approval was raised for this conversation; Full Auto asked nothing.
The files were verified on disk, and `node index.js` run by hand from that
workspace printed the same line, exit 0.

**The interpreter this machine chose, and the demotion.** `bash` - the Git
for Windows one, `C:\Program Files\Git\bin\bash.exe`, now resolved
correctly beside `mingw64\bin\git.exe` - chosen first, as the order
prefers. On its first contained line it died at `STATUS_DLL_INIT_FAILED`
(3221225794, the production-path measurement from Part 0), and
`demoteInterpreter` moved to the next candidate, `cmd.exe`, which carried
every command for the rest of the process. The Full Auto turn above ran on
that chain: one demotion, measured, then cmd for everything.

## 7. Every place this brief was wrong

1. **Part 0, claim 5's exit code and mechanism.** Contained Git bash dies
   at 3221225794 only when the launcher is Node-spawned - the production
   and test path, and the one `demoteInterpreter` keys on. Spawned from an
   msys or PowerShell parent it exits 127 silently, with Git's DLLs fully
   readable (they inherit `ALL APPLICATION PACKAGES` RX from
   `C:\Program Files`), so the failure there is the msys2 runtime, not a
   DLL load. The brief's conclusion ("cannot be contained; demotion
   handles it") holds for production; its description of the mechanism
   does not hold on this machine today.
2. **Part 2, `src/tools/shell/resolve.ts` does not resolve programs.** ADR
   0046 removed the resolver; the file held only `shellResource()`. The
   PATH+PATHEXT resolution the brief describes had to be written there,
   and the brief's premise ("already resolves") understated the work.
3. **Part 0 never surfaced a real bug in interpreter resolution:**
   `bashFromGit`'s root derivation left `Git\mingw64` for this machine's
   `mingw64\bin\git.exe` PATH hit, so the Git-shipped bash was never found
   by the derivation meant to find it. Found by measuring which
   interpreter a plain harness process chooses; fixed in Part 1's pass.
4. **Part 3's frame ("the failure is somewhere after the server starts: the
   stdio channel, the tool list reaching the model, the test adapter's own
   branch") was right but the cause was none of those layers' code** - it
   was the tool list's *enablement scope*, broken by an earlier task's
   change of where conversations stand. The stdio channel, the wire layer
   and the adapter are all innocent; nothing in `src/extend/mcp/wire/*`
   needed touching, so nothing is throwaway.

## 8. Notes for the record

- The elevated step this task ran on this machine:
  `pnpm sandbox:prepare --read` (no directories named; it covered the Node
  runtime at `C:\Program Files\nodejs`, measured back with `icacls` and
  `check`). This is the install-time stand-in the ADR prescribes; a
  packaged installer should perform the same work.
- The demotion comment in `src/tools/shell/index.ts` and the module
  docblock of `src/process/interpreter.ts` now state the measured order
  and the reason, so the next reader does not have to re-measure.
- The two remaining `ALL APPLICATION PACKAGES` grants on this machine are
  the traverse entries from Task 50's prepare and the single `--read`
  entry this task added. `pnpm sandbox:prepare --read --undo` reverses the
  second and nothing else.
