# TASK 28 — The measuring instrument

**Date:** 2026-08-25
**Scope:** One measurement campaign across every harness-spawn site in
`STUDIO HARNESS` (temporary instrumentation, deleted), two port-collision
experiments against the built server, and one behavioural change confined to
`tests/integration/harness.test.ts`: a silence window with a single
same-budget replacement attempt, plus the test that pins it. Nothing else in
the repository changed; the working tree holds the diff.
**Status:** Complete. The measurement is below; so is the admission that the
wedge itself did not reproduce today and why the fix is right anyway.

---

## 1. Part 0 — the number

The requested measurement — milliseconds from `spawn` to the first byte on
stdout, for **every** harness start in a full-suite run — was taken with a
temporary probe wired into all six spawn sites (the five integration files'
`startHarness` copies plus `src/host/harness-launcher.ts`), logging to a file
outside the repo. In `harness.test.ts` the probe also armed a 12-second
autopsy (child CPU time, thread states, handle count, live `node.exe` count,
`netstat` on the port) in case a wedge fired. All of it was removed after the
runs; `git diff` confirms the tree carries only the fix described in §4.

Six runs were instrumented — three full suites, the failing file alone twice,
and seven bare spawns straight after a rebuild:

| Run | Starts | First byte, min–max | Silent wedges |
|---|---|---|---|
| Full suite #1 | 32 | 1971 – 5709 ms | 0 |
| Full suite #2 | 32 | 2043 – 6398 ms | 0 |
| Full suite #3 | 32 | 2043 – 2998 ms | 0 |
| `harness.test.ts` alone, twice | 20 + 20 | 1967 – 3328 ms | 0 |
| Bare spawns after rebuild | 7 | 2420 – 3476 ms | 0 |

Three facts fall out of the curve itself:

1. **It is flat, and it does not accumulate.** Start #1 of every run — the
   coldest, taken while the vitest worker is still settling — is the slowest
   (5.7s and 6.4s in runs 1–2); everything after sits in a narrow 2.0–3.5s
   band with no upward drift across 20 consecutive starts in one file or 32
   spread across six. The accumulation branch of the brief's fork is dead:
   the cause is not upstream of the failing tests, because there is no
   upstream pressure visible anywhere.
2. **Nothing leaks.** The live `node.exe` count recorded at every one of the
   96 full-suite spawn moments was 14, constant, start to finish; every
   instrumented child produced an exit (code 0 or a signal); a post-run
   `tasklist` confirmed the last three launcher children dead. Candidate 1 is
   not merely unproven — its predicted signal (a ratcheting count) is
   directly absent.
3. **The budget is not low.** Worst healthy first byte ever observed, cold,
   under worker contention: 6.4s. Twenty seconds is more than 3x that, and
   the wedges sat silent for the full twenty with zero bytes.

A CPU profile of one bare boot (~2.5s total sampled) says what those seconds
are made of: roughly 60% is synchronous module resolution and loading —
`internalModuleStat` 427 ms, `open` 392 ms, `lstat` 200 ms, `read` +
`readFileUtf8` ~159 ms — plus ~0.8 s inside Node internals
(`compileSourceTextModule`, `wrapSafe`). Application code and every
dependency together are small (`@flue/runtime` leads at 56 ms). **A harness
boot is a burst of synchronous filesystem work**, and its first output line
("Observability initialized") lands at ~2.1s — so the reported wedges, which
produced *nothing* for twenty seconds, died before finishing module load,
before any application code had ever run.

Two incidental measurements close the loop:

- **Heavy I/O load does not produce the wedge.** Run 2's opening minutes
  overlapped an accidental full-disk file walk from my own tooling; typical
  first byte rose from ~2.5s to ~3.9s (+50%). Real load bends the number; it
  does not break it.
- **Port exhaustion is nowhere in reach.** Machine-wide `netstat` between
  runs: 38 `TIME_WAIT`, 39 `LISTENING`.

## 2. What the port race actually produces (candidate 2, tested)

The brief flagged `availablePort()`'s bind-close-spawn window and asked what
Windows really does rather than assuming a bind error. Both possible shapes
were exercised against the real built server, holding the port in a parent
process and handing it to the child:

