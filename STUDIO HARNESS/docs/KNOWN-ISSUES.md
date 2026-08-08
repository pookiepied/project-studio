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

**Twenty defects are being fixed right now under `tasks/001-cross-reference-audit-fixes.md`.**
They are not yet listed below, because an entry here describes shipped code and
those fixes are in flight. Each one moves here as Fixed when its box is ticked.
Two of them let a model run any program through the `git` tool — `T-23` and
`T-24` — and both were proven against real git rather than argued. **Both are
now fixed**, and listed below; eighteen remain in the task file.

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

### P-05 · `taskkill` is found through the inherited `PATH` · Open

`killTree` spawns `taskkill` by bare name with no `env`, so the child inherits
`process.env` and Windows resolves the name through `PATH`. Both halves
contradict the rule stated at the top of the same file: absolute executables
only, and the environment is built rather than inherited.

**Impact:** a `taskkill.exe` earlier on the harness's own `PATH` runs instead of
the system one, during teardown, when a call is already being cancelled. It is
our `PATH` rather than the agent's, which is what keeps this moderate rather
than severe — but it is the one place `runProcess` breaks its own invariant.

**Fix when:** next touch of `src/process/`. Resolve
`%SystemRoot%\System32\taskkill.exe` and pass an explicit environment, the same
way every other spawn in the harness does.

### P-06 · `child.stdin.end()` is unguarded · Open

A child that has already exited makes the write fail with `EPIPE`, which the
stream emits as an `error` event. Nothing listens on `child.stdin`, so it
surfaces as an unhandled error rather than as a normal process result.

**Impact:** rare — it needs a child that exits before the harness closes stdin —
but the failure is an uncaught exception rather than a bounded one.

**Fix when:** next touch of `src/process/`. A no-op `error` listener on
`child.stdin` is the whole fix.

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

### K-04 · `git` does not declare `network`, so Auto Edit pushes silently · Open

`GIT_DESCRIPTOR` declares `effects: ["read", "write"]`. `git push`, `git fetch`,
`git pull`, and `git clone` all reach the network.

`resolveAsk("auto-edit", capability)` allows anything whose effects are only
`read` or `write`. So in Auto Edit, `git push` is allowed with no prompt — and
so are `git reset --hard` and `git clean -fd`, which are not network operations
but are the other things a user would expect to be asked about.

The mode's own documentation says the opposite, in two places:

- `mode.ts`: *"Reading and writing proceed. Running code and reaching the
  network ask."*
- `STATUS.md`, `ADR 0018`: the same claim, in the same words.

The declaration is what makes it false. `hasElevatedEffect(git)` is also false
for the same reason, so `BASE_POLICY`'s `untrusted-elevated` rule would not
catch a git capability from a connected server either.

**Why it is not simply "add `network`":** a `network` effect makes
`requiredIsolation` return `os` for every git call, and `assertSupports` would
then refuse `git log` on a `LocalSandbox`. The declaration is per capability and
the effect is per subcommand, which is the actual mismatch. `src/tools/git/
classify.ts` already sorts subcommands, so the material exists; what is missing
is a decision about whether effects may vary per call, and that is an ADR.

**Fix when:** before Auto Edit is selectable in the UI. Until a posture is wired
(`T-12`) the mode is never anything but `manual`, so this is not currently
reachable — it becomes reachable in the same change that makes `T-12` matter.

**Not closed by ADR 0020, deliberately.** The effect table makes every reader
agree about what `network` requires. It cannot make `git`'s declaration true,
because effects are per capability and `push` is one subcommand. Per-call
effects is a real decision with real cost, and folding it into that change
would have made it about two things.

`tests/unit/effect-rules.test.ts` asserts the *wrong* answer on purpose — that
`git` has no `network` effect and that Auto Edit allows it. Fixing git turns
that test red, and the test names this issue as the explanation.

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

**One consequence not stated when this was written:** the permit is released
when the call is abandoned, not when the work stops. So an abandoned
non-cooperative call keeps running *outside* the concurrency limit, and enough
of them exceed it. The limit bounds calls the gate is tracking, not processes on
the machine. Accepted on the same reasoning — holding the permit instead would
convert one hung call into a stalled gate, which is worse — but the claim in
`bounds.ts` that concurrency answers "the machine fell over" is weaker than it
reads.

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

### T-20 · Undo does not cover everything in the project · Accepted

Two things a restore cannot return, both structural rather than oversights:

