# Frontend Loop Engineer - Refactor Queue

Status: First-pass queue recorded on 2026-07-10.

## Loop 1 - Lint Guardrail Calibration

- Subsystem: Design system / lint config.
- Files involved: `eslint.config.js`, `src/ui/primitives/*`.
- Intended changes: adjust the raw-button restriction so primitive
  implementations are allowed to use native `<button>`. Add narrow carve-outs
  for documented card-as-button components only if necessary.
- Risk: Low.
- Validation: `npm run lint`, `npm run build`.

## Loop 1A - Move Misplaced UI/App Shell Files

- Subsystem: App shell / UI taxonomy.
- Files involved: `src/ui/layout/*`, `src/ui/primitives/*`, `src/app/routes/*`.
- Intended changes: move app-specific layout into `app/shell` or
  `app/navigation`; move chat/permission/markdown components out of
  `ui/primitives`; move feature pages out of `app/routes`.
- Source of truth: `13-structure-and-organization-audit.md`.
- Risk: Medium due import churn.
- Validation: `npm run build`, `npm run lint`, manual app navigation smoke test.

## Loop 1B - Native Adapter Boundary

- Subsystem: Runtime/native boundary.
- Files involved: app shell window controls, external link, project picker,
  terminal, Faster Whisper services, MCP server hooks.
- Intended changes: add typed native/platform adapters and remove direct Tauri
  imports from React UI.
- Source of truth: `13-structure-and-organization-audit.md`.
- Risk: Medium to high depending on terminal/project-picker scope.
- Validation: `npm run build`, manual Tauri smoke checks.

## Loop 1C - Empty `src/lib` By Ownership

- Subsystem: shared utilities/import graph.
- Files involved: `src/lib/**`, `src/core/network`, `src/core/auth`,
  feature-owned parser/helper files, `src/shared`.
- Intended changes: move each `lib` cluster to its real owner and update imports
  one cluster at a time.
- Source of truth: `13-structure-and-organization-audit.md`.
- Risk: Medium.
- Validation: `npm run build`, targeted feature smoke checks.

## Loop 1D - Split Feature Monoliths

- Subsystem: chat/workspace feature organization.
- Files involved: `features/chat/ChatPage.tsx`,
  `features/chat/context/ChatProvider.tsx`, `features/workspace/WorkspacePage.tsx`.
- Intended changes: extract render sections, hooks, constants, formatters, and
  native/service concerns without changing behavior.
- Source of truth: `13-structure-and-organization-audit.md`.
- Risk: High; do in small slices.
- Validation: `npm run build`, manual chat/workspace smoke checks.

## Loop 2 - App-Shell Button Cleanup

- Subsystem: App shell / routes / feedback.
- Files involved: `src/app/App.tsx`, `src/app/routes/*`,
  `src/ui/ErrorBoundary.tsx`, `src/ui/feedback/*`.
- Intended changes: replace simple raw buttons with `Button` or `IconButton`.
- Risk: Low to medium, mostly visual.
- Validation: `npm run lint`, `npm run build`, manual desktop/web smoke check.

## Loop 3 - Error Normalization

- Subsystem: Error system.
- Files involved: `src/app/App.tsx`, `src/ui/ErrorBoundary.tsx`,
  `src/ui/feedback/ErrorDisplay.tsx`, `src/core/errors/*`.
- Intended changes: use safe user-facing messages for init and boundary errors;
  keep technical details for logs/debug copy only.
- Risk: Medium because user-facing failure states are involved.
- Validation: `npm run build`, manual forced-error check.

## Loop 4 - Replace Alerts

- Subsystem: User-facing error UI.
- Files involved: `SettingsDebugPanel.tsx`, `useAttachments.ts`,
  `ProjectContextPicker.tsx`.
- Intended changes: replace `alert(...)` with toast or inline error display.
- Risk: Medium.
- Validation: `npm run build`, manual checks for settings export/reset,
  attachment validation, and project creation failure.

## Loop 5 - Boot Owner Extraction

- Subsystem: App startup.
- Files involved: `src/app/App.tsx`, new `src/app/boot/*`.
- Intended changes: move initialization steps into a typed boot sequence with
  fatal/non-fatal step handling.
- Risk: Medium to high due startup behavior.
- Validation: `npm run build`, desktop launch, web launch, overlay route,
  splash preview route.

## Loop 6 - Runtime Boundary Wrappers

- Subsystem: Frontend/runtime boundary.
- Files involved: `ExternalLink.tsx`, `TitleBar.tsx`,
  `WindowTrafficLights.tsx`, `ProjectContextPicker.tsx`,
  `TerminalPanel.tsx`, new or existing `core/platform/*` services.
- Intended changes: wrap Tauri calls behind typed services.
- Risk: Medium.
- Validation: `npm run build`, manual checks for external links, window controls,
  project context folder creation, terminal open/close.

## Loop 7 - `src/lib` Classification

- Subsystem: Shared utilities.
- Files involved: `src/lib/**` and importing files.
- Intended changes: classify and move only one cluster at a time, starting with
  hooks or formatters.
- Risk: Medium because imports are broad.
- Validation: `npm run build`, targeted feature smoke checks.

## Loop 8 - Resize / Clipboard Duplication

- Subsystem: UI behavior utilities.
- Files involved: artifact/workspace panel components, markdown/artifact/chat
  copy handlers.
- Intended changes: extract repeated resize and copy behavior only after
  documenting behavior parity.
- Risk: Medium.
- Validation: `npm run build`, manual drag/copy checks.

## Loop 9 - Bundle Performance Review

- Subsystem: Build output.
- Files involved: Vite configs and high-weight markdown/mermaid/pdf/graph import
  points.
- Intended changes: fix mixed static/dynamic imports where valuable; consider
  lazy-loading heavy renderers for web.
- Risk: Medium.
- Validation: `npm run build`, compare chunk output.
