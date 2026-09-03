# TASK 29 — A retry you can see

You are working in `D:\Creative Library\Workspace\Project Studio`.

Read first, in this order:
1. `documentation/architecture/reliability-and-the-silent-stop.md` — the
   whole file. This task is step 4 of its build order, and the rule that
   orders the whole document is the one you are here to satisfy.
2. `report/TASK-27-classify-the-failure.md` — steps 2 and 3, already landed,
   including the working `@flue/runtime` patch you will extend.
3. `STUDIO HARNESS/patches/@flue__runtime@1.0.0-beta.9.patch` and the
   comment block beside `patchedDependencies` in `pnpm-workspace.yaml`.
4. `STUDIO HARNESS/src/extend/mcp/wire/backoff.ts` — the best retry code in
   this repository, and the model for Part 2.
5. `STUDIO/src/platform/harness/conversation-chunks.ts`, especially the note
   at the top that an unknown chunk type survives as a fact carrying only
   its position.

## The rule this task exists to satisfy

> A retry budget may only be lengthened once the retry is visible. Invisible
> retry must stay short, because every second of it is indistinguishable
> from a hang.

Task 27 made the *ending* of a failed turn honest. It did nothing for the
middle. A throttled turn still spends about fourteen seconds emitting
repeated empty `message-started` / `message-completed` pairs and nothing
else, and the UI now tells the person "it was retried automatically" —
true, and something they never saw happen.

Inferring "it is retrying" from those repeated empties is not available to
us. A model that legitimately answers with nothing looks identical, and
guessing between them is the same defect class as inventing a completion.
**The signal has to come from the place that knows.**

## Part 0 — where the signal goes on the wire

The choke point is already located, so spend your research budget on the
second question rather than the first.

`waitForTransientModelRetry(assistant, attempt)` in
`node_modules/@flue/runtime/dist/conversation-stream-store-Bitz7UoW.mjs`
(line ~2387) is the only place either decision is made. Both branches are
there: retries exhausted, and about to sleep before another attempt. At that
point the method already holds everything a signal needs — the attempt
number, `MAX_TRANSIENT_MODEL_RETRIES`, the delay from
`modelRetryDelayMs(attempt)`, and the provider's sentence.

Two properties worth knowing before you design anything:

- **The attempt number is derived, not counted.** It comes from
  `countConsecutiveRetryableModelErrors` over the active conversation path,
  so it is read back from persisted records and therefore survives a resume.
  Whatever you emit should preserve that property rather than introduce a
  local counter that does not.
- **The sleep is abortable** via `this.modelRetryAbortController`, so a
  person can cancel *during* a retry wait. Your signal must leave the UI able
  to represent that ending, not just the happy path.

The open question, and Part 0's deliverable: **how does a chunk get appended
to the stream from inside that class, and can the retry site reach it?** The
class is the conversation stream store, so the machinery is nearby — but
"nearby" is not "reachable from this method", and the honest answer might be
that it is not. Find out and say so plainly. As in Task 27, a negative
result is a real finding.

If it cannot be reached, do not invent a substitute that guesses. Report
what blocks it and stop at Part 2, which stands on its own.

## Part 1 — the signal, and what the person sees

Keep the patch minimal and in the same spirit as the one already there: the
existing patch deleted a policy rather than adding one, and this one should
add the smallest possible fact rather than a feature.

- The chunk carries wire facts only: which attempt, out of how many, how
  long the wait is, and the provider's sentence for the attempt that failed.
  Nothing derived, nothing inferred.
- **Landing the patch before the UI must be safe.** The STUDIO parser keeps
  an unknown chunk type as a positioned fact rather than throwing, so verify
  that is actually true of your chunk shape rather than assuming it, and say
  in the report which test proves it.
- On screen, a retrying turn must be distinguishable from a stalled one at a
  glance. What it says is your call and you should defend it — but it says
  what is happening, not a reassurance, and a cancelled retry ends visibly
  rather than simply stopping.

Update the patch comment and the `pnpm-workspace.yaml` block. Both exist so
the next upgrade finds the reasoning; a second hunk that is not explained
there is worse than no hunk.

## Part 2 — one mechanism, many policies

There are currently **nine independent retry authorities in this repository
and no map of them**:

