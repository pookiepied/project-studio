# Organization Implementation Log

Date: 2026-07-10

## Philosophy Applied

This pass followed the audit direction: clean ownership first, then fix behavior. Files were moved by category/subcategory ownership, keeping exports stable where possible so the pass stayed organizational rather than behavioral.

## Completed Moves

### UI primitives cleanup

Moved feature-specific components out of `src/ui/primitives`:

- `AskUserQuestionCard` -> `src/features/chat/components/AskUserQuestionCard.tsx`
- `ConnectionStatusBar` -> `src/features/chat/components/ConnectionStatusBar.tsx`
- `TodoWriteCard` -> `src/features/chat/components/TaskWriteCard.tsx`
- `HarnessPermissionModal` -> `src/features/permissions/components/LocalCapabilitiesModal.tsx`
- `StreamingText` -> `src/features/chat/components/StreamingMarkdown.tsx`
- `TokenRing` -> `src/features/chat/components/ContextTokenRing.tsx`
- `VideoPlayer` -> `src/features/markdown/components/VideoPlayer.tsx`
- `ExternalLink` -> `src/features/markdown/components/MarkdownExternalLink.tsx`
- `ClaudeCodeIcon` -> `src/ui/brand/ClaudeCodeIcon.tsx`
- `StudioIcon` -> `src/ui/brand/StudioIcon.tsx`

After this, `src/ui/primitives` contains only reusable control primitives such as `Button`, `IconButton`, `Input`, `Select`, `Toggle`, and related atoms.

### Overlay ownership cleanup

Removed the generic `src/ui/overlays` bucket:

- `CommandPalette` -> `src/app/command-palette/CommandPalette.tsx`
- `FloatingIsland`, `IslandAtoms`, `PulseCardView` -> `src/features/voice/overlay/`
- `GlobalAccessModal` -> `src/features/permissions/components/GlobalAccessModal.tsx`

This makes overlay ownership explicit: app shell, voice overlay, or permissions gate.

### App shell ownership cleanup

Moved navigation/account shell code out of presentational layout:

- `NavPopup` -> `src/app/shell/NavPopup.tsx`
- `AccountMenu` -> `src/app/shell/AccountMenu.tsx`

This removed the `ui/layout/AccountMenu.tsx` dependency on auth feature state.

### Shared cache cleanup

Moved app icon caching out of the extensions feature because it is consumed by shared brand UI:

- `src/features/extensions/services/appIconCache.ts` -> `src/core/cache/appIconCache.ts`

## Validation

- `npm run build`: passing after each move slice.
- `npx eslint . --format json`: still failing overall because the project has existing design-system raw button errors and deeper core/lib dependency inversions.

Latest lint snapshot:

- Total messages: 294
- Restricted import violations: 14

Remaining restricted import categories:

- `core/daemon/useDaemon.ts` imports app settings/hooks.
- `core/network/fallbackService.ts` imports model/chat feature services.
- `core/platform/overlayService.ts` imports voice hook types.
- `core/storage/chatHistoryService.ts` imports chat conversation adapters/storage.
- `core/storage/fileConfigService.ts` imports model service.
- `lib/modelUtils.ts` imports model services.

## Next Recommended Slice

Handle deeper dependency inversions before broad UI button cleanup:

1. Hoist model capability/model metadata helpers used by `core` and `lib` into a lower layer.
2. Split chat conversation storage/adapters so core storage does not import `features/chat`.
3. Move or type-only isolate voice overlay caption types used by `core/platform`.
4. Then start design-system replacement for raw `button` and `motion.button` usage feature-by-feature.
