# Frontend Loop Engineer - Dead Code and Duplication Audit

Status: First-pass audit recorded on 2026-07-10.

## Deletion Status

No file was proven dead enough to delete in this pass. The audit intentionally
does not delete uncertain code.

## Duplication Signals

### Resize / Drag Panels

Mouse-driven resize logic appears in multiple panel components:

- `features/artifacts/ArtifactPanel.tsx`
- `features/workspace/browser/BrowserPanel.tsx`
- `features/workspace/rightWorkspace/WorkspacePlaceholderPanel.tsx`
- `features/workspace/rightWorkspace/WorkspaceHomePanel.tsx`
- `features/workspace/rightWorkspace/SideChatPanel.tsx`

Candidate extraction: `shared/hooks/useResizablePanel` or a local workspace
panel hook, depending on whether artifact panel needs the same behavior.

### Clipboard Copy

Clipboard writes appear across:

- `ui/ErrorBoundary.tsx`
- `ui/layout/ContextMenu.tsx`
- `features/artifacts/*`
- `features/markdown/*`
- `features/transcription/TranscribePage.tsx`
- `features/voice/hooks/useAudioRecorder.ts`
- `features/chat/hooks/useMessagePopups.ts`

Candidate extraction: typed `clipboardService` plus UI helper for copy state.

### Local Storage

Direct local storage access appears in app shell, auth, models, chat draft
persistence, workspace app selection, shell config, theme, settings, and route
pages.

Candidate extraction: keep feature-owned storage keys local, but route through a
small safe storage helper so unavailable storage and serialization failures are
handled uniformly.

### Error Display

Errors are displayed through a mix of alerts, toasts, inline text, and boundary
UI. See `03-error-system-plan.md`.

### Raw Button Baseline

Lint reports 232 design-system errors, almost all raw button usage. This is both
a design-system debt and a duplication signal: many components hand-roll button
states that should use primitives or documented carve-outs.

## Large File Candidates

Split only when doing a scoped loop:

- `features/workspace/WorkspacePage.tsx`
- `features/chat/context/ChatProvider.tsx`
- `features/chat/ChatPage.tsx`
- `features/activity/ActivityPage.tsx`
- `features/voice/hooks/useAudioRecorder.ts`
- `features/chat/context/useSendPipeline.ts`
- `features/chat/components/ProjectContextPicker.tsx`
- `features/settings/components/SettingsDebugPanel.tsx`

## Open Dead-Code Checks

Before deleting any file, search:

- static imports
- dynamic imports
- string references
- route references
- Tauri config/resource references
- web build references
- docs references
- tests/scripts references
