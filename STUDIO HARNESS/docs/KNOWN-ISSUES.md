# Known Issues And Accepted Limits

Real gaps in shipped code, recorded so they stay visible instead of being
rediscovered later as surprises.

Two kinds of entry live here:

- **Open** — something we should fix, with the condition that makes it urgent.
- **Accepted** — a deliberate limit whose cost we chose. Listed so nobody
  "fixes" it by accident, and so the choice can be revisited when its reason
  expires.

An entry is removed only when the code changes, never because it got old.
Decisions with lasting rationale belong in `decisions/`; this file is the
running list of what is currently not true about the system.

---

## Process Execution (`src/process/`)

### P-01 · A child that ignores the kill is reported dead anyway · Open

`runProcess` waits for the child to actually close before rejecting, then gives
up after a 2 second grace period and rejects regardless. A process that
survives both `taskkill /T /F` and `SIGKILL` — an uninterruptible driver wait,
for example — is then reported as stopped while still running and still holding
its working directory.

**Impact:** a cancel-then-clean-up caller could hit `EBUSY` again in the rare
case. This is the exact bug the grace period was added to fix, narrowed rather
than eliminated.

**Fix when:** we see it in practice. The honest fix is to surface "asked to
stop, did not confirm" as a distinct outcome rather than folding it into
`timeout`/`aborted`.

### P-02 · A verbose command fails instead of truncating · Accepted

Exceeding `maxOutputBytes` (8 MiB default) kills the process and raises
`process.output_limit`. Nothing is returned, not even the first slice.

Chosen because a caller reasoning about a truncated answer as if it were
complete is worse than a caller that knows it got nothing. Revisit if a
legitimate command — a large `git log`, a wide `rg` — turns out to trip it in
normal use, in which case the answer is a per-caller limit, not a bigger global
one.

### P-03 · No `PATH` in the child environment · Partly answered

The child environment is built from policy plus an allowlist of Windows OS
plumbing (`SystemRoot`, `windir`, `TEMP`, `TMP`). `PATH` is deliberately
excluded so a spawned binary cannot find tools the caller never approved.

**Now tested for local git.** `git init`, `git config`, `git status`, and
`git rev-parse` all work without `PATH`, so the reasoning that git computes its
own exec path holds for local operations.

**Still untested for anything that reaches a remote.** `git fetch` and
`git push` invoke credential helpers and `ssh`, which are separate executables
found through `PATH`. Expect that to fail, and expect the fix to be naming the
specific directory rather than inheriting `PATH`.

**Fix when:** a network git operation is first attempted.

### P-04 · A failed `taskkill` degrades silently · Open

If spawning `taskkill` throws, the code falls back to killing only the process
we spawned and does not report that the tree kill failed. Descendants can
survive.

**Impact:** low, but it is invisible when it happens, which is the part worth
fixing. It should report through `ErrorReporter` rather than swallow.

---

## Vendored Binaries (`src/vendor/`)

### V-01 · Vendored binaries are pinned, not independently verified · Open

`vendor/MANIFEST.md` records the source URL and SHA-256 of everything shipped,
and `resolveBinary` accepts whatever file is at the expected path. The hashes
were computed from our own download, so they pin what we shipped and let a later
re-vendor be compared — but they are not a check against an upstream signature.

Acceptable while binaries are committed and reviewed. **It stops being
acceptable the moment anything is fetched on demand**, because that is
downloading an executable over the network and running it unverified.

**Fix when:** before the first on-demand download ships. Verify the recorded
hash at fetch time, and prefer a published signature where upstream provides
one.

Vendor root is resolved relative to the installation rather than the working
directory, so a repository cannot ship its own `vendor/win32-x64/rg.exe` and
have the harness run it.

### V-02 · Resolution is cached for the process lifetime · Accepted

`resolveBinary` caches per binary name because the lookup walks all of `PATH`.
A git uninstalled or installed *during* a session is not noticed.

`clearBinaryCache()` exists and must be called after an on-demand install.

---

## Permissions (`src/permissions/`)

### K-01 · Policy matched on capability id only · Fixed

Closed by the call gate. `PermissionRequest` now carries a `resource`,
`PolicyRule` can match it, and grants store a `resource_pattern`, so `git:log`
and `git:push` are decided separately.

### K-02 · `once` is not re-checked mid-call · Accepted

Recorded in ADR 0012. A long-running approved operation is authorized at the
start and not re-authorized partway through.

