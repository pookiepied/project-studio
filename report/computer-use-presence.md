# Computer/browser presence and desktop ownership

This change continues the computer-use reliability roadmap while deferring the
user's hands-on desktop verification. It adds no dependency, tool or permission.

- `computer/activity.cs` is a bundled helper compiled by the existing Windows
  driver. A dedicated message loop observes non-injected mouse movement, button
  events, wheel events and keyboard events. Only types/counts/age cross the boundary;
  key values and scan codes are never read. A click-through, nonactivating marker
  follows the real pointer briefly during agent actions and hides on user input.
- `computer/driver.ps1` collects bounded activity before requests and at replies,
  expires UI refs, and returns current pointer/window state when available. Input
  remains informational and never causes an automatic stop. Shutdown/refusal
  releases Studio-tracked held input, including the middle button and modifiers.
- `computer/session.ts`, `input.ts`, `control.ts`, `server.ts`, `raw.d.ts` and
  tool descriptions bundle the helper, keep input updates with the originating
  tool, retain action failures, and serialize the shared desktop across chats.
  Another running owner refuses competing input; Stop bypasses the queues.
- Browser `live.ts`, `interaction.ts`, `result.ts` and `server.ts` report viewer
  presence without claiming control or injecting page input. Explicit manual
  commands are counted separately. The existing human-control lease is retained.
  Page-owned cursor telemetry includes bounded pointer/text shape and press state;
  a trailing sample preserves the final coordinate during fast movement.
- Client browser boundary, hook and surface show these cursor states, send bounded
  viewer-only activity samples without key contents, and keep presence traffic
  from crowding out actual input. Pending presence timers are disposed on changes.
- The developer contract, coverage inventory and original computer-use plan record
  privacy, unsupported evidence, current implementation and the remaining order.

Activity reaches the model in its next tool result, including activity during a
call. It does not interrupt a model stream or wake an idle agent. Browser viewer
samples are coalesced and can be dropped; counts are not a hardware audit. Native
hook installation is not proof of lossless delivery or human attribution. The
marker follows the real pointer without replacing the global OS cursor. Child-frame
cursor styles are best effort. The real Chrome chooser, physical-input hooks,
focus/nonactivation and multi-monitor marker behavior remain deferred manual work.
Ownership is local to the computer MCP server; separate harness processes are not
arbitrated. A wedged or force-killed driver cannot guarantee held-input cleanup.

Automated evidence and final gate results are recorded below before shipment.
Previous full gates: 2,498 harness passes / 28 skips and 1,564 client passes.
No fresh pre-change full baseline was run. No existing test is deleted or weakened.

Focused verification passed 52 harness tests across seven files and 17 client
tests across three files. The real browser-window fixture produced light/dark
cursor screenshots; visual inspection led to a contrasting outline for the text
cursor and press ring. The native helper compiled under Windows PowerShell 5.1
without starting hooks or its marker. A real JSON-lines Node child exercised the
session's reply/error path without launching PowerShell or sending desktop input.

Negative controls were applied and restored before final gates:

- Disabling injected-input filtering, desktop ownership and user-input ref expiry
  failed five policy regressions. Adding foreign fields to the activity projection
  failed the privacy assertion after it was strengthened to inspect the first
  projection before a subsequent update could overwrite it.
- Dropping session input delivery failed both real-child protocol tests. Clearing
  browser activity before reporting failed both new browser context tests.
- Dropping cursor shape in the client parser failed its boundary regression.
- Removing the presence backlog bound failed the explicit-control delivery test.
  The stale-sample regression failed before the client fix, and the text-only
  activity test failed before truncation was included in the model-visible text.

The initial browser-window extension missed a movement before the page watcher
was attached. The fixture now waits for that tab's actual live frame before
driving the isolated page; the test passed afterward. An existing fast-movement
regression exposed a missing trailing sample; the production cursor observer was
fixed, preserving the original assertion. No production timeout was relaxed.

An initial full harness gate passed typecheck/lint/build but was interrupted
during tests for the final delivery review. The native summary's unused sequence
and last-kind fields were removed; monitor-read failure preserves already known
activity counts. The client now ignores a refused replaceable presence sample
without losing the next explicit control request, and polls active automation at
the existing manual-view cadence. Final full gates run after these changes.

The native event filter and nonactivation styles follow the Windows contracts:
[low-level keyboard hook](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc),
[mouse input flags](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-msllhookstruct)
and [extended window styles](https://learn.microsoft.com/en-us/windows/win32/winmsg/extended-window-styles).

The final `pnpm -C "STUDIO HARNESS" check` passed typecheck, lint, build and all
2,512 tests, with 28 skips across 197 files (195 passed, two skipped). Its test
phase took 1,267 seconds. The subsequent `pnpm -C STUDIO check` passed typecheck,
lint and all 1,568 tests across 174 files; its test phase took 52 seconds. It
emitted two existing jsdom `scrollTo()` not-implemented messages and exited zero.
The first client gate stopped in lint on an unsafe conversion of the cursor's
unknown kind value; explicit permitted-value checks fixed it. The native helper
compiled in isolated tests; no Tauri/Rust host file changed, so Cargo was not run.
Work stays on `main` under the user's established instruction to commit and push
there. The next implementation slice is condition-based waiting; physical desktop
verification stays deferred.
The isolated browser-window end-to-end test passed again after the final client
parser change (one test, 10 seconds).
