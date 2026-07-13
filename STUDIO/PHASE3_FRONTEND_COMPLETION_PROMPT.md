# Task: Finish STUDIO Frontend Design System Centralization — Phase 3

## Project Context

You are working on **STUDIO**, a Tauri v2 + React + TypeScript desktop app at `C:\pookiepied\Project Studio\STUDIO`. The project uses Tailwind CSS with a fully tokenized design system.

### What was done in prior sessions (Phases 1-2)

**Phase 1 — Design system foundation:**
- CSS split: `index.css` (was 609 lines) → `index.css` (177 lines) + `design/syntax.css` + `design/prose-chat.css`
- All design tokens centralized as CSS vars in `design/tokens.css` (color, surface, text, shadow, syntax, scrollbar, **radius, spacing, z-index, duration, easing**) and `design/typography.css` (font families, type scale, letter-spacing)
- `tailwind.config.js` bridges ALL values from CSS vars — zero hardcoded hex/px/ms remains in the config
- Fixed `filesPanel.css` (broken `--color-muted` → `--scrollbar-thumb`; moved import to actual consumer `MarkdownDocumentPreview.tsx`)
- Removed dead code: `.font-mono-display` class, empty `artifacts/content/` directory
- `src/design/constants.ts` created for shared JS constants (`HERO_GRADIENT`, `LOG_GRID_TEMPLATE`)
- `src/design/motion.ts` created with shared framer-motion variants: `fadeVariants`, `scaleFadeVariants`, `slideUpVariants`, `pageVariants`, `chevronRotateTransition` + matching transitions

**Phase 1 — New primitives created:**
- `src/ui/primitives/Modal.tsx` — AnimatePresence + backdrop + dialog, `size` prop, `closeOnBackdrop`/`closeOnEscape` support
- `src/ui/primitives/PageHeader.tsx` — standardized `text-xl font-display font-normal text-primary` title + subtitle + icon + actions
- `src/ui/primitives/PageShell.tsx` — `h-full flex flex-col bg-surface-page` wrapper
- `src/ui/primitives/Slider.tsx` — tokenized range input
- `src/ui/primitives/index.ts` — barrel export for all 15 primitives

**Phase 1 — Shared hooks created:**
- `src/lib/hooks/useDisclosure.ts` — `{ open, setOpen, onOpen, onClose, onToggle }`
- `src/lib/hooks/useFetchState.ts` — `{ state, run, reset, setData }` with `FetchState<T>` union type

**Phase 1 — Form element migration:**
- 20 raw `<input>` → `Input` primitive
- 7 raw search fields → `SearchInput` primitive
- 10 raw `<textarea>` → `Textarea` primitive
- 2 raw `<input type="range">` → `Slider` primitive
- `WorkspacePage.tsx`: ~100+ `gray-*`/`dark:gray-*` → `surface-*`/`text-*` tokens

**Phase 1 — Token violations fixed:**
- 10 arbitrary `rgba()` shadow strings → `shadow-sm/md/lg/xl` classes
- `ContextTokenRing.tsx`: red/orange → `var(--marker)`/`var(--text-secondary)` (monochrome)
- 6 gray-scale hex inlines → CSS var tokens
- Hero gradient deduplicated to `HERO_GRADIENT` constant
- `gridTemplateColumns` deduplicated to `LOG_GRID_TEMPLATE` constant
- 8 inline `fontFamily: FONT_SANS` → `font-sans` class
- 9 inline `WebkitAppRegion` → `.drag-region`/`.no-drag-region` CSS classes

**Phase 2 — Icon barrel migration:**
- 100 files migrated from `@phosphor-icons/react` → `@/ui/icons`
- Barrel expanded from 14 → 58 semantic concepts
- All `size={number}` → keyword sizes (`xs`/`sm`/`md`/`lg`/`xl`)
- Banned `weight="bold"/"duotone"/"thin"` stripped; `weight="fill"` preserved only for active/selected
- Only `src/ui/icons/index.tsx` imports from `@phosphor-icons/react` (verified)
- Typecheck + lint pass clean

### Current state
- `npm run typecheck` → 0 errors
- `npm run lint --quiet` → 0 errors
- `npm run ratchet:lint` → no new errors

---

## Remaining Work — 10 Tasks

### Task 1: Prune 51 dead icon barrel re-exports
The barrel at `src/ui/icons/index.tsx` has ~149 raw glyph re-exports in the escape-hatch section (lines ~234, 239-383). 51 of these have ZERO consumers — dead exports that bloat the file. Remove all dead re-exports. The 51 dead exports are:

```
ArrowClockwiseIcon, ArrowLeftIcon, ArrowRightIcon, ArrowsClockwiseIcon,
ArrowSquareOutIcon, ArrowUpIcon, BellIcon, BriefcaseIcon, CalendarBlankIcon,
CaretDownIcon, CaretRightIcon, ChartLineUpIcon, ChatCircle, ChatCircleTextIcon,
CheckCircleIcon, CheckIcon, ClockIcon, CodeIcon, CompassIcon, CopyIcon,
DesktopIcon, DotsThreeIcon, EnvelopeSimpleIcon, FilesIcon, FolderOpenIcon,
GearIcon, GlobeIcon, InfoIcon, KeyboardIcon, ListChecksIcon, LockSimpleIcon,
MagnifyingGlassIcon, MinusIcon, MoonIcon, PauseIcon, PencilSimpleIcon, PlugIcon,
QuestionIcon, ShieldIcon, ShieldCheckIcon, SignOutIcon, SquaresFourIcon, SunIcon,
WarningCircleIcon, WifiHighIcon, WifiSlash, WifiSlashIcon, XCircleIcon, XIcon,
ArrowsClockwise, X
```

For each: grep the codebase to confirm zero consumers before removing. Keep any that still have consumers. Also clean up the first import block (lines 26-101) — if a glyph is imported there only to be re-exported (and the re-export is being removed), remove the import too. But keep imports that are used by `makeIcon` concept lines.

### Task 2: Fix 3 raw `<textarea>` elements still bypassing Textarea primitive
These 3 files were supposed to be migrated in Phase 1 but still have raw `<textarea>`:
- `src/features/chat/components/AskUserQuestionCard.tsx:77`
- `src/features/chat/components/ChatComposer.tsx:210`
- `src/features/chat/components/UserMessage.tsx:65`

For each: read the file, replace the raw `<textarea>` with `<Textarea>` from `@/ui/primitives/Textarea` (or `@/ui/primitives` barrel). Keep all refs, event handlers, auto-grow hooks, and custom className. Remove duplicate styling classes the primitive already provides (`border`, `bg-*`, `text-*`, `focus:*`, `rounded-*`). If the textarea lives inside a parent that provides border/bg, pass `border-0 bg-transparent` to override the primitive's defaults.

### Task 3: Fix 2 raw `<select>` elements in WorkspacePage
- `src/features/workspace/pages/WorkspacePage.tsx:361` — raw `<select>` for "Type"
- `src/features/workspace/pages/WorkspacePage.tsx:371` — raw `<select>` for "Trigger"

The `Select` primitive at `src/ui/primitives/Select.tsx` is a Radix-based custom select that takes `options: {value,label}[]`. Check if these two raw selects can use it. If the Radix `Select` is too heavyweight for a simple native form select, at minimum tokenize their className: replace any `gray-*`/`dark:gray-*` with `border-surface-border bg-surface-base text-secondary` etc.