Partly mitigated by ADR 0017: a long call is now bounded by a deadline and can
be cancelled while running, so "approved once, then ran forever" is no longer
possible even though re-authorization still is not.

### K-03 · Nothing calls the kernel yet · Fixed

`CallGate` is now the single caller. Registering a tool registers its capability
with the kernel in the same call, so a tool cannot become callable without also
becoming decidable.

---

## Tool Calls (`src/tools/`)

### T-01 · Every standing approval is per-resource · Fixed

Closed by ADR 0015. `PermissionRequest` carries a `scopes` ladder generated by
the kernel — this file / this folder / this project for paths, this command for
commands — and the approver answers with a `scopeId` from that list. It can no
longer author a pattern at all, so a dialog cannot grant more than it displayed,
and picking "this folder" once covers every file beneath it.

The approval UI renders `request.scopes` and returns an id. No permission logic
and no pattern syntax belong in it.

### T-02 · No timeout, cancellation, or concurrency policy at the gate · Fixed

Closed by ADR 0017. `src/tools/bounds.ts` applies a deadline covering queue
time and execution, a composed signal so cancellation reaches the tool mid-call,
and a FIFO permit queue. Applied to every call; the options tune it rather than
switch it off.

Bounds wrap execution only. Authorization stays outside, because a person
deciding is not a call running slowly.

### T-11 · An abandoned call may still be running · Accepted

A tool that reaches a subprocess is genuinely interrupted — the signal is
forwarded to `runProcess`. A tool that hangs in pure JavaScript is
**abandoned**: the caller is released and the work may run to completion.

There is no way to interrupt a synchronous loop in userland JavaScript, so this
is a limit rather than a bug. It is accepted rather than hidden: the error tells
the model the outcome is unknown, and for a non-idempotent capability tells it
to check the current state before repeating the call.

The narrowing fix, if it ever matters, is moving long pure-JS work into a
worker — not a cleverer race.

### T-03 · Trust and execution modes are not enforced · Fixed

Closed by ADR 0018. Workspace trust is a precondition stored per folder, ahead
of policy and grants; an untrusted folder is denied rather than asked about, and
reading is still allowed so the folder can be looked at. Manual / Auto Edit /
Full Auto resolve a *default* `ask` only — a policy `ask` is never resolved by a
mode, so Full Auto still prompts before a connected server runs code.

### T-12 · The application does not wire a real posture · Open

`PermissionKernel` falls back to `UNGATED_POSTURE` when none is supplied — every
folder trusted, every `ask` asked. That is the pre-trust behaviour, correct for
a fixture and wrong for the application.

Nothing in `src/app.ts` constructs a kernel yet, so there is currently no place
this is wrong. It becomes wrong the moment the application does.

**Fix when:** the application constructs the gate — Phase 18, or sooner if
`shell` is wired to a real session first. The posture must come from
`WorkspaceTrustStore` and the user's selected mode.

### T-04 · Nothing can undo a write · Fixed

Closed by ADR 0016. A shadow git repository per project, in
`~/.studio/data/snapshots/`, work tree pointed at the project. The call gate
takes a snapshot before the first write of each turn, keyed on the declared
`write` effect rather than on each tool remembering. Scope is the project minus
ignored files, plus every path a write tool touched.

### T-09 · A failed snapshot does not block the write · Fixed

Closed by ADR 0018. `TurnSnapshots.required` is now a function rather than a
boolean, so it follows the live execution mode instead of a value captured at
construction. `requiresUndo(mode)` supplies it: false while a person approves
each write, true under Full Auto, where "you can undo it" is the safety story
rather than a safety net.

### T-10 · Snapshot history is never pruned · Open

One commit per writing turn, delta-compressed, so growth is slow — but nothing
removes anything, ever.

Left deliberately for now: a retention policy that discards the snapshot
someone needed is worse than a directory that grows, and the right cutoff is not
knowable before the feature has been used in anger.

**Fix when:** a real project's history is large enough to measure.

### T-05 · The read-before-modify record does not survive a restart · Accepted

`FileAccessLog` is in memory. After a harness restart, a conversation that had
read a file must read it again before modifying it.

Chosen over persisting it: the record's purpose is to prove the model has seen
the *current* contents, and a record restored from disk proves only that some
earlier process did. Failing closed costs one extra read.

---

### T-06 · The search tools were unverified end to end · Fixed

