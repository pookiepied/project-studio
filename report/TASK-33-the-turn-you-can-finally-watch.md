# TASK 33 — The turn you can finally watch

**Date:** 2026-08-26
**Scope:** Four things, in the brief's own order. A new conversation phase,
`submitted`, for the window between a turn's admission and its first token,
and the composer, the working mark and the stop control all reading it. The
ending line suppressed on the one message that has not reached its ending
yet. Home and a project page sending their first message to the harness
instead of to a local demo turn, with the receipt carried across the
navigation. And the two-line `STUDIO HARNESS` typecheck debt, closed at the
test.
**Status:** Complete. Ten files changed, three added, five new test files;
`STUDIO` is 20 files / 239 tests green and typecheck clean, `STUDIO HARNESS`
typecheck is green for the first time since Task 31. Verified on the desktop
against the test source and against one real OpenRouter turn; what was seen
and what was not is in section 5.

---

## 1. Part 1 — the state between admission and the first token

**It is called `submitted`, and it carries the receipt's own submission id.**

```ts
| { readonly status: 'submitted'; readonly submissionId: string }
```

**Why it is a report and not a guess, in one sentence:** the harness answered
the POST with a submission id and the offset that submission's events begin
at, so "a turn is running" is a restatement of what the harness said, not an
inference from how long we have been waiting. Nothing in this state is
derived from a clock, and nothing counts up on screen — the difference
between this and the invented progress indicator Task 29 and Task 32 both
refused is that an invented indicator asserts progress nobody reported, while
this asserts admission, which was reported in writing.

**Why it is its own state rather than a `streaming` that has produced
nothing.** The union's docblock says combinations booleans allow are not
states a conversation has, and folding these two together would create
exactly such a boolean: every consumer would have to ask "streaming, but has
anything actually arrived?" to decide between the working mark and the caret.
They are different facts and they render differently. A turn exists — the
words are gone, something is happening, here is how to stop it — drives the
composer's busy state and the mark's ripple. A turn is producing drives the
caret and the paced reveal, and only that. `isTurnRunning(phase)` is the one
place the first question is answered; `phase.status === 'streaming'` remains
the answer to the second, and `LiveTranscript` now names both
(`turnRunning` and `generating`) instead of using one word for two things.

**What clears it.** Only facts from the harness:

- a `message-started` or `message-delta` on the read moves it to `streaming`,
  carrying the receipt's submission id forward when the chunk itself does not
  name one;
- a `submission-settled` moves it to `idle` or `run-failed`, which is what an
  abort pressed in the quiet window looks like;
- a lifecycle `harness-stopped` / `harness-failed` moves it to `interrupted`;
- the read settling `broken` or `refused` moves it to `interrupted`;
- Task 32's liveness watchdog moves it to `interrupted` when the read has
  delivered nothing at all — chunk, frame or keep-alive — for a whole budget.

**What may never clear it.** Any local timer that means "we have waited long
enough". The watchdog is not one of those and the distinction matters: it
fires on a fact about the READ (three missed heartbeats, when Rust sends one
every 15 s), never on a fact about the model's pace. A turn that is genuinely
slow keeps its read alive and keeps its `submitted` for as long as it takes.

**What a person sees if the harness admits a turn and then says nothing
forever.** The composer stays busy, the mark keeps rippling, and the stop
control stays offered — indefinitely, with no timeout. That is honest,
because it is exactly true: the harness has this submission and has said
nothing more about it. The person is not stuck, because stop works, and the
one thing that would be dishonest — deciding on our own that the turn is over
and quietly releasing the composer — is the silent stop wearing a spinner,
which is what Task 32 spent itself removing. The only automatic exit is the
watchdog, and it fires on the read being dead rather than on the turn being
slow.

**The handoff from the composer's own lock.** `Composer` holds `sending` from
send to receipt and computes `busy` as `(busyOverride ?? false) || sending`,
so the two locks overlap rather than abut: `submit()` calls
`setPhase({ status: 'submitted', ... })` *before* it returns the receipt, so
by the time the composer's `.then` runs `setSending(false)`, the page-supplied
`busy` is already true in the same flush. There is no frame in which neither
is true. `up-to-date` was the other way a gap could open — it arrives on the
very read a submission just opened and used to overwrite anything that was
not `streaming` with `live` — so it now yields to any running turn.

