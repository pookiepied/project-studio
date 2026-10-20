# Live steering, Stop and composer follow-up

2026-10-20. Work stays on main under the user's instruction.

## Problem and change

The previous UI fix promoted the queued message and recovered its transcript
reader, but the runtime only joined that correction at a turn boundary. A long
provider response therefore kept following the old request. The old integration
tests proved history ordering and settlement, not prompt interruption.

The pinned Flue patch now checks scheduling metadata every 100ms only while a
top-level model request runs. Explicit steering cancels that request through a
separate AbortController. The existing durable join appends the correction once;
context is rebuilt without the aborted assistant attempt, then the same host
submission continues. Ordinary queued messages keep their separate turns. No
running tool is cancelled or automatically replayed by steering. Stop and the
original submission deadline take precedence. Poll failures propagate rather
than being reported as successful steering. The timer is disposed on stream result.

The check binds the running host submission, attempt, session and agent, respects
unready/aborted queue prefixes, and reads no image payloads. No dependency version
changed; pnpm regenerated the existing patch hash. Runtime logs expose only
`steering_requested` and `steering_context_ready` as operational stages. Neither
stage claims the model consumed the correction; the next request and settlement
provide that evidence. Content capture remains off unless separately enabled.

The composer has one action slot. During a run it shows Stop for an empty draft
and Send for a sendable draft; sending queues it. A full queue preserves the draft
and disables sending. The current cap is three waiting messages, plus the running
submission. Existing queue controls promote, edit or remove a waiting message.
Voice controls retain their positions. Chat Stop and the desktop pill now use the
same computer cleanup callback; cancelling the model alone cannot stop input
already sent to the separate MCP process.

## Stop policy

| Work | Steering | Stop |
|---|---|---|
| Active model request | Request cancellation, then continue with the correction | Request cancellation and abort the host/queued submissions |
| Active tool batch | Wait for its boundary; do not abort or replay tools | Propagate cancellation; each tool owns cleanup and reports uncertain outcomes |
| Native computer call | Complete the current call, then join the correction | Refuse new input, allow the current request its remaining deadline, release held input on driver exit |
| Hung computer driver | No automatic replay | Bounded force-stop fallback; report unconfirmed cleanup and retain ownership until exit |
| Detached background job | Existing job behavior | Existing explicit job-stop control remains available |

Computer shutdown previously could kill a healthy call after two seconds. It now
uses that request's existing deadline plus a two-second exit margin. Stop no
longer appends release-button calls before fencing new work; the driver's finally
block releases all tracked held input. A nonzero exit or force-stop returns an
error result instead of claiming cleanup succeeded. Completion of a cancelled
external side effect is never assumed, and uncertain actions are not retried.
This is cooperative cancellation, not a transaction or a promise to undo effects.

## Computer activity and cursor

The existing native hook reports bounded mouse movement/button/wheel and
keyboard event counts. It reads flags, never virtual-key values, scan codes or
typed text. Reports include the latest cursor/display and target/foreground
window state when available, expire stale UI refs and travel with the originating
tool result, including failures. Mouse movement does not wake an idle model or
interrupt its stream. These are activity summaries, not a keyboard transcript.

The desktop marker now uses the browser arrow geometry and a custom rounded
Studio badge, painted without a native tooltip. Badge placement adapts at screen
edges while retaining the pointer hotspot. It remains click-through and
nonactivating and does not replace the global OS cursor. Its shipped renderer
was rendered offscreen and visually inspected. Physical hook delivery, real
overlay focus, secure/elevated desktops and multiple monitors remain unverified;
automated tests cannot establish that there are no blind spots.

## Verification

- Before the runtime change, the streamed-steering reproduction failed its
  five-second completion check while the obsolete paced output continued.
- After the fix, promotion changes the actual answer before the old response
  finishes, preserves an earlier queued follow-up, joins the correction once,
  retains host identity and emits content-free diagnostics.
- Other-conversation steering leaves ordinary queued work and its full original
  response untouched. Stop during a correction continuation aborts both receipts
  without reviving the response.
