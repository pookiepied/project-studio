# TASK 32 — The turn you cannot watch

You are working in `D:\Creative Library\Workspace\Project Studio`.

Read first, in this order:

1. `report/TASK-31-the-child-that-says-nothing.md` — and specifically what its
   boot log bought. The method is the point: the window was described from the
   inside before anything was fixed, and the measurement refuted the brief's
   suspects. Do that again here.
2. `documentation/architecture/reliability-and-the-silent-stop.md` — the
   principle section. This task is the same defect the whole document is about,
   one layer up.
3. `STUDIO/src/platform/harness/conversation.ts` — the whole header comment,
   which explains the two views, the offset discipline, and why history is read
   before updates are opened.
4. `STUDIO/src-tauri/src/services/stream.rs` — the SSE parse and forward loop.
5. `STUDIO/src/features/chat/transcript/projection.ts`, the chunk switch at
   line ~718, and `STUDIO/src/features/chat/useConversation.ts`, `reduceChunks`
   and the phase machine.

## The observation

A real turn against a real provider, through the desktop app, on 2026-08-26:
the user sends a message, nothing happens for several seconds, and then the
entire answer appears at once. No text growing. No thinking indicator. No stop
button. No sign the turn is running at all.

## What is already built, which is what makes this a defect

Every layer of the streaming path exists and looks correct on inspection:

- **The harness emits deltas.** `report/TASK-25-render-the-conversation.md`
  captured live frames from a real OpenRouter turn, including
  `message-delta` with `"kind":"reasoning"` and incremental text.
- **Rust forwards frame by frame.** `services/stream.rs` reads the body into a
  bounded channel and pushes each parsed SSE frame onward as it arrives.
  Nothing buffers to completion.
- **React accumulates token by token.** `projection.ts` line ~768 handles
  `message-delta` by calling `appendDelta` into the assistant's segments.

So this is not an unimplemented feature. A working chain has stopped delivering
mid-turn, and the task is to find where.

## One line explains every symptom, which is why there is one defect and not four

`ChatPage.tsx` line ~181:

```tsx
busy: live.phase.status === 'streaming',
onStop: () => void live.abort(),
```

`phase.status` becomes `'streaming'` only when a `message-started` or
`message-delta` chunk arrives **while the turn is running**
(`useConversation.ts`, `reduceChunks`). If no chunk arrives until the end, then
in one stroke: no text grows, `busy` never goes true, the stop control never
renders, and no in-progress state is shown.

The abort seam itself is wired and works — `live.abort()` exists and reaches
Flue's abort route. There is no way to stop a turn because the control that
would offer it never appears.

**Do not fix the symptoms.** If you find yourself making the stop button render
on some other condition, you have gone the wrong way: the button is correct and
its condition is correct, and the thing that is wrong is that the condition is
never true.

## Part 0 — find where the deltas stop, and do not fix anything yet

There are four places the chain can break, and they are distinguishable by
measurement rather than by reasoning. Establish which one, and report how.

1. **The provider never streams.** The model returns one chunk, or the request
   is not made in streaming mode. Check what `LocalModelProviderAdapter`
   actually passes to Pi, and whether `stealth/ox-alpha` streams at all. The
   `test` source is the control: it needs no network and no key, so a turn on
   `PROJECT_STUDIO_MODEL_SOURCE=test` separates "our plumbing" from "this
   provider".
2. **The harness does not project deltas onto the updates view during a live
   turn.** Read the agent stream route directly over HTTP, the way the Task 29
   and 30 integration tests do, and watch whether `message-delta` frames arrive
   *while the turn runs* or all at once at the end. This is the cheapest
   decisive probe available and it should probably be first.
3. **The webview never has the stream open while the turn runs.** The design is
   history first, then updates opened strictly after the snapshot's offset. If
   the attach happens late, dies silently, or is superseded by a re-read on
   submit, chunks would only be seen on a later read. `useConversation.ts`
   around line 359 is where attaching is decided.
4. **Rust classifies or coalesces them.** Least likely, given the loop, but it
   is on the path and cheap to rule out.

Instrument, do not guess. Task 31's boot log is the pattern: a cheap, honest,
directly-written line that describes a window from the inside. A count of
frames with arrival timestamps at each of the four boundaries — harness SSE
out, Rust frame parsed, Rust event delivered, projection applied — settles this
in one run. Whether that instrumentation survives into the commit is a decision
you make at the end, with an argument either way.

Report which boundary the deltas stop at, with the timestamps. If the answer is
(1), say so plainly: a provider that does not stream is not our defect, and the
finding is then that the UI has no honest way to show a turn it cannot see
progressing — which is a different and smaller task, and this brief was wrong.

## Part 1 — fix the delivery

The fix follows the diagnosis and this brief will not guess it. Two constraints:

- **The offset discipline is not negotiable.** `conversation.ts`'s header
  explains why history is read before updates open, and why every delivery
  carries the offset to resume *from*. Whatever you change, a reattach must
  still replay exactly the events the consumer has not applied, and the
  position-based deduplication in `reduceChunks` and the projection must still
  make a redelivered batch safe to apply twice.
- **Do not make the UI infer progress.** If deltas genuinely do not arrive,
  the answer is to deliver them, not to animate a guess. This codebase refused
  that inference in Task 29 for the same reason it must refuse it here: an
  invented progress indicator is indistinguishable from a real one exactly when
  it is wrong.

## Part 2 — what should come back on its own

Once deltas arrive during the turn, `phase.status` becomes `'streaming'` and
the three missing behaviours should return without any new UI code:

- text growing in the assistant message,
- `busy` true on the composer, which renders the stop control,
- the in-progress state visible rather than a gap.

**Verify that rather than assuming it**, the way Task 30 verified that a
per-class budget reached the screen with no frontend change. If any of the
three does not come back, that is a second defect and it is in scope — but say
which it was and why it did not follow.

`ThinkingBlock.tsx` exists. Find out whether reasoning deltas reach it, and if
they do not, whether that is this same defect or a separate one.

Every behaviour you restore gets a test that fails without it.

## Part 3 — verify it on both sources

**The test source first**, because it is deterministic, free, and needs no
network: a turn on `PROJECT_STUDIO_MODEL_SOURCE=test` should show the same
in-progress behaviour as a real one. If the test adapter does not emit
incremental deltas, it should — a seam that cannot exercise streaming cannot
protect it, and adding that is in scope.

**Then one real turn** through the desktop app, on the OpenRouter connection
already configured on this machine (`pnpm providers` reports it; Task 31 wired
the desktop app to the `local` source). One short message. This spends the
user's money: do not loop it, do not benchmark it.

Say what a person actually saw, in plain words. That sentence is the deliverable
this whole task exists for.

The API key never appears in a log, an error, a fixture, a screenshot, a test,
or the report.

## Explicitly not this task

- **Model switching, adding models, per-run routing.** Genuinely unbuilt, and
  honestly scoped as such: `provider-config.ts` says there is no account model
  or run router in this phase. Not now.
- **The offered model switch** (step 6 of the reliability build order). It was
  going to be this task and it is now Task 33, precisely because a mid-turn
  control needs a UI that has a mid-turn.
- **Gallery and demo content.** `ChatPage.tsx` has a `gallery` branch that
  withholds `onSend`, `busy` and `onStop` entirely. Removing demo scaffolding
  is real work the user has named, and it is its own task. Do not start it. If
  the gallery flag turns out to be involved in this defect, that is a finding
  worth reporting.
- The loader dynamic-import dilation from Task 31 §7, and the unexplained
  monotonic clock measurement. Both queued, both named, neither now.

## Constraints

- No `any`, no non-const `as`, no non-null `!`. Hard.
- The admission credential never appears in webview code, a log, an error, or a
  fixture. API keys never appear in a response body or a connection record.
- UTF-8, no BOM, LF. ASCII in source, with the one exception `rules.md` §10
  names: the em dash in comment prose, which §7 requires. No en dashes, no
  smart quotes, no curly apostrophes, no ellipsis characters, no emoji.
- Modular. If a file passes ~400 lines it is probably two files.
- Never leave a green placeholder test.
- `cargo clippy --all-targets` at zero warnings if you touch Rust.

**Do not edit files with a script.** `rules.md` §10 forbids it. Edit by hand.

**Test the adversarial input.** A turn whose stream drops mid-generation and
reattaches, where the replayed batch must not duplicate rendered text. A turn
aborted while text is growing. A retry firing mid-turn, where the retry wait
must show and then clear when generation resumes. Two conversations open, where
a delivery for one must never land on the other's transcript.

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

Baselines, measured on 2026-08-26 after Task 31 landed (`e9898dd`): `STUDIO` 15
files / 214 tests; `STUDIO/src-tauri` 65 tests, clippy 0 warnings; `STUDIO
HARNESS` 1314 passed / 25 skipped. Measure them again rather than trusting this
line.

Run the full HARNESS suite more than once. The startup wedge from Task 31 is
episodic on a tens-of-minutes timescale and its boot log now names it clearly;
a run that trips it is not a failure of your change, and the boot lines will
say so.

## Report

Write `report/TASK-32-the-turn-you-cannot-watch.md`.

Lead with **Part 0**: which of the four boundaries the deltas stopped at, the
timestamps that establish it, and how many runs it took. Numbers, not
impressions.

Then the fix, and why it is a delivery fix rather than a UI change. Then Part
2: which of the three behaviours came back on their own and which did not.
Then Part 3 in one paragraph, in plain words, describing what a person watching
the window actually saw.

Finish with every place this brief was wrong. It has been the most useful
section of the last nine reports, and the last two briefs were both confidently
wrong about their own strongest suspect.