Every behaviour has a test that fails without it
(`src/features/chat/submitted-turn.test.tsx`), including the negative one the
brief named: a submission that is admitted and whose read then delivers
nothing for a whole budget lands in `interrupted`, not in a composer that is
busy forever.

## 2. Part 2 — a message being written no longer says it was stopped

The projection's default is untouched and stays right: `message-started`
opens a message with `end: { state: 'stopped' }`, because how a message ended
comes from the log and never from silence, and a message with no completion
fact really has not completed. What was wrong was rendering the *conclusion*
about an ending the message has not reached — so from `message-started` until
`message-completed` every live reply carried a stop icon and "Stopped before
finishing" under the text it was still writing. `AssistantTurn` now renders
`EndLine` unless `live && item.end.state === 'stopped'`. `stopped` is named
in the condition rather than left implied by the parent, so no reading of
"live" can ever swallow a `failed` or an `aborted` ending, which are facts the
settlement carried. **The definition of `live` I am relying on is the narrow
one**: `LiveTranscript` computes it from `generating` (`phase.status ===
'streaming'`), not from `isTurnRunning`. A turn that has been admitted is not
writing this message, and widening it would have made a previous turn's
crashed last message lose its stop label for the second or two before the new
turn's own replay puts the user's words on the page. Both directions are
tested — `AssistantTurn.test.tsx` pins that an unfinished message reads as
stopped the moment no turn is running and that failed and aborted are never
suppressed, and `LiveTranscript.test.tsx` pins the older-message case, which
fails if `generating` is widened to `turnRunning`.

## 3. Part 3 — where the first submission happens

**On the page the words were typed on, before anything navigates.**

`startConversation()` (`src/features/chat/first-turn.ts`) mints the
conversation id, asks the supervisor for a client for it, POSTs the message,
and only on a receipt does anything else happen: the receipt is stashed for
the view that is about to mount (`first-attach.ts`), the workspace store
records a conversation with that id and a title derived from the message and
no messages of its own, and the chat page opens. A refused send creates
nothing at all — no id in use, no row in the sidebar, no navigation — and the
refusal renders above the composer through `SendRefusal`, which
`ConnectionNotice` now exports for exactly this.

**What the alternative would have cost.** Navigating first and submitting on
mount needs three things this shape does not: a holder to carry the text
across the transition, a mount-time submit hardened against StrictMode's
double invoke and against any later remount, and — the part that decided it —
an answer to "where do the words go when the harness refuses?", because the
field they were typed into no longer exists by the time the answer comes
back. Task 32's rule is that a refused POST leaves the words exactly where
they were; the only way to keep that rule without inventing a new place to
put them is to still be on the page that has them.

**What this shape costs instead**, both cheap: a client for an id that exists
nowhere yet (ids are caller-chosen, ADR 0045), and carrying the receipt
across the navigation. The receipt is worth carrying twice over — its offset
means the conversation view opens its read exactly where the turn begins
rather than asking history about a stream that is milliseconds old, which is
the 404 race Task 32 removed from `submit()`; and its submission id is what
lets the view open in `submitted`, so a conversation's FIRST turn is as
watchable as its second. The handoff is not consumed on read: attaching from
a first turn's offset is idempotent (there is no history before it to miss),
StrictMode mounts the view twice, and what retires the entry is a read
reaching `up-to-date` — the moment a reader has caught up is the moment the
handoff has done its job.

**The gallery is untouched.** `ChatPage` still withholds `onSend`, `busy` and
`onStop` for `GALLERY_CONVERSATION_ID`, `useGalleryTurn` stays, and the
seeded `DEMO_CONVERSATIONS` were not in the way and were not touched.

## 4. Part 4 — the typecheck debt

