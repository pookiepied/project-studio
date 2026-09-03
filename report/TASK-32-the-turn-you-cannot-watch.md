# TASK 32 — The turn you cannot watch

**Date:** 2026-08-26
**Scope:** A delivery fix in `useConversation.ts` and nothing else in the
production path: a submission now attaches its read at the admission
receipt's own offset, and an attached read that delivers nothing at all for
45 seconds is stopped and named `interrupted` instead of being trusted. A
`[pace]` directive in the test adapter so the seam can exercise live
streaming, plus four hook tests and one adapter test that fail without the
fix. The Rust tree is untouched; the working tree holds the diff.
**Status:** Complete. The deltas stopped at boundary 3 — the webview's
read — in two distinct shapes; the provider, the harness's projections and
Rust's forward loop were all measured clean. Both missing behaviours were
then verified returning on the desktop, on the test source and on one real
OpenRouter turn.

---

## 1. Part 0 — where the deltas stopped, with the timestamps

The instrument was a scratch script (`probe-stream.mjs`, run from outside
the repositories, deleted after use) that spawned the harness, admitted a
turn, and read `GET /agents/studio/probe32?view=updates&offset=-1&live=sse`
directly over HTTP, recording every frame's arrival relative to the
submit. Two runs, then the desktop itself instrumented on both sides.

**Run 1 — test source, `[pace]` turn** (admitted at +145 ms):

```
 +165ms  conversation-reset | message-appended | message-started
+1175ms  message-delta x4   ("Echo", ": pl", "ease", " ans")
+2395ms  message-delta x4
+3627ms  message-delta x4
+4181ms  message-delta x2 | message-completed | submission-settled
```

Deltas arrive across four seconds, in batches, while the turn runs.
**Boundary 2 is clean.**

**Run 2 — real source, one short OpenRouter turn** (`stealth/ox-alpha`,
admitted at +127 ms):

```
+1198ms  message-appended (the user's words)
+6118ms  message-started
+7128ms  message-delta(reasoning) x13 | message-delta(text) x18
+7165ms  message-completed | submission-settled
```

**Boundary 1 is clean**: the provider streamed reasoning and then text.
The generation itself lasted about one second, which is why the whole
answer landed in a single coalesced batch — a fact that matters later.

**The desktop, instrumented on both sides** (temporary log lines in
`service_stream`'s forward loop, temporary `console.info` in the webview's
delivery handler, both removed after the diagnosis; console captured over
CDP, Rust lines from the dev terminal). One session, two sends:

- **Send 1, from the home composer (06:31:41).** No POST ever left the
  page. The home composer is demo-wired: the message went to the workspace
  store's local demo turn, a conversation was created, and the chat page
  attached to a conversation the harness has never heard of — history
  answered 404, the delivery was `absent`, and no `service_stream` was
  ever invoked. Screenshots at +1 s, +4 s and +9 s: an empty transcript.
  The harness never ran a turn, because the harness never got a message.
- **Send 2, through the chat-page composer (06:44:34).** The whole chain
  worked. Rust's log shows the stream opening at 06:44:35 and forwarding
  frames promptly for the next 25 seconds — data frames at +4.5 s, +5.5 s,
  +6.7 s, then one roughly every second to +53.6 s. The webview's log
  matches: snapshot at +1308 ms, `up-to-date` at +1328 ms,
  `message-started` at +5804 ms, delta batches of 20-50 deltas every ~1 s,
  tool calls in between, settlement `completed` at +54.9 s. Text grew.
  **Boundaries 2 and 4 are clean under the desktop too.**
- **At 06:48:05.9, the break, caught live.** An attach's `openUpdates`
  invoke failed with `IPC custom protocol failed ... TypeError: Failed to
  fetch`; Tauri fell back to the postMessage interface; the webview then
  logged `Couldn't find callback id 2212867298` three times, and the page
  reloaded (vite reconnect at 06:48:06.2; no HMR line, no renderer crash
  in the Windows event log). Rust opened the new stream anyway (+11 ms, a
  231,890-byte first replay) and its frames were never delivered: the same
  `Couldn't find callback id 2212867298` warning then repeated every 15 s
  for the next 40+ minutes — the still-open stream's keep-alives arriving
  at a callback the webview no longer had. Rust cannot see this failure:
  the sends succeed. The reloaded page re-attached to a conversation whose
  harness history answered 404 and sat at `absent`, empty.

