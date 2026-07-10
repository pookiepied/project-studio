# Full Frontend Organization Pass

Date: 2026-07-10

## Scope

This pass completed the folder/category organization phase. It intentionally did not remove dead code, rename every inconsistent symbol, or replace raw buttons. Those are next phases.

## Completed Organization

### App ownership

Moved app-aware UI out of `ui`:

- `MainLayout`, `TitleBar`, `NavPopup`, `AccountMenu`, `NotificationBell` -> `src/app/shell/`
- `CommandPalette` -> `src/app/command-palette/`
- `OfflineModal`, `UpdateBanner`, `ContextMenu` -> `src/app/globals/`

Result: `ui` no longer imports from `app` or `features`.

### Shared/core boundaries

Moved shared domain contracts below feature code:

- `core/models/`
  - `types.ts`
  - `modelCapabilityService.ts`
  - `modelIdMigration.ts`
- `core/attachments/types.ts`
- `core/conversations/types.ts`
- `core/cache/appIconCache.ts`
- `core/platform/voiceCaptionTypes.ts`

Moved feature-owned behavior out of `core`:

- `chatHistoryService` -> `features/chat/conversations/chatHistoryService.ts`
- `useDaemon` -> `features/models/hooks/useLocalProviderDaemon.ts`

Result: ESLint architecture rule reports zero restricted imports.

### Feature page structure

Moved feature page entrypoints into `pages/`:

- `features/activity/pages/ActivityPage.tsx`
- `features/chat/pages/ChatPage.tsx`
- `features/computerUse/pages/ComputerUsePage.tsx`
- `features/extensions/pages/ExtensionsPage.tsx`
- `features/manage/pages/ManagePage.tsx`
- `features/memories/pages/MemoriesPage.tsx`
- `features/settings/pages/SettingsPage.tsx`
- `features/transcription/pages/TranscribePage.tsx`
- `features/voice/pages/VoicePage.tsx`
- `features/workspace/pages/WorkspacePage.tsx`

Feature barrels were updated to keep app imports stable.

### Markdown feature structure

Moved markdown root render components into `components/`:

- `CodeBlock`
- `MarkdownComponents`
- `MermaidDiagram`

Result: markdown feature root now exposes through `index.ts`, while renderer/component internals live under subfolders.

### Removed empty/general buckets

Removed stale empty/general folders:

- `src/ui/overlays`
- `src/ui/layout`
- `src/ui/notifications`

## Validation

- `npm run build`: passing.
- `npx eslint . --format json`: still fails overall, but architecture violations are clean.

Final lint summary:

- Total messages: 280
- `no-restricted-imports`: 0
- Remaining:
  - 257 design-system raw button / raw motion button violations
  - 23 fast-refresh mixed-export warnings

## Intentional Next Phases

1. Dead/stale code and asset removal.
2. Naming consistency and duplicate naming cleanup.
3. Monolith breakdown and inline extraction.
4. Design-system fixes for raw buttons and motion buttons.
5. Behavioral fixes surfaced by the cleaned structure.
