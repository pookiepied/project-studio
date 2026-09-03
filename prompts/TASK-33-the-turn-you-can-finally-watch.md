# TASK 33 — The turn you can finally watch

You are working in `D:\Creative Library\Workspace\Project Studio`.

Read first, in this order:

1. `report/TASK-32-the-turn-you-cannot-watch.md` — the whole thing, and
   especially section 5, where the user's own hands-on session is classified.
   Three of those nine observations are this task. The report was right to
   name them and right not to widen its own scope; that scope is now here.
2. `STUDIO/src/features/chat/useConversation.ts` — `reduceChunks` and the
   phase machine, as Task 32 left them at `83155af`.
3. `STUDIO/src/features/chat/transcript/live/LiveTranscript.tsx` — the whole
   file. It is short and its comment at the tail describes behaviour its own
   condition cannot produce.
4. `STUDIO/src/features/chat/transcript/live/AssistantTurn.tsx` — `EndLine`
   and its docblock.
5. `STUDIO/src/features/chat/composer/Composer.tsx` — the "Where a send goes"
   section of the header, and `submit()`.

## What Task 32 fixed, and what it did not

Task 32 fixed the delivery. A submission now attaches its read at the
admission receipt's own offset, so the turn's chunks reach the page while the
turn runs, and a read that has gone deaf is named instead of trusted. That is
verified and committed.

What it did not fix is everything between the receipt and the first token,
and everything the page says about a turn while it is running. The user's
sentence — "if I send a text, the result only appears, and that's basically
it" — is still partly true, for three reasons that have nothing to do with
delivery.

## Part 1 — the turn is invisible until the model speaks

`reduceChunks` moves the phase to `streaming` only on `message-started` or
`message-delta`. It does not handle `message-appended`, which is the user's
own message arriving. Everything the page shows about a running turn hangs
off `phase.status === 'streaming'`:

- `ChatPage.tsx` line ~181: `busy` and therefore the stop control,
- `LiveTranscript.tsx`: `turnRunning`, and therefore the working mark,
- `AssistantTurn.tsx`: `live`, and therefore the caret and the paced reveal.

Measured on the real provider in Task 32's own Run 2: admitted at +127 ms,
`message-appended` at +1198 ms, `message-started` at **+6118 ms**. So for six
seconds of a seven-second turn the composer is idle, no stop is offered, and
nothing on the page says a turn exists. That is the gap the user described.

`LiveTranscript.tsx`'s tail comment claims to cover exactly this: "the gap
between sending and the first token gets the mark's own ripple". Its guard is
`phase.status === 'streaming'`, which cannot be true in that gap. The intent
was right and the condition never matched it.

**The receipt is a fact, not an inference.** The harness admitted the turn
and gave us its submission id and the offset its events begin at. Saying "a
turn is running" on the strength of that is reporting what the harness said,
which is the opposite of the invented progress indicator Task 29 and Task 32
both refused. Be precise about which of the two you are building; if you
cannot say in one sentence why this is a report and not a guess, stop and
write that sentence first.

The design decision, which is the real work of this part:

- **Is "admitted, not yet producing" a distinct phase, or is it `streaming`
  with the receipt's submission id and nothing produced yet?** The union's
  own docblock argues that combinations booleans allow are not states a
  conversation has. Decide, and defend it in the docblock the way the
  existing states are defended.
- **What clears it, and what may never clear it.** A settlement clears it. An
  interruption clears it. Task 32's liveness watchdog clears it. A local
  timer must not, and neither may "we have waited long enough" in any
  disguise — a busy composer that unsticks itself on a clock is the silent
  stop again, wearing a spinner. If a turn is admitted and the harness then
  says nothing forever, name what the person sees and why that is honest.
- **The composer's own in-flight lock already exists.** `Composer.tsx` holds
  `sending` from send to receipt, and `busy` is `(busyOverride ?? false) ||
  sending`. Work out how the new state hands off from `sending` without a
  frame where neither is true — a stop control that blinks out and back is
  worse than one that arrives late.

Every behaviour gets a test that fails without it, including the negative
one: a submission whose read then breaks must not leave the composer busy
forever.

## Part 2 — a message being written says it was stopped

`projection.ts` line ~761 opens an assistant message with
`end: { state: 'stopped' }`, and `AssistantTurn.tsx`'s `EndLine` renders for
any end state that is not `complete`. So from `message-started` until
`message-completed`, every live reply carries a stop icon and the words
"Stopped before finishing" underneath the text it is still writing.

**Do not change the projection's default.** It is deliberate and its
docblock says why: how a message ended comes from the log, never from
silence, and a message with no completion fact really has not completed. The
default is correct. What is wrong is rendering a conclusion about the ending
of a message that has not reached its ending yet.