- **Ignored files a subprocess created.** The `#touched` set records paths that
  *write tools* touched, so an ignored file the agent wrote through `edit` is
  force-added. A `dist/` produced by `node build.js` is neither tracked nor
  touched, so it survives a restore that was meant to undo the build.
- **The user's own git state.** Git never adds a nested `.git` directory, so the
  project's history is outside the shadow repository by construction. An agent
  that runs `git reset --hard` cannot be undone by a snapshot; it has to be
  undone with git.

Accepted rather than fixed. Snapshotting `.git` would double the storage and
create two histories that can disagree, and tracking build output would put
`node_modules`-sized directories in the undo history — which is what
`EXCLUDE_FLOOR` exists to prevent.

Worth stating plainly in the UI when undo is offered: it returns your files, not
your build and not your branch.

### T-21 · Small edges in `shell` and the shadow repo · Open

Grouped because each is a few lines and none is worth its own entry.

- **`resolveProgram` does not check executability.** On POSIX,
  `RUNNABLE_EXTENSIONS` is `[""]` and the candidate is accepted on `isFile`
  alone. A non-executable file named `node` earlier on `PATH` wins over the real
  one, and the failure appears later as a spawn error. Needs an `X_OK` check.
- **The program is resolved three times per call** — in `parse`, in `resource`,
  and again in `execute`. Three `PATH` walks, and the binary that runs is
  re-resolved *after* approval, so what was authorized and what runs are two
  separate lookups. Resolve once and carry the path through the parsed input.
- **The exit code can be clipped away.** `clip` runs after `[exit code N]` is
  appended, so on output over 400 lines the model loses the one field that says
  whether the command succeeded. Clip the output, then append the code.
- **`info/exclude` is rewritten on every `ensure()`.** Harmless today because we
  are the only writer, and a trap the moment anything else wants a line in it.

### T-10 · Snapshot history is never pruned · Open

One commit per writing turn, delta-compressed, so growth is slow — but nothing
removes anything, ever.

Left deliberately for now: a retention policy that discards the snapshot
someone needed is worse than a directory that grows, and the right cutoff is not
knowable before the feature has been used in anger.

**Fix when:** a real project's history is large enough to measure.

### T-14 · `shell` writes were not snapshotted · Fixed

`SHELL_DESCRIPTOR` declares `effects: ["execute"]`. The gate takes a snapshot
when `descriptor.effects.includes("write")`. `shell` therefore writes to the
project — `node build.js`, `python migrate.py`, a generator, a formatter,
anything at all — with **no snapshot behind it**, and nothing in the code
notices, because the tool never claimed to write.

This is the largest live gap in the harness, and it lands precisely where the
argument for Full Auto sits. ADR 0018 says undo *is* the safety story once
nobody is approving each write, and `requiresUndo(mode)` enforces that for every
tool that declares `write`. The one tool that can do the most damage is the one
that declaration does not reach.

It also makes `STATUS.md` untrue where it says a tool cannot be added that
writes without being reversible. That sentence was accurate when it was written
and stopped being accurate one ADR later.

**Fixed** by ADR 0020, and by the second of the two candidates rather than the
first. The gate no longer tests for `write`. It asks the effect table whether
any declared effect needs a restore point, and `execute` does.

The reasoning is ADR 0019's own, applied one step further. That ADR admitted
`execute` because *we did not choose the program*. The same sentence answers
reversibility: if we did not choose it, we cannot know what it touched.
"Unknown extent" and "unchosen program" are one fact.

Declaring `["execute", "write"]` on `shell` would have closed today's hole and
left the shape that produced it intact — the next `execute` tool would have the
same gap, and nothing in review would show it.

Cost is one commit per turn that runs any program. Empty commits are already
allowed by design, and git compresses them to about a hundred bytes.

### T-15 · `shell`'s timeout ceiling could not be delivered · Fixed

`shell` clamps `timeoutMs` to at most 600 000 ms and documents ten minutes as
the point of the tool: "a build or a test run is the reason this tool exists."
`CallBounds` applies a 120 000 ms deadline to every call and nothing sets
`timeoutByCapability["native/shell"]`.

The gate's deadline is the shorter one and covers the whole call, so **every
shell call is abandoned at two minutes** regardless of what was asked for. A
model that asks for ten minutes is told yes and gets two.

**Impact:** any real build or test suite over two minutes fails, and fails with
"took too long and was abandoned" rather than with anything pointing at the
cause. The clamp is not merely ineffective, it is misleading.

**Fixed** by ADR 0020. `ToolDefinition.deadlineMs` travels with the tool and
reaches `CallBounds` at registration, so `shell` states its own ceiling once
instead of two bounds disagreeing.

