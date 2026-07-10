# Frontend Loop Engineer - Current State Audit

Status: First-pass audit complete on 2026-07-10.

Scope: `STUDIO` frontend, including `src`, `web`, frontend build config,
Tauri-facing frontend integration files, package/dependency setup, scripts, and
existing frontend task documentation. This pass intentionally did not refactor
source code; it creates the source of truth required before later loops.

## Executive Summary

The frontend is no longer an unorganized flat app. It already has a recognizable
domain split:

- `src/app` owns shell, routes, providers, global event handlers, and startup UI.
- `src/features` owns product domains such as chat, workspace, settings, models,
  extensions, voice, transcription, activity, memories, and permissions.
- `src/core` owns storage, network, logging, errors, platform services,
  notifications, permissions, daemon, config, and skills.
- `src/runtime` owns local agent/runtime transport, tool display, execution, and
  local server lifecycle.
- `src/ui` owns reusable primitives, layout, feedback, overlays, icons, brand,
  and notifications.
- `src/design` owns typography and semantic design tokens.
- `src/lib` remains a mixed shared bucket used across core, app, runtime, and
  features.

Build health is good: `npm run build` completed successfully. Lint health is not
good: `npm run lint` fails with the repository's own design-system guardrail
because raw `<button>` usage is still widespread, including inside primitives.

## Inventory

- Source files inspected by static tree and targeted reads: 453 files under
  `STUDIO/src`.
- File mix: 261 `.ts`, 186 `.tsx`, 4 `.css`, 1 `.md`, 1 `.png`.
- Top feature by file count: `features/chat` with 90 files.
- Other large domains: `features/models` 24, `features/workspace` 21,
  `features/extensions` 17, `features/settings` 15.
- Largest source files by size:
  - `src/features/workspace/WorkspacePage.tsx` (~48 KB)
  - `src/features/chat/context/ChatProvider.tsx` (~44 KB)
  - `src/features/chat/ChatPage.tsx` (~42 KB)
  - `src/features/activity/ActivityPage.tsx` (~31 KB)
  - `src/features/voice/hooks/useAudioRecorder.ts` (~28 KB)
  - `src/features/chat/context/useSendPipeline.ts` (~25 KB)
  - `src/features/chat/components/ProjectContextPicker.tsx` (~23 KB)
  - `src/features/settings/components/SettingsDebugPanel.tsx` (~23 KB)

These large files are not automatically wrong, but they are the highest-risk
places for follow-up loops because they mix UI composition, state, event
handling, service calls, and presentation details.

## Current Architecture

The current architecture is partially aligned with the intended target. The
`app`, `features`, `core`, `runtime`, `design`, and `ui` split is a strong base.
Several folders have ring-leader files such as `features/chat/index.ts`,
`features/settings/index.ts`, `features/workspace/index.ts`, `runtime/index.ts`,
and `core/connection/index.ts`.

The main gap is boundary clarity:

- `src/lib` is still a shared catch-all. It contains API clients, token storage,
  token estimation, response parsing, project context helpers, prompt helpers,
  theme helpers, hooks, formatters, and artifact parsing.
- Some feature and UI code import Tauri APIs directly, especially auth,
  workspace, terminal, browser, chat project context, transcription services,
  global shortcuts, and overlay flows.
- Some app-shell startup work lives directly in `App.tsx` instead of a dedicated
  boot owner.
- Shared UI and feature UI still use raw buttons despite enforced lint rules.

## Validation Snapshot

- `npm run build`: PASS. Runs `tsc && vite build`.
- `npm run lint`: FAIL. 232 errors and 23 warnings, primarily
  `DS: use <Button>/<IconButton> from @/ui/primitives instead of a raw <button>`.
- No test script exists in `STUDIO/package.json`.
- No dedicated `typecheck` script exists; `npm run build` covers `tsc`.

## Key Findings

### A. Project Config

The project uses Vite 6, React 19, TypeScript strict mode, Tailwind 3, ESLint 9
flat config, and Tauri 2. Desktop and web builds are split between
`vite.config.ts` and `vite.config.web.ts`. `@/*` maps to `src/*` in TypeScript
and both Vite configs.

Risk: `tsconfig.node.json` includes only `vite.config.ts`, not
`vite.config.web.ts`, even though the web config is TypeScript and imports Node
APIs.

### B. App Startup

`src/main.tsx` handles early theme/shell class setup, blocks desktop reload
shortcuts, installs global error listeners, and mounts React.

`src/app/App.tsx` handles overlay/splash routing, secure storage init, global
error handler init, storage init, theme/auth/offline delays, bundled skill
deployment, app-ready focus signaling, and splash timing.