- **Same-scope collision** (holder on `127.0.0.1:P`, child told
  `PROJECT_STUDIO_HARNESS_HOSTNAME=127.0.0.1`, i.e. specific-after-specific):
  the child prints "Observability initialized" at 2115 ms, the `EADDRINUSE`
  stack at 2181 ms, and exits with code 1 at 2196 ms. Loud, fast, and fully
  absorbed by the existing "Harness exited during startup" path — the test
  would fail in ~2s carrying the reason.
- **Mixed-scope collision** (holder on `127.0.0.1:P`, child left at its
  default wildcard bind, which is what every helper except the launcher
  does): **the child's wildcard bind succeeds over the specific listener.**
  Windows allows `0.0.0.0:P` to coexist with an existing `127.0.0.1:P`. The
  child comes up normally, prints its listening line, and then receives
  nothing — loopback connections are delivered to the specific-bound holder
  (verified: the holder accepted them; the child's event loop sat idle, CPU
  frozen after module load, zero running threads).

Neither shape is silence. One fails loudly in two seconds; the other produces
a child whose stdout is *non-empty*. The reported signature — alive, zero
bytes on both pipes for the whole budget — matches neither, so candidate 2
cannot be the reported failure. This also settles the brief's aside about
`SO_EXCLUSIVEADDRUSE`: no exclusivity materialises in the mixed-scope case at
all, which is worse than either loud outcome (see §6).

## 3. Where that leaves the cause

Stated plainly: **the wedge did not reproduce today.** Three full suites plus
two single-file runs and seven bare spawns — ~140 starts, all instrumented —
produced zero instances of the failure the brief describes as three-per-run.
The baseline line ("1284 passed / 25 skipped, with the 3 failures") must have
been measured earlier today under a machine state that has since changed;
this workstation currently runs an unrelated development stack (two Medusa
servers, Next.js dev under Turbopack, a static server) that has been up since
mid-morning, with Defender real-time protection on and signatures updated
today. None of today's numbers depend on identifying that state.

What the evidence does pin down:

- The wedged children never reached the ~2s mark where even the first
  application log line fires. Whatever stalled, stalled inside Node's
  synchronous module-load burst.