Narrowed at the test with `instanceof LocalModelProviderAdapter`, not declared
on the interface. Refusing an unroutable turn with directions is how the local
BYOK adapter behaves, not part of what a provider adapter *is* — and putting
`assertTargetResolvable(): Model<Api>` on `ModelProviderAdapter` would drag a
Pi type into `contracts/models.ts`, whose whole point is to describe adapters
without naming a gateway. `pnpm typecheck` in `STUDIO HARNESS` is green.

## 5. Part 5 — what a person watching the window saw

The instrument was a scratch script driving the running desktop app over the
WebView2 CDP endpoint, sampling the visible state every 250 ms: which control
the composer offers, whether "Stopped before finishing" is anywhere on the
page, whether the working mark is drawn, how much reply text is rendered, and
whether the field still holds the words. It is not part of either repository
and it was deleted after use. Getting the test source onto the desktop needed
one temporary edit, disclosed in section 7.

**The test source, first send from home, `[slow][pace]`** (the `[slow]`
directive holds the provider silent for ten seconds before its first token,
which is the window this task exists for). Times are from the click:

```
     8 ms  Stop offered   no stop label   mark    no text   field holds 65 chars
   265 ms  Stop offered   no stop label   mark    no text   field cleared
 10062 ms  Stop offered   no stop label   mark    no text
 11120 ms  Stop offered   no stop label           "Echo: Ple"
 12447 ms  Stop offered   no stop label           "...one ful"
 13769 ms  Stop offered   no stop label           "...sentence about"
 14831 ms  at rest        no stop label           the full sentence
```

**The real provider, one short OpenRouter turn, first send from home:**

```
     9 ms  Stop offered   no stop label   mark    no text   field holds 38 chars
   529 ms  Stop offered   no stop label   mark    no text   field cleared
 11105 ms  Stop offered   no stop label   mark    no text
 12165 ms  Stop offered   no stop label           43 chars
 13223 ms  Stop offered   no stop label           137 chars
 13740 ms  Stop offered   no stop label           255 chars
 14800 ms  at rest        no stop label           426 chars, "Thought" above it
```

Against the four numbered claims, plainly:

1. **The page says a turn is running from the moment the words leave the
   field.** Seen, on both sources. The composer is a stop button at 8-9 ms
   and stays one continuously across the navigation and through the whole
   quiet window — ten and a half seconds of it on the real provider, which is
   the six-second gap the brief measured, only longer. The working mark is on
   screen for that whole window and hands off to the caret when text starts.
2. **The stop control is offered for that whole time, and pressing it
   aborts.** Seen, on the test source. A third turn was sent and Stop pressed
   at 2646 ms, inside the ten-second quiet window before the model had
   produced anything: by 2911 ms the control was at rest and the transcript
   read "This turn was aborted / Submission was aborted." I did **not** press
   stop on the real provider — one turn, as the brief instructs.
3. **Nothing under the growing reply claims it stopped.** Seen, on both
   sources: the sampler looked for "Stopped before finishing" on every frame
   of both runs and never found it, and the finished replies carry no ending
   line at all.
4. **A conversation started from home reaches the harness on its first
   message, and its first reply is the model's.** Seen, on both sources. On
   the real provider the sidebar gained "In two sentences, why is the sky
   blue?" and the page rendered a "Thought" block above a real answer about
   Rayleigh scattering. Nothing was echoed by a demo runner, and no empty
   transcript appeared.

Two things I saw that are worth saying because they are not clean wins:

- **The first run found a real gap and the second run is the fixed one.** In
  the first test-source run the control disappeared between 265 ms and
  544 ms: the home composer had released its own lock and navigated, and the
  conversation view was sitting in `attaching` while its `contact()` invoke
  resolved. That is the stop control blinking out and back that Part 1 says
  is worse than one arriving late, and it existed only on the first turn.
  The fix is that the view now opens in `submitted` on its FIRST render from
  the receipt it already holds, without waiting for the supervisor to repeat
  it. The re-run above shows the gap gone, and there is a test that asserts
  the phase synchronously, before contact resolves.
- **The composer goes to rest a moment before the last words appear.** On the
  real run the settlement landed at 14004 ms while `useSmoothText` was still
  revealing the tail, so for about 800 ms the reply was still growing with no
  stop control. That is honest — the turn really had settled — and it is the
  reveal pacing, not the phase.

