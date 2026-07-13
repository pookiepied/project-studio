# Task: Migrate Direct Phosphor Icon Imports to the Icon Barrel

## Project Context

You are working on **STUDIO**, a Tauri v2 + React + TypeScript desktop app at `C:\pookiepied\Project Studio\STUDIO`. The project uses Tailwind CSS with a fully tokenized design system (CSS custom properties in `src/design/tokens.css` and `src/design/typography.css`, bridged into Tailwind via `tailwind.config.js`).

In a previous session, the entire design system was centralized: design tokens were extracted to CSS variables, `index.css` was split into focused files, 5 new primitives were created (`Modal`, `PageHeader`, `PageShell`, `Slider`), shared hooks were added (`useDisclosure`, `useFetchState`), a motion variants module was created (`src/design/motion.ts`), 39 raw form elements were migrated to primitives, and all `gray-*`/`dark:gray-*` color violations were replaced with semantic tokens. Typecheck + lint pass clean.

The **one remaining task** is the icon barrel migration.

## The Problem

The project has a well-designed **semantic icon barrel** at `src/ui/icons/index.tsx`. Its rules state:
- Phosphor icons should be imported ONLY here — never directly in feature code
- Consumers import semantic concepts (`Close`, `Search`, `Expand`) not raw glyphs (`XIcon`, `MagnifyingGlassIcon`)
- One size scale (`xs`/`sm`/`md`/`lg`/`xl`) via the `<Icon>` wrapper — no raw `size={n}`
- One resting weight: `regular`; `fill` only for active/selected

**However, 96 files across the codebase bypass the barrel entirely**, importing directly from `@phosphor-icons/react` with patterns like:
```tsx
import { XIcon as X, CaretDownIcon as CaretDown, CheckIcon as Check } from "@phosphor-icons/react";
```

This must be fixed. Every direct import should go through the barrel.

## The Icon Barrel API

The barrel is at `src/ui/icons/index.tsx`. It currently exports:

### 14 Semantic Concepts
| Concept | Underlying Phosphor Glyph |
|---|---|
| `Close` | X |
| `Back` | ArrowLeft |
| `Send` | ArrowUp |
| `Refresh` | ArrowsClockwise |
| `Settings` | Gear |
| `Manage` | SlidersHorizontal |
| `Delete` | Trash |
| `Copy` | Copy |
| `Success` | CheckCircle |
| `Warning` | Warning |
| `Expand` | CaretDown |
| `Collapse` | CaretRight |
| `Edit` | PencilSimple |
| `Search` | MagnifyingGlass |

### Escape Hatch
```tsx
import { Icon, type IconSize } from "@/ui/icons";
<Icon icon={SomePhosphorGlyph} size="md" weight="regular" />
```
Use this for one-off icons not yet in the barrel — but then **promote them to a concept** by adding a `makeIcon` line to the barrel.

### Size Scale
```tsx
type IconSize = "xs" | "sm" | "md" | "lg" | "xl";
// maps to: 12, 14, 16, 20, 24 px
```
All icons use `<Concept size="sm" />` — never `size={14}` or raw numbers.

## What To Do

### Step 1: Expand the barrel

Read `src/ui/icons/index.tsx` to understand the full structure. Many of the 96 files use icons that are NOT yet in the barrel. You need to **add new concepts** to the barrel for any icon that appears 3+ times across the codebase. 

To add a new concept:
1. Import the glyph from `@phosphor-icons/react` in the barrel's import block
2. Add a `makeIcon` line at the bottom: `export const ConceptName = makeIcon(GlyphName, "ConceptName");`
3. Use a clear semantic name (what it means, not what it looks like)

Common icons found in the 96 files that likely need barrel entries (verify by searching):
- `Plus` (PlusIcon) — used in 5+ files
- `Check` (CheckIcon) — used in 8+ files
- `Microphone` (MicrophoneIcon) — used in 3+ files
- `Bell` (BellIcon) — used in NotificationBell
- `Moon`/`Sun` (MoonIcon/SunIcon) — used in ThemeToggle
- `Terminal` (TerminalIcon) — used in TerminalPanel, ActivityPage
- `Play`/`Stop` (PlayIcon/StopIcon) — used in ServerBrowseCards
- `ArrowRight` (ArrowRightIcon) — used in AskUserQuestionCard
- `ArrowCounterClockwise` — used in AiModelsView
- `WarningCircle` — used in ErrorDisplay, GoogleLoginButton
- `WifiSlash` — used in OfflineModal, OfflineIndicator
- `Keyboard` — used in ShortcutRegistry
- `LockSimple` — used in ComposerApprovalCard
- `Globe` — used in MarkdownExternalLink
- `ArrowSquareOut` — used in ArtifactRenderer, MarkdownExternalLink, WebSearchArtifact
- `Eye` — used in ModelPicker, CodeBlock
- `Clock` — used in ArtifactRenderer
- `XCircle` — used in ArtifactRenderer
- `ChatCircle` — used in ContextMenu, HeroBanner
- `CaretUp` — used in CodeBlock
- `TextAlignLeft` — used in CodeBlock
- `Cloud` — used in ExtensionIcons
- `Leaf` — used in ModelPicker