Precedence is operator, then tool, then shared default. A tool asking for more
must not overrule a limit somebody set on purpose. `CallGate.deadlineFor`
exposes the result, because the only way to see the answer before was to reach
inside `CallBounds`.

### T-16 · `edit` interpreted `$` in the replacement text · Fixed

`content.replace(oldString, newString)` and `replaceAll` treat the *replacement*
as a pattern even when the search value is a plain string. `$&`, `` $` ``, `$'`,
`$$`, `$1`, and `$<name>` are all substituted rather than inserted literally.

Confirmed, not theorised:

```
oldString "10", newString "$&$&"  →  "const price = 1010;"
oldString "10", newString "$`"    →  "const price = const price = ;"
oldString "10", newString "$$"    →  "const price = $;"
```

**Impact:** silent file corruption, reported to the model as `Edited <path>`.
It fires on ordinary content — shell scripts, `sed` examples, regex source,
template literals, CSS `$` variables, anything documenting a capture group. This
is exactly the failure the tool's own doc comment rules out: "a mistaken edit
fails loudly instead of landing somewhere unintended."

**Fixed** by passing a replacer function at both call sites — specified to
insert its return value verbatim — rather than by escaping `$` as `$$`, since
escaping is a transformation that has to be correct and a function simply is.

Thirteen tests cover it, and nine of them were confirmed to fail against the
old code before the fix landed. The other four are `$1` and `$<name>`, which a
string search value leaves inert; they are kept because they become live the
moment anyone reaches for a `RegExp` here.

`edit.ts` was the only site in `src/` taking a caller-supplied replacement.
Everywhere else the replacement is a literal, and the two places that do use
`$&`/`$1` — `matcher.ts` and `redaction.ts` — mean it.

### T-17 · Nothing serialised access to the shadow repository · Fixed

`ShadowRepository` has no lock. `SnapshotStore.capture` runs `add`, then
`commit`, then `rev-parse` against one git index, and three callers can start
that sequence concurrently:

- `TurnSnapshots.beginTurn()` clears `#pending` while a capture may still be in
  flight, so the next write starts a second one
- `SnapshotStore.restore()` calls `capture()` internally, which can overlap a
  turn snapshot
- `CallBounds` admits eight calls at once, so several writes can reach
  `beforeWrite` together on the first turn

Concurrent git operations on one index fail on `index.lock`, surfacing as
`capture_failed`.

**Impact:** an undo point that silently does not exist, or — under Full Auto,
where `required` is true — a write refused for a reason that has nothing to do
with the write. The dedupe in `TurnSnapshots` covers the common case, which is
why this has not been seen; it does not cover the three above.

**Fixed** by ADR 0020, with the unit being the whole operation rather than the
command. That distinction turned out to matter: `index.lock` does not protect
`add` → `commit` → `rev-parse`, because each command succeeds on its own. A
second capture starting between the `add` and the `commit` folds two states
into one snapshot, and nothing reports an error.

`ShadowRepository.transaction` is not re-entrant, so `restore` uses an unlocked
internal capture — the undo point has to be taken inside the restore that
depends on it, not under a separate lock.

The chain records completion rather than success. A rejected link would stop
every later capture, and one failed snapshot must not disable snapshots.

The off-by-one in `TurnSnapshots` went with it: `#turn` started at 1 and
`beginTurn` incremented before labelling, so the first turn was recorded as
"turn 2" for every caller that opens a turn — which is every caller.

### T-22 · Six copies of one meaning · Fixed

Six files each held their own rule for what `descriptor.effects` means, and
nothing compared them. Five handled `shell` correctly and the sixth did not,
which is `T-14`. The same shape produced `K-04`.

Closed by ADR 0020: `src/contracts/effects.ts` holds one table, and every reader
looks it up. Recorded even though it shipped fixed, because the *shape* is the
thing to watch for — hand-written metadata that three subsystems trust and
nobody verifies. `T-19` is the same shape still open.

### T-23 · A shortened git option walked past the blocklist · Fixed

`BLOCKED_OPTIONS` was matched as an exact string, but git's `parse-options`
accepts any unambiguous abbreviation of a long option. `--upload-pac=cmd`
therefore ran `cmd`, proven against real git. It needed no execution permission,
because `GIT_DESCRIPTOR` declares `read`/`write`.

