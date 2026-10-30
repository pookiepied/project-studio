# Computer presence and cursor refinement

Implemented on `codex/computer-presence-ui`. No commits were made on `main`.
Unrelated working-tree deletions and the transcript patch directory were preserved.

## Changes

- `STUDIO HARNESS/src/computer/activity.cs` replaces magenta colour-key transparency
  with per-pixel alpha, uses neutral text antialiasing, and paints a custom dart
  cursor with the compact Studio badge. `STUDIO/src/features/browser/BrowserWindow.tsx`
  uses matching geometry and colours, a smaller badge, and corrected hotspots.
- Harness `computer/control.ts`, `computer/service.ts`,
  `application/studio-runtime.ts`, `transport/http/create-app.ts` and `app.ts`
  expose admitted, non-cacheable desktop presence from the actual lease. The
  projection contains only the existing conversation ID and mode. Reading it
  does not start a computer server or driver. `computer.activity` inherits the
  HTTP execution parent and existing MCP observations.
- Client `features/screen/useComputerPresence.ts` shares one bounded poll per
  window, distinguishes missing evidence from idle, and fences disposed reads.
  `shell/ComputerPresenceMonitor.tsx` and `App.tsx` move native sign ownership
  above chat navigation. Stop reaches the addressed driver, conversation run,
  owning voice workers and pending decisions even when that chat is not open.
- `features/chat/useComputerIndicator.ts` now handles chat Stop cleanup rather
  than inferring native presence from transcript history. `ChatPage.tsx` and
  `useDelegatedComputerUse.ts` comments describe the revised ownership.
- `shell/ComputerIndicatorWindow.tsx` uses the computer-use icon, simpler visual
  styling, explicit lease-mode labels and reusable Stop state. The existing
  platform `tauri/window.ts` seam and `tauri/index.ts` carry mode updates and
  request-scoped Stop results. Late replies cannot change a newer press or owner.
- `features/rail/BrowserPanel.tsx` follows the same lease, removes inactive
  computer Stop controls, distinguishes failed requests from confirmed inactivity,
  and scopes transient button state to the displayed conversation.
- `STUDIO/src-tauri/src/lib.rs` follows the pointer's monitor using physical
  work-area coordinates, including negative origins and mixed scaling. One sign
  moves between monitors. Renewal expires after four seconds; absent ownership
  continually enforces hiding, including late webview-ready races. Queued native
  position samples are coalesced and unchanged positions are skipped.
- Tests were added or updated in the corresponding client suites, harness
  `computer-activity.test.ts`, `http-admission.test.ts`, the offscreen renderer
  fixture, and native `indicator_tests`. Former transcript-derived pill assertions
  were moved to the live-presence monitor; chat cleanup remains separately tested.
  The observability contract and coverage tracker document the changed boundaries.

## Verification

No pre-change full-suite baseline was recorded.

- Harness `pnpm check`: 2,739 passed, 28 skipped, 213 files.
- Client `pnpm check`: 1,768 passed, 211 files, on the final full run.
- Full current native test binary: all 163 registered tests executed successfully
  under an isolated temporary user profile; exit code 0. No native tests are ignored.
- Native `cargo test --lib indicator_tests`: 2 passed.
- Native `cargo clippy --all-targets -- -D warnings`: passed.
- Client production build and `git diff --check`: passed.
- The native cursor was rendered offscreen and visually inspected.

Negative controls were restored after confirming the exact regression test failed:
removing `activity()`'s owner-settlement check; removing the client read-epoch
guard; removing the rail's conversation-owner comparison; dropping mode from the
monitor effect dependencies; removing pill Stop reset; removing Stop request-ID
matching; ignoring monitor scale in placement; and extending freshness through the
four-second expiry boundary. The transparency test also caught coloured font edges
before neutral text rendering was enabled.

No unrelated product rules or dependencies were added. Polling, renewal expiry,
request correlation and sample coalescing implement the requested state lifecycle.

## Limits and unrelated findings

Live multi-monitor movement, native alpha composition and focus preservation still
need hands-on verification in the desktop application. Offscreen rendering and
coordinate tests do not establish those behaviours.

The first client full run had one unrelated `PairingGate` focus test failure. Its
14-test file passed alone, and the subsequent full client run passed all tests.
The initial native full run had 160 passes and one failure because the existing
WAL assertion used the live Studio home. The subsequent full run used an isolated
profile and passed. The test isolation issue was not changed in this feature.

The production build reports warnings from `webrtcaec3` and bundle chunk size;
those dependency and bundling concerns were left outside this change. The harness
full gate took about 23.5 minutes here, rather than the documented two-minute
estimate. This change does not claim completion of the overall Studio readiness gate.
