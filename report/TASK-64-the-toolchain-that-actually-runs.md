# TASK 64 - The toolchain that actually runs

Brief: a conversation cannot run `git` without meeting a Windows error 5,
the shell tool dies on its first command, the model is told it has bash and
gets cmd without ever being told, and nobody has verified the eight default
toolchain presets end to end. Diagnose on this machine through the real
launcher, fix what is fixable at this layer, verify every toolchain in both
policy shapes plus the custom-add path, document, and land on `main`.

## Diagnosis, measured

All arms below ran contained through `studio-contain.exe` with the
production grants (workspace write, the corridor on user-owned ancestors,
the program's own directory the way the shell tool grants it), unless noted.

**The corridor fix is live and the getcwd wall is gone.** `C:\` and
`C:\Users` carry the machine-wide traverse+LIST entry, `C:\Program
Files\Git` carries the machine-wide read entry, and contained `git
--version` exits 0 with no grant at all. The 2026-09-08 finding that git
cannot resolve its working directory does not reproduce any more.

**Contained git dies on its configuration, not its directory.** With the
production grants and nothing else:

```
warning: unable to access 'C:/Users/pooki/.gitconfig': Permission denied (x3)
fatal: unknown error occurred while reading the configuration files
```

`git init`, `git status`, `git log`, `git rev-parse --show-toplevel` all
exit 128; `git --version` exits 0 (it reads no config). Granting read on
the home flips every one of them to 0 with no warnings - and revoking that
grant takes minutes, past the launcher's own 60-second timeout, so the home
as a read root is measured unshippable.

**Git's bash cannot start in a container, deterministically.** `bash -c
"exit 0"` dies at `STATUS_DLL_INIT_FAILED` (3221225794) on every fresh SID
(5/5), with and without a console, under the policy environment, the full
environment, and every CYGWIN knob tried (`disable_pcon`, `MSYSTEM=MSYS`,
`SHELL`+`HOME`+`ORIGINAL_PATH`). The stderr, which the old reports never
captured, names the cause:

```
*** fatal error - NtCreateDirectoryObject(\BaseNamedObjects\msys-2.0S5-1888ae32e00d56aa): 0xC0000022
```

msys-2.0.dll cannot create its session directory object - access denied -
regardless of grants (it survives full read+execute+LIST to
pooki-inclusive, as the findings doc measured). Node runs 3/3 beside it.
This is the "different disease" the findings doc left unverified: an object-
manager grant no unelevated process can make, and the launcher has no mode
for. The harness already routes around it (`demoteInterpreter` to cmd);
what was missing was telling the model.

**The model is told the wrong shell.** The tool registers under the
resolved interpreter (bash here), the first contained line dies, the
process demotes to cmd silently, and the registered description keeps
saying bash. `a ; b` approved under bash is then refused under cmd - or
read as one command with a stray argument. The environment block
self-corrects on the next turn (`interpreterStatement()` is read per turn);
the registered description stays stale, which is named below as remaining.

**A second live error 5, adjacent:** contained `cargo`/`rustc` (rustup
shims) exit 1 with `error: could not write settings file:
'C:\Users\pooki\.rustup\settings.toml': Access is denied. (os error 5)`
without the rust preset's write roots, and exit 0 with them. By design -
the preset exists for exactly this - but it means a bare conversation
cannot run cargo, which the matrix records.

## Implemented

### The demotion the model is told about (`STUDIO HARNESS/src/tools/shell/index.ts`)

- `demotionNote(from, to, stderr)`: which shell died, its loader death with
  the exit status and the dead attempt's own first line when it left one,
  which interpreter the rest of the session uses, and that shell's own
  statement lines - the same lines the environment block carries, so the two
  cannot disagree about it.
- Foreground: the dead attempt's stderr is kept across the retry, and the
  retried answer carries the note beneath it. The command's answer stays
  first; the note is news, not the outcome.
- Background: the interpreter is proven before the job exists
  (`interpreterCanStart`, which memoizes per process, so this costs one
  spawn only when nobody has proved the interpreter yet). On a proven
  death the plan is rebuilt under the next shell behind the same approval
  check, and the `Started` line carries the note. A background bash used to
  die inside the registry with no retry point and read as the job failing.

### The git configuration as standing read roots (`src/sandbox/policy.ts`, `src/sandbox/scope-store.ts`, `src/sandbox/cli.ts`, `src/application/studio-runtime.ts`)

- `gitConfigRoots()`: `%USERPROFILE%\.gitconfig` and
  `%USERPROFILE%\.config\git\{config,ignore\}`, Windows only, only entries
  that exist (a grant on a missing path fails the containment it was meant
  to enable). File-scoped on purpose: no home-wide reach, no tree-walk
  cost, ancestors already corridor-covered, nothing needs elevation.
- `resolveRoots` rides them along, so every policy built from scope rows -
  conversation and project mode alike, through the one seam the runtime
  already reads - owes them. A project conversation reads its rows plus
  these; a projectless one reads the machine-wide rows plus these.
- `conversationExtraRoots` filters them back out of the environment block:
  the block names what the person granted, and plumbing that reads as an
  invitation to open the git identity file is not named.
- `sandbox:release` and `sandbox:release --stale` build their policies with
  the same roots, so the file entries are taken back with everything else,
  including from a fresh process.

## Verification

Unit: 2025 passed, 1 skipped (133 files), including 5 new demotion tests
and 4 new scope tests. Integration: 106 passed, 24 skipped, including the
new contained-git arm (`git init` + `git status` exit 0 with the config
files as read roots, through the real backend). Typecheck, lint and build
green. Each new rule was broken on purpose first: dropping the loader
sentence fails the note tests, dropping the note from the retried answer
fails the foreground wiring test, disabling the background probe fails the
background wiring test, emptying the helper fails the shape tests.

The toolchain matrix, every arm contained through the harness's own
`LocalSandbox` with production-shaped policies (conversation roots, a
project folder, a custom scope row):

| Toolchain | Preset / detection here | Contained result |
|---|---|---|
| node (`-e` and script form, incl. realpath) | interpreter | exit 0 |
| npm 11.17.0 / npx 11.17.0 (cmd shims, shell join) | via cmd | exit 0 |
| git 2.55.0 (`--version`) | git: `C:\Program Files\Git` read | exit 0, no grant needed |
| git (`init`, `status`, `log`, `rev-parse`) | same, plus the new config roots | exit 0; 128 without the roots |
| bash (msys2) | interpreter | dies 0xC0000142 deterministically; demotes to cmd, and the model is now told |
| python 3.11.9 | python (pip cache, site write) | exit 0 through the program-root grant |
| dotnet 9.0.304 | dotnet (NuGet cache) | exit 0 |
| cargo 1.97.1 / rustc | rust (`~/.rustup`, `~/.cargo` write) | os error 5 bare; exit 0 with the preset's roots |
| go | go | not installed here; preset exists, not detected |
| java / android | java, android-flutter | cache/registry dirs only; nothing to start |

Custom adding: a scope row outside the workspace, contained write through
it, read back - works, through the same path the pane writes. The shell's
own-directory program grants stay: removing them would re-break the
runtime reads (Python's stdlib) the doctrine's limit already names, and the
elevation class they once caused is gone through AAP inheritance.

## What remains open, named rather than fixed

- **The msys2 session-directory grant.** `NtCreateDirectoryObject` on the
  shared session object answers access-denied inside the container. Fixing
  it is object-manager ACL work the launcher has no mode for, needing
  elevation for nothing the product should want. The demotion plus the note
  is the routing; the diagnosis above is the head start.
- **The registered description after a demotion.** The tools-list sentence
  still names the first-resolved interpreter; the environment block and the
  note carry the truth from the next turn on. Re-registering the tool on
  demotion was judged too much surgery for this task.
- **A bare conversation cannot run cargo.** By design today (the rust preset
  is project opt-in, and it works), but worth saying plainly next to the
  matrix: the environment block's toolchain promise holds for node, npm,
  git, python and dotnet in every mode, and for cargo only where the rust
  preset is switched on.
- **The brief's fix 1 is declined with data.** Stopping the shell from
  passing the program's own directory would remove no live elevation prompt
  (Git's directories are AAP-covered, so the grants are skipped) and would
  break the programs that read their installations at runtime. The
  contradiction the brief named is resolved the other way: the grant stays,
  the doctrine's limit stands as written.
