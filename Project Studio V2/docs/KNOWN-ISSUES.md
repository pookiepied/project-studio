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

### P-03 · No `PATH` in the child environment, unverified against git · Open

The child environment is built from policy plus an allowlist of Windows OS
plumbing (`SystemRoot`, `windir`, `TEMP`, `TMP`). `PATH` is deliberately
excluded so a spawned binary cannot find tools the caller never approved.

Git computes its own exec path and should not need `PATH`, but this is
reasoning, not evidence — **it has not yet been exercised against a real git
invocation.** Credential helpers and `ssh` are the likely first failures.

**Fix when:** the git tool lands (step 5). If a helper genuinely needs a
directory, the answer is to add that directory explicitly, never to inherit
`PATH`.

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

### K-03 · Nothing calls the kernel yet · Fixed

`CallGate` is now the single caller. Registering a tool registers its capability
with the kernel in the same call, so a tool cannot become callable without also
becoming decidable.

---

## Tool Calls (`src/tools/`)

### T-01 · Every standing approval is per-resource · Open

When an approver returns no `resourcePattern`, the grant is stored against the
exact resource of that call. That is the safe default — an approval is never
wider than what the user saw — but with no UI offering patterns yet, "always
allow" currently means "always allow this one file", and a working session will
accumulate one grant per file touched.

**Fix when:** the approval UI exists. It should offer a small set of patterns we
generate (this file / this folder / this project), and the user picks one.
Users must never type a pattern in a mid-task dialog; authoring rules belongs in
settings.

### T-02 · No timeout, cancellation, or concurrency policy at the gate · Open

`runProcess` bounds a subprocess, but the gate itself does not bound a tool
call. A tool that hangs in pure JavaScript hangs the call, and nothing limits
how many calls run at once.

The `signal` is threaded through and checked once before execution, so
cancellation works at the boundary but not during a long call.

**Fix when:** before `shell` ships. Recorded in the roadmap as remaining Phase 9
work.

### T-03 · Trust and execution modes are not enforced yet · Open

The design agreed for local execution — workspace trust as a precondition, and
Manual / Auto Edit / Full Auto resolving what `ask` means — is not implemented.
The kernel still prompts for every `ask`, so there is currently no mode in which
edits proceed unattended.

**Fix when:** after the filesystem tools, and before the product needs an
unattended run.

### T-04 · Nothing can undo a write yet · Open

`write` replaces a file whole and `edit` rewrites one in place. The shadow-git
snapshot mechanism that makes those reversible **does not exist yet**, so today
the only protections are the read-before-modify rule and the user approving each
call.

That is adequate while every write is approved in front of a person. It stops
being adequate the moment an unattended mode ships, because the safety story for
Full Auto is "you can undo it", and there is currently nothing to undo with.

**Fix when:** before any mode that writes without asking. Snapshots are the
prerequisite, not a companion feature.

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

---

## Containment (`src/sandbox/`)

### S-01 · `LocalSandbox` is `in-process` isolation · Accepted

Recorded in ADR 0012. It constrains what our own code does on the agent's
behalf and is **not** a boundary against actively hostile code. `execute` and
`network` are refused there rather than approximated.

The plan of record (ADR 0012, and the local/sandbox split agreed after it) is
that local execution is bounded by *permission*, and isolation is what the
sandbox tier adds — WSL2 locally, a remote MicroVM later.

### S-02 · No isolation provider exists yet · Open

`IsolationLevel` has three values and only `in-process` is implemented. Until a
provider lands, any capability requiring `os` isolation is refused.

### H-01 · Only `studio.db` and `bin/` are actually used · Open

`src/platform/paths.ts` names `logs/`, `sessions/`, `projects/`, `cache/`, and
`tmp/`, but nothing writes to them yet. Observability still logs to stdout and
Flue owns its own database wherever it was configured.

Named now so the layout is decided once (ADR 0014) rather than negotiated by
each subsystem as it arrives. The risk is the opposite of the usual one: a
directory nobody uses invites someone to use it for something it was not meant
for.

**Fix when:** each subsystem lands. Flue's own database location should be
brought into the Studio home at the same time.

---

---

## Environment

### E-01 · Node version is below the declared engine · Open

`package.json` requires `>=22.19.0`; the development machine runs 22.18.0, and
every pnpm command prints an unsupported-engine warning.

`node:sqlite` is experimental in this version and warns on every test run. Worth
resolving before anything depends on a 22.19+ behaviour.
