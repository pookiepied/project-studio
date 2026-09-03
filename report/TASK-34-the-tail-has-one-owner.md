# TASK 34 — The tail has one owner

On request, not from a brief. The instruction was: the reasoning row still
changes position, the duration is still wrong, read the whole chat page because
there are probably more of these, fix them, and write down what was done.

Everything below was measured on the running desktop app against the real
provider, over CDP, before and after. Where a claim has a number, the number is
from that instrument and not from a test.

---

## 1. What was actually wrong

The complaint was one sentence — the logo appears, jumps, disappears, and then
the thinking part shows up at the end — and it was four independent defects
arriving in sequence. None of the components involved was wrong on its own,
which is why the thing survived a previous round of fixes aimed at it.

Here is the tail of a turn, sampled every 60ms, **before**:

```
   320ms  bubble@64 "Say the sing…"  |  ROW@128 "Thinking"[inert]
   547ms  bubble@61 "Say the sing…"  |  ROW@125 "Thinking"[inert]
  9922ms  bubble@61 "Say the sing…"  |  ROW@149 "Thinking"[inert]
 10985ms  bubble@61 "Say the sing…"  |  ROW@125 "Thought"  |  text@157 "ready"
```

Three separate wrongs are visible in four lines. The row drops 24px at 9922ms
and comes back at 10985ms. The label never counts. And a ten-second wait ends
by claiming no duration at all.

**and after**, same instrument, same shape of turn:

```
    82ms  bubble@201  ROW@265 "Thinking"[inert]
  5079ms  bubble@201  ROW@265 "Thinking for 5s"[inert]
 10572ms  bubble@201  ROW@265 "Thinking for 11s"[inert]
 11290ms  bubble@201  ROW@265 "Thought for 11s"  |  text@297 "done"
```

The row is at 265 in every sample from 82ms to the end. The count is
continuous. The handover from the pending row to the real one moves nothing.

---

## 2. The defects, and what each one really was

### 2.1 An invisible message was taking up space

`message-started` creates an assistant message with no segments. It draws
nothing — but the transcript is a `gap-6` flex column, and **a flex child of
zero height still gets the gap**. So from `message-started` to the first delta,
an item nobody could see was pushing everything below it down by exactly 24px.

That is the entire 9922ms → 10985ms event above. No component drew anything
wrong; the list reserved space for a child that drew nothing.

`LiveTranscript` now filters items that would draw nothing at all. The
condition is narrow on purpose — exactly an open, empty, newest message whose
turn is still producing. A message left empty by a crash or an abort keeps its
slot and its "stopped" line, because that line is the only evidence on screen
that the turn happened.

### 2.2 The sender's own message did not exist for a second

A user message reaches the transcript by round trip: the harness records it and
returns it as `message-appended`. Until then, nothing on the page held the words
that had just been typed. The composer had cleared; the transcript was empty.

`PendingSubmission` now holds them from the receipt to the echo. It is kept
beside `items`, not in them — items are facts the harness reported, and forging
a log entry to fix a rendering problem is how a projection starts lying. What
retires it is the submission id coming back. Not a timer, and not "some user
message arrived": a second window sending into the same conversation does not
clear yours.

Four orderings had to be right and each has a test: the echo arriving, a
snapshot arriving mid-flight that does not yet contain the message (carry the
words through rather than blanking the screen), a receipt arriving after its own
echo has already been applied (refuse to hold it, or the message draws twice),
and a reply opening before the echo.

For a conversation's first turn the words ride across the navigation in the
receipt that was already being handed over, and are seeded **during render**
rather than in an effect. An effect is a frame late, and a frame of blankness at
the moment somebody is looking for their own message is the defect itself.

### 2.3 The duration was measured between the wrong two moments

The previous rule measured a reasoning run's own first and last delta. On this
harness those are almost always the same instant: durable writes are coalesced
on a one-second window, so a whole reasoning trace arrives in **one batch**. The
rule could only ever report zero for the turns anyone was watching, and the
previous round of work correctly refused to show a zero — which is why the row
said "Thought" over an eleven-second wait.

Refusing to lie was right. It was also not an answer.

The anchor is now the receipt: **the earliest moment this side knew a turn
existed**, which is earlier than any chunk about it can arrive. The duration is
the wait this window observed, from the receipt to the run's last delta. Eleven
seconds, measured, no invention.

That is deliberately *not* a claim about the provider's internal reasoning time,
which nothing on the wire reports. It is how long this window waited, which is
the thing a person watching the screen is asking about. Anything replayed or
seeded still claims nothing: a reattach hands back a two-minute turn in fifty
milliseconds and neither number is the wait.

While the run is live the row runs a real clock, ticking once a second against a
recorded start. The rule about clocks in this app is intact and worth restating,
because it is the rule the original brief was protecting: **a screen may measure
time, and may never decide anything by it.** This clock drives one string. No
state is cleared by it, nothing recovers because of it, and if it never fired
the row would simply stop counting.

### 2.4 The anchor died before it was needed — caught by mutation, not by review

The first implementation anchored the duration to `pending`. That is wrong, and
the interesting part is how it was found.

Every new test passed. Then, breaking `waitBeganAt` on purpose to confirm the
tests would catch it, **nothing failed**. The missing test exposed the missing
mechanism: the echo retires `pending` about a second after the send, and the
reply opens about ten seconds after that. The anchor was always gone by the time
anything needed it, and every duration silently fell back to the arrival time.

