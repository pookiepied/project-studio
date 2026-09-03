# TASK 27 — Classify the failure

You are working in `D:\Creative Library\Workspace\Project Studio`.

Read first, in this order:
1. `documentation/architecture/reliability-and-the-silent-stop.md` — the whole
   file, but especially §"The retry policy, and why its budget is coupled to
   visibility". This task is steps 2 and 3 of its build order.
2. `report/TASK-26-failure-is-visible.md` — step 1, already landed. A failure
   is now visible and carries the provider's sentence.
3. `STUDIO HARNESS/src/models/adapters/test-adapter.ts` — the `[fail]` seam.
4. `STUDIO HARNESS/src/observability/flue.ts` — we already call `instrument()`
   twice. Read this before choosing a route in Part 0.

## The problem, in one sentence

Flue decides whether to retry by regex-matching the provider's error sentence,
and its regex is both **too narrow** (it misses genuinely transient failures,
which are then not retried at all) and **too broad** (it matches billing
exhaustion, which is retried three times for nothing).

### Too narrow — this is the one that costs you work

Flue's classifier, inlined in
`node_modules/@flue/runtime/dist/conversation-projections-*.mjs`:

```
overloaded|rate.?limit|too many requests|429|500|502|503|504|
service.?unavailable|server.?error|network.?error|
connection.?(?:reset|refused|lost)|socket hang up|fetch failed|
timed? out|timeout|terminated
```

Pi's own list (`pi-ai/dist/utils/retry.js`) is a strict superset. Flue misses,
among others: `provider.?returned.?error` — whose comment in Pi names
OpenRouter's wrapper specifically — plus `ended without`,
`stream ended before message_stop`, `http2 request did not get a response`,
`websocket.?(closed|error)`, `upstream.?connect`, `reset before headers`,
`524`, `you can retry your request`, and `ResourceExhausted`.

A transient failure whose wording Flue does not recognise is **not retried at
all**. It fails on the first try. On OpenRouter that is not hypothetical.

### Too broad — this one only wastes time

Pi excludes quota and billing exhaustion from retry (`insufficient_quota`,
`out of budget`, `quota exceeded`, `billing`, monthly-limit wording). Flue has
**no non-retryable guard whatsoever**. OpenAI returns `insufficient_quota` as
HTTP **429**, which Flue's regex matches, so a billing failure burns three
retries and about fourteen seconds before the person is told the one thing
that would actually help them.

**Fix the narrowness first if you have to choose.** A missed retry loses work;
a wasted retry loses fourteen seconds.

## Part 0 — choose the route, and justify it

This is the real decision in this task, and it must be settled before any code.
I have already ruled things out so you do not have to:

- **There is no public retry-policy hook.** I read the exported surface.
- **`DurabilityConfig` is not it.** Its `maxAttempts` (default 10) counts
  submission attempts across resets and deploys, not model retries. Do not
  confuse the two; they are different mechanisms with similar words.
- The budget itself is `MAX_TRANSIENT_MODEL_RETRIES = 3` and
  `TRANSIENT_MODEL_RETRY_BASE_DELAY_MS = 2000`, neither exported.

Three candidate routes remain. Evaluate them and pick one:

1. **Patch `@flue/runtime`.** Precedent exists — `patches/@flue__cli@...`.
   The classifier is a handful of lines. The bundle filename carries a content
   hash, so an upgrade breaks the patch loudly rather than silently, which is
   a point in its favour. Against it: we would own a fork of a dependency's
   retry policy.
2. **`instrument()`**, which is public and which this codebase already uses
   twice. Its `FlueExecutionInterceptor` wraps operations including
   `{ type: 'model', turnId }`. **Whether an interceptor can actually
   influence the retry decision is unverified — find out.** The decision is
   made after the agent loop returns, by reading `stopReason` and
   `errorMessage` off the appended assistant message, so the question is
   whether the interceptor sits anywhere that can change what gets appended.
   If it cannot, say so plainly and move on; a negative result here is a
   genuinely useful finding and belongs in the report.
3. **Classify above the harness, in STUDIO.** Do not change retry behaviour at
   all; instead recognise quota and billing failures when they surface and
   render the right remedy. Cheap, no dependency risk, and it fixes the
   user-facing wrongness — but it fixes neither the wasted retries nor, more
   importantly, the transient failures that are never retried.

