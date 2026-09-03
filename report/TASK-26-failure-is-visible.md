# TASK 26 — Failure is visible

**Date:** 2026-08-25
**Scope:** `STUDIO/src/` only (TypeScript). No Rust touched; no harness source
touched -- its `[fail]` provider seam from Task 25's follow-ups is what made
the whole thing reproducible. Nothing committed; the working tree holds the
changes.
**Status:** Complete. STUDIO 12 files / 190 tests pass, typecheck clean;
`cargo test` 64 passed, clippy 0 warnings; STUDIO HARNESS 84 files / 1276
tests (+25 pre-existing environment skips) -- see "Verification" for the
baselines this beats.

---

## 1. What a failed turn looks like now

End to end, for `[fail] please answer.` against a real harness with
`PROJECT_STUDIO_MODEL_SOURCE=test`:

**Before:** four empty assistant bubbles, every one marked complete, nothing
else. The person sees a reply that says nothing and ended fine.

**Now:**

1. The person sends the message. The POST is admitted; the transcript shows
   the user bubble and the usual working ripple while Flue burns its three
   transient retries (~14s of silence, unchanged -- that budget is a separate,
   documented decision).
2. Four `message-started`/`message-completed` pairs arrive, one per attempt,
   each closing cleanly with zero usage. None of them renders as anything:
   an attempt that never spoke produces no item at any point during the
   stream, because items appear on `message-started` but the settlement
   collapses contentless ones retroactively (see the rule below).
3. The settlement arrives carrying
   `{"name":"FlueError","type":"operation_failed","message":"direct(...)
   failed: 429 rate limit exceeded: temporarily rate-limited upstream"}`.
4. The transcript now holds exactly two items: the user's message, then one
   failure line -- "This turn failed", and beneath it the provider's own
   sentence in muted type. No empty bubbles exist to misread.
5. The connection notice above the composer also says so: "The turn failed
   while it was running." plus the same sentence as its detail line.
6. A cold start -- closing the window, reopening -- seeds from history and
   renders **the identical two items**, because the seed path applies the
   same rule through the same function.

A genuinely completed tool turn pinned in `wire-contract.test.ts` still reads
completed after all of this. A late failure never rewrites finished work.

## 2. Part B -- the rule, and the argument

