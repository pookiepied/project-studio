# TASK 31 — The child that says nothing

You are working in `D:\Creative Library\Workspace\Project Studio`.

Read first, in this order:

1. `report/TASK-28-the-measuring-instrument.md` — the whole thing, and
   especially its conclusion that the wedge was environmental and did not
   reproduce. That conclusion is wrong. Read it anyway: its measurement
   discipline is the part to keep, and its instrument is what makes this task
   possible.
2. `STUDIO HARNESS/tests/integration/harness.test.ts`, lines 120 to 230 — the
   `startHarness` machinery Task 28 built: the silence window, the single
   replacement, the `describeFailure` block.
3. `STUDIO/src-tauri/src/harness/supervisor.rs` — `resolve_server_path`,
   `spawn_child`, and the readiness wait. The second spawn path, and the one
   that matters to a person.
4. `STUDIO HARNESS/src/app.ts` — `createHarnessApplication`, top to bottom.
   Read it as a sequence of things that happen before anything can speak.

## What is known, and it is more than Task 28 had

The wedge is real and it reproduced three times on 2026-08-26, on three
independent spawn paths:

1. **The Rust supervisor**, on the first launch of `pnpm tauri dev`:
   `eager start failed: Harness did not publish loopback readiness within
   30000ms. observed=(nothing) stdout=(nothing) stderr=(nothing)`. No harness
   process survived; the process table held only vite and tauri.
2. **`mcp-flue.test.ts`**, timing out at 60s under full-suite load while
   passing in 33s alone. Disclosed in the Task 30 report as marginality.
3. **`harness.test.ts`**, under full-suite load, with Task 28's instrument
   reporting exactly what it was built to report:

```
Condition was not met within 9906ms. The harness on http://127.0.0.1:58933
never accepted a connection.
  pid=15632  exitCode=null  signal=null  lastProbe=fetch failed
  stdout=(nothing)  stderr=(nothing)
  An earlier attempt was replaced for staying silent:
  pid=19512 on port 58768, killed after 10057ms with no output.
```

That file passes 24/24 in 313s when run alone. **The trigger is load**, which
is what Task 28's six sequential runs of ~140 starts could not produce.

Read that failure message closely, because it says three things at once. The
child was alive (`exitCode=null`). It had said nothing on either stream. And
the replacement Task 28 added did fire, on a fresh port, and went silent too.
A retry is not the fix for something that fails identically twice.

## The structural fact this task turns on

`createHarnessApplication` does four things before it has anything to speak
with:

```
database = openDatabase();
const providerConfig = resolveProviderConfig();
bootstrapModelProviders(providerConfig, { database });
installTransientModelRetryPolicy(createStudioTransientModelRetryPolicy());
observability = initializeObservability();
reportNodeRuntime(observability.logger);   // <- the first line anyone sees
```

Everything above that last line is byte-silent **by construction**. A block in
any of it produces exactly the observation we have: a live pid, no stdout, no
stderr, no exit code, no listening socket.

So "the child says nothing" is not a mystery to be reproduced until it confesses.
It is a window with a known start, a known end, and a small number of things
inside it. Task 28 measured *first byte*, which by definition cannot see inside
this window — that is why it found a flat curve and concluded the wedge was not
there. The instrument was sound and pointed one step too late.

## Part 0 — see inside the window

Do not fix anything yet. Make the window observable, then reproduce.

Instrument the startup path so that each step announces itself *before* it
runs, on a stream that exists from the first instruction — `process.stderr`
directly, not the logger, because the logger is one of the things being timed.
Something a person can read: the step name and a monotonic timestamp. Keep it
cheap and keep it honest; this is a diagnostic, and whether it survives into the
final commit is a decision you make at the end, with an argument either way.

Then reproduce under load and report **which step the clock stops on**. Run the
full HARNESS suite, which is the trigger we know works. If it does not
reproduce in a few runs, raise the load deliberately rather than waiting.

The suspects, with the evidence for each, so you spend the budget on measuring
rather than on guessing:

- **`openDatabase()`** — SQLite. `~/.studio/` currently holds a 74KB
  `studio.db-wal` and a 32KB `studio.db-shm` dated 2026-07-27 beside a 4KB
  `studio.db`. A WAL that size next to a database that small is a recovery
  waiting to happen, and WAL recovery takes a lock. This is the strongest
  suspect for the Rust path specifically, because the app uses `~/.studio`
  while the tests use fresh temporary directories — and the app failed on a
  cold first launch.
- **`KeyringCredentialStore`** — `@napi-rs/keyring`, a native call into
  Windows Credential Manager. Constructed twice in this file. Native
  credential-store calls can block on a contended machine, and blocking is not
  the same as being slow.
- **`initializeObservability()`** — the OpenTelemetry SDK with OTLP HTTP
  exporters configured. Find out whether anything in that initialisation opens
  a socket or waits on an endpoint that is not there. A start-up that waits on
  a collector nobody is running is a hang with a very ordinary explanation.
- **`bootstrapModelProviders`** — cheap under the `test` source, and it is the
  source both failing paths were on. Rule it out by measurement, not by
  reasoning.

A negative result is a real finding here as it was in Tasks 27, 28 and 29. If
the clock stops somewhere this list does not name, that is the more valuable
answer and the list was the wrong shape.

## Part 1 — fix what the measurement names

The fix follows the diagnosis and this brief will not guess it for you. Two
rules constrain whatever you land:

- **The silent window must not survive as a silent window.** Whatever the cause
  turns out to be, a harness that cannot start must say so on a stream before
  it can no longer speak. That is this repository's oldest rule applied to its
  own boot: a failure is visible, or it is a hang.
- **Do not lengthen a timeout as the fix.** A wedged child that says nothing in
  ten seconds says nothing in sixty. Task 28 already established that patience
  is not information; Task 30 established that a budget may only be lengthened
  once the wait is visible. Both point the same way here.

If the true cause is genuinely outside our code — a platform behaviour, a
dependency's native call — then the deliverable is a start that *fails loudly
and fast* with the reason attached, and the report says plainly that the cause
is external. That is a real outcome and not a failure of the task.

While you are here: `mcp-flue.test.ts` starts a harness with a bare helper that
has no pid, no tails, and treats a child exit as retryable. Task 28 named it
and left it. It is the second of the three sightings, so give it the same
treatment `harness.test.ts` got rather than leaving the weakest instrument on
the path most likely to trip.

## Part 2 — only if Part 1 succeeded

Gate this on a harness that starts reliably. If Part 1 ends with an external
cause and a loud failure rather than a working start, stop at Part 1 and say
so; Part 2 keeps.

The desktop app cannot run against a real provider, and the reason is one line.
`resolveProviderConfig()` reads `PROJECT_STUDIO_MODEL_SOURCE` and defaults to
`test`. `apply_harness_environment` in
`STUDIO/src-tauri/src/harness/environment.rs` calls `env_clear()` and re-adds
an eleven-name allowlist that cannot contain it, and the spawn site adds only
`PORT` and the hostname afterward. So the app is structurally incapable of
reaching the BYOK path that already works everywhere else.

1. Set the source at the spawn site, beside `PORT`, with a comment explaining
   why it is set there and not inherited — the allowlist's whole point is that
   host variables cannot shadow deliberate ones, and this is a deliberate one.
2. **Decide what a first launch with no provider looks like.** Under `local`,
   `createLocalAdapter` validates eagerly and a user who has configured nothing
   gets a startup *failure*. That is right for a CLI and wrong for an app
   somebody just installed. The eager validation is deliberate and documented;
   do not delete it. Find the shape where a missing configuration is a state
   the settings UI can fix rather than a dead harness, and defend the choice.
   This is the real work of Part 2, not the one line.

## Part 3 — the live turn

Only after Parts 1 and 2 land.

A real OpenRouter connection is already configured on this machine and is the
user's own: `pnpm providers` reports `openrouter` and `openrouter-test`
connected, default model `openrouter-test/stealth/ox-alpha`. Task 25 used it
for live verification and its report documents the setup.

Send **one short message** through the running desktop app and confirm a real
answer renders. One turn, small, no tool calls needed. This is verification,
not a benchmark, and it spends the user's money — do not loop it, and do not
run a suite against it.