- That burst is pure filesystem I/O (§1's profile), executed identically by
  every start of every run.
- Every repository-side candidate for stalling it is measured dead (leaks,
  port races, exhaustion, globalSetup), and ordinary load demonstrably does
  not do it.

The remaining explanation consistent with all of that is an episodic
machine-level stall of the child's module-loading I/O — the filter-driver /
antivirus episode class, or a disk stall. That is environmental: it cannot be
summoned on demand and cannot be fixed in this repository. The brief allows
exactly this outcome provided it is proven by measurement and paired with the
smallest change that makes the suite trustworthy anyway. The measurement is
§1–§2; the change is §4.

## 4. The fix — a silence window with one replacement attempt

`STARTUP_SILENCE_MS = 10_000` in `harness.test.ts`: if a start attempt has
produced **not one byte on either pipe** after ten seconds — 1.5x the slowest
of ~140 measured healthy boots — that child is not starting slowly, it is
wedged. `startHarness` kills it immediately (`SIGKILL`; there is nothing to
drain) and makes **one** replacement attempt on a fresh port, sharing the
**same** 20-second `STARTUP_BUDGET_MS`. The replacement decision requires
that at least half the silence window of budget remains, so a second attempt
is never started on scraps.

Properties, against the brief's three requirements:

- **No timeout or budget grows.** Total start cost is capped exactly where it
  was; a healthy replacement boots in the measured 2–6.5s and finishes well
  inside the envelope. Six of the file's tests run under 30s timeouts; a fix
  that retried *after* the budget would have blown straight through them and
  silenced the diagnostic — which is why the window shares the clock instead.
- **Diagnostics stay and improve.** The `waitUntil` detail block and the
  stdout/stderr tails are untouched for the final child; when a replacement
  happened, the failure additionally names it: "An earlier attempt was
  replaced for staying silent: pid=N on port P, killed after Nms with no
  output."
- **Real regressions fail harder, not softer.** A child that *exits* is never
  replaced — its stderr already says why (the corrupt-database isolation test
  depends on that and is unchanged). A harness that genuinely cannot boot now
  fails twice inside the original budget, with both attempts named.

New behaviour, new test, per §8 of the house rules: "replaces a harness that
produces no output and names both attempts in the failure" drives a
never-speaks stub entry through the real kill-and-replace machinery with
compressed budgets and asserts two distinct pids plus the history line.
Verified both directions: with the fix it passes (6.3s); with the replacement
condition disabled it fails with `expected 1 to be 2` (one pid, no history).
Restored.

## 5. Verification

Each suite run alone, sequentially; the three full-suite runs stated
individually as required.

```
STUDIO HARNESS:  pnpm test  ->  run 1: 1288 passed / 25 skipped, exit 0, 405.04s
                                run 2: 1288 passed / 25 skipped, exit 0, 394.93s
                                run 3: 1288 passed / 25 skipped, exit 0, 394.31s
                 (1287 was today's pre-fix passing count; +1 is the new test)
STUDIO:          pnpm test      -> 14 files / 204 tests passed
                 pnpm typecheck -> clean
STUDIO/src-tauri:cargo test     -> 64 passed
                 cargo clippy --all-targets -> 0 warnings
```

One honesty note these numbers require: three green full runs existed *before*
the fix too (runs 1–3 of §1, carrying slight probe overhead). For an episodic
failure, green runs prove less than usual, and claiming them as proof would be
the exact defect this task exists to remove. What the fix changes is behaviour
under the failure shape, and that is established deterministically by the new
test, not statistically by reruns.

Tree state: `git status` shows exactly one modified tracked file
(`STUDIO HARNESS/tests/integration/harness.test.ts`, +169/−58) plus this
report. No branch was created and no commit was made — the task's Forbidden
section overrides rules.md §11, so the working tree holds the diff for review.

## 6. Where this brief was wrong

1. **"In a full `pnpm test` run … three integration tests fail" is not true
   today.** Six runs, zero failures. The baseline presented as current ground
   truth was evidently taken under a different machine state. Everything else
   in the brief survives this — the signature, the ruled-out explanations,
   the measurement discipline — but the failure is episodic, and any future
   task premised on reproducing it on demand will stall the way this one's
   Part 0 nearly did.
2. **Candidate 2's ranking survived; its premise did not survive intact.**
   The brief suspected a bind error would be the outcome and worried Windows
   might make it silent instead. Measured answer: *both*, depending on scope —
   loud `EADDRINUSE` same-scope, and mixed-scope a successful double-bind that
   is neither loud nor broken-but-silent, just invisibly misrouted. The
   candidate is dead as a cause of this signature either way.
3. **The file's own record contains a stale claim the brief called a record
   worth reading:** "A healthy start is well under a second." On this machine,
   today, healthy is 2.0–6.4s across ~140 starts. The comment is corrected as
   part of the change; the 20s-budget reasoning around it held.
4. **"`lastProbe=fetch failed`" reads as connection-refused but is not
   guaranteed to be.** Undici's top-level message hides the cause; refused and
   connect-timeout probes report identically. The diagnostic block would say
   something sharper if it walked `error.cause`. Noted, not fixed — it is a
   diagnostic refinement nobody asked for, in a message whose current form
   still did its job.
5. **Candidate 1 (leaked harnesses) was not merely wrong but backwards:** in
   every green run the process count was perfectly flat at 14 with zero
   orphans, which is the strongest leak evidence a green run can offer.
   Candidates 3 and 4 were tested to nothing: 38 `TIME_WAIT` sockets
   machine-wide, and a `globalSetup` that only records profiles while
   `harness.test.ts` ran first in the observed file order anyway.

## 7. Findings out of scope, named and left

- **The mixed-scope double-bind (§2) is a live correctness hazard beyond
  tests.** Any component that allocates a loopback port with
  bind-close-reuse and hands it to a wildcard-bound server can lose traffic
  to whoever bound the specific address meanwhile — silently. Five test files
  share this pattern; production paths use explicit hostnames via the
  launcher, which is the safer shape. Fixing the helpers' default hostname
  would convert the misroute into a loud `EADDRINUSE`, but it adds an
  unrequested rule needing its own forced-collision test, so it is reported
  instead.
- **`mcp-flue.test.ts`'s private `startHarness` has none of the diagnostics**
  — no pid, no tails, a bare timeout sentence, and it treats a child exit as
  a retryable false rather than a reason. TASK-27 saw it time out under
  contention; if Task 29 touches retry visibility, this helper wants the
  same treatment `harness.test.ts` got.
- **Five near-identical copies of `availablePort`/`waitUntil`/`startHarness`**
  now exist across the integration files. Extracting them into one shared
  helper is mechanical but touches every file the task told me to stay out
  of; it also would have made this task's probe trivial. Worth doing once,
  deliberately.