> On a failed or aborted settlement: open messages of that submission take
> the outcome (with the settlement's sentence beside them); messages that
> closed **without ever producing content** are withdrawn; messages that
> closed with content keep their completion; and if withdrawal leaves
> nothing of the submission standing, one `submission-failed` item takes the
> attempts' place, carrying the sentence.

The insight from the docs is kept verbatim: `message-completed` means "this
attempt's record is closed", not "this turn succeeded". The rule exists
because those four closed-empty records were being *displayed* as four
finished replies. Options considered:

- **Mark everything of the submission failed** -- rejected without hesitation;
  it falsifies real work and regresses the tool-turn pin directly.
- **Keep the empties but label each one failed** -- rejected on rendering
  grounds: four identical failure stickers is noise, and it still asserts
  that four things happened worth showing separately. They did not; they were
  one refusal, retried.

**Why withdrawal is not the forbidden emptiness heuristic.** The ban targets
guessing about *content* ("looks empty") or *counts* ("three starts means
retries"). What the projection tests is wire fact, not appearance: did any
delta or tool input ever name this message id. And the test only ever fires
under a failed/aborted settlement. A legitimately silent model under a
COMPLETED settlement touches nothing -- there is a test pinning exactly that
case (`leaves a legitimately silent model alone when the turn actually
completed`). Under a failed one, a silent record carries no information the
failure card lacks; collapsing is not truncating, and the log keeps what the
display drops.

**Content means deltas or tool inputs -- not text.** An attempt that issued a
tool call and completed stays, complete. Tested explicitly.

**The history path forced one more decision.** Real snapshots carry NO
`submissionId` on assistant messages -- not on these attempts, not on
successful turns either (captured; the SDK type calls it optional). So
matching settlements by message id, which Task 25's seed loop did, matched
*nothing* on a cold start; the old code was doubly dead. History offers
exactly one honest association: position. In a linear append-only log, the
assistant messages between THIS settlement's user message and the next user
message are its attempts -- nothing else they could be. The seed path uses
that, plus direct id matching when a snapshot does carry ids (some callers'
snapshots may), and both feed the same `settleSubmissionFailure` function the
live path uses. One rule, two readers, pinned from real bytes on both sides.

## 3. Part A -- the reason survives parsing

`conversation-chunks.ts` gained a hand-written mirror of the settlement error
(`SettlementErrorFacts`: `present`, `name`, `type`, `message`) and three flat
fields on `ChunkFacts` (`errorName` / `errorType` / `errorMessage`), filled by
the `submission-settled` case. House rules held:

- No schema library; fresh objects built field by field.
- Fields the wire omits read `null`. An error object that is present but
  unreadable parses as present with null fields -- "a reason existed and is
  unknown", never a synthesized cause. An empty-string message reads null;
  an empty string is no more a reason than an absent object.
- `SettlementFacts.error` (history) moved from uninterpreted `Present<unknown>`
  to the same parsed shape, so cold starts get the sentence without a second
  interpretation layer.

Observed on the wire and not mirrored: `details: ""`. It was empty in every
capture; it stays unmirrored until something needs it. Noted here so the gap
is deliberate rather than accidental.

## 4. Part C -- a refused send changes something on screen

Three pieces:

1. **Somewhere to land.** `useConversation` exposes `refused: SeamFailure |
   null` plus `dismissRefusal()`. Deliberately *not* a new phase: a send can
   be refused while an earlier turn still streams, and inventing a phase for
   that combination would break the state machine's one-status-at-a-time
   honesty. It clears on dismissal, on conversation switch, and when a later
   send gets through. One exception, argued in code: while the phase machine
   is already saying `no-harness` permanently, the refusal is not stacked --
   the same diagnosis twice teaches people to stop reading notices.
2. **Words that name the remedy.** `ConnectionNotice` renders the refusal
   with per-cause copy: refused names the harness's own sentence and status;
   unreachable gets the careful one -- the message *may or may not have
   arrived*, check the transcript before resending (an identical resend is a
   second turn; Flue deduplicates nothing); no-harness points at the status
   bar. A missing provider and a dead harness produce different sentences
   because they have different fixes.
3. **The text is never lost.** This was not fixed where the brief pointed.
   ChatPage discarding the result was half the story; the other half was the
   Composer clearing optimistically *before any result existed*. `onSend`
   now returns a receipt (`Promise<{ok}>`); the field clears only when `ok`
   says the harness took the words. Words typed during the round trip belong
   to the sender again if the receipt disagrees with the field. The composer
   is busy from send to receipt, which also closes a small hole where a
   double-click could POST twice -- i.e. manufacture a second turn.

## 5. Adversarial cases (all tested, all listed in the brief)

| Case | Test |
|---|---|
| Failure after real content streamed | `projection.test.ts`: keeps content, marks the record failed with the reason beside it, no card |
| Failed settlement whose earlier messages genuinely completed | same file: worker message keeps `complete`; silent retries vanish |
| Settlement with `outcome: failed` and no error object | card renders, `reason: null`, copy says no reason arrived; phase `detail` null |
| Submission refused while an earlier turn streams | `useConversation.test.tsx`: phase stays `streaming`, refusal lands beside it |
| Redelivered batch containing the failed settlement | identity preserved (`toBe`), applies once |

Plus the captured-wire pins in `wire-contract.test.ts`: the full updates-view
turn AND the history snapshot of the same failed conversation, both verbatim
from a live harness, both rendering as user + one visible failure.

## 6. Where this brief was wrong

The brief asserted its diagnosis confidently, as it said it might. Checking
paid off four times:

1. **The wire error shape was slightly off.** The brief showed
   `{name, type, message}`; the real payload is
   `{"name":"FlueError","message":"...","type":"operation_failed",
   "details":""}` -- key order aside, it also carries `details`. Minor, but
   the parser had to be written against what arrives, not what was quoted.
2. **The bigger miss: fixing `readChunkFacts` cannot fix cold starts, and the
   brief's framing implied parser + open-message rule would do.** History
   snapshots carry no `submissionId` on assistant messages at all, so even
   the pre-existing seed-side settlement marking (Task 25's re-verification
   fix) silently matched nothing -- every failed turn rendered as complete
   empty bubbles forever after a restart regardless of the live-path fix.
   The positional association in section 2 was not an optimization; it was
   the only way cold starts could work, and nothing in the brief or the
   architecture docs recorded that assistant snapshots lack the id.
3. **"ChatPage discards the result" understated the text-loss mechanism.**
   Even with the result landed somewhere renderable, the typed words were
   already gone: Composer cleared the field synchronously, before the
   outcome existed. The fix required changing the send contract itself to a
   receipt, which ChatPage's discard was merely hiding.
4. **A nit on the repro description.** "Four empty assistant messages, every
   one marked `complete`" is exactly right live, and the two named causes
   are real -- but there was a third consequence the brief did not spell
   out: because every attempt completes before the settlement lands, the
   failed-settlement rule could not be blamed for touching none of them. Any
   rule keyed only on still-open records was structurally incapable of
   showing this failure; withdrawal (or equivalent) was mandatory, not a
   stylistic extra.

One more observation worth keeping, though the brief was not wrong about it:
the SSE frames include `event: control` payloads (`streamNextOffset`,
`upToDate`) alongside `data` frames. Rust forwards them as opaque frames and
`useConversation` correctly ignores them. Nothing needed doing; recording it
so nobody rediscovers it under time pressure.

## 7. Files changed

**New:** `transcript/live/SubmissionFailed.tsx` (the failure line),
`composer/Composer.test.tsx` (receipt mechanics).

**Parser/mirror:** `platform/harness/conversation-chunks.ts` (Part A),
re-exported via `contracts.ts` / `index.ts`.

**Projection:** `transcript/projection.ts` -- `MessageEnd.failed`/`aborted`
now carry `reason`; user items carry `submissionId` (needed as the adjacency
anchor); `settleSubmissionFailure` replaces `markSubmissionEnded`;
`submission-failed` joins `TranscriptItem`.

**Connection/UI:** `useConversation.ts` (`refused`, `dismissRefusal`,
run-failed `detail`), `useConversationTranscript.ts`, `ChatPage.tsx`,
`ConnectionNotice.tsx`, `AssistantTurn.tsx` (reason under the end line),
`LiveTranscript.tsx`, `Composer.tsx` (receipt-gated clear, in-flight busy).

**Tests:** `wire-contract.test.ts` (+2 real fixtures, +6 tests),
`projection.test.ts` (+9), `useConversation.test.tsx` (+6),
`contracts.test.ts` (+1), `conversation.test.ts` / shape updates.

## 8. Verification

Each suite run alone, sequentially:

```
STUDIO:               pnpm test      -> 12 files / 190 tests passed (baseline 11 / 166)
                      pnpm typecheck -> clean
STUDIO/src-tauri:     cargo test     -> 64 passed (baseline 64)
                      cargo clippy --all-targets -> 0 warnings
STUDIO HARNESS:       pnpm test      -> 84 files / 1276 passed, +25 environment skips (baseline equal)
```

Scratch probes (a temporary launcher script driving `launchHarness` +
raw SSE capture) were used to pin the fixtures and were deleted; nothing in
either repo references them.
