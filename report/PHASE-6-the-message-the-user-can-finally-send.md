# Phase 6 - the message the user can finally send

**Date:** 2026-09-03 (work done 2026-09-02 evening and 2026-09-03). **Where:**
`STUDIO/src/platform/harness/` and `STUDIO/src/features/chat/` (the phase's
first touch of the webview since the migration began), docblocks in
`STUDIO HARNESS/src/application/harness-client.ts` and
`STUDIO HARNESS/src/transport/http/middleware/turn-settings.ts`, docblocks in
`STUDIO/src-tauri/src/services/stream.rs`, and ADR 0033 reopened. Rust
behaviour unchanged; no git commands run, per the rules.

**The number that matters:** a person typed into the real app's composer,
pressed send, and the reply streamed in - "Hello, world is wonderful.
Wednesday." Then a long turn was interrupted mid-stream with the stop control,
settled visibly aborted, and the conversation continued. The wire no longer
refuses the webview.

---

## What was done

### Part 1 - the composer

`STUDIO/src/platform/harness/conversation.ts` `submitTurn` now sends the 2.0
envelope. The body for a text turn with settings:

```json
{
  "kind": "user",
  "body": "<the message>",
  "modelId": "<provider>/<model>",
  "reasoningLevel": "default",
  "permissionMode": "manual"
}
```