The key never appears in a log, an error, a fixture, a screenshot, a test, or
the report. It is the user's credential and it stays in the OS keychain where
`pnpm providers` found it.

If a retry happens to fire during that turn, capture what the person saw. That
would be Tasks 26 through 30 arriving on screen at once, against a real
provider, and it is worth a paragraph in the report if it happens. Do not
provoke one deliberately.

## Explicitly not this task

- The offered model switch. That is step 6 of the reliability build order and
  it is Task 32's whole subject.
- Retry budgets, classification, the retry map. Task 30 closed those.
- Rewriting the Rust restart policy. The supervisor's one-restart-per-60s
  window is deliberate and documented; this task explains why a child goes
  silent, it does not renegotiate what happens afterwards.
- Extracting the shared `availablePort` / `waitUntil` / `startHarness` helpers
  across the five integration files. Real, queued, and not now — except for the
  `mcp-flue.test.ts` instrument named in Part 1.
- The mixed-scope wildcard bind hazard from Task 28 §7.

## Constraints

- No `any`, no non-const `as`, no non-null `!`. Hard.
- The admission credential never appears in webview code, a log, an error, or a
  fixture. API keys never appear in a response body or a connection record.
- UTF-8, no BOM, LF. ASCII in source, with the one exception `rules.md` §10
  names: the em dash in comment prose, which §7 requires. No en dashes, no
  smart quotes, no curly apostrophes, no ellipsis characters, no emoji.
  (`harness.test.ts:175` currently carries a U+2026 from Task 28. It is
  pre-existing, it is one character, and you may fix it while you are in the
  file.)
- Modular. If a file passes ~400 lines it is probably two files.
- Every new behaviour gets a test that fails without it. Never leave a green
  placeholder test. Where a defect is statistical, a deterministic stub proves
  the shape — Task 28's `never-speaks.mjs` is the pattern.
- `cargo clippy --all-targets` at zero warnings.

**Do not edit files with a script.** `rules.md` §10 forbids it, and Task 29 did
it twice and had to disclose it. Edit by hand.

## Forbidden

Do not run `git checkout`, `git switch`, `git stash`, `git reset`,
`git clean`, `git commit`, or `git rebase`. Reading git state is fine.
`Backend/`, `docs/`, `prompts/`, and `report/` are the user's — read for
context, never modify, never `git add`.

Do not delete or move anything under `~/.studio/`. If the stale WAL there turns
out to be the cause, that is a finding to report and a recovery path to build,
not a file to quietly remove — it is the user's data directory, and "I deleted
it and the problem went away" destroys the only copy of the evidence.

## Verification — run each suite alone

```
cd "STUDIO" && pnpm test && pnpm typecheck
cd "STUDIO/src-tauri" && cargo test && cargo clippy --all-targets
cd "STUDIO HARNESS" && pnpm test
```

Running the two vitest suites concurrently makes Vite's SSR temp directory
vanish under one of them and produces ~80 bogus `ENOENT` failures.

Baselines, measured on 2026-08-26 after Task 30 landed (`ce2a68f`): `STUDIO` 15
files / 214 tests; `STUDIO/src-tauri` 64 tests, clippy 0 warnings; `STUDIO
HARNESS` 1311 passed / 25 skipped. Measure them again rather than trusting this
line.

**Run the full HARNESS suite more than once.** One green run does not
demonstrate a fix for a defect whose trigger is load; it is the same evidence
that persuaded Task 28 the wedge was not there. Say how many runs you did and
what each one reported.

## Report

Write `report/TASK-31-the-child-that-says-nothing.md`.

Lead with **Part 0**: which step of the startup sequence the clock stopped on,
how you measured it, and how many attempts it took to reproduce. Give the
numbers, not an impression.

Then the fix, and why it is a fix rather than a longer wait. Then Part 2's
first-launch decision and why you chose that shape. Then Part 3, in one
paragraph: it worked, or it did not, and what the person saw.

Finish with every place this brief was wrong. It has been the most useful
section of the last eight reports — and this brief is written on top of a
conclusion from Task 28 that turned out to be false, so treat its confidence
about the suspects as exactly the kind of thing worth proving wrong.
