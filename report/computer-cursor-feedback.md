# Computer cursor feedback and pill alignment

Prepared on `codex/visible-computer-cursor` as a follow-up to the desktop cursor
being too similar to the normal pointer and too easy to miss. The final design
uses Studio's white, charcoal and neutral grey palette. No accent colour or
OS-wide cursor-theme replacement is introduced.

## Files and behaviour

- `STUDIO HARNESS/src/computer/activity.cs`: smaller white pointer, one thin
  charcoal edge, smaller Studio hint, five-second activity visibility, and bounded
  press/held/release feedback. A press compresses the pointer; release expands and
  fades a neutral ring over 260 ms. Pointer correction retains known held-button
  state, while manual buttons, refusal, release cleanup and disposal clear it.
- `STUDIO HARNESS/src/computer/driver.ps1`: renews the visual marker after accepted
  input and exact pointer correction, updates button feedback only after accepted
  mouse input, and dismisses it on refusal and held-input cleanup. Mouse delivery,
  keyboard delivery, permissions, results and exceptions remain unchanged.
- `STUDIO HARNESS/src/browser/live.ts`: retains a bounded product-only press
  counter through the existing private viewer projection. A complete click between
  polls can animate without increasing the polling rate. Page telemetry is visual
  evidence, not execution identity, input authority or application-success proof.
- Client `domain/browser/live.ts` and its test validate that counter. New
  `features/browser/StudioCursor.tsx` and its test render compact neutral pointer
  feedback without replaying initial or repeated samples. `BrowserWindow.tsx` and
  its test hide Studio's pointer for another human controller or an ended session.
- `shell/ComputerIndicatorWindow.tsx`: compact pill, lighter shadow, shared text
  line box, consistent foreground and a reserved Stop/Stopping slot. The original
  button widened from about 46 px to 70 px when its label changed. The slot now
  stays fixed, and longer stopping copy is shortened to fit the native window.
- Harness `computer-activity` raster and managed-dispatch fixtures cover renewal,
  movement during holds, overlapping buttons, release fade, manual takeover,
  wheels and refused input. `browser-live` integration covers complete clicks
  between reads. New `computer-indicator-layout` integration renders the actual
  component, fonts and CSS in isolated headless browser contexts.
- `computer-marker-live.ps1` is an opt-in component fixture, excluded from normal
  test execution. It checks actual layered-window composition and foreground
  preservation over its own backdrop without hooks or injected input.
- The observability contract and coverage tracker describe the visual state,
  existing transport exclusions, identity distinctions and unsupported evidence.

## Visual verification

The pill passed geometry checks across 96 combinations: four UI font sizes,
light/dark themes, four statuses and 100/125/150 percent display scales. Both text
boxes align within 0.5 CSS pixels, labels fit without overlapping the button, and
the Stop slot does not grow when busy. Light, dark and 150 percent captures were
inspected. Cursor idle, press and release frames were rendered from the shipped
C# renderer and inspected; an animated preview uses those same rendered frames.

Review assets are under `report/shots/computer-cursor-feedback/`:
`cursor-feedback.gif`, `cursor-states.png`, `indicator-light.png`,
`indicator-dark.png` and `indicator-dark-150.png`.

After the user said they were gaming, verification used isolated headless browser
contexts and offscreen bitmap rendering. No desktop input, active Studio restart
or game interaction was performed. The earlier opt-in native component check
reported matching arrow/badge composition and preserved foreground focus. That
component check does not establish end-to-end agent input or physical attribution.

## Checks

The last full baseline before this follow-up was 2,739 harness passes with 28
skips, and 1,768 client passes. Final full-gate results are recorded after the
current verification finishes. Focused final cursor tests passed; frontend lint,
typechecking and production build passed. No Rust source changed.

Negative controls confirmed failures when each dispatch renewal was removed,
when accepted mouse-button dispatch stopped updating feedback, when ring rendering
was disabled, when the browser press counter stopped advancing, and when initial
snapshots were allowed to animate. The original button-width test failed before
the reserved slot was implemented. Additional tests caught held state being lost
during pointer correction and stale held state after a manual button takeover;
both were corrected without changing input delivery.

All mutations were restored. No unrelated product rules or dependencies were
added. Unrelated working-tree deletions and the transcript patch directory were
preserved. The existing audio dependency and bundle warnings remain outside this
cursor/pill change. A running computer MCP process keeps its loaded helper source;
the rebuilt helper takes effect after Studio's computer connection or app restarts.
No commit was created on `main`.