So the answer to Part 0 is **boundary 3, in two shapes**:

1. **The submit-time cold start.** After admission, `submit()` re-attached
   by re-reading history and opening updates after the snapshot. When that
   history read won its race and answered 404, the read settled `absent`,
   nothing re-attached, and the turn ran with no reader at all.
2. **The deaf-but-attached read.** A read whose webview side died —
   measured here as a lost channel callback at an unexplained page reload —
   keeps `attached()` true forever, because Rust's sends into the void
   succeed. `submit()` trusted it: `if (!client.attached()) attach()`. A
   turn submitted into that state runs entirely unwitnessed — no busy, no
   stop control, no text, no thought — and a later attach (navigation,
   reload, next launch) replays the finished turn from history, which is
   the observed "entire answer appears at once".

Run count: two HTTP probes, one instrumented desktop session (two sends),
and the two verification sessions of Part 3.

## 2. Part 1 — the fix, and why it is a delivery fix

Both changes are in `STUDIO/src/features/chat/useConversation.ts`. No UI
code changed, no state was inferred, and the offset discipline is not
merely preserved — the first change is made *of* it.

**A submission attaches from its receipt's offset.** The admission receipt
has always carried the offset to resume from (`SubmittedTurn.offset`:
"Reading from here yields this turn"), and `submit()` now uses it:
`attach({ from: sent.value.offset, announce: false })`, replacing whatever
read exists. The 404 race is unreachable because no history read happens
on submit — the receipt is the proof the stream exists. A deaf read is
replaced at the exact moment its turn starts. Any chunks an older read
already delivered are replayed by the new one and dropped by the position
discipline that `reduceChunks` and the projection already enforce, so a
redelivery is safe by construction. The attach is `announce: false`
because the turn's own replay arrives within milliseconds and drives the
phase from there; a stale `interrupted` or `run-failed` notice is cleared
by that same replay the moment it lands.

**A read that delivers nothing for 45 seconds is not trusted.**
`READ_LIVENESS_BUDGET_MS = 45_000` mirrors Rust's `READ_IDLE_TIMEOUT` one
layer up: Rust forwards a KeepAlive every 15 s while a read is healthy, so
a live read is heard from at least twice inside the budget, and a firing
timer means *no delivery of any kind* — chunk, frame, or keep-alive — for
three missed heartbeats. On expiry the read is cancelled by name through
the registry and the phase says `interrupted`, visibly, holding its
retained offset. This is the only place the deaf-read failure can be
named, because it is the only place it is observable. It never silently
reattaches; the next submission heals it through the receipt offset, and
`resume()` heals it by hand.

The instrumentation question: the temporary per-frame Rust log line and
the webview `console.info` lines were removed. The boot log stayed in
Task 31 because silence about a silent child was the defect; here the
durable instruments are the watchdog (which converts the silent state into
a visible one) and the tests (which pin the delivery contract), and a
per-frame log line at Info would have been 125 lines per tool turn of
noise nobody reads.

## 3. Part 2 — what came back on its own

All three, verified on the desktop, plus the ThinkingBlock question:

- **Text growing.** On the test source with `[pace]`, the answer grew in
  visible steps across ~2.5 s ("Echo: Reply with" at +1.5 s, the full
  sentence by +4 s; screenshots at 1 s intervals). On the real source the
  answer arrived in one visual step — the model generated for under a
  second, inside the harness's 1 s flush window, exactly as the Run 2
  probe predicted. That is honest: nothing was buffered by us.
- **`busy` and the stop control.** Visible in the paced test-source run
  (the composer's send mark becomes the stop square while the text is
  growing, and returns to rest after settlement). On the real turn the
  generation was shorter than my 3 s screenshot cadence; the control's
  condition is unchanged and its window is simply the generation's length.