Risk: startup is understandable but too centralized in `App.tsx`. It should move
to `app/boot` or an equivalent owner so steps, fatal/non-fatal behavior, and
typed status are reusable and testable.

### C. Routing / Pages

Routing is intentionally simple and custom: `AppRouter` gates OAuth callback,
auth loading, API config checking, web/desktop auth state, and the runtime
permission modal.

Risk: route state depends directly on `window.location.pathname`, global
connection events, auth context, API config, environment service, and runtime
init in one component. This is acceptable short-term but should be separated
into route detection and route rendering helpers.

### D. Design System

Design tokens are already substantial. `src/design/tokens.css`,
`src/design/typography.css`, `tailwind.config.js`, and primitives in `src/ui`
form a real design-system base.

Problems:

- Lint proves raw `<button>` usage is still widespread.
- Hardcoded hex values remain in carved-out places such as branded icons,
  terminal color themes, charts, Mermaid, graph rendering, Claude accent
  styling, extension cards, and workspace app colors.
- Some raw color values are intentional third-party or brand carve-outs, but the
  carve-outs should be formalized next to code or in one registry.
- `src/index.css` is still a large global CSS file owning both base styles and
  markdown/prose/syntax behavior.

### E. Error / Logging

There is already a central logger (`core/logging/logger.ts`) and error service
(`core/errors/errorService.ts`). `ui/ErrorBoundary.tsx` catches React boundary
errors and reports them.

Problems:

- `App.tsx` displays raw initialization error text directly to users.
- `ErrorBoundary` displays `error.message` in the UI chip.
- `alert(...)` is still used in settings debug, attachment handling, and project
  creation flows.
- Direct `console.*` remains in app shell, overlay, model status, project
  launcher, file logger internals, and error notification output.

### F. Frontend / Runtime Boundary

There is a `runtime` layer, plus `core/platform` and `core/daemon`. That is good.
However, direct Tauri usage still appears in app, UI, and feature files:

- `app/App.tsx`, `app/routes/OverlayPage.tsx`, `app/routes/ShaderWelcomePage.tsx`
- `ui/layout/TitleBar.tsx`, `ui/primitives/ExternalLink.tsx`
- `features/auth/services/tauriOAuth.ts`
- `features/chat/components/ProjectContextPicker.tsx`
- `features/chat/conversations/*`
- `features/transcription/services/fasterWhisper/*`
- `features/workspace/browser/*`, `features/workspace/terminal/TerminalPanel.tsx`
- `features/workspace/rightWorkspace/projectAppsShell.ts`

Some of these are service files and can stay runtime-adjacent, but UI components
should call typed adapters rather than Tauri APIs directly.

### G. Dependency / Plugin Setup

All major runtime dependencies have observed import usage except packages that
are build/tooling-only or need a deeper package-level confirmation:

- Active: React, React DOM, Framer Motion, Phosphor Icons, Sonner, Radix Select,
  Tauri API/plugins, Xterm, Cmdk, KaTeX, Mermaid, PDF.js, React Markdown,
  React Syntax Highlighter, Recharts, Simple Icons, Three,
  React Force Graph 3D, js-tiktoken.
- Web-font packages are imported by `web/web-main.tsx`; desktop loads fonts via
  links/CSS rather than package imports.
- Tooling active: Vite, TypeScript, ESLint, Tailwind, PostCSS, Autoprefixer,
  Tauri CLI.

No dependency was removed in this pass.

### H. Dead Code / Duplication

No file was proven dead enough to delete in the first pass. There are strong
signals for cleanup:

- Duplicate resize-panel mouse handling appears in artifact/workspace/right
  workspace/browser panels.
- Copy-to-clipboard behavior appears across markdown, artifacts, error boundary,
  context menu, transcribe, voice, and chat hooks.
- Local storage access is scattered across app shell, auth, models, chat,
  settings, workspace, and shell config.
- Runtime permission/tool display UI lives under `runtime/ui`, which may be
  acceptable but should be checked against the "runtime must not depend on UI"
  rule if shared with non-React runtime code.

## First Safe Refactor Direction

Start with behavior-neutral fixes that improve validation:

1. Make design-system primitives exempt from the raw-button lint rule, or update
   the lint selector to ignore `src/ui/primitives/*` and documented card-button
   carve-outs.
2. Convert app-shell raw buttons to `Button`/`IconButton`.
3. Normalize user-facing initialization and boundary errors through
   `errorService`.
4. Replace user-facing `alert(...)` in high-use flows with existing toast/error
   UI.
5. Extract boot sequence from `App.tsx` after validation is green enough to
   detect regressions.
