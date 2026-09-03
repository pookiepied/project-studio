# TASK 28 — The measuring instrument

You are working in `D:\Creative Library\Workspace\Project Studio`.

Read first, in this order:
1. `documentation/rules.md` — all of it, and §8 twice.
2. `STUDIO HARNESS/tests/integration/harness.test.ts` lines 40-242 — the
   startup budget, `startHarness`, `stopHarness`, and the `afterEach`. The
   comments there are a record of two previous attempts at this bug. Read
   them before forming a theory.
3. `STUDIO HARNESS/vitest.config.ts`.
4. `report/TASK-27-classify-the-failure.md` §6, which reported this failure
   and attributed it to something that has since been ruled out.

## The problem

In a full `pnpm test` run of `STUDIO HARNESS`, three integration tests fail.
Alone, the same file passes 15/15. The failure signature is identical every
time:

```
Condition was not met within 20000ms (waited 20008ms).
The harness on http://127.0.0.1:65429 never accepted a connection.
  pid=22244  exitCode=null  signal=null
  lastProbe=fetch failed
  stdout=(nothing)
  stderr=(nothing)
```

A child process exists, has not exited, and has produced **not one byte on
either pipe** in twenty seconds. That is the fact worth staring at. It is not
a port collision and it is not a crash — both of those would say something.

This matters more than three tests. The verification numbers at the end of
every report are the only evidence any of this work is correct, and five
consecutive tasks have leaned on them. **A flaky suite makes every future
claim softer.** That is why this is a task and not a footnote.

## What is already ruled out — do not re-litigate

- **It is not test parallelism.** `vitest.config.ts` sets
  `fileParallelism: false`, and the failing file is `describe.sequential`.
- **It is not this file's process cleanup.** `stopHarness` requests shutdown
  over IPC, awaits the actual `exit` event, and hard-kills after 5s. The
  `afterEach` runs it over every tracked child. That code is sound; read it
  to confirm, then move on.
- **It is not the external load the Task 27 report blamed.** That report
  attributed it to an unrelated `npm install` in another session. It
  reproduced on a second machine state with no such process running. That
  explanation is dead; do not revive it.
- **Raising `STARTUP_BUDGET_MS` is not the fix**, and the comment above it
  says why at length. Twenty seconds is already an order of magnitude beyond
  an observed boot. If your conclusion is that the budget is too low, you
  have found a different bug and must say so explicitly.

## Part 0 — measure before you fix

**Do not propose a cause until you have a number.** The single most useful
measurement, and the one nobody has taken:

> For every harness start in a full-suite run, record the milliseconds from
> `spawn` to the first byte on stdout.

If that number climbs monotonically across the run, this is accumulation and
the cause is upstream of the failing tests. If it is flat and then spikes,
it is a race or a resource cliff. Those two answers lead to opposite fixes,
and guessing between them is how the previous two attempts failed.

Instrument it however you like, including a temporary probe you delete
afterwards. Put the numbers in the report.

## Candidates, ranked by my confidence, none verified

1. **Another integration file leaks harnesses.** Five other files spawn a
   harness: `harness-bootstrap-channel`, `harness-listener`, `mcp-flue`,
   `observability`, `stop`. Only `harness.test.ts` has had its cleanup read.
   Each file's `processes` set is file-scoped, so a leak in one is invisible
   to the others and survives into later files.
2. **`availablePort()` is a bind-close-spawn race.** It binds port 0, reads
   the port, closes, and hands the number to a child that binds it later.
   Anything may take it in between. This would usually produce a bind error
   rather than silence — but on Windows, with `SO_EXCLUSIVEADDRUSE`
   semantics, check what it actually produces before dismissing it.
3. **Ephemeral port or handle exhaustion** over a 454-second run that opens
   a probe socket plus a server socket per harness, with Windows `TIME_WAIT`
   at four minutes.
4. **The `globalSetup` in `tests/sandbox-profiles.ts`**, which registers
   Windows AppContainer profiles, and the containment tests that follow it.

You are not required to agree with this ranking. You are required to say
which ones you tested and what the test showed.

## Part 1 — fix the cause you found

Whatever the fix is, it must satisfy all three:

- The full suite passes repeatedly. **Run it at least three times.** One
  green run of a flaky suite proves nothing, and reporting one as if it did
  is the exact defect this task exists to remove.
- No test's timeout or startup budget grows.
- The diagnostic message keeps working. `waitUntil`'s detail block and the
  `stdout`/`stderr` tails were added deliberately after a failure that could
  not be diagnosed from its own message. If your fix makes them unnecessary,
  they still stay.

If the honest answer is that the cause is environmental and cannot be fixed
in the repository, say so, prove it with the measurement, and propose the
smallest change that makes the suite trustworthy anyway. That is an
acceptable outcome. A green run you cannot explain is not.

## Explicitly not this task

- Anything in `documentation/architecture/reliability-and-the-silent-stop.md`.
- Retry visibility, retry budgets, the reliability module. That is Task 29.
- Speeding the suite up. If your fix happens to make it faster, fine; if you
  find yourself deleting coverage to reach green, stop.

## Constraints

- No `any`, no non-const `as`, no non-null `!`. Hard.
- The admission credential never appears in webview code, a log, an error, or
  a fixture.
- UTF-8, no BOM. Comments use full prose with em dashes, per `rules.md` §7.
- Modular. If a file passes ~400 lines it is probably two files.
- Every new behaviour gets a test that fails without it. Never leave a green
  placeholder test.
- **Never delete or weaken an existing test** to make a suite pass.
- `cargo clippy --all-targets` at zero warnings if you touch Rust.

## Forbidden

Do not run `git checkout`, `git switch`, `git stash`, `git reset`,
`git clean`, `git commit`, or `git rebase`. Reading git state is fine.
`Backend/`, `docs/`, `prompts/`, and `report/` are the user's — read for
context, never modify, never `git add`.

## Verification — run each suite alone

```
cd "STUDIO" && pnpm test && pnpm typecheck
cd "STUDIO/src-tauri" && cargo test && cargo clippy --all-targets
cd "STUDIO HARNESS" && pnpm test
```

Running the two vitest suites concurrently makes Vite's SSR temp directory
vanish under one of them and produces ~80 bogus `ENOENT` failures.

Baselines, measured on 2026-08-25 rather than copied: `STUDIO` 14 files /
204 tests; `STUDIO/src-tauri` 64 tests, clippy 0 warnings; `STUDIO HARNESS`
1284 passed / 25 skipped, with the 3 failures this task removes.

## Report

Write `report/TASK-28-the-measuring-instrument.md`. Lead with the
measurement from Part 0 and what it ruled in or out — that number is the
deliverable even more than the fix. Then the cause, the fix, and the three
full-suite runs with their results stated individually rather than
summarised.

Finish with every place this brief was wrong, including any candidate above
that turned out to be nonsense.
