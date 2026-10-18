# Browser window reliability and shared appearance

Branch: `codex/live-browser-window`. This correction continues the detached
browser implementation already committed on this branch. No commit on `main`.

The viewer no longer waits for workspace index/catalog hydration. It resolves
the existing Harness transport itself, shows bounded startup/read recovery, and
never repeats uncertain input. Rejected navigation remains an input error rather
than disconnecting the live page. Recovery resets held input after queued input
was discarded. Pending senders are scoped to their connection epoch. Scroll
events coalesce within the same tab without crossing subsequent clicks.

Page titles refresh in the background, at most once per second and with one
evaluation pending per listed page. A title waiting on navigation cannot block
frames. Captured frame metadata supplies dimensions, avoiding the viewport
resize race. Small viewports fit without enlargement. Active human control polls
every 40ms plus request duration; this is still a streamed browser surface, with
HTTP/MCP input latency, rather than a native embedded Chromium tab.

All AppearanceProviders subscribe to the shared native preference key, or browser
storage events. Subscription precedes a catch-up read; a newer event outranks that
snapshot. Remote changes never persist again. Reset propagates the absence of a
preference, and unmount disposes the subscription. No native command, dependency,
engine bundle, user profile, or capture-policy change was added.

Files:

- `STUDIO HARNESS/src/browser/live.ts`: nonblocking bounded title cache and
  capture-owned frame dimensions.
- `STUDIO HARNESS/tests/integration/browser-live.test.ts`: actual installed
  browser regressions for mismatched viewport/frame dimensions and a title
  evaluation that never resolves.
- `STUDIO HARNESS/tests/integration/browser-window.test.ts`: startup temporarily
  has no address, native-window-sized viewport, frame aspect ratio, existing
  shared input/control flow.
- `STUDIO/src/features/browser/useLiveBrowser.ts`: independent connection,
  bounded read recovery, separate input failures, reset, queue coalescing and
  sender epochs.
- `STUDIO/src/features/browser/BrowserWindow.tsx`: recovery status, input-error
  notice, input gating and no artificial image enlargement.
- Browser hook/window tests: startup, bounded failure, uncertain input without
  replay, scroll ordering, replaced sender and fit regressions.
- `STUDIO/src/platform/store.ts`: key subscription with ordered catch-up.
- `STUDIO/src/design/theme/appearance.ts` and `AppearanceProvider.tsx`: shared
  preference reception and local-only persistence. The passive recorder emits
  `client.window` / `appearance_received` without preference values.
- `AppearanceProvider.test.tsx`: native updates/reset/unsubscribe, persistence
  without echoes, stale snapshot suppression and browser storage updates.
- Observability contract/inventory and retry map: corrected boundary coverage
  and the viewer's sole read-recovery authority.

Verification:

- The previous commit recorded 2,467 Harness tests passed / 28 skipped and
  1,545 client tests passed. A fresh full pre-change baseline was not measured.
- Focused current client tests: 22 passed, including the original behavior.
- Isolated negative controls used copies under `%TEMP%`, never live source.
  Removing startup retries, wheel merging, sender epoch isolation and fit's
  scale cap made their regressions fail. Making received preferences persist
  caused three theme regressions to fail. Separately removing the snapshot
  freshness guard failed its exact regression. Reverting frame dimensions to
  the current viewport failed the real-browser frame test; awaiting the title
  failed with `blocked` instead of `frame`. Restored copies passed 22 client
  tests and the installed-browser fixture.
- Initial full client checkpoint passed typecheck, lint and 1,552 tests. Final
  client check passed typecheck, lint and all 1,556 tests across 173 files,
  including the subsequent recovery/snapshot regressions. Harness typecheck,
  lint and build passed. The completed full Harness run passed 2,465 tests,
  skipped 28, and failed two teardown hooks with Windows `EBUSY` on the same
  temporary job workspace. No assertion failed. The complete, unmodified
  observability file then passed all eight tests on rerun. The full gate still
  returned nonzero; the isolated rerun is not a clean full-suite readiness gate.
- Client production build passed with Vite's large-chunk warning. The real
  browser-window fixture passed again; its 1120-by-800 light and dark renders
  were inspected for page size, aspect ratio and existing minimal chrome.
- The first long-running session and its temporary logs disappeared before
  continuation. Its completion was not assumed: the Harness gate was rerun in
  full, taking 1,303 seconds. Retained logs are under each product's ignored
  `node_modules/.cache/`: `studio-browser-fixes-harness-final.log`,
  `studio-browser-fixes-observability-rerun.log`, `studio-browser-fixes-visual.log`
  and the client's `studio-browser-fixes-build.log`. The earlier successful
  client-check and mutation results were observed before temporary cleanup;
  their old temporary log files are no longer present.

No unsolicited product rule was added. Bounded reads and input reset address the
reported recovery problem; the retry budget is visible and inputs are not retried.
Native desktop behavior was not manually reproduced through Inspector. Initially
its status endpoint failed. A later read answered with `feed_unavailable`, a
source gap and old receipts, so it supplied no current window evidence. The user
reports refresh restores
the window; the tests reproduce unavailable startup and blocked title delivery,
but do not establish which occurred in that particular running window.

The old unrelated conversation-window lossy label sanitizer remains out of scope.
The house rules' approximately two-minute Harness gate estimate does not match
the prior approximately 22-minute full run on this machine. Root AGENTS requires
the contract/inventory updates despite the older house-rule restriction on docs.