On the reveal itself: after Parts 1 and 2, the real turn read as several
visible steps rather than one block (43, 73, 137, 203, 255, 323, 379, 426
characters across 2.6 s), which is better than Task 32's real run managed and
is simply what a longer generation looks like through the 1 s coalescing
window. I have no finding to add against the brief's "blocky" paragraph.

The API key never appeared in a log, an error, a fixture, a screenshot, a
test or this report. One real turn was spent; it was not repeated.

## 6. Verification

Each suite alone, sequentially, with the desktop app closed.

```
STUDIO:           pnpm test      -> 20 files / 239 tests passed (baseline 15 / 218)
                  pnpm typecheck -> clean
STUDIO/src-tauri: cargo test     -> 65 passed / 0 failed
                  cargo clippy --all-targets -> 0 warnings
STUDIO HARNESS:   pnpm typecheck -> clean (baseline: two errors)
                  run 1 -> 1285 passed / 30 failed / 25 skipped (5 files)
                  run 2 -> 29 failed, same files (totals not captured)
                  run 3 -> 1286 passed / 29 failed / 25 skipped (4 files)
```

The 21 new `STUDIO` tests are five files: `submitted-turn.test.tsx` (the
phase and the handoff), `first-turn.test.ts` (the live first send),
`AssistantTurn.test.tsx` and `LiveTranscript.test.tsx` (the ending line and
the working mark), and `HomePage.test.tsx` (that home no longer reaches the
demo turn runner). Every one of them was checked against broken code per
rules.md section 8 — the `submitted` setPhase removed (four fail), the
`up-to-date` guard narrowed back to `streaming` (one fails), the mount
handoff removed (two fail), `forgetFirstAdmission` removed (one fails),
`rememberFirstAdmission` removed (one fails), the `EndLine` guard forced
false (one fails), `turnRunning` narrowed back to `streaming` (one fails),
`generating` widened to `turnRunning` (one fails), and home's `onSend`
swapped back for `onSent` (two fail).

`cargo test` is 65/65 because the app was closed: the run that includes
`a_deliberate_stop_reports_stopped_and_leaves_no_hot_wal` needs the real
`~/.studio/data/studio.db` unheld, exactly as the brief says.

**The HARNESS failures are the environmental sandbox family and nothing
else**, in both runs: `sandbox-appcontainer`, `mcp-launcher`, `mcp-runtime`
and `tools/shell`, every one of them the same
`SandboxError: The sandbox needs one-time setup ... run: pnpm sandbox:prepare
"C:\Users\pooki"`. The count moved 30, 29, 29 against a 31 baseline, which is
the drift the brief warns not to read as a regression. Not chased. Every
model, provider, conversation, streaming and turn test passes, including
`model-providers.test.ts`, which is the file Part 4 touched.

## 7. Where this brief was wrong

1. **The brief's central assertion held: the receipt is enough to say a turn
   is running.** This was the thing the brief said would outrank everything
   else if it turned out false, so it is worth stating plainly that it did
   not. Across three admitted turns on the test source and one on the real
   provider, every admission was followed by a running turn — the harness
   never admitted one it did not run, and the ten-second `[slow]` window is
   precisely a harness that has taken a turn and produced nothing, which is
   the state `submitted` was built to name.
2. **The brief did not know the first turn needs the receipt's submission id,
   not only its offset.** Part 1 is written as though the fix lives entirely
   in `submit()`, but a conversation started from home never calls `submit()`
   — the send happened on another page and the view mounts afterwards. Carry
   only the offset and the first turn of every conversation is exactly as
   unwatchable as before: it opens in `attaching` and stays there until
   `message-started`. The handoff carries both halves of the receipt for that
   reason, and the view sets `submitted` from it on its first render.
3. **"The composer's own in-flight lock hands off from `sending`" was only
   half the handoff.** The brief's framing is right for a send on the
   conversation page and does not cover the first send at all, where the lock
   has to hand off across a NAVIGATION, from one component to another that
   does not exist yet. That is where the measured 280 ms gap was, and it was
   invisible to the `submit()`-shaped analysis. It took a desktop run to see
   it (section 5).
