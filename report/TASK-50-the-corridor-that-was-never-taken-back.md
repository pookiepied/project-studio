# TASK 50 — The corridor that was never taken back

Brief: containment on Windows grants a traverse entry on every ancestor of a
workspace so a contained program can resolve its own path, but the record of
which ancestors were granted lived only in the memory of the process that
granted them. A release in a fresh process revoked nothing, and the entries
accumulated until a user's directory permission list was physically full. This
task verified the mechanism against the source, made the corridor survive the
process that granted it, reports the setup shortfall before it becomes a leak,
and bounds the growth even when release never runs. Everything below was
measured on the real machine, from an unsandboxed shell.

Verification: `pnpm typecheck` clean; both vitest suites run one at a time
(unit: 9 failed / 1368 passed / 1 skipped, integration: 3 failed / 87 passed /
24 skipped - every failure attributed outside this task's area, none in sandbox
code, and the Windows containment suite passed 16 of 16 including the new
fresh-process corridor test); and the 20-run slope measured, in bytes, with the
DACL returning to the exact starting number after release.

---

## 1. Part 0 - the mechanism, confirmed on all five points

Every claim in the brief's Part 0 was verified against the source before
anything was changed. One naming note: the brief's paths say `src/sandbox/...`;
the package root is `STUDIO HARNESS/`, so the real paths are
`STUDIO HARNESS/src/sandbox/...`. With that prefix, every line number was exact.

1. **Confirmed.** `STUDIO HARNESS/src/sandbox/isolation/windows/appcontainer.ts:83`
   declares `readonly traversed: Set<string>` on `PreparedContainer`, populated
   at line 142 from `ensureTraversable`'s `granted`.
2. **Confirmed.** Line 247 is `for (const ancestor of container?.traversed ?? [])`,
   where `container` comes from `this.#prepared` (line 226), an in-memory `Map`
   on the singleton backend (line 100). One naming nuance: the loop lives in the
   backend's `release` method; `LocalSandbox.releaseIsolation` (line 275 of
   `local-sandbox.ts`) is the wrapper that calls it. The mechanism is exactly as
   described.
3. **Confirmed.** `sandbox/cli.ts` dispatches `--stale` to `releaseStale()`,
   which builds a fresh `LocalSandbox` per ledger entry and calls
   `releaseIsolation()`. In that process `#prepared` is empty, `container` is
   `undefined`, the loop at line 247 iterates nothing, and the profile is
   deleted with the SID recovered through `deriveExisting` (line 295), which
   re-ensures the profile by name. The ancestor entries stay.
4. **Confirmed.** `ledger.ts:45` - `ProfileEntry` was `name`, `workspaceRoot`,
   `createdAt`. Nothing on disk recorded the corridor.
5. **Confirmed.** `traversal.ts:131` -
   `if (holdsTraverse(ancestor, ALL_APPLICATION_PACKAGES)) continue;` - an
   ancestor covered by the machine-wide entry is skipped entirely, which is both
   the design that keeps prepared directories clean and the reason the
   unprepared user directory took the whole leak.

The comment above the line-247 loop says leaving the entries behind "would be
the 'only ever adds' growth this method exists to prevent". The intent was
right; the state it depended on dies with the process.

## 2. Part 1 - the corridor is recorded where release can read it

The ledger was the right place, as the brief argued: it already exists,
survives the process, and is written when the profile is minted. It is still a
log of what we know we did, never a claim about the machine; this adds to what
we know we did, recorded at the moment we did it.

- `src/sandbox/isolation/windows/ledger.ts` - `ProfileEntry` gains an optional
  `traversed: readonly string[]`: the ancestors granted per-workspace traverse.
  **Absent means unknown, never nothing.** A ledger written before this change
  has no field; it releases without crashing and is not read as "nothing to
  revoke". A present-but-empty array is a real measurement (every ancestor was
  already covered by the machine-wide entry). The distinction is preserved in
  the JSON: the field is written even when empty, and a malformed field is
  dropped while the row itself is kept, because a corridor that cannot be
  trusted is an *unknown* corridor, not a broken record. New `recordTraversed()`
  merges first-seen, writes only when the corridor actually grew, and never
  throws.
- `src/sandbox/isolation/windows/appcontainer.ts` - `contain()` persists the
  corridor (in `recordTraversed`) immediately after granting, before the
  shortfall decisions, so a contain that fails part-way still records the part
  it granted. `release()` revokes the union of three sources:
  1. the in-memory set (what this process granted),
  2. the ledger record (what any process granted since the corridor was
     recorded),
  3. a **measured sweep**: for each ancestor of the policy's roots, the
     launcher is asked whether this workspace's own SID holds traverse there.

  The sweep is what answers an *unknown* corridor: with a measurement rather
  than an empty set, which is precisely the bug. Its attribution is
  SID-equality - it can only ever name entries the workspace's own SID holds -
  so nothing belonging to anyone else can enter the answer.