The settings keys stay at the top level beside the envelope, spelled exactly
as the harness contract names them - the turn-settings middleware reads that
same top-level object, so they did not move. Null `modelId` is omitted
(absent means the conversation's settled state stands); `permissionMode` is
omitted when unset.

**Images: `attachments` replaced `images`.** Measured in the 2.0.3 runtime
bundle (`DeliveredUserMessageSchema`): the user envelope is
`{ kind, body, attachments?: DeliveredAttachment[] }`, and valibot's object
schema STRIPS unknown keys, so the old `images` key would not be refused -
the images would vanish silently. The item shape is unchanged
(`{ type: 'image', data, mimeType, filename? }` matches `DeliveredAttachment`
field for field); only the body key moved. A text-only turn still sends no
key at all.

**The refusal, both shapes.** `parseHarnessErrorBody` in `contracts.ts` now
reads our flat shape (`{ error, code? }` - admission, provider routes,
turn-settings) and Flue's nested envelope
(`{ error: { type, message, details, ref? } }`), preferring `details` (the
sentence a person can act on) over `message` (the class sentence) because
"Request is malformed." names nothing. `ref` is a server-log correlation id
and is deliberately not carried to a person. The 400 that used to render as
"the harness answered 400 with no explanation" now renders:

> The harness refused this message (400): Delivered messages must be
> { kind: "user", body: string, attachments?: attachment[] } or ... Fix what
> it names, then send again.

Measured verbatim against a live harness: the old 1.0 body answers 400 with
exactly the envelope above; the 2.0 envelope answers **202** with
`submissionId` (`sub_...`), `streamUrl`, `offset`
(`0000000000000000_0000000000000000`), and `uid` (`inst_...`, new in 2.0,
ignored here).

### Part 2 - the stream, measured on a live 2.0 harness

All measurements in this section were taken by driving the real built
artifact (`dist/server.mjs`, the test model source, a scratch home) and
reading frames off the wire. The scripts were deleted after the run.

**The three control fields.** A live `live=sse` updates read answers:

- first data frame: `[{"type":"stream-checkpoint","incarnation":"inc_..."}]`
  - a NEW wire-only continuity chunk, no `position`, which the webview
  mirror already survives as an identity-only fact;
- content frames: `event: data` with a JSON array of chunks;
- control frames, verbatim:
  `{"streamNextOffset":"0000000000000000_0000000000000009","upToDate":true}`
- heartbeats: `: heartbeat` comment lines.

So, against the three names Rust was written for:

| Field | 1.0 contract | 2.0 measured |
|---|---|---|
| `streamNextOffset` | present | **present, always** |
| `upToDate` | present | **present, only when true** (absent otherwise) |
| `closed` | ended the stream | **never sent. Ever.** |

**`closed` is gone, and the stream never ends on its own.** The 2.0 SSE
writer loops - read, project, control frame, wait for wake - until the
reader disconnects; there is no close frame. A finished run is told to
clients by a `submission-settled` chunk, not by the stream ending. Nothing
breaks: Rust's parser simply never takes the `Closed` path, the webview
learns the outcome from the settlement chunk (the phase machine already
did), and the read stays attached after the turn settles, held open by
heartbeats until the webview cancels it (conversation switch, unmount) or
the harness stops. The Rust side changes NOT AT ALL in behaviour and only in
docblocks: `deliver()`, `StreamEvent::Ended` and `Outcome::Closed` now state
the measured contract and note that the `closed` handling stays because it
is the stream protocol the module implements and the tests pin its shape.
This is the phase's one honest surprise about the runtime contract, and it
is written where the next person will read it.

**Offsets stay opaque, confirmed.** The 2.0 offset is
`0000000000000000_0000000000000000` - two 16-digit zero-padded components
(`<readSeq>_<seq>`, first always zero per the runtime's `formatOffset`).
Grepped the whole surface: Rust carries strings end to end
(`stream.rs` never parses; `encode_query_component` passes digits and
underscores through unchanged), the webview holds the last reported string,
`first-attach.ts` carries the receipt's string in memory, no storage column
holds one. Nothing parses, slices, or assumes length. The Rust tests'
`5_1`-shaped fixtures remain valid protocol shapes.

**`wait()` semantics, written down** (docblock on `HarnessClient.wait` in
`harness-client.ts`), each line measured:

- **already settled:** resolves immediately with the reply read from history
  (measured 26ms);
- **still running:** resolves when the submission's `submission-settled`
  chunk arrives; the SDK follows the conversation from its stream origin, so
  the id is the only thing the caller needs;
- **settled failed or aborted:** THROWS (`FlueExecutionError`) - the failure
  is the wait's value, not a result shape;
- **unknown conversation:** rejects at once with 404 `stream_not_found`;
- **known conversation, unknown submission id:** NEVER RESOLVES. There is no
  "no such submission" answer; the read watches an up-to-date, quiet stream
  for a settlement that will not come (measured still waiting past 8s, no
  error). Every caller here passes a receipt-backed id, and the docblock
  says that is the only safe shape.

**The abort scope, written down** (docblocks on `abortRun` in
`conversation.ts` and on `HarnessClient.cancel`):

- abort while idle: `{"aborted": false}` (200).
- abort during a real in-flight turn (the test source's `[slow]` marker
  holding the model call open): `{"aborted": true}`, and the submission
  settles `outcome: "aborted"` with
  `error: { name: "FlueError", message: "Submission was aborted.",
  type: "submission_aborted", details: "The operation was stopped before it
  produced a completed response." }`.
- the "queued" half of 2.0's contract is, measured, a JOIN: a submission
  sent while a response is live coalesces into the host response (its
  settlement carries `answeredBySubmissionId` = the host's id), so in
  practice one conversation holds at most one running response. The contract
  is still conversation-wide, not per-submission - written on both abort
  docblocks, with the note that the webview's stop control addresses the
  whole conversation by design, which is now the actual semantics rather
  than an approximation of 1.0's.
- the aborted turn's history carries the empty assistant attempt (parts
  `[]`, `submissionId` set) and a `system` advisory - see Part 3.

**The dedup decision: declined, ADR 0033 reopened and reaffirmed.** Flue 2.0
ships the key upstream and the semantics were measured on a live harness:
the same key with the same payload converges on the original submission
(same receipt, `deduplicated: true`, offset reported as `-1`); the same key
with a different payload rejects 409 `submission_conflict` with
`meta.submissionId`. Declined because nothing in the tree resends a
submission automatically: a lost acknowledgement surfaces as `unreachable`
with the instruction to check the transcript before sending again, and the
durable transcript read IS the answer to the ambiguity (ADR 0045). Adoption
would put the key's lifecycle in the composer - minted per composed message,
invalidated on any content or settings change (a mismatch is a 409), retired
the moment a person deliberately resends after checking - which is a product
decision of its own, not a rider on the envelope reshape. The reopen
condition is named in both places: **any future path that resends
automatically** (a scheduled send, an outbox, a reconnecting admission queue)
must carry the key. Written in the reopened ADR 0033 status note and at
`AcceptedRun` in `harness-client.ts` (the comment there invited this
decision).

### Part 3 - what the transcript lost, and what actually broke

The brief's two channel facts were measured and confirmed, and then one step
further - because the loss the brief pointed at turned out to be invisible,
and the thing the same wire change breaks was not named:

- **No model identity on assistant messages.** 2.0 stamps nothing into
  message metadata ("Message metadata is entirely agent-authored... The
  runtime stamps nothing" - SDK types; confirmed on the wire: history
  assistant messages carry no `metadata`, no `timestamp`, no `usage`, no
  `model`). 1.0's `metadata.model` is gone entirely.
- **Errored assistant attempts are dropped from the projection.** A failed
  attempt leaves no assistant message; the settlement record and (for
  aborts) the `system` advisory are what remain.
- **What the UI actually showed from those channels: nothing.** Grepped the
  whole transcript: no component renders `item.model` (AssistantMessage
  renders `trailing={null}` "by design", named in its source), none renders
  `usage`, none renders the message `timestamp`. The projection still
  carries `model` in its item type, fed from two channels that both now
  answer null: history `metadata.model` (gone) and the `message-started`
  chunk's `model` field - which 2.0 does not carry either (verbatim chunk:
  `{"type":"message-started","conversationId":...,"messageId":...,
  "submissionId":...,"turnId":...,"timestamp":...,"position":...}`). Same
  for `message-completed` (no `usage`). So the honest answer to "what did
  the transcript lose" is: nothing a person can see, and nothing needed
  re-sourcing this phase. If model identity or usage is ever to be shown
  again, the candidates stand as the brief named them - the settled settings
  row and the telemetry events - and that is Phase 7's event work, now with
  the wire shapes it needs measured (this report quotes them).
- **What actually broke: the system advisory.** An aborted turn's history is
  `user, assistant (empty parts), system ("Submission was aborted.",
  purpose: advisory, display: diagnostic, settlement: {outcome: aborted},
  signal.attributes.submissionId)`. The webview's strict mirror accepted
  only `user | assistant`, so `readConversationMessage` returned null, so
  `readConversationSnapshot` returned null, so EVERY conversation that had
  ever been stopped failed its cold start with "The history snapshot did not
  match the contract this client mirrors." One stop-control press made a
  conversation permanently unreadable in the app. Reproduced against a live
  harness (the strict rule, run over the real snapshot body: rejected), then
  fixed: the mirror accepts `role: "system"` (MessageRole widened, the
  channel fact documented where the type is declared), the projection SKIPS
  system messages when seeding and when one arrives live on
  `message-appended` (they are diagnostics; the settlement is what renders,
  as the `submission-failed` card - measured: the aborted snapshot seeds to
  user + failure card, attempt withdrawn), and `fork.ts` excludes them from
  a fork's inherited words (they are not words anybody said). Also
  rewritten while there: the stale claim that snapshot assistant messages
  carry no `submissionId` (1.0-era observation; 2.0 stamps it, measured).

Two smaller mirror truths while the file was open, both measured:
2.0 emits new chunk types the mirror must tolerate - `message-metadata`,
`data-part`, and `stream-checkpoint` (no position) - and it already does
(unknown types survive as identity-only facts, position dedupe unharmed);
and 2.0's snapshot carries `incarnation` (unread here; the SDK's observe()
uses it for reset detection).