- **The in-progress state.** The user's own words render in the transcript
  within a second or two of the receipt (the replay the new attach opens
  with), so a turn is visibly under way during the provider's quiet
  seconds instead of the screen lying empty.
- **ThinkingBlock.** Reasoning deltas reach it — the real turn rendered
  its "Thought" block above the answer. It is this same defect, not a
  separate one: reasoning travels the identical chunk path, and it was
  starving on the same delivery.

Every restored behaviour has a test that fails without it, verified by
temporarily reverting each half of the fix: the two receipt-offset tests
fail against the old `if (!client.attached()) attach()` submit, and the
watchdog test fails with the watchdog's fire action removed. The fourth
test (a read that keeps receiving keep-alives is never interrupted) is the
no-false-positive guard; it passes in both states by design. The harness's
`[pace]` test pins the seam: more than two deltas spanning ≥900 ms of wall
clock.

## 4. Part 3 — what a person saw

On the test source: you press send, your words appear in the transcript
within a second, the reply starts writing itself in visible steps while
the send button is a stop button, and it settles done about four seconds
later. On the real provider, one short turn: your words appear within a
couple of seconds, the screen is quiet for roughly ten while the provider
thinks, and then the answer arrives with its "Thought" block above it —
for this short answer the writing itself took the model under a second,
so it lands in one step, and nothing in our path held it. The turn you
cannot watch is watchable again.

The API key never appeared in any log, error, fixture, screenshot or
report. The scratch probes and the temporary instruments were removed; the
Rust tree is byte-identical to `e9898dd`.

## 5. The user's hands-on session, classified

The user then drove the fixed app personally and reported nine observations,
asking which are intended and which are broken. Each is classified here with
its code location; nothing was changed for them in this task.

