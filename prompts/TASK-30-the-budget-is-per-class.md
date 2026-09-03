# TASK 30 — The budget is per class

You are working in `D:\Creative Library\Workspace\Project Studio`.

Read first, in this order:

1. `documentation/architecture/reliability-and-the-silent-stop.md`, and in
   particular the section "The budget is per class, not one number" (line 168)
   and "What has to be true before any of this is worth building" (line 273).
   This task is step 5 of that build order. Steps 1 through 4 have landed.
2. `documentation/architecture/retry.md` — the map Task 29 wrote, and the rule
   it exists to enforce.
3. `STUDIO HARNESS/patches/@flue__runtime@1.0.0-beta.9.patch` — all three
   hunks. You are extending the first two.
4. `STUDIO HARNESS/src/reliability/backoff.ts` — the shared mechanism, and the
   only place in this repository that is allowed to know how to wait.
5. `report/TASK-29-a-retry-you-can-see.md`, for what the wire now carries.

## The rule this task exists to satisfy

> A retry budget may only be lengthened once the retry is visible.

It is visible now. Task 29 was what bought this permission, and this task is
what spends it. That is also the reason this task could not have come earlier
and must not be widened now: the permission covers budgets, and nothing else.

## What is true today

Every transient failure gets the same budget: three retries, base 2000ms,
doubling. The constants are `MAX_TRANSIENT_MODEL_RETRIES` (line 372) and
`TRANSIENT_MODEL_RETRY_BASE_DELAY_MS` (line 373) in
`node_modules/@flue/runtime/dist/conversation-stream-store-Bitz7UoW.mjs`,
consumed by `modelRetryDelayMs(attempt)` at line 513 and by
`waitForTransientModelRetry(assistant, attempt)` at line 2387. Neither constant
is exported and there is no override hook.

The architecture document already states the policy this should become:

| Class | Budget |
|---|---|
| 429 carrying `Retry-After` | honour the provider's number |
| 429 without one | generous — the case worth 8 to 10 |
| 5xx, overloaded | medium, 3 to 5 |
| Connection reset, socket hang up | fast, 2 to 3 |
| Quota, billing, monthly limit | zero |

The last row already works: Task 27 delegated classification to pi-ai, whose
non-retryable patterns are tested before its retryable ones, so billing
exhaustion is not retried at all. **Do not re-implement it.** The other four
rows are one number today.

## Part 0 — what can actually be classified, and what has been lost

Do this before designing anything, and let the answer shape the rest.

`isRetryableAssistantError` is at
`node_modules/@earendil-works/pi-ai/dist/utils/retry.js`. Read it. It decides
from exactly one input: `message.errorMessage`, a string. The
`AssistantMessage` interface (`dist/types.d.ts`, line 279) carries
`errorMessage?: string` and `diagnostics?: AssistantMessageDiagnostic[]` and no
status code, no headers, and no response object.

So the first table row above — honour the provider's `Retry-After` — asks for a
value that may not exist by the time this code runs. **Find out whether it
survives anywhere**, and report the answer plainly:

- Does `diagnostics` carry anything structured, and is it populated on the
  error path at all, or only in some providers?
- Does any provider embed its retry delay in the message text? Pi's own
  retryable list contains the pattern `retry delay`, which suggests some do.
  If the number is only ever available as prose inside an error sentence, say
  so and say what parsing it would cost in fragility.
- Is there a seam higher up — inside Pi's streaming path, or Flue's call site —
  where the HTTP response is still in scope?

If `Retry-After` is unreachable at this layer, **that row does not get built**,
and the report says why. Inventing a delay and calling it the provider's number
would be worse than the fixed backoff we have. A negative result here is a real
finding, as it was in Tasks 27, 28 and 29.

Pi's own docblock is worth quoting in the report, because it describes this
task's boundary exactly:

> This does not implement retry policy. Callers should first handle context
> overflow separately, then apply their own retry budget, backoff, and
> reporting before restarting the assistant turn.

We are the caller it means.

## Part 1 — where the policy lives, and the rule it must not break

This is the design question, and getting it wrong undoes Task 29.

The natural implementation is to widen the existing patch: classify inside
`waitForTransientModelRetry` and pick a budget and a delay per class. But Task
29 established `src/reliability/backoff.ts` as the one place that knows how to
wait, and wrote the rule that there is **at most one retry authority per axis**.
A class-to-budget table living inside a patched dependency bundle would be a
second authority on the same axis, created one task after the rule forbidding
it.

So establish, with evidence:

- **Can the patched bundle reach our source at all?** It executes from
  `node_modules`; our modules are built separately. If it cannot import
  `src/reliability/`, say so concretely — what was tried, what failed, and
  whether the harness build (`flue build --target node`, which leaves
  `@flue/runtime` external) changes the answer.
- If it cannot, where does the table live so the rule survives? A table
  duplicated into the patch with no owner is the outcome to avoid. A table that
  lives in `src/reliability/` and is *injected* into the patched code at
  bootstrap is better if it is reachable. A patch that defers to a module it
  cannot import is not an option; do not pretend otherwise.

Whatever you choose, `documentation/architecture/retry.md` must still be true
when you are done, and its row for the Flue model turn must describe what now
happens. If your design genuinely requires a second authority, then the rule is
wrong or incomplete, and you should say that in the report and amend the rule
rather than quietly violating it.

Classification of the *class* is ours; classification of *retryable at all*
stays pi-ai's. Do not fork the second into the first.

## Part 2 — the budgets, and the two questions the table does not answer

The chunk Task 29 added already carries `maxRetries`, so a per-class budget
reaches the person for free: "Attempt 2 of 9" instead of "Attempt 2 of 4",
with no UI change. Verify that is true rather than assuming it; if
`RetryWait.tsx` hard-codes anything about the budget, that is a defect this
task surfaces and fixes.

