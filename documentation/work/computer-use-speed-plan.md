# Computer use: faster, fewer round trips, provider-safe (decision, 2026-10-21)

Status: items 1-3 implemented 2026-10-21 (`studio_computer_batch`, references
that survive Studio's input, adaptive settle in `Observe-Action`). Item 4 is
superseded; item 5 is not started.

## Measured live (2026-10-21, this machine, Windows 11 Notepad)

Task: new tab, type a line, open Save as, cancel it, close the tab with
Don't save (by reference). Same task through the real MCP server bundle,
before (commit 9d5cccb7) and after (b348732e), two runs each:

| | Tool calls (= model turns) | Tool time | Pictures added to context |
|---|---|---|---|
| Before | 10 | 9.6-9.7 s | 8 |
| After | 4 (two batches, read_ui, act) | 6.4-6.5 s | 3 |
| With dialog adoption | 3 (one batch, read_ui, act) | 5.0-5.1 s | 2 |

One input step went from about 1.05-1.25 s to 0.7 s (the settle). The larger
gain is the seven model turns not taken, each several seconds of model time,
which tool time does not include.

Found on the first "after" run: keys to a dialog found by `wait_for_window`
were refused until it was focused by handle (the target rule), so "open the
dialog, then type into it" took two batches. Fixed the same day: a window
`wait_for_window` finds becomes the target when it is in front, owned (through
its owner chain) by the target, and of the target's own process run. A window
of the same app that the target does not own (the person's own Notepad) or one
owned by it from another process is never adopted. When the adopted dialog
closes, the target returns to the window that raised it, if that window still
has the same identity; an explicit focus or click elsewhere in between wins.
Covered by the driver contract test (adoption, both refusals, hand-back,
replaced owner) and the live run above.

Input: `computer-use-perception-research.md` (a model-written survey; useful
direction, overstated in places) and the current Studio driver.

## What Studio already has (the survey assumes it does not)

- Structured targets on the desktop: `read_ui` walks Windows UI Automation and
  stamps `ui_<observation>_<n>` references; `act`, `set_value`, `select_text`
  use them without moving the pointer. This is the survey's item 1, except the
  references expire after **any** input.
- Action receipts: every input returns an observation (target window, front
  window, windows opened/closed) plus a post-action screenshot. Item 2.
- Event waits for windows (`wait_for_window`). Part of item 5.
- Screenshots at 1568 px longest side, JPEG by default, full resolution through
  `zoom`. This is **not** a quality loss: Anthropic scales anything larger down
  to about this size before the model sees it, so sending 4K only costs upload
  time and bytes. Keep it.

## Where the time actually goes, per step

1. The model turn (2-60s; dominant). Fewer turns is the biggest lever.
2. A fixed 800 ms settle after every input (`Observe-Action` sleeps 8 x 100 ms
   regardless of whether anything is still changing).
3. A cursor request plus a full-display screenshot after every input.
4. References die after every input, so the next `act` needs another `read_ui`
   turn first: two model turns per control instead of one.
5. Every screenshot stays in the history and is resent each turn, which grows
   the request (latency) until the provider refuses it (the 30-34 picture
   failure).

## Decision, in order of payoff

1. **Batch tool** (`studio_computer_batch`): a list of the existing actions
   (click, type, key, act, set_value, scroll, wait, wait_for_window), run in
   order, stop at the first failure and mark the rest "not executed", one
   observation and one screenshot at the end. Anthropic's own computer-use
   tool and OpenAI's code-execution path both converged on this. Expected:
   form filling and menu walks drop from N model turns to 1-2. No replay:
   a batch is never retried automatically, and the receipt says exactly which
   steps ran.
2. **References that survive input**: keep each element's UI Automation
   RuntimeId with its reference; on use, re-find it by RuntimeId under the
   target window. If it is gone, refuse with "stale, read again" (never guess).
   Removes the extra `read_ui` turn after most actions.
3. **Adaptive settle**: sample window state every 50 ms and stop once two
   samples in a row match (minimum 150 ms, maximum 800 ms as today). Saves
   about half a second per action when nothing moves.
4. **Picture history**: superseded. The request window is decided in
   `documentation/architecture/media-limits.md` (50 pictures, general for
   every provider, not tuned for computer use). Fewer pictures come from the
   batch tool (item 1): one screenshot per batch instead of one per action.
5. **Diff on read_ui** (later): with stable RuntimeIds, a re-read can report
   "added / removed / changed" controls instead of the whole outline.

## Rejected, and why

- **OmniParser / Set-of-Mark overlays**: needs a detector model on the user's
  machine; large, slow on CPU, and only helps apps with no accessibility tree.
  Revisit only if canvas or game apps become a real use case.
- **Code-execution control** (the model writes PyAutoGUI scripts): fast, but it
  gives the model an unreviewed script with full input access. It bypasses the
  per-action ownership, foreground checks and receipts Studio already has.
  The batch tool gets most of the speed while keeping those checks.
- **Sending full 4K screenshots**: no detail gained (the provider downscales),
  and slower uploads. `zoom` remains the way to read fine text.

## Verification for each item

Driver contract tests (isolated, no real desktop needed) for batch halt-on-
failure, stale-reference refusal and settle bounds; one live run on this
machine timing a five-field form before and after (model turns, total time,
pictures sent). Observability: the batch is one `computer` operation with a
step count and the index it stopped at; no arguments or typed text.
