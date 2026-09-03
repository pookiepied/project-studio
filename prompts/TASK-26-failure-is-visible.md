# TASK 26 — Failure is visible

You are working in `D:\Creative Library\Workspace\Project Studio`.

Read first, in this order:
1. `documentation/architecture/reliability-and-the-silent-stop.md` — items 1-3
   of §"The gaps, honestly" were rewritten on 2026-08-25 with observed
   findings. This task is item 3.
2. `documentation/architecture/transcript-and-rendering.md` §1
3. `STUDIO/src/platform/harness/conversation-chunks.ts`,
   `STUDIO/src/features/chat/transcript/projection.ts`,
   `STUDIO/src/features/chat/useConversation.ts` — Task 25's code, which you
   are correcting.
4. `STUDIO/src/features/chat/transcript/wire-contract.test.ts` — how real
   captured wire payloads are pinned. You will add one.

## The bug, already diagnosed and reproducible

**Do not re-litigate which layer is at fault.** That work is done, and the
Task 25 report got it wrong, so trust this over that report:

- Pi does not retry. It classifies, and says so in its own docblock.
- Flue retries transient model errors three times, gives up, and settles
  `outcome: "failed"` carrying the provider's own sentence.
- **The harness is honest. The silence is ours.**

Feed a real rate-limited turn through the shipped parser and reducer and it
renders as **four empty assistant messages, every one marked `complete`**,
with nothing saying anything went wrong. Two causes:

1. **The settlement's error is dropped.** The wire carries it, shaped like
   `{"type":"submission-settled","outcome":"failed","error":{"name":"FlueError",
   "type":"operation_failed","message":"direct(...) failed: 429 rate limit
   exceeded: temporarily rate-limited upstream"}}`. `readChunkFacts` produces
   `errorText: null` for that chunk. The one sentence a person could act on
   never leaves the parser.
2. **Every retry attempt is already `complete`.** Each attempt emits its own
   `message-started` / `message-completed`, so by the time the failed
   settlement arrives all four messages are `complete` — and the rule that a
   failed settlement marks only *still-open* messages then correctly touches
   none of them.

The insight worth keeping: **`message-completed` means "this attempt's record
is closed", not "this turn succeeded".** Conflating the two is how a faithful
log still produces a fabricated success.

### Reproducing it

The test provider fails on demand. `[fail]` in a user message answers with a
transient 429 every time; `[fail: some other text]` names any other provider
sentence, so a non-retryable failure goes through the same door. Both live in
`STUDIO HARNESS/src/models/adapters/test-adapter.ts` beside the older
`[slow]`, and `tests/integration/harness.test.ts` pins the harness half.

`PROJECT_STUDIO_MODEL_SOURCE=test` needs no network and no key.
`launchHarness` (`STUDIO HARNESS/src/host/harness-launcher.ts`) starts a real
harness; see `tests/integration/harness-listener.test.ts` for the environment
it wants. Capture a real failed turn this way and pin it, the way
`wire-contract.test.ts` pins the text and tool turns. Delete scratch probes
when you are done.

## Part A — carry the reason

Extend the wire mirror so a settlement's error survives parsing: at minimum
the provider's message, and the error type beside it. Keep the house style —
hand-written parsers, no schema library, fields the wire omits are `null`
rather than invented.

A failure with no sentence is still a failure. Do not synthesise a message
when the wire carries none; render the outcome and say the reason is unknown.

## Part B — a failed submission must not look like a completed one

Decide the rule and defend it in the report. The constraint is
`transcript-and-rendering.md` §1: this is a **display** projection, and
nothing you add may flow back into a request.

Two things must be true when you are done:

- A rate-limited turn is visibly a failure, with the provider's sentence
  reachable, not four empty bubbles.
- A turn that genuinely completed earlier in the same submission still reads
  as completed. A late failure does not retroactively falsify real work — the
  tool turn already pinned in `wire-contract.test.ts` must not regress.

Retry attempts are the hard case and the interesting one. Four empty assistant
messages for one rate-limited turn is bad rendering regardless of the error
text; consider whether an attempt that produced no content and ended in a
failed submission should be an item at all. Whatever you choose must be
derivable from wire facts alone — never from a count you infer, nor from a
heuristic about emptiness that a legitimately silent model would trip.

## Part C — a refused submission must change something on screen

`ChatPage.tsx` sends with `onSend: (text) => void live.submit(text)` and
discards the result. A refused POST — no provider configured, admission
denied, harness gone — changes no phase and paints nothing. The person types,
presses send, and the app does exactly nothing.

Submission failure belongs in the connection state machine, not a toast bolted
onto the page. `useConversation.submit` already returns a typed error; give it
somewhere to land and render it the way `ConnectionNotice` renders the other
states. The message must name what a person can do about it — a missing
provider connection and a dead harness are not the same sentence.

**Do not lose the typed text when a send fails.**

## Explicitly not this task

- `max_tokens` continuation. Already answered: Flue classifies a `length`
  stop as `completed` and does not continue the turn. Fixing that means
  patching Flue or continuing a layer above, and it is its own decision.
- Retry jitter, or a "retrying now" surface — separate task.
- Bounded auto-resume for streams.
- Retry/edit/fork semantics against an append-only log.
- The approvals UI.
- Anything from `transcript-and-rendering.md` §4-§6.

## Constraints

- No `any`, no non-const `as`, no non-null `!`. Hard.
- The admission credential never appears in webview code, a log, an error, or
  a fixture. API keys never appear in a response body or a connection record.
- UTF-8, no BOM. ASCII punctuation in source; `--` not an em dash in comments.
- Modular. If a file passes ~400 lines it is probably two files.
- Every new behaviour gets a test that fails without it. Never leave a green
  placeholder test.
- `cargo clippy --all-targets` at zero warnings if you touch Rust.

**Test the adversarial input.** For this task: a failure arriving after real
content already streamed, a failed settlement for a submission whose earlier
messages genuinely completed, a settlement with `outcome: failed` and no error
object at all, a submission refused while an earlier turn is still streaming,
and a redelivered batch containing the failed settlement.

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

Baselines to beat, not merely match: `STUDIO` 11 files / 166 tests;
`STUDIO/src-tauri` 64 tests, clippy 0 warnings; `STUDIO HARNESS` 84 files /
1276 tests (+25 pre-existing environment skips).

## Report

Write `report/TASK-26-failure-is-visible.md`. Lead with what a failed turn
looks like now, end to end, and the rule you chose in Part B with the argument
for it. Then Part A and Part C. Finish with every place this brief was wrong —
that section has been the most useful part of the last four reports, and this
brief asserts a diagnosis confidently enough that it deserves checking.