ripgrep 14.1.1 is vendored at `vendor/win32-x64/rg.exe` and recorded in
`vendor/MANIFEST.md`. All seven end-to-end tests now run.

### T-07 · Git hooks run the project's own code · Accepted

`git commit` runs the repository's `pre-commit` hook, `git checkout` runs
`post-checkout`, and so on. Those are real programs, executing on the user's
machine, that the harness did not vet.

Accepted rather than prevented. They are the user's own repository
configuration doing what git is designed to do, and the alternative —
`--no-verify` — would silently skip the checks the user set up for themselves,
which is worse than running them.

Worth knowing when the sandbox tier lands: a commit inside a container runs that
container's hooks, not the host's.

### T-08 · Git output is truncated at 400 lines with no paging · Open

Unlike `read`, `grep`, and `glob`, the git tool has no `limit`/`offset`. A long
`git log` or a large `git diff` is cut at 400 lines and the model is told to
narrow the command instead.

**Fix when:** it proves annoying in practice. The honest fix is paging
parameters like the other tools have, not a bigger ceiling.

---

---

## Containment (`src/sandbox/`)

### S-01 · `LocalSandbox` is `in-process` isolation · Accepted

Recorded in ADR 0012. It constrains what our own code does on the agent's
behalf and is **not** a boundary against actively hostile code.

Amended by ADR 0019: it now admits `execute` for a **native** capability when
the policy opted in, as *uncontained by consent* rather than as containment.
Anything a user connected is still refused outright. The sandbox never claims
to contain what it admits.

### T-13 · `shell` cannot run npm-family tools on Windows · Accepted

`npm`, `pnpm`, `yarn`, `tsc`, and most npm-installed tools are `.cmd` shims,
and `runProcess` refuses those (CVE-2024-27980) because running them needs
`cmd.exe`, which would reintroduce metacharacter parsing of our arguments.

`node`, `python`, `cargo`, `go`, `docker`, and anything shipping a real `.exe`
work normally. A shim is detected and explained rather than reported as
missing, since "not found" is misleading when the file is right there.

**The candidate fix** is resolving a shim to its underlying `node` entry point.
Deliberately not done yet: it is version-dependent guesswork, and it should wait
for evidence that it is needed rather than be built on the assumption.

The plan of record (ADR 0012, and the local/sandbox split agreed after it) is
that local execution is bounded by *permission*, and isolation is what the
sandbox tier adds — WSL2 locally, a remote MicroVM later.

### S-02 · No isolation provider exists yet · Open

`IsolationLevel` has three values and only `in-process` is implemented. Until a
provider lands, any capability requiring `os` isolation is refused.

**Now load-bearing rather than theoretical.** Since ADR 0019, this is the only
thing standing between a connected MCP server and `execute` on the host. A
native `shell` runs uncontained by consent; a server's does not run at all, and
that distinction is enforced here.

### H-01 · Only `studio.db` and `bin/` are actually used · Open

`src/platform/paths.ts` names `logs/`, `sessions/`, `projects/`, `cache/`, and
`tmp/`, but nothing writes to them yet. Observability still logs to stdout and
Flue owns its own database wherever it was configured.

`data/snapshots/` is now real — ADR 0016 put the undo history there, and it is
the first directory in this list to get a user.

Named now so the layout is decided once (ADR 0014) rather than negotiated by
each subsystem as it arrives. The risk is the opposite of the usual one: a
directory nobody uses invites someone to use it for something it was not meant
for.

**Fix when:** each subsystem lands. Flue's own database location should be
brought into the Studio home at the same time.

---

---

## Environment

### E-02 · The harness integration test times out under load · Open

`tests/integration/harness.test.ts` waits 15 seconds for the harness to accept
connections. It passes alone and passes on a rerun, and it has now failed once
in a full-suite run — the suite starts a real server while 480 other tests
compete for the machine.

**Not a regression, and not to be "fixed" by raising the timeout blindly.** The
honest fix is for the wait to poll a readiness signal the harness actually
emits, rather than racing a fixed budget. A longer timeout only moves the
threshold.

**Fix when:** it fails twice, or before this suite runs on shared CI — whichever
comes first.

### E-01 · Node version is below the declared engine · Open

`package.json` requires `>=22.19.0`; the development machine runs 22.18.0, and
every pnpm command prints an unsupported-engine warning.

`node:sqlite` is experimental in this version and warns on every test run. Worth
resolving before anything depends on a 22.19+ behaviour.