| where | budget | shape |
|---|---|---|
| Flue model turn | 3, base 2s + jitter | private to the bundle |
| Flue context overflow | compact, retry once | separate path |
| `durability.maxAttempts` (`src/agents/studio.ts`) | 3 | submission attempts across resets |
| MCP server start (`extend/mcp/wire/backoff.ts`) | 5, 1s x2 cap 30s, full jitter | ours, and the good one |
| Harness process (`src-tauri/.../supervisor.rs`) | 1 per 60s window | deliberate, not exponential |
| Harness HTTP client (`platform/harness/client.ts`) | none, on purpose | 12s timeout |
| Conversation stream (`platform/harness/conversation.ts`) | resume by offset | a resend would be a second turn |
| Outbound HTTP (`src/net/http.ts`) | none | ceiling and deadline |
| Test harness startup (`tests/integration/harness.test.ts`) | 1 replacement on silence | added by Task 28, shares one budget |

A contributor cannot answer "does this retry, and how many times?" from any
single place, and will find the number `3` in three unrelated meanings. The
ninth row is the newest and makes the point better than the argument does: it
was added days ago, by a task that was not about retry at all, and it is
already the second place in this repository implementing "try once more, then
tell the truth" — the harness supervisor being the first. Neither knows about
the other.

**Separate the policy, centralise the mechanism.** One global retry count is
genuinely wrong — a billing failure deserves zero attempts and a 429 without
`Retry-After` deserves eight — but four hand-rolled implementations of
"attempt number to delay" is duplication, not diversity.

1. Promote `backoff.ts` out of `extend/mcp/wire/` into a shared reliability
   module. **Behaviour unchanged**, MCP keeps passing its own options, the
   pure-function-with-injectable-random shape is preserved exactly. Its
   existing tests must pass untouched; if one needs editing, you have changed
   behaviour and must stop.
2. Write the map — that table, corrected by what you find, as
   `documentation/architecture/retry.md`, with a column for whether each is
   visible to the person waiting on it.
3. Add the rule to `documentation/rules.md`: **at most one retry authority
   per axis, and a layer that does not own the axis surfaces the failure
   instead of inventing its own loop.** The two comments that already reason
   this out independently — `platform/harness/client.ts` ("a retry loop
   against a dead loopback port only delays the truth") and
   `platform/harness/conversation.ts` ("a retry loop would be duplication
   wearing a retry's clothes") — are the evidence for it. Cite them.

Part 2 is not cosmetic and is not optional. If Part 0 comes back negative,
Part 2 is the whole task and should be done well.

## Explicitly not this task

- **Lengthening any retry budget.** The rule above permits it only once the
  retry is visible, and this task is what makes it visible. Changing a number
  here would consume the permission this task creates in the same commit that
  creates it. Step 5 is a separate decision with a separate brief.
- Per-class budgets, `Retry-After` honouring, the offered model switch.
- `max_tokens` continuation. Still an open decision, still not this.
- Rewriting the MCP supervisor or the Rust restart policy to use the shared
  module. Map them; do not move them.

## Reproducing

`[fail]` answers with a transient 429 every time, so it exercises the full
three-retry path and the exhausted branch. `[fail-once]` refuses once and
then answers, which is the case that must show a retry *and* a recovery.
`[fail: <text>]` names any other sentence.

`PROJECT_STUDIO_MODEL_SOURCE=test` needs no network and no key.
`tests/integration/harness.test.ts` holds the existing attempt-count tests to
sit beside; `attemptCount` there reads attempts back from real history and is
the pattern to follow.

**Count what you assert.** A retry signal that fires once when it should fire
three times passes any test that only checks the signal appeared.

## Constraints

- No `any`, no non-const `as`, no non-null `!`. Hard.
- The admission credential never appears in webview code, a log, an error, or
  a fixture. API keys never appear in a response body or a connection record.
- UTF-8, no BOM. Comments use full prose with em dashes, per `rules.md` §7.
- Modular. If a file passes ~400 lines it is probably two files.
- Every new behaviour gets a test that fails without it. Never leave a green
  placeholder test.
- If you patch a dependency, the patch is minimal, commented, and the reason
  is recorded where the next upgrade will find it.
- `cargo clippy --all-targets` at zero warnings if you touch Rust.

**Test the adversarial input.** A retry cancelled mid-wait. A retry signal
arriving in a redelivered batch. The exhausted branch, which must not read as
another retry about to happen. A turn that retries and then succeeds, where
the finished answer must not carry a stale "retrying" state. And a client
built before this chunk existed, which must not break on it.

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
1288 passed / 25 skipped across 85 files, re-measured after Task 28 landed.
Measure them again anyway rather than trusting this line.

## Report

Write `report/TASK-29-a-retry-you-can-see.md`. Lead with **Part 0**: whether
the retry site can reach the stream, how you established it, and what the
chunk looks like on the wire. Then what a retrying turn looks like end to
end, with attempt counts measured. Then Part 2, and specifically what the
map turned out to say that the table above got wrong.

Finish with every place this brief was wrong. It has been the most useful
section of the last six reports.