1. **"Harness is starting" shows; the UI loads before the harness. Which
   ordering is correct - block, parallel, or queue the early send?**
   Intended as shipped, with the product question genuinely open. The
   webview mounts at once and the phase machine says `harness-starting`
   (Task 23's lifecycle); when the harness comes up, `harness-started`
   triggers the attach automatically. An early send today is refused with
   the words kept in the field - never queued, never silently lost. Queueing
   is a product decision that has not been made, and the refusal's own
   sentence is what currently stands in its place.
2. **The very first message never reached the provider.** Confirmed, and it
   is the report's own named finding (§8, first item): the home composer is
   demo-wired. The message went to the workspace store's local demo turn -
   the sidebar glyph the user saw was that demo runner's spinner - and no
   POST was ever made. The second message worked because it went through a
   conversation's composer, which is live. This is demo scaffolding slated
   for its own removal task, now with user evidence, and it is not the
   streaming defect this task fixed.
3. **The text field holds the words for a couple of seconds before
   clearing.** Intended: the field clears only when the admission receipt
   arrives, because a refused POST used to silently swallow the text (the
   composer's docblock carries that history). The stop mark shows during
   the round trip. The couple of seconds is the POST and admission latency.
4. **Thinking shows no duration ("thinking for six seconds").** A
   documented refusal in the live components: "No duration is carried per
   segment on the wire, so none is claimed" (`AssistantTurn.tsx`). The demo
   timed it locally. A small follow-up could record each thinking segment's
   first-delta arrival time in the projection - a measurement, not an
   inference of progress - and is named, not built here.
5. **"Stopped before finishing" renders while the answer is still growing.**
   A real defect, verified in code and in this report's own paced
   screenshot: `EndLine` renders for any message whose end state is not
   `complete`, and a message being written is `stopped` until
   `message-completed` arrives - so the end-state label shows mid-growth.
   The label is correct for genuinely interrupted messages and wrong while
   the message is the live-growing one; suppressing it there is a small fix
   that belongs to the live components, not to the delivery path this task
   changed.
6. **Streaming is block-by-block rather than smooth.** The smooth reveal is
   wired (`useSmoothText` measures arrival spacing and reveals per-frame);
   what the user saw is the harness's 1-second durable-write coalescing
   arriving in bursts, possibly compounded by frame throttling while the
   window was not foreground. The demo revealed per-character because the
   demo generated per-character locally. Tuning the reveal against burst
   cadence is a follow-up; nothing regressed.
7. **No copy, read-aloud, or model name under the reply; no actions on the
   user's bubble.** Not yet built: Task 25 shipped a deliberately minimal
   live surface, and the demo's `MessageActions` row and user-message
   actions were never ported to `AssistantTurn`/`LiveUserMessage`. Editing
   a sent message is documented as absent on purpose (an edit is a new
   submission with new semantics). A surface-completion task, named.
8. **Stopping feels half-implemented.** The abort itself works end to end
   (Flue's abort route; the settlement renders `Aborted` and open messages
   take the outcome). What "half" means concretely needs the user's
   specifics; named for follow-up rather than guessed at.
9. **Encoding verification, as asked.** All four files this task changed
   are UTF-8 without BOM, contain zero forbidden characters - no en dashes,
   curly quotes, ellipsis characters, emoji, or mojibake sequences - and
   the only non-ASCII anywhere in them is pre-existing em dashes in comment
   prose, which `rules.md` §10's exception allows. Repository-side line
   endings are LF; the CRLF seen on disk is this machine's `autocrlf`
   checkout convention and is normalized on commit. The report file is
   UTF-8, no BOM, LF.

The short answer to "intentional or broken": the delivery defect was real,
is fixed, and is what this report is about. The home-composer demo send is
scaffolding the user has now independently hit and should be removed next.
The "Stopped before finishing" mid-growth label is a small real defect in
the live components. Everything else - thinking duration, message actions,
reveal tuning, harness-ordering policy - is named surface that was never
built, not behaviour that broke.

## 6. Verification

Each suite alone, sequentially. The HARNESS suite ran twice, per the brief,
because Task 31's wedge is episodic.

```
STUDIO:           pnpm test      -> 15 files / 218 tests passed (baseline 214; +4)
                  pnpm typecheck -> clean
STUDIO/src-tauri: cargo test     -> 64 passed / 1 failed (see below)
                  cargo clippy --all-targets -> 0 warnings
STUDIO HARNESS:   run 1 -> 1292 passed / 23 failed / 25 skipped (4 files)
                  run 2 -> 1286 passed / 29 failed / 25 skipped (same 4 files)
```

**The one cargo failure is a collision with the live desktop app, not the
change.** `a_deliberate_stop_reports_stopped_and_leaves_no_hot_wal` asserts
that no `studio.db-wal` sits beside the REAL `~/.studio/data/studio.db`;
the desktop app was running at the time (left up at the user's request for
hands-on testing), so its harness held the database and the WAL file
existed by definition. The same run was green earlier in the session
before the app was launched. The Rust tree is untouched by this task; the
test could not be rerun green until the app is closed.

**The HARNESS failures are one machine-state defect, the same in both
runs, and none of them is this change.** All 23-29 failures sit in exactly
the sandbox-shaped files (`sandbox-appcontainer`, `mcp-launcher`,
`mcp-runtime`, and one more), all with the same root:
`SandboxError: The sandbox needs one-time setup ... run: pnpm
sandbox:prepare "C:\Users\pooki" ...`. Every conversation, streaming,
provider, and turn test passes - including the new ones. My diff has no
causal path to AppContainer ACLs: the `[pace]` change is function-internal
to the test adapter's stream, and the new adapter test never runs in the
failing files. The named remedy was attempted: `pnpm sandbox:prepare`
reports `C:\Users\pooki\AppData\Local\Temp - ready` but
`C:\Users\pooki - failed: could not build the new permissions (error 87)`,
an ERROR_INVALID_PARAMETER from the native launcher on the home root's
current ACL state. Repairing that needs the administrator route the error
message names, which this session cannot run. The corridor-release test
inside the suite (`takes the corridor back off the user's folders when
released`) revokes these grants persistently and passes every run, which
makes the suite itself a suspect for the original revocation - named in
§8, not fixed here.

## 7. Where the brief was wrong

1. **The break was not one seam but two, and neither was where the brief's
   instrumentation plan was looking.** The four-boundary list was the right
   map, but the brief's emphasis (counting frames at each boundary of the
   streaming path) found the streaming path clean at every point it
   measured. The failures lived in the read's *lifecycle*: a race that
   attaches nothing, and a death Rust is structurally unable to see.
2. **The brief's model of the missing stop button was incomplete.** The
   one-line explanation (`busy` is `phase.status === 'streaming'`) is
   correct, but the reason the condition was never true was not chunk
   content or timing — in the deaf-read shape the chunks never arrived at
   all, and in the demo shape no turn existed to arrive. The line was
   right; "the condition is never true" had two unrelated causes.
3. **The brief did not know the home composer is demo-wired.** A first
   message sent from home never reaches the harness: it goes to the
   workspace store's local demo turn, and the conversation it opens renders
   live-transcript-empty forever. That is the same family as the gallery
   scaffolding the brief fenced off, it is arguably the loudest instance of
   it, and it is reported here rather than fixed, per the brief's own rule.
4. **"The test adapter does not emit incremental deltas" was half wrong.**
   It emits deltas; it emits them with zero spacing, which is equally
   useless — no observer can tell a live delivery from a replayed one. The
   seam's gap was pacing, not emission.
5. **The brief's "the abort seam itself is wired and works" was untestable
   by a person.** True as code; unreachable as behaviour, because the
   control that offers it never rendered. It renders now.
6. **The webview can lose a channel without dying, and Rust's delivery
   contract cannot notice.** The brief's boundary 4 ("Rust classifies or
   coalesces them") was the right place to look for the wrong thing: Rust
   forwards promptly and its sends into a dead channel *succeed*, which is
   precisely why the deaf read stayed broken for 40+ minutes with
   keep-alives flying. The failure is not in the forwarding; it is that
   forwarding has no return path.
7. **Two page reloads happened in the dev app with no cause this task
   could name** — no HMR line, no renderer crash in the event log, no
   harness restart, 06:29:35 and 06:48:06. The second one is what
   triggered the captured callback loss. The watchdog covers its
   consequence whatever the trigger turns out to be, but the trigger
   itself is named and open.
8. **Task 31's wedge cost more of this task than the defect did.** Three
   of five desktop launches hit it (one byte-silent, one silent after
   `journal module evaluating` at +1885 ms, one clean), with a game
   running on the machine during the episode. The boot log named every
   sighting, exactly as built to; the episode passed on its own
   tens-of-minutes schedule, exactly as predicted.
9. **One `sed` ran against this report file.** The brief forbids editing
   files with a script, and Tasks 29 and 31 both disclosed theirs. This
   one renumbered four section cross-references (§6 to §7, §7 to §8)
   after this report gained a section - a mechanical renumbering of this
   document's own headings, no code, no string literals. The four lines
   were re-read by hand afterward; everything else in this repository was
   edited by hand.

## 8. Findings out of scope, named and left

- **The home composer's demo send** (§7.3): a new-conversation flow that
  silently plays a local demo turn the live transcript will never render.
  Removing demo scaffolding is the user's own named task; this is its
  highest-value instance.
- **The reload trigger** (§7.7): unexplained. A production build may not
  have it; the watchdog makes it survivable either way.
- **The sandbox corridor on the home root is broken, and the suite's own
  release test is the likeliest hand on the knife.** `releaseIsolation`
  revokes the corridor's ACL grants from the user's folders persistently,
  the release test runs it inside every suite, and once revoked the
  sandbox-shaped tests fail with `needsElevation` until an elevated
  `sandbox:prepare` restores them - which currently cannot, because
  rebuilding the home root's permissions fails with error 87. Whether the
  revocation should restore-and-then-release, or the launcher should
  tolerate the post-release ACL state, is a sandbox task.
- **`FlueHarnessClient.wait` remains unbounded**, Task 31 §7's finding,
  untouched here.
- **The HARNESS `pnpm typecheck` is red at HEAD**, before this task's
  changes: `model-providers.test.ts` lines 213/216 call
  `assertTargetResolvable()` on the `ModelProviderAdapter` interface, which
  does not declare it. Two-line fix on the test or one line on the
  interface; it is not this task's change, and it was left as found.