For icons used in only 1-2 files, use the `<Icon icon={...} />` escape hatch (import the raw glyph type from `@phosphor-icons/react` only for the type, pass it to `<Icon>`).

### Step 2: Migrate all 96 files

Here is the full list of 96 files that import directly from `@phosphor-icons/react`. Each must be migrated to import from `@/ui/icons` instead:

**app/ (16 files):**
- `src/app/command-palette/CommandPalette.tsx`
- `src/app/routes/ShaderWelcomePage.tsx`
- `src/app/routes/ProjectsPage.tsx`
- `src/app/routes/ProfilePage.tsx`
- `src/app/shell/ThemeToggle.tsx`
- `src/app/shell/NotificationBell.tsx`
- `src/app/shell/TitleBar.tsx`
- `src/app/shell/NavPopup.tsx`
- `src/app/shell/AccountMenu.tsx`
- `src/app/shell/FloatingPanel.tsx`
- `src/app/globals/UpdateBanner.tsx`
- `src/app/globals/OfflineModal.tsx`
- `src/app/globals/OfflineIndicator.tsx`
- `src/app/globals/ContextMenu.tsx`

**ui/ (4 files — primitives that own their HTML are OK to use raw Phosphor internally):**
- `src/ui/primitives/Select.tsx` — uses CaretDown, Check. Migrate to barrel imports.
- `src/ui/primitives/EmptyState.tsx` — imports `type Icon` from Phosphor. Change to `import type { PhosphorIcon } from "@/ui/icons"` or re-export the type from the barrel.
- `src/ui/feedback/ErrorDisplay.tsx` — uses X, WarningCircle. Migrate.
- `src/ui/ErrorBoundary.tsx` — uses multiple icons. Migrate.

**ui/icons/ (1 file — this IS the barrel, skip it):**
- `src/ui/icons/index.tsx` — DO NOT MIGRATE, this is the barrel itself

**runtime/ (3 files):**
- `src/runtime/ui/RuntimeStepCard.tsx`
- `src/runtime/ui/InlineToolSteps.tsx`
- `src/runtime/ui/toolCardRegistry.tsx`
- `src/runtime/ui/toolCardUtils.tsx`

