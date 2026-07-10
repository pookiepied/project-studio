# Frontend Loop Engineer - Frontend / Runtime Boundary

Status: First-pass boundary audit recorded on 2026-07-10.

## Current Boundary

The app has three native/runtime-adjacent areas:

- `src/runtime`: local runtime, MCP invocation, local server lifecycle, tool
  execution, WebSocket transport, runtime UI cards.
- `src/core/platform`: environment, autostart, feature manager, shortcuts,
  overlay, pulse coordinator, studio paths, tray service.
- `src/core/daemon`: daemon client and hook.

This is a good base.

## Boundary Leaks Found

Direct `@tauri-apps/*` imports are still present in app, UI, and feature code.
Some are acceptable service boundaries; others should be wrapped.

High-priority UI/component imports:

- `src/app/App.tsx`
- `src/app/routes/OverlayPage.tsx`
- `src/app/routes/ShaderWelcomePage.tsx`
- `src/ui/layout/TitleBar.tsx`
- `src/ui/primitives/ExternalLink.tsx`
- `src/features/chat/components/ProjectContextPicker.tsx`
- `src/features/workspace/terminal/TerminalPanel.tsx`

Service-layer imports that can remain but should be named as native adapters:

- `src/features/auth/services/tauriOAuth.ts`
- `src/features/chat/conversations/storage/localConversationStore.ts`
- `src/features/chat/conversations/claude/*`
- `src/features/transcription/services/fasterWhisper/*`
- `src/features/workspace/browser/nativeBrowserService.ts`
- `src/features/workspace/rightWorkspace/projectAppsShell.ts`
- `src/runtime/**`
- `src/core/platform/**`

## Target Boundary

Component code calls typed adapters:

```txt
core/platform/windowService.ts
core/platform/externalLinkService.ts
core/platform/dialogService.ts
core/platform/filesystemService.ts
core/platform/clipboardService.ts
runtime/terminal/terminalSessionService.ts
features/chat/projectContext/projectContextFileService.ts
```

Only those adapters import Tauri packages directly.

## First Runtime Boundary Loop

Start with small wrappers:

1. External link opening from `ui/primitives/ExternalLink.tsx`.
2. Window controls from `ui/layout/TitleBar.tsx` and
   `app/shell/WindowTrafficLights.tsx`.
3. Project context dialog/fs calls from `ProjectContextPicker.tsx`.
4. Terminal Tauri event/invoke calls after terminal behavior is covered by manual
   verification.
