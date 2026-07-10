# Frontend Loop Engineer - Target Architecture

Status: First-pass target recorded on 2026-07-10.

## Current Baseline

The current top-level split is close to the desired target:

```txt
src/
  app/
  core/
  design/
  features/
  lib/
  runtime/
  types/
  ui/
```

The next architecture pass should refine this structure rather than replace it.

## Target Shape

```txt
src/
  app/
    boot/
    contexts/
    globals/
    routes/
    shell/
    App.tsx
    AppProviders.tsx
    AppRouter.tsx
  core/
    config/
    errors/
    logging/
    network/
    notifications/
    permissions/
    platform/
    storage/
  design/
    tokens.css
    typography.css
    fonts.ts
  features/
    chat/
    workspace/
    settings/
    models/
    extensions/
    voice/
    transcription/
    activity/
    memories/
    permissions/
    auth/
    artifacts/
    markdown/
    manage/
    computerUse/
  runtime/
    capabilities/
    execution/
    invoke/
    servers/
    transport/
  ui/
    brand/
    feedback/
    icons/
    layout/
    notifications/
    overlays/
    primitives/
  shared/
    api/
    errors/
    hooks/
    storage/
    text/
    tokens/
    utils/
```

`shared/` is not a required immediate folder move. It is the intended
replacement for the current broad `lib/` bucket after imports are classified.

## Boot System Target

Move the startup sequence out of `App.tsx` into:

```txt
src/app/boot/
  index.ts
  boot-sequence.ts
  boot.types.ts
  boot.constants.ts
```

Current boot steps:

1. Overlay/splash mode detection.
2. Early theme and workspace shell class setup in `main.tsx`.
3. Desktop reload shortcut suppression.
4. Global error and unhandled-rejection listeners.
5. Tauri secure storage init.
6. Global error handler init.
7. Unified storage init.
8. Theme/auth/offline placeholder steps.
9. Bundled local skill deployment.
10. Desktop `app_ready` focus signal.
11. Splash minimum-duration handling.

Target: `App.tsx` should render based on typed boot state. The boot owner should
mark each step as fatal or non-fatal and return normalized errors.

## Runtime Boundary Target

Use `runtime` for local agent loop, MCP tool invocation, local server lifecycle,
and tool execution. Use `core/platform` for Tauri/native app services such as
window, updater, autostart, overlay, paths, tray, shortcuts, and environment.

UI and feature components should call typed service functions. They should not
import `@tauri-apps/*` directly unless the component itself is the thin native
host boundary and that carve-out is documented.

## Extension Rule

Future developers should add:

- new app-shell behavior under `app`.
- reusable visual controls under `ui`.
- product workflows under `features/<domain>`.
- native/platform adapters under `core/platform` or `runtime`.
- shared cross-feature non-visual logic under a classified shared area, not a
  generic catch-all.