`AssistantTurn` already receives `live`. That is the seam. Note the coupling
before you use it: `live` is derived from `phase.status === 'streaming'`, so
whatever you decide in Part 1 changes what `live` means here. Say which
definition you are relying on.

The case that must still work: a message left unfinished by a crash, a
harness stop, or an abort still reads as stopped, immediately, with no turn
running. That is the whole reason `EndLine` exists and Task 26 built it.
Write the test that would catch a fix that silenced it.

## Part 3 — the composer that starts a conversation is a demo

`Composer.tsx` sends through the workspace store's local demo turn runner
unless it is given `onSend`. Exactly one caller gives it one: `ChatPage.tsx`,
and only for a non-gallery conversation.

- `HomePage.tsx` line ~49: no `onSend`.
- `ProjectPage.tsx` line ~50: no `onSend`.

Both are the entry point. So **every conversation in this app begins with a
fake turn**: the message never leaves the page, a local demo reply types
itself out, a conversation id is created that the harness has never heard of,
and the chat page then attaches to it and sits empty forever. The second
message onward is live, which is why the app appears to work.

The user named removing demo scaffolding as its own task. This is that task's
first and largest instance, and it is here because a live first turn is not
scaffolding removal, it is the missing half of the send path.

The decision to make and defend:

- **Where does the first submission happen?** Home has no conversation and no
  client; the chat page has both. Submitting from home means building a
  client for an id that does not exist yet and carrying the receipt across a
  navigation; navigating first and submitting on mount means the text has to
  survive the transition, and a mount-time submit must never fire twice under
  React's development double-invoke or a remount. Both shapes are real. Pick
  one, and say what the other would have cost.
- **What happens to a failed first send.** Task 32's composer keeps the words
  in the field when the harness refuses. A first send that has already
  navigated has no field to keep them in. Decide before you build, not after.
- **The gallery stays.** `GALLERY_CONVERSATION_ID` is a display of artifacts,
  not a conversation with an agent, and `ChatPage.tsx` withholds `onSend`,
  `busy` and `onStop` for it deliberately. Leave it alone. `useGalleryTurn`
  stays. Whether `useDemoTurn` still has any caller once this lands is a
  finding to report, not a file to delete on a hunch.
- **The seeded demo conversations** in `DEMO_CONVERSATIONS` are a separate
  question and not this task. If they get in the way, say how.

## Part 4 — the two-line typecheck debt

`STUDIO HARNESS`'s `pnpm typecheck` is red at `83155af` and has been since
Task 31:

```
tests/unit/model-providers.test.ts(215,26): error TS2339:
  Property 'assertTargetResolvable' does not exist on type 'ModelProviderAdapter'.
tests/unit/model-providers.test.ts(218,26): same
```

`assertTargetResolvable` is declared on `LocalModelProviderAdapter`
(`src/models/adapters/local-adapter.ts:102`) but not on the
`ModelProviderAdapter` interface that `createModelProviderAdapter` returns.
Two shapes fix it: narrow at the test, or declare it on the interface. One of
those is a statement about what a provider adapter *is*. Decide which, briefly.

It is in this task because a gate nobody runs is not a gate, and because it
was my own miss: Task 31's verification block never named HARNESS typecheck.
It is named in this one, below.

## Part 5 — verify it as a person, on both sources

The test source first, with `[pace]`, because it is free and deterministic.
Then **one** short message through the desktop app on the real OpenRouter
connection. One turn. It spends the user's money: do not loop it, do not
benchmark it, and the key never appears in a log, an error, a fixture, a
screenshot, a test, or the report.

What has to be true, and be honest about which of these you actually saw:

1. From the moment the words leave the field, the page says a turn is running
   — before the model has produced anything.
2. The stop control is offered for that whole time, and pressing it aborts.
3. Nothing under the growing reply claims it stopped.
4. A conversation started from home reaches the harness on its **first**
   message, and its first reply is the model's.

## Explicitly not this task

- **The offered model switch.** Deferred from Task 32, deferred again, and
  it is Task 34. It needs the mid-turn this task is building.
- **Model switching, adding models, per-run routing.** Unbuilt, honestly
  scoped as such in `provider-config.ts`. Not now.
- **Thinking duration.** `AssistantTurn.tsx` refuses it because no duration
  is carried per segment on the wire. Recording each thinking segment's
  first-delta arrival time would be a measurement rather than an inference,
  and it is a real follow-up — not here.
- **Message actions, copy, read-aloud, model name.** Task 25 shipped a
  deliberately minimal live surface; completing it is its own task.
- **Reveal cadence tuning.** Flue coalesces streamed deltas at
  `CANONICAL_FLUSH_DELAY_MS = 1e3`, hard-coded in the vendored bundle
  (`node_modules/@flue/runtime/dist/internal.mjs:22`), and the SSE route
  polls durable at 250 ms. That is the floor on when text can first appear,
  and `useSmoothText` already paces what arrives. Changing the constant means
  extending the patch, which is a decision with a cost. Not this task. If
  your live turn still reads as blocky **after** Parts 1 and 2, that is a
  finding worth a paragraph.