### Part 4 - the eleventh failure

Both required full runs on this tree landed exactly on the documented floor:

- **Run 1:** 1492 passed, 10 failed, 25 skipped (676s). The ten are the
  enumerated Phase 8 retry-regression tests, nothing else. `mcp-flue`
  passed: 2/2 in 32.6s.
- **Run 2:** 1492 passed, 10 failed, 25 skipped (656s). The same ten,
  verbatim the Phase 4/5 enumeration. `mcp-flue` passed again.

So: **zero failures above the floor in both runs**, and the eleven/twelfth
failures the brief recorded did not reproduce. Per-failure attribution for
the ten: all in `harness`, all pinning the patched-runtime behaviour
(visible per-retry signals, per-class budgets, the quota guard's fail-fast,
the resume-time attempt re-derivation) that returns when Phase 8 re-derives
the hunks. No deadline was raised; no test was touched.

What was measured while hunting the instability (the brief's question: what
accumulates across the 100 files):

- **Processes:** sampled every 10-15s across a full run. `node.exe` never
  exceeded 6 (vitest, its worker, and the one or two live harness children);
  `studio-contain.exe` appeared transiently, never more than one; worker
  memory flat at ~600-675MB; loopback TCP `TIME_WAIT` never above 20 during
  the run; CPU load 11-56%. Nothing accumulates monotonically anywhere I
  can measure on this machine.