**The tension that probably decides it:** Flue classifies on the same string
the person reads. Since Task 26 the settlement's message is rendered verbatim,
so you cannot change the classification by rewriting the sentence without also
changing what the user sees. Anything that launders the error text to steer
the regex is out — it trades one honesty problem for another.

If your conclusion is that route 3 is all that is safely available right now,
that is an acceptable answer. Say so, do it, and record what routes 1 and 2
would have cost. Do not force a patch to look thorough.

## Part 1 — the classifier

Whichever route you chose, the behaviour to reach:

- A transient failure Pi would retry is retried, including OpenRouter's
  wrapper wording.
- A quota, billing, or usage-limit failure is **not** retried, and its sentence
  reaches the person immediately.
- The two lists live in one named place with the reasoning beside them, not
  scattered as inline regexes. Whoever revisits this should be able to see what
  is classified and why without reading a bundle.

Pi already exports `isRetryableAssistantError`. Prefer reusing its judgement
over copying its regex, if the route you chose allows it — a copied list rots.

## Part 2 — the remedy the person reads

A billing failure and a rate limit are not the same sentence and do not have
the same fix. Task 26 built the surface; this gives it something to say.

- Quota / billing exhausted → this will not resolve by waiting; it points at
  the provider account.
- Rate limited → transient, it was retried, it can be retried again.
- Everything else → the provider's sentence, unclassified rather than guessed.

Classification must key on wire facts. If a sentence matches nothing, say so
plainly. **An unrecognised error is not a rate limit**, and inventing a
category is the same defect class as inventing a completion.

## Explicitly not this task

- Lengthening the retry budget. The spine forbids it until retry is visible,
  and retry is not visible — Flue's retry is a log line, not a record.
- Emitting a retry signal on the wire (step 4).
- Per-class budgets (step 5).
- The offered model switch (step 6) — and when it comes, it carries the
  context-window guard recorded in the same document.
- `max_tokens` continuation. Separate decision, already answered.

## Reproducing

`[fail]` answers with a transient 429 every time. `[fail: some other text]`
names **any** provider sentence — so
`[fail: You exceeded your current quota, please check your plan and billing details (insufficient_quota)]`
and `[fail: Provider returned error]` are both one message away. Use them.

`PROJECT_STUDIO_MODEL_SOURCE=test` needs no network and no key. `launchHarness`
starts a real harness; see `tests/integration/harness-listener.test.ts` for the
environment, and `tests/integration/harness.test.ts` for the existing
provider-failure test to sit beside. Delete scratch probes when done.

**Count the attempts, do not assume them.** A fast-fail that still retries
three times passes any test that only checks the final outcome. Assert the
number of attempts — on the wire, the retries are visible as repeated
`message-started` / `message-completed` pairs.

## Constraints

- No `any`, no non-const `as`, no non-null `!`. Hard.
- The admission credential never appears in webview code, a log, an error, or
  a fixture. API keys never appear in a response body or a connection record.
- UTF-8, no BOM. ASCII punctuation in source; `--` not an em dash in comments.
- Modular. If a file passes ~400 lines it is probably two files.
- Every new behaviour gets a test that fails without it. Never leave a green
  placeholder test.
- `cargo clippy --all-targets` at zero warnings if you touch Rust.
- If you patch a dependency, the patch is minimal, commented, and the reason
  is recorded where the next upgrade will find it.

**Test the adversarial input.** An error matching both lists at once (a
billing message that also contains `429` — this is the real OpenAI shape, and
non-retryable must win). An empty error message. An error whose sentence
matches nothing. A transient failure that succeeds on the second attempt, so
retry still works and does not merely fail faster.

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
vanish under one of them and produces ~80 bogus `ENOENT` failures. Re-run
alone before reporting.

Baselines to beat, not merely match: `STUDIO` 12 files / 193 tests;
`STUDIO/src-tauri` 64 tests, clippy 0 warnings; `STUDIO HARNESS` 84 files /
1276 tests (+25 pre-existing environment skips).

## Report

Write `report/TASK-27-classify-the-failure.md`. Lead with **Part 0**: which
route you chose, what you ruled out, and what the rejected routes would have
cost — including whether an `instrument()` interceptor can reach the retry
decision at all, which nobody currently knows. Then the classifier, then the
remedy copy, with attempt counts measured rather than asserted.

Finish with every place this brief was wrong. It has been the most useful
section of the last five reports, and this one leans on regexes read out of a
bundle, which is exactly the sort of thing that turns out to be subtly off.