- **The sandbox corridor** (see Verification). Not yours to repair.
- **The unexplained dev-app page reloads** from Task 32 section 7.7.
- The Flue loader dynamic-import dilation from Task 31 section 7.

## Constraints

- No `any`, no non-const `as`, no non-null `!`. Hard.
- The admission credential never appears in webview code, a log, an error, or
  a fixture. API keys never appear in a response body or a connection record.
- UTF-8, no BOM, LF. ASCII in source, with the one exception `rules.md` §10
  names: the em dash in comment prose, which §7 requires. Task 32's new
  comments used ASCII hyphens where prose called for em dashes; match the
  file you are in. No en dashes, no smart quotes, no curly apostrophes, no
  ellipsis characters, no emoji.
- Modular. If a file passes ~400 lines it is probably two files.
- Never leave a green placeholder test.
- `cargo clippy --all-targets` at zero warnings if you touch Rust.

**Do not edit files with a script.** `rules.md` §10 forbids it, and the last
three reports each had to disclose one. Edit by hand, including report
headings.

**Test the adversarial input.** A first send from home that the harness
refuses. A submission that is admitted and then interrupted before any token
— the composer must not stay busy. An abort pressed during the quiet window,
before the model has produced a thing. A turn whose stream drops and
reattaches while text is growing, where the replayed batch must not duplicate
rendered text and must not resurrect a stop label. Two conversations open,
where a delivery for one must never land on the other's transcript.

## Forbidden

Do not run `git checkout`, `git switch`, `git stash`, `git reset`,
`git clean`, `git commit`, or `git rebase`. Reading git state is fine.
`Backend/`, `docs/`, `prompts/`, and `report/` are the user's — read for
context, never modify, never `git add`.

Do not delete or move anything under `~/.studio/`.

## Verification — run each suite alone

```
cd "STUDIO" && pnpm test && pnpm typecheck
cd "STUDIO/src-tauri" && cargo test && cargo clippy --all-targets
cd "STUDIO HARNESS" && pnpm test && pnpm typecheck
```

`STUDIO HARNESS`'s typecheck is in that list on purpose, and Part 4 is what
makes it green.

Running the two vitest suites concurrently makes Vite's SSR temp directory
vanish under one of them and produces ~80 bogus `ENOENT` failures.

Baselines, measured independently on 2026-08-26 at `83155af`:

- `STUDIO`: 15 files / 218 tests, typecheck clean.
- `STUDIO/src-tauri`: 65 tests, clippy 0 warnings — **but** one of them,
  `a_deliberate_stop_reports_stopped_and_leaves_no_hot_wal`, fails while the
  desktop app is running, because the app holds `~/.studio/data/studio.db`
  and the WAL exists by definition. Close the app before you judge that
  number. It is not your change and it is not a flake; it is a test that
  reaches into the real data directory.
- `STUDIO HARNESS`: 1284 passed / 31 failed / 25 skipped across 6 files.
  **Every one of the 31 is the same environmental failure** —
  `SandboxError: The sandbox needs one-time setup ... run: pnpm
  sandbox:prepare "C:\Users\pooki"` — in the sandbox-shaped files
  (`tools/shell`, `mcp-launcher`, `mcp-runtime`, `sandbox-appcontainer`).
  The corridor's ACL grants on the home root were revoked and cannot be
  restored without an elevated terminal, which no session here can run. The
  count has grown across runs (23, then 29, then 31), so do not read a
  difference in that number as a regression of yours. Task 32 section 8
  names the suite's own release test as the likely cause. **Do not chase
  it.** Say what your runs reported and move on.

Run the full HARNESS suite more than once; Task 31's startup wedge is
episodic on a tens-of-minutes timescale and its boot log names it clearly.

## Report

Write `report/TASK-33-the-turn-you-can-finally-watch.md`.

Lead with **Part 1's decision**: what the state between admission and the
first token is called, why that is a report of a fact rather than a guess,
and what clears it. Then Part 2 in a paragraph. Then **Part 3's decision**:
where the first submission happens and what the alternative would have cost.
Then Part 4 in two lines. Then Part 5 in plain words — what a person watching
the window actually saw, on each source, against the four numbered claims
above, saying plainly which ones you did not see.

Finish with every place this brief was wrong. It has been the most useful
section of the last ten reports, and the last three briefs were each
confidently wrong about their own strongest suspect. This one asserts that
the receipt is enough to say a turn is running. If that turns out to be
false — if the harness can admit a turn it never runs — that is the finding,
and it outranks everything else in the task.
