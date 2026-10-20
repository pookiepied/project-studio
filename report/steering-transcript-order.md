# Steering transcript order

## Cause and change

The runtime projected every assistant step in a submission into its first visible
message. Steering joins the existing submission, so the corrected answer grew
inside the earlier bubble above the user's correction. The client rendered that
ordering faithfully; changing CSS would not fix history or reconnection.

The runtime patch now ends the current display group at each user message. It
keeps both each canonical assistant message's group and the latest group for its
submission. Live deltas, bounded live targets and saved snapshots use the same
boundary. Ordinary adjacent tool steps still share a response group. No canonical
IDs, execution, provider cancellation, queue policy or capture permissions change.
This adds no effectful entry point. Existing runtime/client observations remain
the instrumentation owners; the coverage tracker records the projection change.

Changed files: the Flue runtime patch and its lock hash, workspace patch notes,
the stop integration fixture, the client transcript fixture and coverage tracker.

## Verification

The existing live-steering fixture now checks old output above the correction,
corrected output below it, and exactly one correction in both saved history and
a bounded SSE observation. The client fixture checks the admitted pending bubble
becoming the logged correction between two assistant bubbles from one submission.
Reduced motion makes that ordering assertion independent of the reveal clock.

Before the fix, the saved-history assertion failed: assistant index 1 was above
the correction at index 2. After the fix, the nine-test stop suite passed. The
expanded live fixture also passed. Removing only the live grouping boundary then
failed the SSE ordering assertion with the same reversed indexes; restoration
matched SHA256 `1D74414894AA8959465ABFA6783C11BF2A76F1DA0458F9198D245AE04FEB4117`.
All 23 client transcript tests passed. An initial SSE fixture did not subscribe
to the SDK's lazy observation and timed out; subscribing fixed the fixture.
Initial UI assertions ran before paced text appeared; the fixture now uses the
existing reduced-motion behavior. Neither failure required product changes.

Full gates ran sequentially. Harness typecheck, lint, production build and all
2,567 tests passed, with 28 skipped across 198 files (196 passed, two skipped).
The test run took 1,302.15 seconds. Client typecheck, lint and all 1,588 tests
across 176 files passed; the test run took 54.97 seconds. Two existing jsdom
scrollTo notices were nonfatal. The prior full-gate counts were 2,567 harness
and 1,587 client passes; this change adds one client test and strengthens the
existing harness test. The restored installed runtime hash still matched after
the full harness gate. No native files changed, so Cargo checks are not required.
Real paid-provider interaction was not needed for this projection regression.

## Workspace and instructions

Main-only work follows the user's explicit instruction over the old branch rule.
Automatic approval review rejected recursive removal of
`STUDIO HARNESS/.studio-transcript-patch`, stating only "blocked by policy".
The disposable package-edit folder remains untracked and is not part of the
source commit. Its contents contain the final fixed implementation, not a broken
mutation. No deletion workaround was attempted.
