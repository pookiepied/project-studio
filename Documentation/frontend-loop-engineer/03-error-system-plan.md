# Frontend Loop Engineer - Error System Plan

Status: First-pass plan recorded on 2026-07-10.

## What Exists

- `src/core/errors/errorService.ts` categorizes errors and creates user-facing
  messages.
- `src/core/errors/errorReporting.ts` is used by `ErrorBoundary` and
  `errorService`.
- `src/core/errors/globalErrorHandler.ts` is initialized during app startup.
- `src/core/logging/logger.ts` is the central logger.
- `src/ui/ErrorBoundary.tsx` provides a React error boundary.
- `src/ui/feedback/ErrorDisplay.tsx` provides reusable feedback UI.

## Problems Found

- `src/app/App.tsx` creates a raw initialization error string and displays it.
- `src/ui/ErrorBoundary.tsx` displays `error.message` directly.
- `alert(...)` remains in:
  - `features/settings/components/SettingsDebugPanel.tsx`
  - `features/chat/hooks/useAttachments.ts`
  - `features/chat/components/ProjectContextPicker.tsx`
- Direct `console.*` remains in:
  - `app/shell/shellConfig.ts`
  - `app/routes/OverlayPage.tsx`
  - `features/models/components/LocalProviderStatus.tsx`
  - `features/workspace/rightWorkspace/ProjectLauncher.tsx`
  - `core/logging/fileLogger.ts`
  - `core/errors/errorNotificationService.ts`

## Target Flow

```txt
unknown caught value
  -> errorService.categorize()
  -> logger/reportError for technical detail
  -> userMessage for UI/toast
  -> optional technical copy hidden behind explicit diagnostics/debug affordance
```

## Required Follow-Up

1. Add a small `normalizeError` wrapper if `errorService.categorize()` is too
   API-specific for generic UI use.
2. Change initialization failures in `App.tsx` to store a categorized error.
3. Change `ErrorBoundary` to show a safe message by default. Keep copyable
   technical details only under an explicit developer/debug action.
4. Replace `alert(...)` with existing toast or inline error UI.
5. Replace non-internal `console.*` with `logger`.
6. Decide whether file logger internals are an accepted console carve-out.

## Validation

Run after each loop:

```bash
npm run build
npm run lint
```