**features/ (72 files):**
- `src/features/auth/components/GoogleLoginButton.tsx`
- `src/features/activity/pages/ActivityPage.tsx`
- `src/features/manage/pages/ManagePage.tsx`
- `src/features/manage/components/WhitelistView.tsx`
- `src/features/manage/components/ModelRegistryView.tsx`
- `src/features/manage/components/ModeIcon.tsx`
- `src/features/manage/components/AiModelsView.tsx`
- `src/features/workspace/terminal/TerminalPanel.tsx`
- `src/features/workspace/browser/BrowserPanel.tsx`
- `src/features/workspace/pages/WorkspacePage.tsx`
- `src/features/workspace/rightWorkspace/FilesPanel.tsx`
- `src/features/workspace/rightWorkspace/ProjectLauncher.tsx`
- `src/features/workspace/rightWorkspace/ReviewPanel.tsx`
- `src/features/workspace/rightWorkspace/SideChatPanel.tsx`
- `src/features/workspace/rightWorkspace/RightWorkspacePanel.tsx`
- `src/features/workspace/rightWorkspace/WorkspaceHomePanel.tsx`
- `src/features/workspace/rightWorkspace/WorkspacePlaceholderPanel.tsx`
- `src/features/artifacts/DocumentStorageModal.tsx`
- `src/features/artifacts/ArtifactPanel.tsx`
- `src/features/artifacts/artifact/DocumentView.tsx`
- `src/features/artifacts/artifact/CodeView.tsx`
- `src/features/artifacts/components/ArtifactLabPanel.tsx`
- `src/features/voice/pages/VoicePage.tsx`
- `src/features/voice/components/VoiceInput.tsx`
- `src/features/voice/components/ReadAloudMiniPlayer.tsx`
- `src/features/voice/overlay/FloatingIsland.tsx`
- `src/features/voice/overlay/IslandAtoms.tsx`
- `src/features/voice/overlay/PulseCardView.tsx`
- `src/features/permissions/components/ComposerApprovalCard.tsx`
- `src/features/extensions/pages/ExtensionsPage.tsx`
- `src/features/extensions/components/ServerBrowseCards.tsx`
- `src/features/extensions/components/ManagePanel.tsx`
- `src/features/extensions/components/AppConnectModal.tsx`
- `src/features/extensions/components/HeroBanner.tsx`
- `src/features/extensions/components/ComposioCards.tsx`
- `src/features/extensions/components/ExtensionIcons.tsx`
- `src/features/models/components/TierSelector.tsx`
- `src/features/models/components/ModelPicker.tsx`
- `src/features/models/components/library/ModelListRow.tsx`
- `src/features/models/components/library/ModelDetail.tsx`
- `src/features/transcription/pages/TranscribePage.tsx`
- `src/features/computerUse/pages/ComputerUsePage.tsx`
- `src/features/memories/pages/MemoriesPage.tsx`
- `src/features/settings/pages/SettingsPage.tsx`
- `src/features/settings/components/ShortcutsView.tsx`
- `src/features/settings/components/ShortcutRegistry.tsx` (note: file is `ShortcutRegistry.tsx`)
- `src/features/settings/components/SettingsDebugPanel.tsx`
- `src/features/settings/components/InterfaceView.tsx`
- `src/features/settings/components/PermissionsView.tsx`
- `src/features/settings/components/IntelligenceView.tsx`
- `src/features/settings/components/LocalServicesView.tsx`
- `src/features/settings/components/AudioView.tsx` (if it has icon imports)
- `src/features/markdown/renderers/TextBlock.tsx`
- `src/features/markdown/renderers/JsonRenderer.tsx`
- `src/features/markdown/renderers/ArtifactRenderer.tsx`
- `src/features/markdown/renderers/artifacts/WebSearchArtifact.tsx`
- `src/features/markdown/components/CodeBlock.tsx`
- `src/features/markdown/components/MermaidDiagram.tsx` (if it has icon imports)
- `src/features/markdown/components/MarkdownExternalLink.tsx`
- `src/features/chat/components/ChatFloatingDock.tsx`
- `src/features/chat/components/ClaudeModelSelector.tsx`
- `src/features/chat/components/CollapsibleUserText.tsx`
- `src/features/chat/components/ClaudeUsageBadge.tsx`
- `src/features/chat/components/ChatComposer.tsx`
- `src/features/chat/components/AskUserQuestionCard.tsx`
- `src/features/chat/components/BranchSelector.tsx`
- `src/features/chat/components/AttachmentInput.tsx`
- `src/features/chat/components/EngineSelector.tsx`
- `src/features/chat/components/EnvironmentSelector.tsx`
- `src/features/chat/components/MessageActions.tsx`
- `src/features/chat/components/PermissionModeSelector.tsx`
- `src/features/chat/components/PendingMessageQueue.tsx`
- `src/features/chat/components/ProjectContextPicker.tsx`
- `src/features/chat/components/idle/TurnStatus.tsx`
- `src/features/chat/components/UserMessage.tsx`

### Step 3: Migration Pattern

For each file, the transformation is:

**Before:**
```tsx
import { XIcon as X, CaretDownIcon as CaretDown, CheckIcon as Check } from "@phosphor-icons/react";

// Usage:
<X size={16} weight="regular" />
<CaretDown size={14} />
<Check size={16} weight="fill" />
```

**After:**
```tsx
import { Close, Expand, Copy } from "@/ui/icons";
// OR if some icons aren't in the barrel yet and are one-offs:
import { Close, Icon } from "@/ui/icons";
import { SomeOneOffIcon } from "@phosphor-icons/react"; // type-only or escape hatch

// Usage (size scale replaces raw numbers):
<Close size="md" weight="regular" />     // 16px = "md"
<Expand size="sm" />                      // 14px = "sm"
<Copy size="md" weight="fill" />
```