- Six SQLite tests exercise the actual patched store: metadata-only reads,
  no claiming, session/attempt binding, blocking queue prefixes and storage errors.
- Real JSON-lines child fixtures exercise orderly native-call draining, queued
  input refusal and the forced-exit fallback without desktop input. Reinstating
  the two-second kill made the drain test fail; restoration passed.
- Existing native privacy, driver, observation, server and bounds tests passed
  (74 tests before the extra drain regressions). Composer/indicator tests passed
  (41 tests). Full sequential gates are pending below.

The existing composer regression now expects one action button to change from
Stop to Queue message. It retains the stable button-count, Enter/click queue,
draft refusal and working Stop assertions; its earlier two-button expectation
changed because the user explicitly requested one slot. No unrequested product
policy or dependency was added. The previous recorded full client gate passed
1,576 tests. The previous harness gate had 2,547 passes, 28 skips and one browser
fixture failure; its isolated rerun passed. No fresh full baseline was run before
this fix. The new streaming reproduction was run against the old runtime and failed.

## Hands-on checks after restarting

1. During a long answer, queue a correction and choose Steer now. The obsolete
   stream should end promptly and the same run should answer the correction.
2. Leave the composer empty during a run: only Stop occupies its action slot.
   Type a draft: Send replaces it. Send three follow-ups; a fourth stays in the
   field until a queued slot becomes available.
3. During computer use, move the physical mouse and type a harmless test word.
   The next tool result should report counts and the latest cursor position,
   without reporting that word through the keyboard activity summary. Screenshots
   and explicit UI-reading tools remain separate ways to read visible screen content.
4. Check the custom arrow and Studio badge near each display edge. It should
   follow agent input, hide on human input and never capture clicks or steal focus.
5. Stop during a native action: no queued action should follow it. The current
   call should finish within its remaining deadline, then release held input and
   exit. An unconfirmed shutdown must not be treated as successful cleanup.

One isolation fixture initially timed out because its normal paced response took
longer than the test budget; shortening only that fixture preserved the full-output
assertion. A draft wedged-child double exited when stdin closed because its timer
was unreferenced; keeping that timer alive exercised the real fallback. One early
full gate was deliberately stopped during review to add the safer native drain;
it is not counted as passing. No existing production deadline was relaxed.

Providers must honor AbortSignal for prompt interruption. Already-streamed text
remains visible in history. Custom submission stores without the metadata peek
keep the earlier turn-boundary behavior. Restart the running harness after loading
this build; rebuilding files alone does not replace code in an existing process.

## Final checks

The full harness check passed typecheck, lint, build and 2,561 tests, with 28
skips across 198 files (196 passed, two skipped). Its test run took 1,332 seconds.
The client production build passed; its existing bundle-size warning remains.
The subsequent full client check passed typecheck, lint and all 1,579 tests across
174 files; its test run took 59 seconds. Two existing jsdom scrollTo messages were
nonfatal. The suites ran sequentially. No source changed after these gates except
temporary, hash-verified mutation controls that were fully restored.

Additional mutation controls failed as expected: removing session/prefix guards
and reading full payloads failed five store assertions; accepting ordinary queues
and stale attempts failed two more. An invisible arrow failed the shipped-renderer
check, and restoring a duplicate Stop control failed the composer regression.
After restoration, all 15 store/activity tests passed. SHA-256 checks confirmed
the installed vendor store, store test, activity source and composer matched
their pre-mutation bytes. A preliminary attempt to run a disposable package copy
could not resolve its dependencies; that setup failure is not counted as mutation
evidence. No change to the saved patch or lockfile came from these controls.

Automatic approval review blocked both recursive removal of the ignored pnpm
patch-work folder and nonrecursive removal of its temporary dependency junction,
stating only "blocked by policy." The package copy was restored to the final
implementation. This ignored cache and dependency link remain outside the source
commit; no broken mutation remains. No Tauri/Rust host file changed, so Cargo
checks were not required. Main-only work follows the user's explicit instruction,
overriding the old branch prohibition in documentation/rules.md.