Two things the architecture document's table does not settle, and you must:

1. **The class can change between attempts.** `attempt` arrives as a count from
   `countConsecutiveRetryableModelErrors` over the persisted path — consecutive
   *retryable* errors, without regard to class. A turn that fails with a 503 and
   then a 429 has attempt 2, but under which budget? Decide, defend it, and
   test it. The derived-not-counted property must survive: whatever you do must
   still be re-derivable from persisted records after a resume, because that is
   what makes the count correct across a restart.
2. **A generous budget makes the total wait long.** Eight attempts of doubling
   from 2s is over eight minutes. That is defensible only because the wait is
   now visible and cancellable — which is precisely the permission this task
   spends. Make sure it stays cancellable at every attempt, and consider
   whether a total-elapsed ceiling belongs beside the attempt count. If you add
   one, it is a policy with a number in it and it goes in the map.

Reuse `getBackoffDelay` from `src/reliability/backoff.ts` if Part 1 makes it
reachable. Its twelve tests must pass unmodified; if one needs editing you have
changed behaviour and must stop.

## Explicitly not this task

- The offered model switch. That is step 6, it needs only step 1, and it is a
  separate brief.
- `max_tokens` continuation. Still an open decision, still not this.
- The other eight rows of the retry map. Map them; do not move them.
- The silent harness start under the Rust supervisor, and the missing
  `PROJECT_STUDIO_MODEL_SOURCE` line at the spawn site. Both are real, both are
  known, both are queued behind this. Do not touch either.
- Widening what counts as retryable. Task 27 settled that by delegating to
  pi-ai, and re-opening it here would put two classifiers in the tree.

## Reproducing

`PROJECT_STUDIO_MODEL_SOURCE=test` needs no network and no key.

The test adapter's seams are `[fail]` (refuses every attempt), `[fail-once]`
(refuses once, then answers), and `[fail: <text>]` (names any sentence). The
third is how you drive a specific class: `[fail: 503 service unavailable]`,
`[fail: socket hang up]`, `[fail: insufficient_quota]`. Check the exact strings
against `isRetryableAssistantError`'s patterns rather than guessing which side
of the line a sentence lands on.

Note the wart before it bites you: `onceFailureCounts` in
`src/models/adapters/test-adapter.ts` is a module-level map keyed by the exact
refusal sentence and lives for the process lifetime. Give each scenario its own
sentence.

`tests/integration/harness.test.ts` holds Task 29's strict-counting helpers —
`readUpdateChunks`, `collectUntil`, `isRetryWaitChunk`, `waitForSettledChunk`.
Follow them. **Count what you assert:** a per-class budget that silently falls
back to three passes any test that only checks a retry happened.

## Constraints

- No `any`, no non-const `as`, no non-null `!`. Hard.
- UTF-8, no BOM, LF. ASCII in source, with the one exception `rules.md` §10 now
  names: the em dash in comment prose, which §7 requires. No en dashes, no
  smart quotes, no curly apostrophes, no emoji.
- Modular. If a file passes ~400 lines it is probably two files.
- Every new behaviour gets a test that fails without it. Never leave a green
  placeholder test.
- Patches stay minimal and commented, and the reason is recorded where the next
  upgrade will find it — the patch comment and the `patchedDependencies` block
  in `pnpm-workspace.yaml`. A hunk explained in neither is worse than no hunk.
- `cargo clippy --all-targets` at zero warnings if you touch Rust.

**Do not edit files with a script.** `rules.md` §10 forbids it, and the last
task did it twice and had to disclose it. Edit by hand.

**Test the adversarial input.** A class that changes between attempts. A budget
of zero, which must produce no retry signal at all and settle immediately. A
generous budget cancelled at attempt six. A retry signal arriving in a
redelivered batch. A resume in the middle of a long wait, where the attempt
count must be re-derived rather than restarted. And the exhausted branch, which
must still emit nothing.

## Forbidden

Do not run `git checkout`, `git switch`, `git stash`, `git reset`, `git clean`,
`git commit`, or `git rebase`. Reading git state is fine. `Backend/`, `docs/`,
`prompts/`, and `report/` are the user's — read for context, never modify,
never `git add`.

`documentation/` is mine to change when this task requires it: `retry.md` must
stay true, and `reliability-and-the-silent-stop.md` line 195 says "Flue's retry
is a log line, not a record", which Task 29 made false. Correct that sentence.
Those two edits are in scope; nothing else under `documentation/` is.

## Verification — run each suite alone

```
cd "STUDIO" && pnpm test && pnpm typecheck
cd "STUDIO/src-tauri" && cargo test && cargo clippy --all-targets
cd "STUDIO HARNESS" && pnpm test
```

Running the two vitest suites concurrently makes Vite's SSR temp directory
vanish under one of them and produces ~80 bogus `ENOENT` failures.

Baselines, measured on 2026-08-25 after Task 29 landed: `STUDIO` 15 files / 214
tests; `STUDIO/src-tauri` 64 tests, clippy 0 warnings; `STUDIO HARNESS` 1291
passed / 25 skipped. Measure them again rather than trusting this line.

## Report

Write `report/TASK-30-the-budget-is-per-class.md`.

Lead with **Part 0**: what an error actually carries by the time this code sees
it, and whether `Retry-After` survives. If it does not, that is the headline,
and the table above is wrong in its first row.

Then Part 1: where the policy ended up living, what you tried, and whether the
one-authority-per-axis rule survived intact — including the case where it did
not and you are proposing to amend it.

Then the budgets themselves, with measured attempt counts per class, and your
answer to the class-changes-mid-sequence question.

Finish with every place this brief was wrong. It has been the most useful
section of the last seven reports.
