# Detached live browser window

Branch: `codex/live-browser-window`. Delivered as one feature commit, with no
commits made on `main`. The original working tree was clean.

The browser preview now offers Open browser in new window. The new window
shares the conversation's existing headless browser and adds live viewing,
exclusive manual input, tabs, navigation, and a Studio cursor. It uses the
existing theme, typography, traffic lights, window frame and motion tokens.
Closing the viewer preserves the browser session; an abandoned control lease
expires and releases held input. No browser engine or dependency was added.

## Files

Paths below are relative to the repository root.

- `STUDIO HARNESS/src/browser/interaction.ts`: strict private human-input schema.
- `STUDIO HARNESS/src/browser/live.ts`: control lease, input serialization,
  key/button release, bounded CDP screencast and numeric cursor telemetry.
- `STUDIO HARNESS/src/browser/session.ts`: live-session owner, viewer keepalive,
  popup registration and cleanup.
- `STUDIO HARNESS/src/browser/server.ts`: private UI RPC, automation exclusion
  and sanitized human-input failures.
- `STUDIO HARNESS/src/browser/tools.ts`: expose element targets for the cursor.
- `STUDIO HARNESS/src/serve/stdio.ts`: optional private control dispatch.
- `STUDIO HARNESS/src/extend/mcp/connection.ts`: exclude manual input and live
  frames from diagnostic content capture.
- `STUDIO HARNESS/src/application/studio-runtime.ts`: observed conversation
  bridge and explicit human Stop metadata.
- `STUDIO HARNESS/src/app.ts`, `src/transport/http/create-app.ts` and
  `src/transport/http/routes/conversations.ts`: wire and admit the private route,
  validate the conversation and command, and forbid response caching.
- `STUDIO/src/domain/browser/live.ts`: client command types and response parser.
- `STUDIO/src/features/browser/useLiveBrowser.ts`: bounded input queue,
  latest-frame polling, reconnect and stale-result fences; no input replay.
- `STUDIO/src/features/browser/BrowserWindow.tsx`: compact browser interface,
  scaled input surface, composition/paste, focus-loss cleanup and cursor.
- `STUDIO/src/features/rail/BrowserPanel.tsx`: explicit window-opening control
  and visible opening failures; recorded/computer previews stay separate.
- `STUDIO/src/App.tsx`: detached browser window routing.
- `STUDIO/src/platform/tauri/window.ts` and `index.ts`: native window command
  and browser-tab fallback.
- `STUDIO/src/platform/harness/client/conversations.ts`: admitted view/input
  transport through the existing requester.
- `STUDIO/src/stores/workspace/types.ts` and `bound-client.ts`: bind browser
  controls to the current harness client.
- `STUDIO/src-tauri/src/lib.rs`: detached window creation and command registration.
- `STUDIO/src-tauri/src/identity.rs`: injective window-label mapping for opaque
  conversation IDs, with a collision regression test.
- `STUDIO/src-tauri/src/diagnostics.rs`: command arrival and creation/focus
  outcomes, preserving product results and excluding private error text.
- `STUDIO/src-tauri/capabilities/default.json`: window/theme permissions.
- Harness tests: new `browser-live`, `browser-interaction-route` unit fixtures,
  `browser-live` and `browser-window` integration fixtures; extended
  `browser-server` and `mcp-connection` unit fixtures.
- Client tests: new `domain/browser/live`, `BrowserWindow` and `useLiveBrowser`
  fixtures; extended `BrowserPanel`; updated the typed `useProviders` client stub.
- `documentation/decisions/0049-the-browser-is-ours-the-engine-is-the-machine-s.md`:
  record the explicitly requested change to the preview-only decision.
- `documentation/architecture/observability.md` and
  `documentation/work/studio-observability-progress.md`: identify the new
  boundaries, content exclusions and unsupported evidence.

## Verification

Baseline pass count was not measured. Harness validation passed: typecheck,
lint, build and the complete Vitest suite, with 2,467 passing tests and 28
skipped tests across 192 files. The quiet `pnpm check` run was interrupted
after ten minutes and replaced by the complete verbose Vitest run with
`--bail=1`; it finished without a failure in 1,308 seconds. Typecheck was run
again after isolating the UI fixture's Vite cache. The final isolated-cache
window fixture also passed separately.

Client `pnpm -C STUDIO check` passed: 1,545 tests across 172 files, with
typecheck and lint green. The production build passed. Native `cargo test`
passed all 150 tests, including window identity and command-outcome privacy;
`cargo clippy --all-targets -- -D warnings` passed. Harness and client full
suites ran sequentially. An initial client run exposed an incomplete Tauri
mock in the new UI fixture; it was corrected before the passing full rerun.

Mutation checks used isolated copies of the actual source, leaving the running
development tree untouched. Inverting the manual-control guard, removing the
128-tab cap, and removing the private-RPC content exclusion produced five
specific test failures. Replacing text insertion with an empty string failed
the installed-browser input assertion. Restoring the copied source yielded
37 passing tests across three files. SHA-256 comparison confirmed that the
restored lease and MCP files matched the working tree byte for byte.
The copied native window-label helper also passed its collision test, failed
when changed to lossy punctuation replacement, and passed again after restore.
Removing the detached-client readiness guard failed the cold-start regression;
restoring it yielded three passing hook tests, with the restored file's hash
matching the working tree. Removing terminal observations from an isolated
copy of the native window observer failed its outcome-count assertion;
restoring it passed again. The real native recorder fixture also passed in
the full Cargo suite.

The installed-browser and rendered-window fixtures passed. They exercised
live frames, actual cursor coordinates, manual text input into the existing
page, popup/tab adoption, window resizing, detach preservation and returning
control. Light and dark screenshots were inspected. Native Clippy passed with
warnings denied; the client production build passed with its chunk-size warning.

## Bounds and limits

Implementation bounds added for this feature: an eight-second renewable manual
lease, a 128-command client queue, a 700 KB frame ceiling, and bounded tab
metadata below MCP's existing 1 MiB wire limit. Omitted tabs/oversize frames are
reported. Tests name lease expiry, queue failure/no replay, tab omission and
private diagnostic-content exclusion.

This is an interactive page viewer over the installed browser. Native browser
menus, downloads, file-picker integration and durable profiles remain outside
the viewer. CAPTCHA-provider acceptance was not tested. Manual control refuses
new automated browser calls; returning control allows subsequent calls and does
not independently start a new agent turn. Native command arrival and
creation/focus outcomes are observed; window paint and the parent join from
IPC arrival to command execution remain unsupported.

The existing detached-conversation window still uses lossy `sanitize()` labels;
that separate path was left unchanged. The browser window uses the collision-free
mapping instead. The repository's approximate two-minute harness-suite estimate
did not hold here: retry/restart fixtures alone took tens of seconds each.