Closed in task 001 item 1. `reachesBlockedOption()` matches by prefix in both
directions. It over-refuses abbreviations of harmless options on purpose — the
alternative is tracking which abbreviations each subcommand finds unambiguous,
which is a copy of git's own parser that would rot.

### T-24 · A chained git alias walked past the alias check · Fixed

`assertNotShellAlias` read `alias.<name>` once. Git expands the result again, so
`alias.x = y` with `alias.y = !echo` ran the shell while our check saw the plain
word `y`.

Closed in task 001 item 2. The chain is followed to depth 10, a cycle is refused
by name, and the expansion's own arguments are now validated too — which closes
a second route the audit did not name: `alias.a = log --upload-pack=sh` never
passed through the normal option check, because the caller only typed `a`.

### T-18 · A rejected capture poisons the rest of the turn · Open

`#pending ??= this.#capture()` stores the promise, so a rejection is stored too.
Every later write in the same turn awaits the same rejected promise and fails
with the original error, without retrying.

Under `required` that is fail-closed and defensible. It is recorded because the
behaviour is invisible in the code — it reads as "retry next write" and is not —
and because a transient failure (a lock, a full disk that cleared) stays fatal
until the next turn.

### T-19 · A tool can be registered outside the gate · Open

`CallGate` says everything executable passes through it. Nothing enforces that.
`src/agents/studio.ts` registers `workspace_summary` directly with Flue via
`defineTool`, so it reaches the model without a `CapabilityDescriptor`, without
the kernel, and without bounds.

`workspace_summary` itself is harmless — it echoes its input and touches
nothing. The problem is that it is a working precedent for the shape, sitting in
the tree, and it is currently the agent's **only** tool.

**Fix when:** Phase 11, when MCP makes a second registration path real. An
architecture test asserting that the agent's tool array contains only
gate-registered capabilities is the cheap version, and the same test is what
keeps MCP honest.

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

Note that this is also the shape `mental-model.md` §3.5 rules out — large tool
output should be written to `~/.studio/` with a handle in the transcript, never
truncated. Every shipped tool truncates. Tracked as `C-11`.

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

---

## Storage (`src/storage/`)

### D-01 · The secret-column guard ran once and then never again · Fixed

`assertNoSecretColumns` was called after the migration loop, and each migration
committed and bumped `user_version` on its own. So a migration that added a
credential column committed, the guard threw once, and the column stayed on
disk. On the next start `current === latest` returned early and the guard never
ran again. The application then started normally, forever, with the column
present.

Closed in task 001 item 3. The guard runs inside each migration's transaction,
so a refusal rolls the column back, and again on every open before the early
return, so a file poisoned by an older build still fails.

A `StorageError` is now rethrown from the migration catch untouched. It was
being wrapped by `storageErrorFrom`, which replaced the message naming the
offending column with the generic one.

### D-02 · The secret-column pattern missed obvious names · Fixed

The pattern anchored the keyword at the end, so any suffix escaped —
`api_key_hash` and `private_key_pem` both passed — and bare `key` was not a
keyword, so `secret_key`, `encryption_key`, and `signing_key` passed too.

Closed in task 001 item 4. The name is split into words and any secret word
refuses it. Two exceptions are explicit: `NOT_SECRET_COLUMNS` for the columns we
ship that contain `key`, and a measurement rule so `token_count` and
`total_tokens` pass while `token_secret_count` does not.

The default is now refuse. A future `cache_key` column will fail the check, and
the correct response is to add it to the allowlist, not to loosen the rule.

---

## Containment (`src/sandbox/`)

### S-01 · `LocalSandbox` is `in-process` isolation · Accepted

Recorded in ADR 0012. It constrains what our own code does on the agent's
behalf and is **not** a boundary against actively hostile code.

Amended by ADR 0019: it now admits `execute` for a **native** capability when
the policy opted in, as *uncontained by consent* rather than as containment.
Anything a user connected is still refused outright. The sandbox never claims
to contain what it admits.

### S-02 · No isolation provider exists yet · Open

`IsolationLevel` has three values and only `in-process` is implemented. Until a
provider lands, any capability requiring `os` isolation is refused.

**Now load-bearing rather than theoretical.** Since ADR 0019, this is the only
thing standing between a connected MCP server and `execute` on the host. A
native `shell` runs uncontained by consent; a server's does not run at all, and
that distinction is enforced here.

The plan of record (ADR 0012, and the local/sandbox split agreed after it) is
that local execution is bounded by *permission*, and isolation is what the
sandbox tier adds — WSL2 locally, a remote MicroVM later.

---

## Where Things Live (`src/platform/`)

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