### Task 4: Fix 5 ring-offset regressions
These were removed in Phase 1 but have reappeared (likely from a separate session's edits):
- `src/features/chat/components/AskUserQuestionCard.tsx:68` — `focus-visible:ring-offset-white dark:focus-visible:ring-offset-surface-base`
- `src/features/chat/components/AskUserQuestionCard.tsx:90` — same pattern
- `src/features/permissions/components/ComposerApprovalCard.tsx:233` — `focus-visible:ring-offset-1`
- `src/features/permissions/components/ComposerApprovalCard.tsx:234` — `focus-visible:ring-offset-1`
- `src/features/permissions/components/ComposerApprovalCard.tsx:243` — `focus-visible:ring-offset-1`

Remove ALL `ring-offset-*` classes from these lines. The pattern should be `focus-visible:ring-2 focus-visible:ring-focus` only — no offset, no offset-color.

### Task 5: Fix remaining color token violations
These are ALL genuine violations outside documented carve-outs:

**5a. Hardcoded hex (2):**
- `src/features/chat/components/AskUserQuestionCard.tsx:76` — `dark:bg-[#111]` → `dark:bg-surface-deep`
- `src/features/workspace/rightWorkspace/ProjectLauncher.tsx:123` — `fill="#fff"` in VsCodeIcon SVG → if this is a brand glyph, add an eslint-disable comment documenting it; if not, use `fill="currentColor"` or a token

**5b. Hardcoded rgba (7):**
- `src/runtime/ui/InlineToolSteps.tsx:112` — shimmer `linear-gradient(..., rgba(255,255,255,0.04) ...)` → create a CSS class or use `--surface-hover`
- `src/features/chat/components/AskUserQuestionCard.tsx:50` — `shadow-[...rgba(15,23,42,0.5)...]` and `dark:shadow-[...rgba(0,0,0,0.8)]` → `shadow-lg`
- `src/features/chat/components/ChatComposer.tsx:174` — 5× rgba in arbitrary `shadow-[...]` → `shadow-md` or `shadow-lg`
- `src/features/chat/components/ChatComposer.tsx:250` — rgba in arbitrary `shadow-[...]` → `shadow-md`
- `src/features/chat/components/ContextTokenRing.tsx:31` — `rgba(75,85,99,0.72)` → `var(--text-secondary)`
- `src/features/chat/components/ContextTokenRing.tsx:32` — `rgba(156,163,175,0.48)` → `var(--text-muted)`
- `src/features/chat/components/ContextTokenRing.tsx:46` — `rgba(156,163,175,0.18)` → `var(--text-disabled)`

**5c. Inline style hardcoded colors (3):**
- `src/app/routes/ShaderWelcomePage.tsx:241` — `backgroundImage: radial-gradient(...rgba(0,0,0,0.65)...)` → if this is the shader hero (documented marketing carve-out), add eslint-disable comment; otherwise tokenize
- `src/app/routes/ShaderWelcomePage.tsx:250` — `background: radial-gradient(..., rgba(255,255,255,0.45) ...)` → same
- `src/app/routes/ShaderWelcomePage.tsx:64,65` — `shadow-[...]` arbitrary rgba → add eslint-disable if it's the hero, or tokenize

**5d. Arbitrary z-index (1):**
- `src/features/chat/components/EnvironmentSelector.tsx:69` — `z-[9998]` → `z-popover` (or `z-context` if it needs to be above other popovers)

### Task 6: Migrate `gray-*` classes to semantic tokens (MAJOR — 739 instances across 81 files)
This is the single biggest remaining debt. 739 `gray-*` Tailwind classes + 510 `dark:gray-*` pairings remain across 81 files.

**Token mapping:**
| Raw class | Token replacement |
|---|---|
| `bg-white` / `dark:bg-gray-900` | `bg-surface-page` |
| `bg-gray-50` / `dark:bg-gray-900` | `bg-surface-page` |
| `bg-gray-100` / `dark:bg-gray-800` | `bg-surface-base` |
| `bg-gray-200` / `dark:bg-gray-700` | `bg-surface-raised` |
| `border-gray-100` / `dark:border-gray-800` | `border-surface-border` |
| `border-gray-200` / `dark:border-gray-700` | `border-surface-border` |
| `border-gray-300` / `dark:border-gray-600` | `border-surface-border` |
| `text-gray-900` / `dark:text-gray-50` | `text-primary` |
| `text-gray-800` / `dark:text-gray-200` | `text-primary` |
| `text-gray-700` / `dark:text-gray-300` | `text-secondary` |
| `text-gray-600` / `dark:text-gray-400` | `text-secondary` |
| `text-gray-500` / `dark:text-gray-400` | `text-muted` |
| `text-gray-400` / `dark:text-gray-600` | `text-disabled` |
| `text-gray-300` / `dark:text-gray-700` | `text-disabled` |
| `hover:bg-gray-50` / `dark:hover:bg-gray-800` | `hover:bg-surface-hover` |
| `hover:bg-gray-100` / `dark:hover:bg-gray-700` | `hover:bg-surface-selected` |
| `bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100` | `bg-primary text-on-emphasis` (inverted button pattern) |

When you see `dark:` variants paired with a `gray-*` light value, replace BOTH with a single token class — tokens auto-switch.

**Key rule:** When you see `text-white dark:text-gray-900` paired with `bg-gray-900 dark:bg-gray-100`, this is the inverted primary button pattern → replace with `bg-primary text-on-emphasis`.

**Top offender files (do these first):**
1. `src/features/artifacts/components/ArtifactLabPanel.tsx` (53 instances)
2. `src/features/chat/components/ProjectContextPicker.tsx` (38)
3. `src/features/workspace/browser/BrowserPanel.tsx` (32)
4. `src/features/markdown/renderers/ArtifactRenderer.tsx` (31)
5. `src/features/chat/components/ChatComposer.tsx` (29)
6. `src/features/models/components/ModelPicker.tsx` (24)
7. `src/features/models/components/TierSelector.tsx` (23)
8. `src/features/permissions/components/GlobalAccessModal.tsx`
9. `src/features/permissions/components/LocalCapabilitiesModal.tsx`
10. `src/features/permissions/components/ManagementAccessModal.tsx` (if it exists)
11. `src/features/chat/components/AskUserQuestionCard.tsx`
12. `src/features/permissions/components/ComposerApprovalCard.tsx`
13. `src/features/workspace/rightWorkspace/WorkspacePlaceholderPanel.tsx`
14. `src/features/workspace/rightWorkspace/WorkspaceHomePanel.tsx`
...and ~67 more files. Use `grep` to find them all: search for `gray-[0-9]` in `*.tsx` files.

**Also migrate these patterns found alongside gray-* classes:**
- `bg-white` (139 instances across 51 files) → `bg-surface-page` or `bg-surface-base`
- `bg-black/25`, `/30`, `/50` (modal scrims ~6) → keep if documented as scrim carve-out (D-304); otherwise `bg-scrim`
- `text-white` paired with dark bg → `text-on-emphasis`
- `text-black` → `text-primary`
- `border-white/[0.06]`, `border-white/10` hairlines (26 instances) → `border-surface-border`
- `ring-black/5`, `dark:ring-white/10` → `ring-surface-border` or remove if redundant with `border-*`

**Do NOT touch** files/lines with `/* eslint-disable */` comments documenting brand/data-viz carve-outs (TerminalPanel ANSI palette, MermaidDiagram, MonacoSourceView, memories graph, ActivityPage chart axes, toolCardRegistry brand glyphs, GoogleLoginButton Google "G", Claude warm accent in ChatPage/EngineSelector, ComposioCards/HeroBanner brand icon configs, TitleBar/WindowTrafficLights traffic-light colors, ProjectLauncher folder glyphs).

### Task 7: Fix 5 `<h1>` outliers
Standardized pattern is: `text-xl font-display font-normal text-primary`
- `src/ui/ErrorBoundary.tsx:86` — change to `text-xl font-display font-normal text-primary`
- `src/app/App.tsx:155` — change to `text-xl font-display font-normal text-primary`
- `src/app/routes/ProjectsPage.tsx:30` — this is semantically an eyebrow label, not a page title. Change the `<h1>` to a `<span>` or `<div>` and keep its existing className, OR if it must be h1, align to the standard pattern
- `src/app/globals/OfflineModal.tsx:87` — modal title, not page title. Acceptable as-is but change `font-sans tracking-tight` → `font-display font-normal` for consistency
- `src/features/workspace/rightWorkspace/MarkdownDocumentPreview.tsx:25` — markdown renderer context, acceptable but change to `font-display font-normal` if it's being rendered as a heading

### Task 8: Adopt shared motion variants (72 files, 0% adoption)
`src/design/motion.ts` exports 5 variant+transition pairs but ZERO files use them. 181 hand-rolled `duration: 0.X` literals exist across 72 files.

**Map durations to shared variants:**
| Current pattern | Replace with |
|---|---|
| `initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}` | `import { fadeVariants, fadeTransition } from "@/design/motion"` then `{...fadeVariants} transition={fadeTransition}` |
| `initial={{ opacity: 0, scale: 0.96, y: -10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: -10 }} transition={{ duration: 0.18 }}` | `scaleFadeVariants` + `scaleFadeTransition` |
| `initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2 }}` | `slideUpVariants` + `slideUpTransition` |
| `animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.18 }}` (chevron rotation) | `chevronRotateTransition` |

**Do NOT force-fit** — if a component has unique animation values that don't match any variant (e.g. `duration: 0.32`, `ease: [0.22, 1, 0.36, 1]`), leave it as-is. Only replace exact or near-exact matches (within 0.02s).

### Task 9: Adopt `useDisclosure` hook (18 files, 0% adoption)
`src/lib/hooks/useDisclosure.ts` exists with `{ open, setOpen, onOpen, onClose, onToggle }` but ZERO files use it. 18+ files hand-roll `useState(false)` for open/close:

Replace `const [open, setOpen] = useState(false)` with `const { open, setOpen, onOpen, onClose, onToggle } = useDisclosure()` in these files:
- `src/app/globals/ContextMenu.tsx:17`
- `src/app/command-palette/CommandPaletteContext.tsx:17`
- `src/app/shell/MainLayout.tsx:22`
- `src/app/shell/NotificationBell.tsx:155`
- `src/app/shell/AccountMenu.tsx:26`
- `src/features/workspace/rightWorkspace/RightWorkspacePanel.tsx:173`
- `src/features/workspace/rightWorkspace/ProjectLauncher.tsx:178`
- `src/features/chat/components/ClaudeModelSelector.tsx:37`
- `src/features/chat/components/BranchSelector.tsx:27`
- `src/features/chat/components/ClaudeUsageBadge.tsx:87`
- `src/features/chat/components/EngineSelector.tsx:37`
- `src/features/chat/components/PermissionModeSelector.tsx:41`
- `src/features/workspace/browser/BrowserPanel.tsx:219`
- `src/features/chat/components/EnvironmentSelector.tsx:26`
- `src/features/models/components/ModelPicker.tsx:89`
- `src/features/models/components/TierSelector.tsx:66`
- `src/features/markdown/renderers/JsonRenderer.tsx:16`

For each: if the file only uses `open` and `setOpen`, import `{ open, setOpen }`. If it uses `setOpen(true)` / `setOpen(false)` patterns, prefer `onOpen` / `onClose` for readability.

### Task 10: Extract 3 duplicate className patterns into shared components
These cross-file duplicates should be extracted:

**10a. Permission modal shell → `PermissionModalShell` component**
3 permission modals share an identical modal chrome className:
`pointer-events-auto flex w-full max-w-[820px] h-[480px] max-h-[90vh] overflow-hidden rounded-2xl bg-white dark:bg-surface-base shadow-2xl ring-1 ring-black/5 dark:ring-white/10`

Files: `GlobalAccessModal.tsx`, `LocalCapabilitiesModal.tsx`, `ManagementAccessModal.tsx` (if exists), `ProjectContextPicker.tsx` (variant).

Create a shared layout component (could live in `src/ui/primitives/` or a `src/features/permissions/components/PermissionModalShell.tsx`).

**10b. Permission action button → shared component**
The primary action button pattern `flex-1 py-2.5 text-base font-semibold text-white bg-gray-900 dark:bg-gray-100 dark:text-gray-900 ...` is duplicated 6× across the 3 permission modals. After tokenizing (Task 6), this becomes `bg-primary text-on-emphasis`. Extract a `PermissionActionButton` or use the existing `Button` primitive with `variant="primary"`.

**10c. Inline toast banner → `InlineToast` component**
`fixed bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-surface-raised border border-surface-border text-primary text-xs px-3 py-2 rounded-lg shadow-lg z-toast`
duplicated 3×: `AiModelsView.tsx:254`, `ModelRegistryView.tsx:420`, `WhitelistView.tsx:212`.

Create `src/ui/feedback/InlineToast.tsx` (or `src/ui/primitives/InlineToast.tsx`) and replace all 3 call sites.

---

## Verification After All Tasks

```bash
npm run typecheck   # must be 0 errors
npm run lint --quiet  # must be 0 errors
npm run ratchet:lint  # no new errors
```

Then run these grep checks to confirm:
1. `grep -r "gray-[0-9]" --include="*.tsx" src/ | grep -v "eslint-disable"` → should be ~0 (only documented carve-outs)
2. `grep -r "ring-offset" --include="*.tsx" src/` → 0 matches
3. `grep -r "bg-white" --include="*.tsx" src/ | grep -v "eslint-disable" | grep -v "brand/"` → ~0
4. `grep -r "text-white" --include="*.tsx" src/ | grep -v "eslint-disable" | grep -v "brand/"` → ~0
5. `grep -r "z-\[9998\]" --include="*.tsx" src/` → 0 matches
6. `grep -r "shadow-\[" --include="*.tsx" src/ | grep -v "eslint-disable"` → ~0
7. `grep -r "<textarea" --include="*.tsx" src/ | grep -v "primitives/"` → 0 matches
8. `grep -r "<select" --include="*.tsx" src/ | grep -v "primitives/"` → 0 matches
9. `grep -r "from \"@phosphor-icons/react\"" --include="*.tsx" src/` → only `src/ui/icons/index.tsx`

## Important Rules

1. **Never change visual appearance** — only swap tokens, imports, and class names
2. **Never touch documented carve-outs** — lines with `/* eslint-disable */` or `// eslint-disable-next-line` comments documenting brand colors, data-viz palettes, or marketing hero surfaces
3. **Keep brand logos intact** — `src/ui/brand/` files (StudioMark, ClaudeCodeIcon, AppLogo, BrandLogo) use raw SVG paths and brand colors. Do not change them.
4. **Read each file before editing** — understand context before making changes
5. **Work in batches** — use parallel subagents for groups of 10-15 files
6. **Run typecheck after each task** — don't let errors accumulate
7. **Preserve all functionality** — event handlers, refs, state logic, animation behavior must remain identical
8. **When in doubt about a color** — check if there's an eslint-disable comment. If yes, skip. If no, tokenize it.
9. **The `gray.*` palette in `tailwind.config.js`** (lines 42-53) should NOT be removed — it's a reference palette. We're replacing USAGE of `gray-*` classes in TSX with semantic tokens, not removing the config.
10. **Log all changes** — at the end, report exactly what was changed in each file