`pending` and `admitted` are now separate fields with different lifetimes, which
is what they always were:

- `pending` is about **drawing** words the log has not echoed. It ends at the echo.
- `admitted` is about **measuring** the wait. It is replaced by the next
  submission and never cleared by an arrival.

The same lifetime bug existed once more, one layer up, in the component — and
that one was caught by the instrument rather than by a test. In the second
measured run the row read "Thinking for a moment" at 101ms, then plain
"Thinking" at 174ms, then nothing until 9092ms. The 174ms transition is the echo
landing and the row losing its anchor. `admitted` is now threaded to the
component too.

### 2.5 A reply stopped counting as live when a message landed behind it

`lastAssistantId` was "the last item, if it happens to be an assistant". The log
can put a user message after a reply has opened — a second submission, or an
echo landing behind its own `message-started`. At that moment the reply being
written stopped counting as newest: its caret went out and "Stopped before
finishing" appeared under text that was still arriving.

This is the same bug class as the original "Stopped before finishing" defect,
returning through a different door. It now scans for the newest assistant
message wherever it sits.

### 2.6 The app told people to use a control that did not exist

Two pieces of copy instructed the reader to start the harness "from the status
bar". There is no status bar. There is no harness control anywhere in the
frontend. `restart_harness` has been a Tauri command since the supervisor
landed, and **nothing in the webview had ever called it**.

So a harness that failed to come up left the app permanently unable to send,
with the only instructions on screen impossible to follow. This was hit for real
during this session.

Rather than reword the sentence, the remedy now exists: `startHarness()` in the
platform layer — the one module that talks to the supervisor — and a control in
the notice that already reports the absence. A failed start says so and stays
put rather than clearing itself, because reattaching to a harness that never
came up would replace the supervisor's own reason with a generic message.

---

## 3. Something found that is not a UI bug

The harness would not start at all at one point in this session, and the cause
is worth recording because it is not a frontend problem and it is not fixed.

`HARNESS_INHERITED_VARIABLES` copies each variable from the host **if the host
has it**, silently skipping it otherwise. `SystemRoot` is on that list. On
Windows it is not optional — without it Node cannot initialise its CSPRNG and
dies instantly:

```
# Assertion failed: ncrypto::CSPRNG(nullptr, 0)
node::InitializeOncePerProcess+3100
```

Launching the app from a shell that does not export `SystemRoot` — Git Bash,
for instance — therefore produces a dead harness. Reproduced directly, both ways.

Three things make it invisible rather than merely broken:

1. The readiness wait does not check whether the child is still alive, so a
   process that died in 50ms burns the full 30-second timeout.
2. The failure message then reports `stderr=(nothing)` despite Node having
   printed a full native stack trace to stderr.
3. `tauri_plugin_log` is installed in `setup()`, which runs *after* the eager
   start thread is spawned — so the harness's own startup logging races the
   logger and can go nowhere. One launch produced zero harness log lines for a
   harness that never started.

Also worth knowing: cold boot measured ~16s against a 30s readiness budget.

None of this was touched. It is Rust, it is its own task, and the fixes are
clear: require `SystemRoot` on Windows and fail with that name; poll the child
during the readiness wait; capture stderr before terminating; install the logger
before the eager start.

---

## 4. Verification

- 299 tests pass; typecheck clean.
- 33 new tests across six files.
- **Fourteen mutations** applied to the code under test, one at a time, each
  reverted after. Twelve failed the tests written for them. Two did not, and
  both were real gaps rather than test-writing mistakes — 2.4 above was a
  missing mechanism, and the newest-assistant scan (2.5) had no test until the
  mutation asked for one.
- Three real turns driven through the desktop app against the live provider,
  sampled at 60ms. Geometry quoted in section 1.
- No console errors in the app since the final build.

## 5. What was NOT done

- **The status bar itself.** A harness control now exists where the absence is
  reported, which fixes the dead end. A persistent indicator of harness state —
  running, starting, failed with its reason — is still not built, and the
  supervisor's lifecycle events (`harness-starting`, `harness-failed`,
  `harness-restarting`) still have no listener anywhere in the frontend.
- **The sidebar's "working" indicator**, which remains dead for every real
  conversation: its `running` set is populated only by the demo turn runner.
- **The supervisor's startup honesty**, section 3.
- **A full audit of both trees.** This pass read the chat feature — roughly 6400
  lines across 48 files — and not the rest of the frontend or any of the
  harness. The paging window, the auto-scroll follow, and the collapsible text
  were read closely and no defects were found in them; they are carefully built.

## 6. Where the instruction was right, and where I was wrong

The instruction was right about all three things it asserted. The row was still
moving. The duration was still wrong. And reading the whole page did turn up
more than the reported symptom — 2.5 and 2.6 were not visible from the
complaint.

What I got wrong is worth stating plainly, because it is the same mistake twice.
The previous round declared this area fixed on the strength of passing tests
without ever watching a real turn. Both of the defects in 2.1 and 2.4 are
invisible to jsdom: one is a CSS gap around a zero-height box, and the other only
appears when a real echo arrives a second before a real reply opens. The
instrument that found them took ten minutes to write and should have existed
before the first claim that anything here worked.