4. **Part 2's seam needed one more word than the brief gave it.** `live` was
   the right seam, but suppressing `EndLine` on `live` alone quietly makes a
   promise it cannot keep on its own: it only never hides a failure because
   the PARENT happens to compute `live` from `isMessageBeingWritten`, which
   requires `stopped`. The guard names `stopped` itself, so the component is
   correct in isolation rather than correct by a caller's habit.
5. **"Both shapes are real" understated how much the failed-first-send
   question decides.** The brief presents "where does the first submission
   happen" as a balanced choice with the refusal question as a follow-up. It
   is not balanced: once you accept Task 32's rule that a refusal leaves the
   words in the field, submitting after navigation has no field to leave them
   in, and every repair for that (a holder, a restored draft, a new notice
   surface on the conversation page) is machinery invented to undo the
   navigation you just did. The question answers itself.
6. **The gallery needed no defending and `useDemoTurn` has no callers left.**
   The brief asks for this as a finding, so: `Composer` has exactly three
   call sites, and after this task only `ChatPage`'s gallery branch omits
   `onSend`. The workspace store's `run` picks `demo.run` only for a
   non-gallery id, and `send`, `retry`, `editMessage` and `fork` are now
   reachable only through the gallery's `Transcript`. So `useDemoTurn` is
   unreachable from the shipped UI. Reported, not deleted — `useGalleryTurn`
   imports its `TurnRun` type, and whether the demo runner should go or
   become the gallery's own is a decision, not a hunch.
7. **`Composer`'s `onSent` prop is now dead.** No caller passes it; it is
   only read in the demo branch of `submit()`, which only the gallery reaches
   and which passes a non-null `conversationId`, so the branch that would
   call it cannot run. Left in place with the rest of the demo path rather
   than removed piecemeal.
8. **An early send while the harness is still starting says the wrong
   sentence on home.** `startConversation` refuses `starting` and `absent`
   alike with a `no-harness` failure, and `refusalCopy` renders "there is no
   harness running to receive it. Start the harness from the status bar" for
   both. On a starting harness that instruction is wrong. Matching the
   shipped conversation page (which produces the same sentence in the same
   situation) was the reason not to widen the platform's failure union for
   it here, but it is a real rough edge and the brief did not anticipate it.
9. **A reattach briefly resurrects the stop label on a growing message.**
   Pressing Reattach after an interruption puts the phase in `attaching`, so
   `generating` is false and the unfinished message shows its ending line
   until the replay's first delta arrives. I left it: while reattaching we
   genuinely do not know whether a turn is running, and claiming one would be
   inventing exactly what this task refused to invent. The brief's
   adversarial list asked that a replayed batch "must not resurrect a stop
   label", and for the submission-driven reattach — the one that matters,
   because it is the one that happens without the person doing anything — it
   does not, because that attach is `announce: false` and keeps its phase.
10. **An abort says so three times.** After the aborted turn the page carried
    "This turn was aborted", "Submission was aborted." twice more, and "The
    turn was aborted before it finished." from the connection notice. Every
    one is a correct rendering of a different record; together they are
    repetitive. Not this task's to change, and named here because the user's
    "stopping feels half-implemented" (Task 32, section 5.8) may be partly
    this.
11. **One temporary edit to Rust, disclosed.** The desktop hard-codes
    `PROJECT_STUDIO_MODEL_SOURCE=local` at the harness spawn site, so the
    only way to verify on the test source "as a person" is to flip that one
    string, run, and flip it back. I did, twice — `local` to `test` before
    the deterministic runs and back before the real one — and
    `git status STUDIO/src-tauri` is clean, so the Rust tree is byte-identical
    to `83155af`. Nothing else in the repository was edited by a script; every
    edit in this task, including this report's headings, was made by hand.
12. **Task 31's startup wedge cost one launch.** The first launch's harness
    published no readiness within 30 s with nothing on stdout or stderr, and
    the eager start failed; a `restart_harness` brought it up immediately.
    The boot log named it exactly as built to. Not chased.