- **mcp-flue timing:** alone 20.1s; inside the full run 32.6s; and 17.9s
  while `sandbox-appcontainer` (continuous AppContainer profile
  create/delete churn) ran CONCURRENTLY as a second vitest process. The
  profile churn that was one suspect does not stress it at all.
- **The EBUSY mechanism, stated precisely:** the debris is real but
  downstream, exactly as the brief said. `afterEach` stops the harness
  (graceful IPC shutdown, 5s bound, then SIGKILL) and then removes the temp
  directory. A test-spawned harness has NO job object around it - the
  production containment (job object, descendants die together) lives in
  the Rust supervisor, which tests do not use - so when the graceful stop
  exceeds its 5s bound on a busy machine, the SIGKILLed harness's
  descendants (the containment launcher, the contained MCP server child)
  survive it; a survivor holding an open file under the directory makes
  `rm` throw EBUSY, `afterEach` rejects, and the directory stays. That is
  the whole debris story: it requires the primary failure AND a slow
  graceful stop, which is why both always travel together. On passes, the
  graceful stop completes and nothing is left (verified: zero
  `studio-mcp-flue-*` directories in temp after this phase's runs; the 26
  the brief counted are gone from the machine).
- **The harness-startup failure** the second Phase 4/5 run produced (two
  silent attempts, no output) is the shape `startHarness`'s own
  silence-replacement machinery exists for, and it is pinned by
  mcp-flue's second test. Its cause is machine contention, not protocol -
  but on today's evidence I cannot name what contended: nothing I can
  sample accumulates.

**The verdict:** the honest finding is that the instability is NOT
reproducing on this machine since the C:/D: traverse grants were applied,
and nothing measurable accumulates across the suite. The one structural gap
the investigation did name is written down here rather than patched: the
test harness spawn lacks the job-object containment its production
supervisor has, so every SIGKILL fallback orphans descendants - which is
harmless on passes and is exactly the EBUSY debris on failures. Giving the
tests that containment is a real, small change (spawn with a job object as
the supervisor does); it belongs to the suite's own task list rather than
this phase, because no test is failing because of it today. If the
eleventh failure returns, the poll's own instrumentation (absorbed failed
fetches, the harness output dump) plus the sampler setup from this phase is
what will catch it.

### The exit - a person's exit, and it is not a test

The real app: `target/debug/studio.exe`, dev frontend (vite on 1420),
launched from `src-tauri` so the supervisor found the harness artifact.
Supervisor log: `harness ready pid=11196 127.0.0.1:60727` - eager start.
Then, in the window, by keyboard:

1. **Typed and sent:** "Say hello in exactly five words, then name the day
   of the week as you see it. No tools, no files - just answer." on the
   "Free Models Router" row (a zero-cost alias from the user's live catalog,
   Phase 4/5's practice), Manual mode. The send went through the new
   envelope from the composer's own client; the reply streamed into the
   transcript: **"Hello, world is wonderful. Wednesday."**, with a
   "Thought for 3s" block beside it.
2. **A long turn, stopped:** sent a request for a 1200-word lighthouse
   story. It streamed - thinking block first ("Thinking for 26s"), then
   paragraph after paragraph of the story. Pressed the send control, now a
   stop control, mid-stream. The turn ended with the failure the wire
   carried, rendered verbatim: "The turn was aborted before it finished. /
   Submission was aborted." The partial story stayed on the page, marked
   aborted; the composer came back.
3. **Resumed watching:** sent "Stopped you there - thanks. In one short
   sentence: what was the keeper's name?" and the reply arrived:
   "I didn't actually name the keeper in the story before you stopped me."
   Same conversation, same stream, three turns in.
4. **The cold start the stop control used to break:** navigated away to
   another conversation and back. The history read now carries the abort
   advisory (a `system` message - the exact body that failed the strict
   parser before Part 3's fix), and the conversation rendered complete:
   both turns, the thinking blocks, the full partial story, the follow-up.
   This is the Part 3 fix proven in the app, not in a test.

**What the stop actually stopped:** the conversation's whole durable work -
2.0's abort scope, in-flight included (measured `aborted: true` and the
`submission_aborted` settlement on the live harness; the app's settlement
card shows the same words the wire carried). The READ was never stopped:
the app stayed attached, the settlement arrived on it, and the next turn
ran without reattaching. Three real turns were spent total, one short
question, one long generation (stopped part-way), one one-sentence
follow-up. Never looped, never benchmarked; the credential never appears
in a log, an error, a fixture, a screenshot, a test, or this report.

The app was closed with the window's close control: supervisor log
`shutting down harness pid=11196` - graceful stop, window close to
harness exit, as designed.

## Verification

- `pnpm typecheck` (harness): clean. `tsc -b` (frontend): clean.
- Frontend suite: **47 files, 456 tests, all green** (includes the new
  refusal-envelope, attachments-body, and system-advisory tests).
- `pnpm test` (harness, builds first), run whole twice:
  - **Run 1: 1492 passed, 10 failed, 25 skipped.**
  - **Run 2: 1492 passed, 10 failed, 25 skipped.**
  - Both runs' ten failures are the enumerated Phase 8 retry-regression
    tests and nothing above the floor; per-failure attribution in Part 4.
- `cargo clippy --all-targets`: zero warnings. Rust suite: **65 passed,
  0 failed**. Rust changes are docblocks only (the measured contract where
  the old one was written from 1.0).
- Rules: no `any`, no non-const `as`, no non-null `!`; UTF-8, LF; edits by
  hand; the throwaway measurement scripts and debug log were deleted after
  the runs.

## Every place this brief was wrong

1. **"Three control fields" is the 1.0 contract, not 2.0's.** The brief
   asked to verify `streamNextOffset`, `upToDate` and `closed` against a
   live stream; 2.0 never sends `closed` at all, and its updates stream is
   endless by design. The brief's own instruction to read the wire rather
   than the type surface is what caught it.
2. **"Anything the transcript showed from those channels is showing nothing
   now" presumes the transcript showed something.** It showed nothing: no
   component renders model, usage, or message timestamp today. The real
   casualty of the same wire change was one the brief did not list: the
   system advisory an abort records, which made every stopped conversation
   unparseable on cold start. The brief's two channel facts are true; the
   harm was in the third thing the projection ADDS, not the two it lost.
3. **The suite numbers.** The brief reported 11 then 12 failures on
   consecutive runs; this tree, this machine, today: 10 and 10 - the floor
   twice, with mcp-flue passing inside both full runs. The instability was
   not reproducible, and the instrumentation (samplers, contention
   experiment) is recorded in Part 4 so the next sighting has a baseline.
4. **"Queued work" in 2.0's abort contract is, measured, a join.** A
   submission sent during a live response coalesces into the host response
   (`answeredBySubmissionId`) rather than waiting in a queue; the abort
   scope is conversation-wide, but the picture of a queue of submissions
   behind a running one is not what the harness does. Written into the
   abort docblocks.
5. **One omission the brief's verification list would not have caught:** a
   first submission's receipt in 2.0 carries `uid` (`inst_...`) beside the
   known fields. Nothing here consumes it; recorded in the wire table in
   Part 1 so nobody rediscovers it by surprise.

## State left on the user's machine, named

- One proof conversation in the real index: "Say hello in exactly five
  words, then name" (three turns, one aborted mid-story). It is the exit's
  own artifact and can be deleted in the UI like any conversation.
- The beta journal, the Phase 1 export, and everything else under
  `~/.studio/` are untouched.
- The temp-folder debris the brief named (26 `studio-mcp-flue-*`
  directories) is gone - zero remain after this phase's runs.
