# Computer Use QA exercise

Run this exercise against Studio's 30 Computer Use MCP tools. The deliverable is a small house drawing in Paint and a Notepad note reading `Studio QA: house drawn`. Both are disposable fixtures. The review matters more than the drawing.

## Setup

- Build the Harness with `pnpm -C "STUDIO HARNESS" build`. Launch the resulting `STUDIO HARNESS/dist/computer.mjs` with the absolute path to Node and use newline-delimited JSON-RPC over stdin and stdout. Send `initialize`, then `notifications/initialized`, then one `tools/list`. Use the raw `studio_computer_*` names in `tools/call`. Close stdin and wait for cleanup at the end.
- Use a dedicated Windows test session for native input, screen captures, clipboard and app operations. Use a synthetic driver when a dedicated session is unavailable. Keep its window titles, screenshots, controls and clipboard synthetic. Record the environment for every reported outcome.
- Use a single server process for the whole run. Keep the window handle, PID and process start time that the server actually returned. Keep the latest frame ID or UI reference for each action. Save only synthetic screenshots and output.

## Workflow and tool coverage

The names below omit the shared `studio_computer_` prefix. Each row must have an observed outcome or a specific blocker.

| Phase | Tools | Work |
| --- | --- | --- |
| Session and screen | `control`, `displays`, `status`, `screenshot`, `zoom`, `cursor` | Read the lease, identify the display, take a fixture frame, crop a confusing area and verify the pointer position. Acquire only after observing the desktop. |
| Find the app | `apps`, `open`, `wait_for_window`, `windows`, `get_window`, `focus`, `arrange` | Find Paint, open it, wait for it, then resolve and confirm its identity. Focus and arrange only the test window. Refresh coordinates after the layout changes. |
| Draw | `read_ui`, `act`, `move`, `click`, `drag`, `mouse_button`, `scroll`, `mark` | Read controls and select a brush if its accessibility pattern is available. Draw a simple roof and wall. Exercise one explicit button down/up pair and a small scroll. Show and clear a short-lived mark. Verify the resulting frame. |
| Write and edit | `type`, `key`, `hold_key`, `set_value`, `select_text`, `clipboard` | Open a disposable Notepad window. Type the note, edit it with a key or chord, set and select text on a supported control, then exercise the clipboard with synthetic text. Record which text patterns Windows actually exposes. |
| Timing and cleanup | `wait`, `batch`, `stop` | Wait for a short, known change. Run a small batch with a visual postcondition. Release any held input, clear marks, discard or close only test documents, stop the driver and check that control ended. |

When a call errors, log the attempted arguments, which stage refused it, what the result says was sent, and whether the suggested recovery worked. Never replay a call whose input outcome is uncertain. Never invent a frame ID or UI reference to make the workflow pass. If a mark needs Studio's UI to render, record server output and on-screen rendering as separate outcomes.

## Review

For each tool, record the exact name and arguments, relevant prior state, result, and whether the expected change was verified. Distinguish direct MCP protocol coverage, synthetic driver execution, and native Windows execution. Call out confusing schemas, redundant reads, missing recovery information, unexpected permissions, and cleanup failures. Rank findings by user impact and provide the smallest reproducible sequence for each. Keep taste and assumptions out of the defect list.

## 2026-11-20 run

The built server listed 30 tools over its local stdio connection. A live display-metadata read passed. The full exercise used the built server with a synthetic Windows driver and made 63 calls across all 30 tool names. The returned fixture image contains six drawing strokes. The fixture editor verified typing, backspace, setting a value, selecting a range and pasting separately. Cleanup left no simulated button held. A click with a stale frame and a clipboard read awaiting approval were the two expected refusals.

- The driver-contract test originally stopped before reaching its assertions. Its stubbed environment omitted the indicator target helper used by the driver answer. The fixture now runs that helper and checks the limited handle and process ID sidecar.
- Waiting for a window returned its handle in prose and omitted the process identity needed to focus it safely. It also advised focusing a window that `open` had already made the current target. The wait result now carries the identity and distinguishes an already selected target from a window that merely has the foreground.
- A direct `mark` response claimed that the marks were visible. The direct MCP server returns the mark payload and has no renderer to confirm that. The response now describes the request it actually returned.
- The reviewer found duplicated target and foreground lines for the same window. Receipts now combine those when the identities match and keep both when they differ.
- A move invalidated the prior click frame as designed. Its result already supplied a replacement frame. An operator can continue with that frame when the point is still appropriate, avoiding a separate capture.

In a separate model-directed trial, the reviewer chose a new roof path, used the drag receipt's frame for a move, then deliberately tried the older frame for a click. The click was refused before input. The reviewer continued with the move receipt's frame, and the click succeeded without a new screenshot. The native driver was still simulated for this trial.

Native drawing, text patterns in installed Paint and Notepad, overlay compositing, and the approved clipboard-read path were outside this run's coverage. An end-to-end test of those paths requires an isolated Windows desktop.