- A release that cannot identify what to revoke now **reports it**. The old
  `if (sid === undefined) return;` was an exit-zero release that revoked
  nothing - the exact shape that let this survive its first cleanup. It now
  throws, keeps the ledger record, and leaves the workspace listed for a retry.

`src/sandbox/cli.ts` marks corridor-less entries in `sandbox:list` ("no
corridor recorded - this entry predates it, and is the kind that leaked ancestor
entries on this machine") and prints the same caveat after releasing one, so
the user knows the release was partly a measurement and partly a record.

## 3. Part 2 - the shortfall is reported before it becomes a leak

The trap had a shape worth naming: the user's home directory is *user-owned*,
so `ensureTraversable` can grant it per-workspace without ever failing - the
shortfall (no machine-wide entry there) is silent by construction. On the
machine this was found on, `sandbox:prepare` had covered `C:\` and `C:\Users`
but never `C:\Users\pooki`, which is exactly where the entries landed.

The fix is a non-fatal advisory in `contain()`, printed to `process.stderr`
directly (the `boot-log` precedent: it must work in the maintenance command's
process and be visible to the person, not only to telemetry). It names the
exact directories and the exact command:

```
[sandbox] These directories are taking one traverse permission entry per workspace:
[sandbox]   C:\task50-verify
[sandbox] One setup run makes that a single machine-wide entry instead, and
[sandbox] nothing further accumulates there:
[sandbox]   pnpm sandbox:prepare "C:\task50-verify"
```

It fires once per directory per process, on the *first* containment - the
difference between one setup command and a repair. It never demands elevation
(the accumulation happens on directories the user owns, which need none), never
widens what `prepare` grants, and never elevates the runtime. Directories
already covered by the machine-wide entry never reach the advisory, so a
prepared machine advises nothing. The message text is a pure exported function
(`prepareAdvice`) with its own tests.

## 4. Part 3 - the growth is bounded even when release never runs

Three changes, and one explicit refusal to take a fourth option.

**Release at a point that actually runs.** All 610 entries came from the test
suite's temp workspaces, and a suite that mints containers and leaves them is
the ordinary case. The vitest global setup (`tests/sandbox-profiles.ts`)
already deleted the profiles the run minted; it now *releases* each of them
through the same `release()` a user's `sandbox:release` runs - grants, corridor
and profile, keyed off the ledger record written at mint time. That teardown
process never contained anything, so it exercises the fresh-process release
path on every suite run. The difference rule is preserved: only profiles that
appeared during the run are released, and a real project's profile is untouched.

**The full release works in a fresh process.** With the corridor in the ledger,
`pnpm sandbox:release --stale` and single-workspace release revoke the corridor
even when the workspace's directory is long gone - the case `--stale` exists
for and the case the in-memory corridor could never serve. The profile itself
is recovered by name; AppContainer SIDs derive from the profile name, so
re-ensuring an existing or deleted profile yields the same SID the leftover
entries reference.

**When the list is full, the message says so.** A grant refused with status 87
(`SetEntriesInAclW`'s answer for a DACL with no room) was classified as
"system-owned" and the user was told to run `sandbox:prepare` - which fails the
same way on the same directory, which is how the broken state survived its
first cleanup attempts. `ensureTraversable` now splits these into a separate
`refused` outcome, and containment refuses with the truth: the permission list
on those directories is full; release recorded workspaces first to shrink it;
whatever remains is unresolvable `S-1-15-2` rows that only `icacls` by hand can
find. The signature check (`isFullPermissionList`) pins the launcher's message
format and is tested.

**Identity reuse was considered and rejected.** Reusing one SID across
workspaces would bound the ACE count, but per-workspace identity is the
boundary between concurrent projects - a grant made for one workspace must not
open a door for another. Bounding the growth does not require weakening it:
(a) and (b) above stop the accumulation at both real exits (maintenance command
and suite teardown), and the corridor record makes every future release whole.
Recovery from the already-broken state is `--stale` itself: recorded corridors
are revoked exactly; unknown corridors are answered by the measured sweep of
the workspace's own ancestors; profile-less and record-less leftovers are the
one class nothing of ours can attribute, and the listing says so rather than
guessing.

**On "near its limit":** without new surface in the launcher binary, the DACL's
byte size is not readable from Node, so this task reports *at* the limit (the
error-87 classification) rather than *near* it. That is the honest boundary of
what the launcher's existing contract exposes; a byte-size read would be a
launcher change and is recorded here as deliberately not taken.

The non-negotiables hold throughout: nothing ever removes an ACE for a SID
other than the workspace's own identity, on a path other than one the record
names or the sweep measured; `sandbox:prepare` is untouched and stays the only
elevated step; no migrations were touched; the only thing deleted under
`~/.studio/` is ledger rows, forgotten by release as before.

## 5. Verification, measured in bytes on the real machine

### How the shell was confirmed unsandboxed

The brief warns that an agent shell on this project runs sandboxed with
`AppData` redirected. In this harness, the two shell modes the tool exposes
(default and explicitly unsandboxed) were compared directly: a full
`printenv` diff is byte-for-byte identical between them, and a marker file
written through the default mode was immediately readable through the
unsandboxed mode - one filesystem view. No `AppData` redirection was observable
from either mode. All DACL measurements below were nonetheless taken in the
explicitly unsandboxed mode via PowerShell, and cross-checked two ways:
`AppData` reads 188 bytes here, the same number the brief reports from the
ordinary elevated shell during the investigation; and every mutation this task
performed was verified by a before/after delta that had to cancel exactly, and
did (192 -> 1152 -> 192 bytes, 0 -> 20 -> 0 rows), which is the strongest
available evidence that reads and writes hit the same, real DACL.

### The 20-run slope

A scratch parent `C:\task50-verify` was created (not covered by
`sandbox:prepare`), and twenty contained workspaces were run under it - one
fresh identity each, each released by *nothing* (the leak case), each directory
deleted after its run. Every number below was read in bytes with
`GetSecurityDescriptorBinaryForm().Length`.

| Step | `C:\task50-verify` | `C:\Users\pooki` (prepared) |
|---|---|---|
| baseline | 192 bytes, 0 `S-1-15-2` rows | 216 bytes, 0 rows |
| after 5 runs | 432 bytes, 5 rows | 216 bytes, 0 rows |
| after 10 runs | 672 bytes, 10 rows | 216 bytes, 0 rows |
| after 15 runs | 912 bytes, 15 rows | 216 bytes, 0 rows |
| after 20 runs | 1152 bytes, 20 rows | 216 bytes, 0 rows |
| after `sandbox:release --stale` (fresh process) | **192 bytes, 0 rows** | 216 bytes, 0 rows |

The size returned to the exact starting number - not smaller, not larger, and
not merely "release exited 0": the rows themselves were counted with `icacls`
before and after (0 -> 20 -> 0). Each traverse entry cost 48 bytes on this
directory (960 bytes over twenty runs). The prepared user directory - the
directory that took 610 entries on the machine this was found on - accumulated
nothing across all twenty runs, which is Part 2's machine-wide entry doing its
job. The advisory printed once, naming `C:\task50-verify` and the exact
prepare command. All twenty ledger entries recorded their corridor
(`["C:\\task50-verify"]`), and `--stale` released all twenty from a fresh
process, deleting directory and profile and returning the DACL to baseline.

### The deleted-directory release

Two demonstrations. The twenty scratch workspaces above were all released with
their directories already deleted - the case `--stale` exists for and the case
the in-memory corridor could never serve. And a new integration test
(`tests/integration/sandbox-appcontainer.test.ts`, "takes the corridor back in
a process that never contained the workspace") contains a real workspace,
asserts the corridor is recorded, asserts by launcher `check` that each
recorded ancestor holds traverse for the workspace's SID, deletes the
directory, runs the real delivery path (`src/sandbox/cli.ts`) as a separate
node process, and asserts every recorded ancestor no longer holds anything and
the ledger entry is gone.

### The two vitest suites, one at a time

`pnpm typecheck` is clean. Both suites were run in full, separately, and the
failure counts below are what was actually observed.

- **Unit** (`tests/unit`): **9 failed / 1368 passed / 1 skipped.** All nine
  failures are in `tests/unit/tools/shell.test.ts`, all of them `itContained`
  tests that spawn a real command through the shell tool inside the container.
  Diagnosis: on this shell's PATH the command interpreter resolves to Git's
  `bash.exe`, and a contained bash cannot read its own `msys-2.0.dll` - the
  exact limitation `appcontainer.ts`'s docblock states ("a program that reads
  its own files at runtime ... needs its directory granted"; the shell tool
  grants no program roots) - so the child dies with status 0xC0000142
  (STATUS_DLL_INIT_FAILED) before running a line. Contained `cmd.exe` starts
  and runs in the same container, and contained `node` runs everywhere in the
  integration suite, so containment itself works; the failures are the
  interpreter choice this shell's PATH produces. None of that path
  (interpreter resolution, child environment, spawn arguments, grants) is
  touched by this task's diff.
- **Integration** (`tests/integration`): **3 failed / 87 passed / 24 skipped.**
  The failures are `harness.test.ts` ("continues after a typed tool call"),
  `mcp-flue.test.ts` ("runs a real selected tool through approval") and
  `observability.test.ts` ("emits agent/model/tool span hierarchy") - the
  approval, tool-selection and telemetry areas the brief places with tasks 47
  and 48, which were running concurrently on this machine during this task.
  `sandbox-appcontainer.test.ts` passed **16 of 16**, including the new
  fresh-process corridor test; `sandbox-bwrap.test.ts` skipped 23 (Linux-gated,
  correct on Windows).

The brief's "previously expected 35" belongs to the machine in its broken
state, where every containment was refused with error 87; on the repaired
machine the observed count is 12 across both suites, none of them in sandbox
code.

## 6. Where the brief was wrong or imprecise

1. **Paths.** All paths omit the package root: the files live under
   `STUDIO HARNESS/src/sandbox/...`, not `src/sandbox/...`. With that prefix,
   every cited line number was exact.
2. **"releaseIsolation revokes ancestors".** The loop is in the backend's
   `release`; `releaseIsolation` is the `LocalSandbox` wrapper. Same mechanism,
   one name off.
3. **"the account's real entries are four rows".** Measured today: five rows,
   216 bytes on `C:\Users\pooki`, none of them `S-1-15-2-*`. A fifth row that
   is not an AppContainer entry is on the directory; whether it predates or
   postdates the repair cannot be determined from here.
4. **The 610 / 65,568 arithmetic is not re-derivable** on the repaired machine.
   It is consistent with the mechanism (entries at roughly 48-107 bytes
   depending on the directory, thousands of contained runs over three days),
   but the exact figures are the finding machine's, not reproducible now.
5. **The sandboxing trap did not materialise in this harness.** No
   `AppData` redirection was observable from either shell mode (Section 5
   records the confirmation). The discipline the brief demands was still
   applied: measurements in the explicitly unsandboxed mode, cross-checked
   against the brief's own numbers and against cancelling deltas.
6. **"Run the two vitest suites"** was read as the unit suite and the
   integration suite, run separately in full. If two specific files were
   meant, the sandbox pair that matters both ran within them
   (`sandbox-isolation.test.ts` in full; `sandbox-appcontainer.test.ts` 16/16).

## 7. What changed

- `STUDIO HARNESS/src/sandbox/isolation/windows/ledger.ts` - the corridor
  field, unknown-vs-empty semantics, `recordTraversed()`, tolerant reading.
- `STUDIO HARNESS/src/sandbox/isolation/windows/traversal.ts` - `refused`
  outcome and `isFullPermissionList`.
- `STUDIO HARNESS/src/sandbox/isolation/windows/appcontainer.ts` - corridor
  persistence at grant time, three-source corridor revocation, the measured
  sweep, the refusal-to-be-silent release, the preparation advisory and
  `prepareAdvice()`.
- `STUDIO HARNESS/src/sandbox/cli.ts` - corridor marking in `sandbox:list`,
  corridor caveats on both release paths.
- `STUDIO HARNESS/tests/sandbox-profiles.ts` - the teardown now releases what
  the run minted, through the real release path, under the same
  difference-not-pattern rule.
- Tests: `tests/unit/sandbox-ledger.test.ts` (eight new corridor tests,
  including the unknown-vs-empty pins), `tests/unit/sandbox-isolation.test.ts`
  (advice rules, error-87 classification), and the fresh-process corridor
  integration test described above.

## 8. State of the machine afterwards

The machine arrived hand-repaired (0 orphan `S-1-15-2` rows on every directory
measured) but littered: 60 ledger entries, most for temp workspaces whose
profiles had been deleted without their corridor being taken back, and 28
leftover profile registrations. Mid-session the home chain gained its
machine-wide entries (`C:\Users\pooki`, `AppData`, `AppData\Local` all show
`ALL APPLICATION PACKAGES` traverse now) - applied outside this task, and the
reason the user-directory column of the slope table shows no growth. The task
left: 0 ledger entries, 0 `S-1-15-2` rows on every measured directory, and 29
profile registrations whose workspaces predate the ledger record - the one
class nothing of ours can attribute, left alone on purpose, and invisible to
`sandbox:list` by the blind spot its own docblock declares.
