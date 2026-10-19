# Computer-use observation and recovery

The existing tool catalog could act on a chooser, lose that window, and leave
the model using old handles or accessibility references. Coordinate clicks and
accessibility invocation also updated targets differently. This change keeps the
26-tool surface and the existing permission gate while making observations and
recovery explicit.

- `driver.ps1`: read-scoped UUID references, invalidation at action/refusal,
  process identity checks, display-relative control centres, ambiguous app/window
  refusal, point-selected coordinate targets and bounded post-action observations.
  Replacement candidates never become input authority automatically.
- `session.ts` and `server.ts`: central UUID generation for product observations,
  per-conversation tool serialization, queue cancellation and stale-continuation
  fences, pending-request settlement and cleared frame metadata after shutdown.
- `tools.ts` and `errors.ts`: observations in prose and structured product results,
  consistent observation propagation, honest missing screenshot/cursor evidence,
  and observe/act/verify/recover guidance in the actual discoverable definitions.
- Client `computerCall.ts`: prefers current observed window identity over an
  older title mentioned in the action prose, retaining legacy result support.
- The developer contract and coverage inventory document identity ownership,
  existing gated MCP capture and unsupported observations.

New driver tests load only selected production functions and the click dispatch
from the parsed source. Native initialization and the live driver loop never run;
all window discovery and input functions in the fixture are controlled doubles.
Tests cover old-read reference aliasing, another process reusing a handle, driver
epochs, input invalidation, positive/negative display origins, ambiguous matches,
delayed replacement windows, unrelated foreground windows and observation failure.
Additional TypeScript tests cover the action receipt across tool kinds, screenshot
and cursor failures, serialization, cancellation and stale continuations. No new
dependency or tool was added. No Tauri native host file changed.

This is bounded observation, not proof that an application completed an action.
Transitions occurring after sampling still require status/windows/wait_for_window
and another explicit selection/read. Unobserved same-process HWND recycling and
desktop-wide arbitration across simultaneous conversations remain limitations.
The real Chrome profile-picker sequence was not exercised against the user's
desktop; its changing-window behavior is represented by isolated regressions.

Focused verification passed 48 harness tests (30 new, 18 existing) and 13 client
projection tests (three new, ten existing). A fresh pre-change full baseline was
not run; the previous recorded gates were 2,468 harness passes / 28 skips and
1,561 client passes.

Negative controls were applied and restored before final checks:

- Removing the reference epoch check, coordinate-origin subtraction, ambiguity
  refusal and foreground/target separation failed five driver policy regressions.
- Bypassing the tool queue failed the action/observation ordering regression.
- Ignoring structured observations failed all three new client title regressions.
- Removing the target-process identity guard failed its keyboard regression with
  a managed foreground API double, proving the refusal is not an incidental
  missing-native-API exception. Removing the held-input cleanup exception failed
  the release regression. Both protections were restored.

An initial full harness run was interrupted during testing when review found
that held-button release needed to bypass the new pre-action observation check.
The corrected path is covered by the actual button dispatch running with an
input double and a failing observation provider. Final gates run after this fix.

The corrected full harness gate passed typecheck, lint, build and all 2,498 tests
with 28 skips across 195 files (193 passed, two skipped). The test phase took
1,275 seconds. The subsequent full client gate passed typecheck, lint and all
1,564 tests across 174 files; its test phase took 71 seconds. The client emitted
two jsdom `scrollTo()` not-implemented notices and exited successfully.

No existing test was deleted or weakened. The added bounds, cancellation fences
and ambiguity refusals support the requested reliability changes. No unrelated
feature was added. Work remains on `main` under the user's established request
to use and push that branch.