### Size mapping (raw number → IconSize):
- `size={12}` or `size={11}` → `size="xs"`
- `size={14}` or `size={13}` → `size="sm"`
- `size={16}` or `size={15}` → `size="md"`
- `size={20}` or `size={18}` → `size="lg"`
- `size={24}` or `size={22}` → `size="xl"`

If `size` is not specified (defaults to Phosphor's 32px or 24px), use `size="md"` or `size="lg"` depending on context.

### Special cases:

1. **`EmptyState.tsx`**: Currently imports `type Icon` (the Phosphor type) to accept an icon component as a prop. The barrel re-exports the `Icon` wrapper component but not the Phosphor type. You need to re-export the type from the barrel:
   In `src/ui/icons/index.tsx`, add:
   ```tsx
   export type { Icon as PhosphorIcon } from "@phosphor-icons/react";
   ```
   Then `EmptyState.tsx` can do: `import { type PhosphorIcon } from "@/ui/icons"`

2. **`toolCardRegistry.tsx`** and **`toolCardUtils.tsx`**: These may use Phosphor icons as data (storing icon components in arrays/objects for dynamic rendering). Make sure to use the barrel's `<Icon icon={glyph} />` escape hatch if they store raw glyph components.

3. **Type-only imports**: If a file only imports `type { Icon }` or `type { IconProps }` from Phosphor, re-export those types from the barrel and update the import.

4. **`weight` prop**: The barrel defaults to `"regular"`. Only pass `weight="fill"` if the original code explicitly used `weight="fill"` or `weight="bold"` — but first check: `weight="bold"` is BANNED. If the original used bold, change to `weight="fill"` only if it's an active/selected state; otherwise drop the weight prop (defaults to regular).

5. **`className` prop**: Pass through as-is — the barrel forwards all extra props.

6. **Unused imports**: After migration, if some Phosphor icon imports are no longer used, remove them. Make sure no `from "@phosphor-icons/react"` import lines remain in feature code (only in `src/ui/icons/index.tsx` itself).

### Step 4: Verification

After all migrations, run:
```bash
npm run typecheck
npm run lint -- --quiet
```

Both must pass with zero errors.

Then verify no direct imports remain:
```
Search for: from "@phosphor-icons/react" in *.tsx files
Expected: ONLY `src/ui/icons/index.tsx` should have this import.
```

If any file other than `src/ui/icons/index.tsx` still imports from `@phosphor-icons/react`, it was missed.

## Important Rules

1. **Do NOT change visual appearance** — the icon, its size, weight, color, and position must remain identical after migration. Only the import source and size notation change.
2. **Do NOT touch `src/ui/icons/index.tsx` imports** — the barrel itself legitimately imports from `@phosphor-icons/react`. That's the whole point.
3. **Do NOT touch `src/ui/brand/`** files — brand logos (ClaudeCodeIcon, StudioMark, etc.) are a separate documented category that may use raw SVG paths and brand colors. They don't use Phosphor.
4. **Read each file before editing** — understand what icons are used and how before making changes.
5. **Preserve all other imports** — React, framer-motion, other primitives, etc. Only the `@phosphor-icons/react` import line should change.
6. **Handle aliased imports** — `import { XIcon as X }` means the local name is `X`. The barrel exports `Close` (which wraps `X`). So replace `X` usage with `Close` throughout the file, or import `Close as X` if you want to minimize diff size (but prefer using the semantic name).
7. **Work in batches** — use parallel subagents for groups of ~15-20 files at a time to maximize throughput.
8. **Run typecheck after each batch** — don't let errors accumulate.

## Files NOT in the migration list (skip these)

- `src/ui/icons/index.tsx` — IS the barrel, keep its Phosphor import
- `src/ui/icons/WorkspaceIcons.tsx` — if it exists, it's a special case (NavToggleIcon is a hand-rolled SVG, not Phosphor)
- `src/ui/brand/*` — brand logos, not Phosphor
- `src/features/markdown/components/MermaidDiagram.tsx` — may import Phosphor for its own internal use; check but be careful with mermaid config objects
- `src/features/voice/pages/VoicePage.tsx` — may use Phosphor `type Icon` for dynamic dispatch; handle carefully
- `src/features/workspace/terminal/TerminalPanel.tsx` — may store icon components in xterm config; check context

## Summary

The goal is: after this task, the ONLY file in the entire `src/` tree that contains `from "@phosphor-icons/react"` is `src/ui/icons/index.tsx`. Every other file imports icons from `@/ui/icons`. Typecheck and lint both pass clean.
