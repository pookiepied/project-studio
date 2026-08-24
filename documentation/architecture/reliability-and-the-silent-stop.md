# Reliability, and the silent stop

**Written:** 2026-08-24, from a working conversation. Not a decision record — a nudge, so
the reasoning is here when we implement it. Nothing in this file has been ratified as an
ADR yet; where it hardens into a rule, promote it.

## The observation that started it

Across several agent harnesses — third-party CLIs, editor integrations, both open and
closed source — a run stops in a random place. The model was mid-task, the response was
streaming, and then it simply ends. It looks like the model gave up. The user has to
watch the screen, which defeats the point of delegation.

The same person does not see this in the harnesses shipped by the labs, and sees it with
the *same* models pointed at different clients. That is the interesting part, and it is
what makes the diagnosis possible.

## The diagnosis: it is the client, not the model

There are roughly six distinct causes. They all present identically — "it stopped" —
which is why the behaviour feels random rather than like a bug with a shape.

1. **Truncation that reads as completion.** An SSE stream ends. If the client treats
   "body ended" as "turn finished", a dropped connection is indistinguishable from a
   finished answer. The model did not stop; the socket did, and the client reported
   success.
2. **`stop_reason` ignored.** The model hits its output cap and returns `max_tokens`.
   The correct response is to continue the turn. A client that never inspects
   `stop_reason` just ends — mid-sentence, or mid-tool-call.
3. **The agent loop's exit condition.** Most loops are `while (response has tool_use)`.
   A model that writes "now I'll update the file" as prose without emitting a tool call
   exits the loop cleanly, and the client believes it is done. Malformed tool-call JSON
   does the same thing by a different route.
4. **Idle timeouts.** Proxies cut connections after 60–100s of silence. A long thinking
   block with no keepalive frames gets severed. This is why the Anthropic API emits
   `ping` events at all.
5. **Mid-run 429 / 529 / 5xx.** Naive clients surface a retryable status as terminal.
6. **Context overflow.** A silent 400 late in a long run, caught by a broad handler and
   rendered as "done".

Providers do drop connections. That is normal at any scale and is not going away. The
difference between a harness you trust and one you do not is **whether the client can
tell "the stream ended" from "the stream stopped", and whether it can resume.**

A client that cannot make that distinction will silently present truncation as
completion, at a rate that tracks network quality and provider load — which is exactly
what "random" feels like from the outside.

**The unacceptable class is the silent stop.** A visible failure is fine. A fabricated
success is not, because it destroys the user's ability to trust any result without
re-reading it, which is the whole value of delegating.

## The principle

> **Retry is only safe on top of an idempotent, durable journal.**

Most harnesses bolt retry onto a stateless stream, get duplicated or lost work, and
reasonably conclude that retry is dangerous — so they do not retry, so they stop. The
ordering has to be the other way around: durability first, then resume becomes safe and
obvious rather than risky.

## What Project Studio already has

Several decisions already made were the expensive half of this, mostly by accident of
taking ADR 0032 and ADR 0045 seriously:

- **Durable Streams with opaque offsets.** Every event carries a resume point. A broken
  read is a `GET` with an offset, not a lost turn.
- **`service_stream` distinguishes `Ended` from `Failed`** (`STUDIO/src-tauri/src/services/stream.rs`).
  During Task 22 this was briefly wrong — `let _ = chunks_tx.send(...)` never polled the
  future, making an ended body indistinguishable from an aborted task. **That was cause
  #1, in our own code**, and a mid-stream-break test caught it. Worth remembering that
  this class of bug is easy to write and invisible without a test that severs a stream.
- **Flue's idempotent appends** (`appendEventOnce`) and its canonical transcript, which
  is the journal the principle above requires.
- **Task 23's lifecycle**: a crash is observed, recorded, announced, and restarted once
  per window rather than in a loop.

## The gaps, honestly

1. **`stop_reason: max_tokens` continuation.** Flue owns the agent loop, so this is
   probably Flue's job — but that must be *verified by reading Flue*, not assumed. If it
   does not continue the turn, we inherit cause #2 wholesale.
2. **Provider-level retry** with backoff and jitter on 429/5xx/connection-reset.
3. **Never render an incomplete turn as complete.** The rule: a turn is complete only
   when a settlement chunk says so — never because bytes stopped arriving.
   `useConversation`'s `interrupted` state is the right shape; it must never be
   collapsed into `idle` for tidiness.
4. **Bounded, visible auto-resume for streams**, following the shape Task 23 already
   chose for processes: retry once per window, then a human decides. Infinite retry is
   the other failure mode — a harness that looks busy while accomplishing nothing.

## On dogfooding Studio to build Studio

The goal is right and the ordering instinct — reliability before features — is right.
Two caveats worth keeping:

**Dogfooding too early costs you your instrument.** When a task fails you need to know
whether the *task* failed or the *harness* failed. If Studio is both the thing under
test and the thing running the test, that signal disappears exactly when it matters.
Keep a known-good fallback until Studio can complete a full delegated task unsupervised.

**Define "reliable enough" as a number, not a feeling.** Something like: N delegated
tasks end to end, zero silent stops, every interruption either auto-resumed or visibly
surfaced.

**The workflow we already run is the product spec.** Task prompt → delegate → report →
*independent verification* → commit. The verification step is not optional and is the
reason the loop works; it assumes the delegate may be wrong and checks. In Task 24's
review, a security guard passed every test its author wrote for it and was still
bypassable. That is not a delegate failure — it is the normal case, and the process is
what caught it. Studio should make that loop native rather than leaving it to a human's
diligence.
