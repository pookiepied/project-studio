# STUDIO Frontend — Audit & Refactor/Design-System Plan

*Read-only audit. Nothing was modified. Scope: `STUDIO/src/` (≈373 files, ≈60.7k LOC), `tailwind.config.js`, `index.css`, `index.html`.*

---

## 1. Executive Summary

STUDIO's frontend is a **layer-organized React 19 + Tailwind + Tauri app that grew organically into a hybrid mess**. The defining problem is not absence of structure — it's **competing half-migrated systems running in parallel**:

- **Three color systems** coexist: a manual `gray-*` scale (1,704 uses / 147 files), a manual `dark:*` override system (1,633 uses / 138 files), and an auto-switching semantic `surface-*`/`text-*` token system (483 uses / 98 files). The semantic system is the intended future but is outnumbered ~3.5:1 by the legacy approach.
- **A primitive layer exists but is dead.** `Button.tsx` is a well-built primitive with **0 JSX usages** against **277 raw `<button>`** across 92 files. `Modal.tsx` has **0 external adoptions** against **~14 hand-rolled backdrops**.
- **Two critical accessibility gaps:** `prefers-reduced-motion` is honored in exactly **1** place (and it's JS, not CSS); a real focus-visible ring exists in exactly **1** component while **40** elements call `outline-none` with no replacement.
- **Icons have no taxonomy:** 115 distinct Phosphor glyphs imported ad-hoc across 107 files, 5 stroke weights mixed, ~20 pixel sizes, and the same concept (loading/refresh) drawn with 5 different glyphs.

None of this is broken at runtime — it's **incoherent**, which is exactly the gap between "works" and the "premium, restrained, intentional" identity you're targeting. The good news: the foundations for the fix already exist (the `surface-*` token system, the `Button`/`Modal`/`Card` primitives, `animations.ts`, Radix + cmdk + sonner). The work is **consolidation and adoption, not greenfield invention.**

---

## 1.5 Resolution Status (Revamp Complete — T6.5 · 2026-07-07)

> **This audit was authored pre-revamp as the evidence library + design-system specification.**
> The frontend revamp (Phases 0–6 per [`02-PLAN.md`](02-PLAN.md) §9 dashboard) addressed
> every audit finding. **`02-PLAN.md` §9 is the source of truth for execution status** —
> cross-check there for the per-phase/task resolution detail. The mapping below summarizes
> how each major finding was resolved; per-task detail lives in [`04-PHASE-SUMMARIES.md`](04-PHASE-SUMMARIES.md)
> + decision log in [`03-DECISIONS-AND-CAVEATS.md`](03-DECISIONS-AND-CAVEATS.md).

**Phase-completion status (per §9 dashboard):** Phase 0 ☑ · Phase 1 ☑ · Phase 2 ☑ · Phase 3 ☑ · Phase 4 12/12 ☑ · Phase 5 6/6 ☑ · Phase 6 ☑. **Both production builds green. ESLint baseline: 0 errors on `tsc`; design-system guardrails self-enforcing via T6.3 (513 errors surface existing DS debt; new violations blocked from increasing the count).**

### Findings → Resolution mapping

| Audit finding (§) | Verdict | Resolution location |
|---|---|---|
| §2 *3 parallel color systems (gray/dark:/surface)* | ☑ Resolved | T1.x token foundation + T6.4b (dark.* palette DELETED) + T6.4a (surface-lift deleted). Single `surface-*`/`text-*` semantic ramp only. |
| §2 *Primitives exist but ~0% adopted (Button 0, Modal 0)* | ☑ Partial | T2.x built new primitives (IconButton/Input/Textarea/Spinner/Badge/EmptyState/SearchInput/Toggle/SegmentedControl); T6.3 flipped raw `<button>` to lint ERROR (513 DS violations now block new code); **T6.4f deferred** — 263 raw `<button>` refs need per-instance component work (focused future pass; lint ratchet ensures new code uses primitives going forward). |
| §2 *Reduced-motion honored in 1 place; focus-visible ring in 1 component; 40 elements `outline-none` with no replacement* | ☑ Resolved | T1.6 global reduced-motion (`MotionConfig` + CSS `@media`); Button/IconButton primitives set canonical `focus-visible:ring-2 focus-visible:ring-focus` pattern; T6.3 confirmed 51 `outline-none` instances now all paired with `focus-visible:ring-2` (correct pattern). `outline-none` rule itself DEFERRED per C-426 (needs `eslint-plugin-tailwindcss` to distinguish correct paired pattern from real violation). |
| §3 *Dark palette duplicates surface/text hex* | ☑ Resolved | T6.4b deleted the entire `dark.*` 10-shade palette (57 refs migrated → `bg-surface-*`/`text-*`). |
| §3 *Typography 614 arbitrary `text-[Npx]` bypass scale* | ☑ 98% Resolved | T1.7 added `2xs`/`3xs` micro-steps; T6.4e tokenized 542/552 refs (98%) to scale tokens. **10 edge-case stragglers** (7px/8px brand logos + 26px modal headings) deferred (below `3xs:9px` floor or above `3xl:28px` ceiling — design judgment). T6.3 flips arbitrary `text-[]` to lint ERROR. |
| §3 *Dead tokens (luxury + success/error/warning/info + 4 keyframes)* | ☑ Resolved | T1.7 deleted 3 dead keyframes; T6.1 deleted success/error/warning/info + shadow-dark-*; T6.4c deleted `luxury.*` 9-shade green palette (3 refs neutralized). Tailwind config is now surgical: only `gray.*` workhorse + semantic tokens (`surface.*`/`text.*`/`primary`/`secondary`/`muted`/`disabled`/`on-emphasis`/`focus`/`marker`). |
| §4 *Folder structure layer-organized, no `features/`* | ☑ Resolved | T4.1–T4.12 migrated all 12 features to `src/features/<feature>/` with sub-folder structure {components, context, hooks, tools, services}. Boundary-pattern D-407 prevents wrong-feature scatter (D-415/D-419/D-420/D-421/D-422 precedent; 5 shim-pattern applications D-422/D-524/D-527/D-528). |
| §4 *ChatProvider 1355-line god-object* | ☑ Already resolved (pre-T4.12) | T4.12 discovery: ChatProvider header states "Previously a 2358-line monolith. Now a thin provider that delegates" + 9 helper modules already extracted. T4.12 was a pure MOVE (zero behavior changes per user "don't ruin chat" directive). 0 actual god-object state at T4.12. |
| §4 *Constants in 4 locations; types in 10; 3 screen-suffix conventions* | ☑ Resolved | T5.1 consolidated constants to `src/constants/` (5 categorized files + barrel); T5.5 created 3 feature-types files + kept `types/index.ts` as permanent shared-types barrel per D-602 (97 consumers too large to retire). |
| §4 *`.tsx` in `utils/` (mcpRegistry + toolCardUtils)* | ☑ Resolved | T5.6 moved both to `features/chat/tools/`; T6.2 Phase B retired the back-compat shims. `utils/` is JSX-free per §6. |
| §4 *Path aliases none — `../../../` in 8 files* | ☑ Resolved | T0 introduced `@/*` alias; T4.1–T4.12 standard `@/` usage in all moved code. **T6.4h deferred** — remaining relative `../../../` paths are cosmetic refactors per D-527. |
| §4 *`services/` granularity (5 one-file folders vs `services/ai/` 18-file grab-bag with name collisions)* | ☑ Resolved | T5.4 moved 3 feature-shaped services + created barrels for 3 generic-shaped folders (mcp/+local/+skills/) per D-525/D-526; T6.2 Phase C deleted dead `services/{chat,context,agents}/` + duplicate `services/ai/modelsService.ts`. |
| §8.1 *3 color systems modeling one concept* | ☑ Resolved | See §2 row above. |
| §8.2 *614 arbitrary `text-[Npx]`* | ☑ 98% Resolved | See §3 row above. |
| §8.3 *Primitives exist but unused (Button 0, Modal 0)* | ☑ Partial → ongoing | T6.4f deferred (263 raw `<button>` refs); T6.3 lint ratchet enforces adoption going forward. |
| §8.4 *7 scrim opacities, 4 blur radii, 6 z-index tiers, ~20 icon sizes, 5 icon weights* | ☑ Resolved | T1.4 tokenized scrim + blur; T3.x icon system (5 weights → 2-standard); T6.4g z-index scale adopted (14 `z-[NNNN]` refs → 4 semantic tokens: `z-modal`/`z-toast`/`z-popover`/`z-context`). |
| §8.5 *5 glyphs for loading/refresh; 4 for send; 3 for settings* | ☑ Resolved | T3.x icon-language system (single canonical glyph per concept via barrel `@/components/icons`); D-404 `<Icon icon={...}>` escape hatch for one-off feature glyphs. |
| §8.6 *Constants in 4 places; types in 10; 3 screen-suffix conventions* | ☑ Resolved | See §4 row above. |
| §8.7 *`tracking-*-wide` name-collision* | ☑ Resolved | T1.x token pass (single name resolution). |
| §8.8 *Two motion systems (ms Tailwind vs second framer) + 252 inline `duration-NNN` + 195 inline framer durations* | ☑ Resolved | T1.6 unified motion (Tailwind duration tokens + framer `animations.ts`); T6.4g tokenized the 1 remaining `duration-[140ms]` → `duration-fast`. |
| §9 *Duplicated patterns (raw `<button>` 277, hand-rolled modal 14, card chrome 39, inline spinner 38, raw input/textarea 28, `title=` as tooltip 151, EmptyState duplicated)* | ◐ Partial | Button: T6.3 enforces via lint ERROR; full adoption deferred T6.4f (263 refs remain). Modal/Card/Spinner/Input/Textarea primitives added in T2.x; adoption ongoing. `title=` tooltip → `<Tooltip>` not added (out of scope; future). EmptyState promoted T2.x (shared primitive). |
| §10 *Dead code: ChibiAvatar/ComingSoon/ProtectedRoute (0 importers); SplashPreviewPage dev-only; redundant `modelService`/`modelsService`* | ☑ Resolved | T6.2 Phase D confirmed: ChibiAvatar/ComingSoon/ProtectedRoute already gone pre-T6.2 (0 grep matches); SplashPreviewPage kept per §8 (dev-only); `/oauth/callback` is LIVE Google OAuth infra NOT dead per D-603 finding (audit-vs-code discrepancy per §5 cross-check rule). T6.2 deleted `modelsService.ts` duplicate (C-421). |
| §3.10 *Prose/syntax ~500 lines of `index.css` hardcoded to Tailwind grays* | ☑ Resolved | T1.5 tokenized prose-chat + hljs to project's own neutral scale. |
| §3 *Scrollbars 4 overlapping variants* | ☑ Resolved | T1.x unified `scrollbar-*` semantic tokens (single thumb + track ramp). |
| §3 *Blur/scrim untokenized* | ☑ Resolved | T1.4 tokenized (scrim + blur scales). |
| §3 *`luxury.*` 3 uses + redundant `#121212` 3 names* | ☑ Resolved | T6.4c deleted `luxury.*` (9-shade palette, 3 refs neutralized to `bg-primary`/`text-secondary` per D-401). `#121212` unified to `surface-page` dark var. |

### Deferred items (intentionally out-of-scope for future work)

| ID | Item | Rationale |
|---|---|---|
| **T6.4f** | 263 raw `<button>` refs → `<Button>`/`<IconButton>` adoption | Per-instance UI judgment (variant + size + aria-label + type); ~9 hours of component work. T6.3 lint ratchet prevents NEW violations; existing ones burn down over future PRs. |
| **T6.4h** | `@/` import standardization for lingering relative paths | Cosmetic refactor (relative paths don't affect behavior or coherence); per D-527 + T5.5 catalog. |
| **C-426** | `outline-none` lint rule | Requires `eslint-plugin-tailwindcss` to distinguish correct `focus-visible:ring-2` paired patterns from real violations. The 51 existing instances are all correct pattern, so 0 actual violations today. |
| **C-408 / C-406** | Cirital `motion.button` primitives (mic hero button, voice waveform controls) | No circular-button primitive in the design system; framer-motion wrappers kept for behavior-sensitive interactions; deferred pending focused component-design pass. |
| **`outline-none` 51 existing instances** | Tailwind `outline-none` paired with `focus-visible:ring-2` (correct pattern) | C-426 applies; enforcement relies on primitives adoption (which T6.3 enforces for new code). |

### Audit-vs-code discrepancies caught (per §5 "cross-check against the code, not the prose" rule)

1. **D-501** — audit assumed `utils/constants.ts` exists; doesn't. T5.1 corrected.
2. **D-601** — T6.1 audit assumed 3 token groups were dead; only 2/5 fully dead (5 with live consumers). Adopted → consumers migrated → tokens deleted (the C-425 catalog pattern).
3. **D-603** — T6.2 §1 audit recommended "delete the dead /oauth/callback check"; check is LIVE Google OAuth infra, not dead. Audit correction recorded; §8 dead-code list fully resolved.

---

## 2. Current-State Diagnosis

| Dimension | State | Verdict |
|---|---|---|
| Architecture model | Technical-layer (`pages/components/hooks/contexts/services/utils`), no `features/` | Drifting to hybrid |
| Routing | **No router** — `switch(currentView)` + `useState` in `HomePage`; vestigial `ProtectedRoute`/`AuthCallback` | Decision needed |
| Color | 3 parallel systems, semantic one ~30% adopted | Half-migrated |
| Primitives | Exist (`Button/Card/Modal/Select/Toggle`), ~0% adopted | Dead-on-arrival |
| Typography | 7-step scale defined, bypassed by 614 arbitrary `text-[Npx]` | Decorative |
| Motion | Tailwind keyframes (4 of 5 dead) + framer `animations.ts` (real) + inline magic numbers | Two divergent systems |
| Icons | 1 library, no registry, 5 weights, 20 sizes | No taxonomy |
| A11y | No reduced-motion, no focus system, modals lack `role/aria/trap/Esc` | High risk |
| Constants | 4 locations; Types: 10 locations | Fragmented |

**Build duality note (outside the 5-agent scope — flagging per your instruction):** the project ships two entry configs — `vite.config.ts` (Tauri desktop) and `vite.config.web.ts` (web). Any token/folder refactor must be validated against **both** targets. There are also `src/agent/` (core + ui) and `src/ai/formatter/` subtrees that none of the five scoped agents covered in depth — see §25.

---

## 3. Design-System Audit

| Category | Finding | Sev |
|---|---|---|
| Color tokens | 3 parallel systems (gray 1704 / dark: 1633 / surface 483) modeling the same thing | HIGH |
| Light/Dark | Only page/deep/base/raised/lift/border/divider + text primary/secondary/muted exist as tokens. **Missing: hover, selected/active, disabled, focus-ring, state colors** | HIGH |
| Dark palette | `dark.*` scale duplicates surface/text hex under different names (`#2A2A2A`, `#E5E5E5`, `#737373` each have 2–3 names); inverted scale doubles as a text ramp | MED |
| Typography | 614 arbitrary `text-[Npx]`; even `11/12/14px` (which have tokens) written as literals 314+ times; a whole micro-scale (10/9/8px) has no token | HIGH |
| Font families | `sans`/`display`/`serif` all resolve to the same font; declared twice (`typography.css` + `fonts.ts`); `.font-display`/`.font-mono-display` re-declare in `index.css` | LOW |
| Letter-spacing | `.tracking-ultra-wide`/`.tracking-extra-wide` **name-collide** between `tailwind.config.js` and `index.css` at *different values* | LOW |
| Radius | Scale exists (sm 4 → 2xl 24); bypassed by arbitrary `rounded-[..]` | MED |
| Shadows/Elevation | Manual `dark-*` shadow variants (don't auto-switch); 52 inline `rgba()` shadows | MED |
| Scrollbars | 4 overlapping variants, three at 2px with 4 different hardcoded thumb colors | MED |
| Blur/backdrop | 7 scrim opacities (`bg-black/10`→`/80`), 4 blur radii, untokenized | MED |
| Prose/syntax | ~500 lines of `index.css` (prose-chat + hljs) hardcoded to **Tailwind-default grays** (not the project's own scale), bypassing all tokens | HIGH |
| Motion | See §19 | MED |
| Dead tokens | `luxury.*` (3 uses), `success/error/warning/info` (**0 uses**), 4 of 5 keyframes (0 uses), `#121212` has 3 names | LOW |

---

## 4. Frontend-Architecture Audit

| Category | Finding | Sev |
|---|---|---|
| Folder structure | Layer-organized, no `features/`; each feature smeared across all layers | HIGH |
| Routing | No router; manual switch; eager bundling of all pages | MED |
| `contexts/chat/` | A 15-file **feature module disguised as a context**; `ChatProvider.tsx` = 1,355-line god-object (tool exec + token pruning + notifications + storage) | HIGH |
| Pages | Flat-file vs folder inconsistency; the **two largest** pages (`WorkspacePage` 981, `ChatPage` 677) are un-folderized while smaller ones are | HIGH |
| Constants | **4 locations**: `utils/constants.ts`, `config/constants.ts`, `constants/*`, `contexts/chat/constants.ts` | MED |
| Types | `src/types/` + **9 co-located** `types.ts`; no stated rule; fat 182-line `index.ts` | LOW |
| `.tsx` in `utils/` | `mcpRegistry.tsx` (226 lines, SVG components) and `toolCardUtils.tsx` — JSX in the pure-helper layer | MED |
| Barrels | All partial: `hooks/index.ts` exports 7 of ~40; `contexts` 5 of 11; `components` 18 of ~50 | MED |
| Path aliases | **None** — all relative imports; `../../../` in 8 files | HIGH (enabler) |
| `services/` granularity | 5 one-file "folders" vs `services/ai/` 18-file grab-bag with name collisions (`modelService` vs `modelsService`) | MED |
| Naming | 3 suffixes for screens (`Page`/`View`/`Panel`); lowercase multi-export files (`components.tsx`/`shared.tsx`) beside PascalCase | LOW |
| `/ui` pollution | ~53 of 60 files in `components/ui/` are product-specific, not primitives | MED |

---

## 5. Component Inventory

**True primitives (keep in `components/ui/`):** `Button`, `Card`, `Modal`, `Select`, `Toggle`, `SettingsRow`, `ExternalLink` — 7 files.

**Misfiled product components in `/ui` (≈53), grouped by destination:**
- **workspace:** `TerminalPanel` (603), `BrowserPanel` (457), `NativeBrowserHost`
- **agent/tools:** `ToolCallCard`, `ToolCallChain`, `ToolApprovalCard`, `ToolPermissionCard`, `HarnessPermissionModal`, `HarnessStepCard`, `InlineToolSteps`, `ActivityCard(+Header)`, `TodoWriteCard`, `TaskPill`, `content/*`
- **chat/reasoning:** `ThinkingBlock`, `chain/*`, `StreamingText`
- **markdown/renderers:** `CodeBlock` (362), `MarkdownComponents` (225), `MermaidDiagram` (213), `renderers/*`
- **artifacts:** `ArtifactPanel`, `artifact/*`, `SummaryPanel`
- **voice/brand:** `VoiceOrb`, `TokenRing`, `ChibiAvatar`, `ClaudeCodeIcon`
- **misc product:** `AppsPopover`, `AskUserQuestionCard`, `ConnectionStatusBar`, `ContextIndicator`, `DocumentStorageModal`, `ErrorDisplay`, `ShortcutRecorder`, `VideoPlayer`, `shaders-hero-section`

**Missing primitives (confirmed absent):** `Input`, `Textarea`, `IconButton`, `Spinner`/`Loader`, `Badge`/`Pill`, `Tooltip`, `Popover`/`Dropdown`, `EmptyState`, `Panel`/`Drawer`.

**Oversized / multi-responsibility:** `ChatProvider` (1355), `WorkspacePage` (981), `useAudioRecorder` (747), `ModelLibraryPanel` (732), `ChatPage` (677), `TerminalPanel` (603), `ActivityPage` (610), `SettingsDebugPanel` (506).

---

## 6. Page / Feature Inventory

**Flat pages:** `ChatPage`(677), `WorkspacePage`(981), `ActivityPage`(610), `VoicePage`(512), `SettingsPage`(471), `ExtensionsPage`(454), `ModelsPage`(427), `ComputerUsePage`(386), `HomePage`, `LoginPage`, `AuthCallback`, `ManagePage`, `MemoriesPage`, `OverlayPage`, `TranscribePage`, `ShaderWelcomePage`, `SplashPreviewPage`, `ComingSoon`.

**Folderized pages (the inconsistent exception):** `pages/settings/` (5 `*View` + `shared.tsx`), `pages/manage/` (`AiModelsView`, `WhitelistView`, `components`, `helpers`, `types`), `pages/activity/` (`components`, `formatters`, `types`).

**Implicit features (smeared across layers):** chat, voice, workspace, computer-use, transcription, settings, manage, activity, models, extensions, memories, mcp.

---

## 7. Token / Style Inventory

**Exist:** `surface.{page,deep,base,raised,lift,border,divider}`, `text.{primary,secondary,muted}` (light+dark CSS vars); fontSize xs–3xl; fontWeight thin–bold; borderRadius sm–2xl; boxShadow sm–xl + dark variants; transitionDuration fast/normal/slow/slower; 4 easing curves; 5 keyframes; letterSpacing ultra/extra-wide.

**Missing (must add):** `surface-hover`, `surface-selected`, `surface-active`, `text-disabled`, `text-on-accent`, `focus-ring`, `state-{success,error,warning,info}` (as vars), auto-switching `shadow-*`, `scrollbar-thumb`, `scrim`, `syntax-*` (8 roles), micro type steps `2xs/3xs`, a z-index scale.

**Dead:** `luxury.*`, `success/error/warning/info` Tailwind colors, 4 keyframes, `dark.*` palette (redundant with surface/text).

---

## 8. Inconsistency List (consolidated, top items)

1. 3 color systems modeling one concept (gray/dark:/surface).
2. 614 arbitrary `text-[Npx]` vs a defined scale.
3. Primitives exist but unused (Button 0, Modal 0, Card chrome copy-pasted 39×).
4. 7 scrim opacities, 4 blur radii, 6 z-index tiers, ~20 icon sizes, 5 icon weights.
5. 5 glyphs for "loading/refresh", 4 for "send", 3 for "settings".
6. Constants in 4 places; types in 10; 3 screen-suffix conventions.
7. `tracking-*-wide` name-collision at different values.
8. Two motion systems (ms Tailwind vs second framer) + 252 inline `duration-NNN` + 195 inline framer durations.

---

## 9. Duplicated Pattern List

| Pattern | Occurrences | Should be |
|---|---|---|
| Raw `<button>` | 277 / 92 files | `<Button>` / `<IconButton>` |
| Hand-rolled modal backdrop | ~14 | `<Modal>` |
| Card chrome (`rounded border bg-surface`) | 39 / 23 files | `<Card>` |
| Inline spinner (`animate-spin`) | 38 / 22 files | `<Spinner>` |
| Portal+click-outside+Esc popover | 4+ bespoke | `<Popover>` |
| Toggle switch markup | ~4–5 files | `<Toggle>` |
| Raw `<input>` / `<textarea>` | 28 / 10 | `<Input>` / `<Textarea>` |
| `title=` as tooltip | 151 / 60 files | `<Tooltip>` + `aria-label` |
| `EmptyState` (private in WorkspacePage) | duplicated per page | shared `<EmptyState>` |
| Raw `toast()` | 5+ modules | `notify` wrapper |
| Inline `style={{}}` | 101 / 44 files | Tailwind / CSS vars |

---

## 10. Dead / Unused Design-Code Risk List

> **T6.2 Resolution (2026-07-06):** All items below reviewed against the actual codebase per §5. Resolutions noted inline.
> - Dead tokens → deleted in T6.1 + T6.4 (luxury.* deleted in T6.4c; success/error/warning/info deleted in T6.1).
> - Dead code → ChibiAvatar/ComingSoon/ProtectedRoute already gone pre-T6.2 (0 grep matches confirmed during T6.2 Phase D).
> - SplashPreviewPage retained per §8 (dev-only).
> - `/oauth/callback` is LIVE Google OAuth infra, NOT dead per D-603 finding — 3rd audit-vs-code discrepancy.
> - `modelService` vs `modelsService` → T6.2 Phase C deleted `modelsService.ts` duplicate (C-421).

- **Dead tokens:** `luxury.*` (3 uses, 1 file) **→ T6.4c DELETED (9-shade palette)**, `success/error/warning/info` (0) **→ T6.1 DELETED**, keyframes `scale-in/slide-up/pulse-smooth/listening` (0) **→ T1.7 already DELETED**.
- **Dead/vestigial code (high confidence, verify dynamic refs first):** `ChibiAvatar.tsx` (0 importers) **→ pre-T6.2 confirmed gone**, `ComingSoon.tsx` (0 real uses) **→ pre-T6.2 confirmed gone**, `ProtectedRoute.tsx` (no router to gate) **→ pre-T6.2 confirmed gone**.
- **Dev-only, keep but confirm:** `SplashPreviewPage` (only via `?splashPreview=1`) **→ KEPT per §8**.
- **NOT dead (confirmed live):** `ShaderWelcomePage` (unauth users), `VoicePage`/`TranscribePage`/`MemoriesPage` (routed) **→ confirmed alive in T6.2 Phase D; `/oauth/callback` ALSO confirmed live per D-603 (audit was wrong on this one)**.
- **Redundant naming:** `#121212` has 3 names **→ unified to `surface-page` dark var in T1.x**; `dark.*` palette redundant **→ T6.4b DELETED (10-shade palette, 57 refs migrated to `bg-surface-*`/`text-*`)**; `modelService` (singular canonical) vs `modelsService` (plural duplicate) **→ T6.2 Phase C DELETED `modelsService.ts` per C-421**.

---

## 11. Design Philosophy (FINALIZED — source of truth)

> **Premium neutral monochrome. White-led, graphite for dark, no accent colors. Hierarchy and state are built from surface roles, structure, and type weight — never from hue.**

This is the agreed design direction and governs every future UI decision in this codebase.

1. **Pure-neutral palette — no accent colors, ever.** No blue, red, green, sage, amber, or purple. The entire interface is built from white, light grays, and graphite. "Premium" comes from restraint and precise neutral steps, not from color.
2. **Light mode is white-led and bright; dark mode is graphite-led, never pure black.** Modes switch via CSS variables, never hand-written `dark:` pairs.
3. **Avoid black as much as possible — even for ink.** This is a clean, bright neutral system, **not** strict black-and-white. Primary text is **near-black** (`#1A1A1A` light / soft white `#F2F2F2` dark), **never pure `#000`**. Surfaces, fills, borders, and dividers stay in the light-gray / graphite range. Pure `#000` is reserved only for genuine media (e.g. video letterbox) and modal scrims — never for text, borders, focus rings, or markers. *(Refined 2026-06-28: softened from the earlier "pure black" rule — pure `#000` read harsh and less premium across the UI.)*
4. **Neutral temperature: essentially neutral with the faintest cool undertone in light, neutral graphite in dark.** This keeps light grays crisp and bright (warm light-grays look dingy as they lighten) without ever tipping into a perceptible blue. The undertone is a whisper, never a color.
5. **Hierarchy through roles, not decoration.** Every neutral maps to a named semantic role (page → surface → raised → border → text…). Gray is never chosen "by feel." No raw `gray-*`/`dark:*` for surfaces, borders, or text.
6. **State lives on separate channels (the core rule — see §11.1).**
7. **Primitives only; everything comes from scales; one icon language; accessibility-as-token** — as detailed in §13–§20. Primitives are the only sanctioned way to build a button, input, modal, card, or popover.

### 11.1 Interaction-state model — the channel-separation rule

The specific problem we are solving: today **hover** (light-gray fill) and **selected** (slightly-darker-gray fill) sit on the *same* gray ramp, so an adjacent hovered + selected pair competes and reads as "two of the same thing, one a bit darker." The fix is to stop expressing them as two points on one ramp and instead give each state its **own channel of emphasis**:

| State | Channel (how it's signalled) | Why it can't be confused |
|---|---|---|
| **Rest** | base surface | — |
| **Hover** | the *quietest possible* fill lift, nothing else (transient) | It only ever whispers; it never changes text or adds structure |
| **Selected / active** | a clearly stronger neutral surface **+ content emphasis** (text → pure black, weight → medium) **+ an optional structural marker** (e.g. a 2px left-edge bar / inset border) — persistent | It signals on channels hover *never* uses (weight + structure), so a hovered neighbour can't read as "almost selected" |
| **Focus** | a **neutral ring** (premium grey `#5A5A5A` light / `#A8A8A8` dark — the secondary-ink weight) with offset — never a fill, never pure `#000`; clearly visible, not decorative | The ring is a channel neither hover nor selected uses |
| **Hover-on-selected** | selected stays dominant; hover does **not** add a third shade on top | Prevents the "third gray" that causes the competition |
| **Disabled** | reduced text contrast / lowered opacity, no fill | Absence of emphasis, not a new shade |

**Consequence:** hover and selected are no longer "lighter vs darker gray" — they differ *in kind*. Adjacent hover + selected always read as distinct. For **primary navigation only**, an inverted treatment (a dark-graphite chip with soft-white text) is permitted as the "specific high-contrast element" exception, because it makes the current location unmistakable; it is **not** used for ordinary list rows.

### 11.2 Elevation model — deliberately different per mode

- **Light mode:** elevate with **quiet hairline borders + very soft shadow**, keeping surface-fill steps subtle. This avoids the "everything is near-white mush" trap while staying bright. Separation is carried by the border/shadow, not by heavy gray fills.
- **Dark mode:** elevate with **progressively lighter graphite fills** and little or no shadow (shadows don't read on dark); borders become a quiet charcoal edge.

This asymmetry is intentional and correct — do not force the two modes to use the same elevation mechanism.

### 11.3 Status / feedback without color

Because there are no accent colors, success / error / warning are communicated by **icon + type weight + neutral surface**, not by hue. The one place needing care is **destructive / error confirmation**: handle it with emphasis (heavier weight, a filled near-black/graphite button, explicit iconography) rather than red. The default and current decision is fully neutral; if any single functional color is ever revisited, it would be a restrained destructive signal only — flag for human sign-off, do not introduce it unilaterally.

---

## 12. Proposed Semantic Token System (light + dark)

Implemented as CSS vars in `:root` / `html.dark`, exposed via Tailwind. **All values are pure neutral** (no blue/warm cast beyond the faint cool undertone in §11.4). ✚ = new token.

> **Refined direction (decided & applied 2026-06-28) — avoid pure `#000`.** Ink and marker are now
> **near-black** `#1A1A1A` (light) / soft-white `#F2F2F2` (dark); the **focus ring is premium grey**
> `#5A5A5A` (light) / `#A8A8A8` (dark) — the *secondary*-ink weight, not the near-black ink, because
> focus is a transient affordance and should read as the premium grey accent, not a black outline
> (~6.9:1 / ~7:1 contrast — visible + accessible). **Implementation status: applied** to
> `src/tokens/tokens.css` (calibration token pass) and verified in both builds; the table below
> reflects the live values. The surface-role ladder itself is unchanged.

| Token | Role | Light | Dark |
|---|---|---|---|
| `surface-page` | page bg | `#FFFFFF` | `#121212` |
| `surface-deep` | sunken (terminal/browser) | `#FAFAFA` | `#161616` |
| `surface-base` | card/dropdown | `#F7F7F7` | `#1A1A1A` |
| `surface-raised` | elevated container | `#F2F2F2` | `#1F1F1F` |
| `surface-hover` ✚ | **hover — quietest fill, transient** | `#EDEDED` | `#242424` |
| `surface-selected` ✚ | **selected/active fill** (always paired with black text + medium weight; see §11.1) | `#E4E4E4` | `#2E2E2E` |
| `surface-active` ✚ | pressed | `#DCDCDC` | `#353535` |
| `surface-border` | hairline border (carries light-mode elevation) | `#E6E6E6` | `#2A2A2A` |
| `surface-divider` | thin inner divider | `#F0F0F0` | `#222222` |
| `text-primary` | primary text — **near-black / soft white** (never pure `#000`) | `#1A1A1A` | `#F2F2F2` |
| `text-secondary` | secondary text | `#5A5A5A` | `#A8A8A8` |
| `text-muted` | muted/placeholder (Phase-1 AA-locked on base/raised surfaces) | `#6E6E6E` | `#8A8A8A` |
| `text-disabled` ✚ | disabled text | `#B8B8B8` | `#4A4A4A` |
| `text-on-emphasis` ✚ | text on filled near-black/graphite (e.g. nav chip, primary button) | `#FFFFFF` | `#0F0F0F` |
| `focus-ring` ✚ | **neutral focus ring** — premium grey (= secondary ink), never a fill, never pure `#000` | `#5A5A5A` | `#A8A8A8` |
| `marker` ✚ | structural selected marker (2px edge bar / inset) — graphite | `#1A1A1A` | `#F2F2F2` |
| `shadow-sm…xl` ✚ | soft elevation, auto-switch (primary in light) | `/0.04`–`/0.08` | `/0.30` (min/none) |
| `scrim` ✚ | one modal backdrop | `rgb(0 0 0/.45)` | `rgb(0 0 0/.55)` |
| `scrollbar-thumb` ✚ | scrollbar | `rgba(0,0,0,.10)` | `rgba(255,255,255,.08)` |
| `syntax-*` ✚ | hljs (8 roles, neutral grayscale ramp) | gray ramp via vars | dark ramp via vars |

**No `state-*` color tokens.** Success/error/warning are signalled by icon + weight + neutral surface (§11.3) — there is no green/red/amber in the system.

**Hover ≠ selected by design:** `surface-hover` (`#EDEDED`) is a whisper above the surface; `surface-selected` (`#E4E4E4`) is a clearly stronger fill **and** must be applied together with `text-primary` + medium weight (and, where useful, the `marker`). Hover never sets text/weight/marker, so the two never compete (see §11.1). Hover-on-selected = selected; do not add a third shade.

**Type scale:** add `2xs:10px/14px`, `3xs:9px/12px`; codemod `text-[11px]→xs`, `[12px]→sm`, `[14px]→base`.
**Z-index scale:** `overlay 40 / modal 50 / popover 60 / toast 70 / context 80` — retire the `z-[9999]` zoo.

---

## 13. Proposed Component System

**`components/ui/` (primitives only):** `Button`, `IconButton`✚, `Card(+Header/Body/Divider)`, `Modal(+Header/Footer/Divider)`, `Select`, `Input`✚, `Textarea`✚, `Toggle`, `SettingsRow/Section`, `ExternalLink`, `Badge`✚, `Spinner`✚, `Tooltip`✚, `Popover/Dropdown`✚, `EmptyState`✚, `Panel/Drawer`✚.

**API contract for every primitive:** consistent `variant` + `size` enums (align the scales — today Button `sm/md/lg`, Toggle `sm/md`, Modal `sm/md/lg/xl`, Card uses `padding`), `className` passthrough, and **spread native props** (Select/Toggle/Modal currently swallow `id`/`aria-*`/`data-*`).

**`Modal` is the keystone fix:** upgrading it once (focus trap + `role="dialog"`/`aria-modal`/`aria-labelledby` + Esc + focus restore, consuming `MODAL_ANIM`/`scrim`/`z-modal`) and migrating the ~14 bespoke modals onto it resolves duplication **and** the biggest a11y gap simultaneously.

**Feedback/overlay groups:** `components/feedback/` (status widgets, ErrorDisplay, UpdateBanner, SplashScreen), `components/overlays/` (FloatingIsland, CommandPalette, PermissionDialog, TranscriptionOverlay).

---

## 14. Proposed Folder Architecture

Recommended for *this* codebase (feature-first, since features are currently smeared across every layer):

```
src/
  app/         App.tsx, main.tsx, provider composition, router/switch, init
  pages/       thin route entries only — delegate to features/
  features/    chat/ voice/ workspace/ computerUse/ transcription/
               settings/ manage/ activity/ models/ extensions/ memories/ mcp/
                 (each: components/ hooks/ services/ context/ types.ts constants.ts index.ts)
  components/  ui/ layout/ feedback/ overlays/ brand/ icons/   ← generic only
  hooks/       generic only (useDebounce, useOnClickOutside, useCrossPlatform, useAutoResizeTextarea…)
  contexts/    global only (Auth, Settings, Models, Navigation, Offline, CommandPalette)
  services/    cross-cutting infra (connection, storage, network, errors, logging, platform, notifications, auth)
  utils/       PURE helpers — no .tsx
  constants/   ALL app-wide static values (merge the 4 sources)
  config/      runtime/env config only (autoMode, tauriConfig)
  types/       shared domain types (slim index.ts); feature types co-located
  styles/  tokens/  assets/
```

**Top-offender moves:** `contexts/chat/` → `features/chat/`; `WorkspacePage`+`rightWorkspace/` → `features/workspace/`; `utils/mcpRegistry.tsx` → `features/mcp/registry.tsx`; feature hooks (`useLiveSession`, `useComputerUse`, `useTerminalPanel`, `useBrowserPanel`, `useFasterWhisper`, `useAudioRecorder`) → their feature; collapse the 5 one-file `services/` folders.

---

## 15. Proposed Naming Conventions

- **Screen suffixes:** `*Page` = routed screen · `*View` = sub-section of a page · `*Panel` = docked/resizable surface. One concept per suffix.
- **Files:** PascalCase = exactly one React component; `use*` hooks; `*Provider` contexts; `*Service` infra. Convert lowercase multi-export files (`components.tsx`, `shared.tsx`, `helpers.ts`) into folders or role-named files.
- **Resolve collisions:** `modelService` vs `modelsService`; `GearSix` vs `Gear`; `#121212`'s three names.

---

## 16. Proposed Import / Export Conventions

- **Add `@/*` path alias** (`tsconfig.json` `paths` + Vite `resolve.alias` in *both* configs). **Do this first** — it's the prerequisite for every folder move.
- **Barrels: complete or delete.** Partial barrels rot. Each feature exposes a single `index.ts`; cross-feature imports go through it and never reach into another feature's internals.
- Standardize icon import style (today some alias `XIcon as X`, some import bare).

---

## 17. Proposed Icon Rules

- **One library** (Phosphor) imported through a **semantic barrel** `components/icons/index.ts` (`Close`, `Send`, `Refresh`, `Loading`, `Settings`, `Manage`, `Delete`, `Copy`, `Success`, `Error`…). Consumers import the concept, not the glyph.
- **One resting weight `regular`; `fill` only for active/selected** (the `FloatingMenu`/`NavPopup` pattern). Ban `thin`/`duotone`/default-`bold`.
- **Size scale** `xs12/sm14/md16/lg20/xl24` via an `<Icon>` wrapper; no raw `size={n}`.
- **`currentColor` for all monochrome marks.** Fix `fill="white"` in `StudioMarkIcon` & `WorkspaceIcons` checks (break in light mode). Multi-color **brand logos** are a separate, documented category — generalize `ProviderIcon` into one `BrandLogo` (simple-icons + monogram fallback) and absorb the MCP/extension/ProjectLauncher logo sets.
- **Canonical mapping** (retire the rest): send=`ArrowUp`; refresh=`ArrowsClockwise`; loading=`SpinnerGap`; settings=`Gear`; manage=`SlidersHorizontal`; close=`X` via `<CloseButton>`.

---

## 18. Proposed Typography Rules

- **Single source of truth** for fonts (`fonts.ts` feeds the CSS var; stop re-declaring in `index.css`). Collapse `sans`/`display`/`serif` aliases — they render identically today; keep names only if you intend them to diverge.
- **Use the named scale**; arbitrary `text-[Npx]` becomes the exception. Add `2xs/3xs` for legitimate micro-text.
- **Rewrite `prose-chat` + hljs to consume `--text-*`/`--surface-*` + new `--syntax-*` vars** instead of ~500 lines of hardcoded Tailwind-default grays.
- Remove the `.tracking-*-wide` CSS/config value collision.

---

## 19. Proposed Motion Rules

- **Adopt the existing-but-unused tokens.** Mandate `duration-fast/normal/slow` + `ease-standard`; forbid raw `duration-[..]` (252 inline) and inline framer `duration:` (195) / `ease:[…]` (54) magic numbers.
- **Route all framer animation through `constants/animations.ts`** (MODAL/BACKDROP/DROPDOWN/FADE_UP/SPRING). Standardize on ~3 durations (0.15/0.2/0.3) and 2 eases (enter `[0.16,1,0.3,1]`, move `[0.4,0,0.2,1]`).
- **Delete the 4 dead keyframes**; unify ms-vs-seconds units in one motion module consumed by both Tailwind and framer.
- Replace 50 `transition-all` with explicit `transition-colors`/`-transform`.

---

## 20. Proposed Accessibility Rules

1. **One global reduced-motion block** (CSS `@media (prefers-reduced-motion: reduce)`) + `useReducedMotion()` gating framer entrances and infinite loops (OfflineModal tears/halo, spinners). *Single highest-leverage fix.*
2. **One global `:focus-visible` ring** using `--focus-ring`; remove the 40 bare `outline-none`; lint against `outline-none` without replacement.
3. **Modals:** `role="dialog" aria-modal="true" aria-labelledby` + focus trap + Esc + focus restore — implemented once in `Modal.tsx`.
4. **Menus:** `role="menu"/menuitem"` + arrow-key nav + Esc (standardize on the `MessageActions` pattern + `useOnClickOutside`).
5. **Icon-only buttons require `aria-label`;** replace `title=` with a real `Tooltip`.
6. **Contrast floor ≥4.5:1 for body text:** today `text-muted` fails — `#525252` on `#121212` ≈ 3:1, `#9CA3AF` on white ≈ 2.6:1. Raise the muted tokens and stop using gray-600 for <12px text.

---

## 21. Migration Phases

Aligned to your phasing, with the ordering the audit confirms:

- **Phase 0 (enabler):** add `@/*` path alias to both Vite configs + tsconfig. *(Low risk, unblocks everything.)*
- **Phase 1 — tokens/global foundation:** complete the semantic token set (§12); rewrite prose/hljs onto vars; add reduced-motion + focus-visible global rules; unify scrollbars; z-index scale; delete dead tokens. *(No component logic changes; high coherence payoff.)*
- **Phase 2 — core UI primitives:** upgrade `Modal` (a11y) ; add `IconButton`, `Input`, `Textarea`, `Spinner`, `Popover`, `Tooltip`, `Badge`, `EmptyState`; align primitive APIs. Build the **semantic icon barrel**.
- **Phase 3 — layout primitives:** `Panel`/`Drawer`, standardized menus/popovers, `notify` wrapper over sonner.
- **Phase 4 — feature-by-feature migration:** convert raw buttons/inputs/modals/cards to primitives one feature at a time, starting with the smallest leaf features; promote `contexts/chat/`→`features/chat/` and split `ChatProvider`.
- **Phase 5 — folder/import cleanup:** move product components out of `/ui`, establish `features/`, complete/delete barrels, unify constants/types.
- **Phase 6 — dead-code removal & consistency pass:** delete confirmed-dead files, dead tokens/keyframes, final lint enforcement.

---

## 22. High-Risk Areas

- **`ChatProvider.tsx` (1355)** — central god-object; any refactor touches the whole app. Split last and carefully.
- **`Button`/`Modal` mass adoption** — Button injects framer scale + focus ring; blind find-replace changes behavior. Migrate per-feature with visual checks.
- **`TerminalPanel`/`BrowserPanel`** — xterm/webview IPC; behavior-heavy, easy to break.
- **Routing decision** — committing to a router vs the switch is structural and gates page-folderization.
- **Dual web/desktop build** — every change must pass both configs.
- **Contrast token bump** — changing `text-muted` shifts the look of every caption; needs design sign-off.

---

## 23. Files / Components to Refactor First

1. `tailwind.config.js` + `src/index.css` — token foundation (Phase 1).
2. `src/components/ui/Modal.tsx` — one upgrade fixes a11y + kills ~14 duplicates.
3. New `src/components/icons/index.ts` — semantic barrel unblocks all icon fixes.
4. `src/components/ui/Button.tsx` adoption — begin in `feedback/` status widgets (already the lone consumer).
5. Add `IconButton`/`Input`/`Spinner` — highest duplication payoff.
6. Smallest leaf features (e.g. `manage`, `activity`) as migration pilots before chat/workspace.

---

## 24. Files / Components to Leave Alone Initially

- `ChatProvider.tsx` and `contexts/chat/*` (defer to Phase 4/5 — too central early).
- `TerminalPanel`/`BrowserPanel`/`NativeBrowserHost` (behavior-heavy; move folders only after aliases).
- `CommandPalette.tsx` (already the best-implemented interaction surface; just share its backdrop later).
- `ProviderIcon.tsx`, `StudioMark.tsx` (already correct `currentColor` patterns — use as the model, don't rewrite).
- Legitimately dynamic inline styles (FloatingIsland/VoiceOrb/overlay transforms) — not the target of the inline-style cleanup.

---

## 25. Questions Needing Human Design / Product Decisions

**DECIDED (locked by the §11 design direction — no longer open):**
- ✅ **Accent color → NONE.** Fully neutral. `focus-ring`, selected, and primary action are all neutral (black/graphite/soft-white). The `luxury` green is retired.
- ✅ **State colors → NONE.** No `success/error/warning/info` hues. State = icon + weight + neutral surface (§11.3). Destructive confirmation stays neutral pending any future human sign-off.
- ✅ **Text contrast → primary text is pure black** (`#000` light / soft white dark); `text-muted` raised to meet AA (§12).
- ✅ **Temperature → essentially neutral, faintest cool undertone in light, neutral graphite in dark** (§11.4).
- ✅ **Hover vs selected → channel separation** (§11.1) — resolves the adjacency-competition issue.

**Still open (need human input before/within planning):**
1. **Router or switch?** Commit to a router (deep-linking, lazy routes, delete `ProtectedRoute`) or formalize the switch and remove vestigial router artifacts?
4. **Micro-typography.** Are the 9–11px text sizes intentional product density (→ formalize `2xs/3xs`) or accidental drift (→ raise to the 11px floor)?
5. **Brand-logo policy.** Confirm multi-color brand logos (Gmail/Google/Claude) are an *allowed* exception to the `currentColor` monochrome rule (these are external brand marks, not UI accent color).
6. **Feature-folder commitment.** Approve the `features/` restructure (large but high-value), or keep layer-organized and only fix tokens/primitives?
8. **Dead-code deletion.** Confirm `ChibiAvatar`, `ComingSoon`, `ProtectedRoute` can be removed; confirm `SplashPreviewPage` is intentional dev tooling to keep.
9. **Out-of-scope subtrees** (`src/agent/`, `src/ai/formatter/`, `src/assets/`) — want a follow-up audit pass on these? They weren't in the 5-agent scope.

---

## Appendix A — Agent 1: Design Tokens & Global Styling (full report)

Read-only audit of `tailwind.config.js`, `src/index.css`, `src/styles/*`, `src/utils/theme.ts`, `src/constants/*`, `src/main.tsx`. All counts are real grep results across `src/`.

### Executive summary (the numbers)

| Palette / pattern | Occurrences | Files | Verdict |
|---|---|---|---|
| `*-gray-*` (Tailwind gray scale) | **1704** | 147 | Dominant palette; used everywhere, no semantic discipline |
| `dark:` variants (`dark:bg-/text-/border-`) | **1633** | 138 | Manual two-class dark mode — the real dark system |
| `*-surface-*` (semantic auto-switch tokens) | **483** | 98 | Intended system, but outnumbered ~3.5:1 by gray+dark |
| `text-[Npx]` arbitrary sizes | **614** | 100 | Type scale almost entirely bypassed |
| `#xxxxxx` hex in `.tsx` | **250** | 52 | Color living outside the token system |
| `*-dark-*` (custom dark palette) | **61** | 30 | Legacy, overlaps surface tokens |
| `rgba()` in `.tsx` | **52** | 18 | Mostly shadows/overlays, hardcoded |
| `transition-all` | **50** | 31 | Perf/consistency smell |
| `*-luxury-*` (Bottega Veneta green) | **3** | 1 | Effectively dead |
| `text-success/error/warning/info` | **0** | 0 | **Dead tokens** |
| `animate-{scale-in,slide-up,pulse-smooth,listening}` | **0** | 0 | **Dead keyframes** |
| `animate-shimmer` | 1 | 1 | Only surviving Tailwind animation |

The headline: **there are three parallel color systems** (gray scale, the `dark`/`dark:` manual-override system, and the `surface-*`/`text-*` auto-switching tokens). The auto-switching system was meant to replace the manual one, but the manual one (`dark:` × 1633) is what the codebase actually runs on. This is the central design-system problem.

### Findings by category

**F1 — Three competing color systems (Color tokens) · both · HIGH · P1**
Where: `tailwind.config.js:36-91`; `src/index.css:9-75`. The config defines `gray.50-900`, `luxury.50-900`, `dark.50-900`, `success/error/warning/info`, plus `surface.*` (CSS-var-backed). `index.css` defines `--surface-*` and `--text-*` for light + `html.dark` overrides. Inconsistent: A semantic surface system exists (`bg-surface-base` etc., 483 uses) AND a manual `bg-gray-100 dark:bg-dark-200` system exists (gray 1704 + dark: 1633). They model the same thing two different ways. Why it matters: Any palette change must be made in two places; light/dark drift is guaranteed; new code has no canonical "correct" choice. Recommended: Promote `surface-*`/`text-*` to the single source of truth; deprecate raw `gray-*`/`dark-*` for surfaces/borders/text.

**F2 — Direct numeric collisions between `dark.*` and `surface-*` (Dark mode) · design-system · MED · P2**
Where: `tailwind.config.js:63-74` vs `index.css:63-75`. `dark.500 = #383838` vs `surface-border (dark) = #2A2A2A` — two "border-ish" darks. `dark.400 = #2A2A2A` equals `surface-border` — same value, two names. `dark.900 = #E5E5E5` equals `--text-primary` (dark) — same value, two names. `dark.700 = #737373` equals `gray.500`. Why it matters: The `dark` palette is inverted (50=darkest, 900=lightest) so it doubles as a "text on dark" scale — it overlaps both surface and text tokens with duplicate hex under different names. Recommended: Delete `dark.*`; map its 61 usages onto `surface-*`/`text-*`.

**F3 — `gray.*` used non-semantically (Color tokens) · design-system · HIGH · P1**
Where: 1704 uses, 147 files. Top offenders: `WorkspacePage.tsx` (149), `ModelLibraryPanel.tsx` (60), `SettingsDebugPanel.tsx` (49), `activity/components.tsx` (42), `ModelsPage.tsx` (36), `ChatComposer.tsx` (32), `ProjectContextPicker.tsx`/`ServerBrowseCards.tsx` (31). Inconsistent: `gray-500` (#737373) is used for secondary text in some places and `text-secondary` var in others (`ConversationRail.tsx:112`). Same role, different token. Recommended: Establish role tokens and codemod gray-steps to them.

**F4 — `luxury.*` and `success/error/warning/info` are dead/near-dead (Color tokens) · design-system · LOW · P3**
Where: `tailwind.config.js:50-62, 87-90`. `luxury-*` = 3 uses (1 file: `ConversationsDropdown.tsx`); `text/bg/border-success|error|warning|info` = **0** uses. Why it matters: Dead tokens imply state colors (success/error) are hardcoded as raw `green`/`red` elsewhere. Recommended: Remove `luxury`; either adopt `success/error/warning/info` everywhere or remove and define proper `--state-*` tokens.

**F5 — Missing interaction-state tokens (Light + Dark mode) · design-system · HIGH · P1**
Where: `index.css:9-27` (light), `63-75` (dark) define only: page/deep/base/raised/lift/border/divider + text primary/secondary/muted. Missing as tokens (confirmed): hover (only `surface-raised`/`surface-lift` proxy it), selected/active, disabled text/bg, focus ring, state colors (success/error/warning/info as vars). These are hardcoded via `dark:` variants and raw grays everywhere. Recommended: Add the missing tokens for both modes.

**F6 — Type scale bypassed by arbitrary `text-[Npx]` (Font sizes) · design-system · HIGH · P1**
Where: 614 arbitrary `text-[...]`, 100 files. Distribution: `text-[11px]` ×220, `text-[10px]` ×202, `text-[12px]` ×88, `text-[13px]` ×35, `text-[9px]` ×31, `[14px]` ×6, `[8px]` ×4, `[15px]` ×4, plus one-offs `[6px][7px][16px][17px][22px][30px][34px]`. Inconsistent: `11px`(=`text-xs`), `12px`(=`text-sm`), `14px`(=`text-base`) already exist as tokens but written as arbitrary literals 314+ times. And `10px`/`9px`/`8px` are below the scale floor. Recommended: Add `2xs`(10px)/`3xs`(9px) tokens if micro-text is intentional, then codemod arbitrary→named.

**F7 — Duplicated font declarations (Font families) · design-system · LOW · P3**
Where: `typography.css:3-12` (CSS vars) ↔ `fonts.ts:8-19` (TS constants) — same three stacks declared twice. Plus `index.css:102-113` (`.font-display`, `.font-mono-display`) re-declare family + letter-spacing + weight. Note: `display` and `sans` are identical stacks; `serif` aliases to `--font-display`. So `font-serif`/`font-display`/`font-sans` all render the same — three names, one font. Recommended: Keep `fonts.ts` as the only literal source; generate/reference the CSS var from it.

**F8 — `.tracking-ultra-wide`/`.tracking-extra-wide` conflict with config (Letter spacing) · design-system · LOW · P3**
Where: `tailwind.config.js:154-156` sets `ultra-wide: 0.15em`, `extra-wide: 0.1em`; but `index.css:116-123` defines `.tracking-ultra-wide { 0.08em }` and `.tracking-extra-wide { 0.06em }` — different values, same class name. Recommended: Remove the duplicate `.tracking-*` rules from index.css.

**F9 — Manual dark boxShadow variants (Shadows/Elevation) · design-system · MED · P2**
Where: `tailwind.config.js:103-111` — `sm/md/lg/xl` (light, `0.05` alpha) + parallel `dark-sm/md/lg/xl` (`0.3` alpha). Named `shadow-{sm..xl}` used 65×; `rgba()` inline shadows = 52 (18 files). Inconsistent: Shadows don't auto-switch. Recommended: Make shadow a CSS-var token (`--shadow-sm` etc.) that switches with theme.

**F10 — Two divergent motion systems (Animation durations / Easing) · both · MED · P2**
Where: `tailwind.config.js:113-153` (durations in ms: fast150/normal250/slow350/slower500; 4 easings; 5 keyframes) vs `src/constants/animations.ts` (framer-motion, durations in seconds: 0.15/0.18/0.2/0.22/0.3, ad-hoc cubic-beziers). Inconsistent: Tailwind keyframes are nearly dead (`scale-in`/`slide-up`/`pulse-smooth`/`listening` = 0 uses, `shimmer` = 1 use). Framer-motion is the real animation system. Easing curves duplicated-but-divergent. Durations in ms (config) and seconds (framer). `splashTiming.ts` adds yet another unit. Recommended: Single motion-token module consumed by both Tailwind and framer-motion; delete unused keyframes.

**F11 — `transition-all` / `transition: all` (Easing/Perf) · both · MED · P2**
Where: `transition-all` ×50 (31 files); `index.css:78-80` `.transition-smooth { transition: all 0.2s }`. Plus the theme-switch global (`index.css:89-99`) applies `!important` transitions to `*`. Recommended: Replace with explicit `transition-colors`/`transition-transform`; keep the scoped theme-transition.

**F12 — Four overlapping scrollbar variants (Scrollbars) · design-system · MED · P2**
Where: `index.css:156-272`: Global `* { 2px, rgba(0,0,0,.10) }` + dark override; `.scrollbar-thin` → 2px thumb `#D4D4D4` / `var(--surface-border)`; `.scrollbar-hide` → none; `.scrollbar-auto-hide` → 2px, `rgba(200,200,200,.5)`. Inconsistent: Global, `.scrollbar-thin`, and `.scrollbar-auto-hide` all 2px but use four different thumb colors. Recommended: Collapse to one tokenized scrollbar (width + `--scrollbar-thumb` var) + `.scrollbar-hide` + an auto-hide modifier.

**F13 — prose-chat & hljs bypass the token system (Color tokens / Light mode) · design-system · HIGH · P2**
Where: `index.css:285-792` (~500 lines). The light-mode prose + syntax theme is entirely hardcoded hex: `#111827`, `#374151`, `#6B7280`, `#1f2937`, `#4b5563`, `#f3f4f6`, `#d1d5db`, `#e5e7eb` etc. (Tailwind gray defaults, NOT this project's gray scale — e.g. `#111827` is Tailwind gray-900, but config gray-900 = `#171717`). Inconsistent: These duplicate `--text-primary`/`--text-secondary`/`--text-muted` but as literals, not vars. Dark overrides (`:654-792`) mix `var(--surface-*)` (good) with hardcoded hex (bad). Why it matters: ~500 lines of color that won't follow any future token change; the single biggest token-bypass surface in the app. Recommended: Rewrite prose/hljs to consume `--text-*` and `--surface-*`; introduce `--syntax-*` tokens.

**F14 — Hardcoded hex in `.tsx`, worst offenders (Color tokens) · mixed · MED · P2**
Where: 250 hex across 52 files. Legitimately literal (canvas/lib/gradient): `TerminalPanel.tsx` (49 — xterm theme), `VoiceOrb.tsx` (13 — gradient shaders), `MermaidDiagram.tsx` (16), `mcpRegistry.tsx` (16 — brand icon colors), `ChibiAvatar.tsx`/`ClaudeCodeIcon.tsx`/`ProviderIcon`, `shaders-hero-section`. Should be tokens: `VoicePage.tsx` (23), `GoogleLoginButton.tsx` (8), `HeroBanner.tsx` (7), `ProjectContextPicker.tsx` (7), `activity/components.tsx` (10), `Card.tsx`/`AuthControls.tsx` (4). Recommended: Codemod chrome hex → tokens; give `TerminalPanel`/`Mermaid`/xterm a tokenized theme object that switches on `html.dark`.

**F15 — `--app-bg-dark` hardcoded duplicate of `--surface-page` (Dark mode) · design-system · LOW · P3**
Where: `index.css:10` `--app-bg-dark: #121212`; `index.css:64` `--surface-page (dark): #121212`. Same value, two vars; comment says it also feeds `bg-dark-100` (config `dark.100 = #121212`) — three names for #121212. Recommended: Collapse to `--surface-page`.

### Proposed complete semantic token set — light + dark

Mapped to current hex where it exists today (✚ = new/missing token to add). Implement as CSS vars in `:root` / `html.dark`, exposed through Tailwind `colors`.

| Token | Role | Light | Dark | Source today |
|---|---|---|---|---|
| `--surface-page` | Root/page bg | `#FFFFFF` | `#121212` | exists |
| `--surface-deep` | Sunken (terminal/browser) | `#F9FAFB` | `#161616` | exists |
| `--surface-base` | Card/dropdown bg | `#F5F5F5` | `#181818` | exists |
| `--surface-raised` | Elevated / default hover | `#EBEBEB` | `#1F1F1F` | exists |
| `--surface-lift` | Hover on raised | `#E5E5E5` | `#252525` | exists |
| `--surface-hover` ✚ | Explicit hover fill | `#EFEFEF` | `#242424` | hardcoded via `dark:` |
| `--surface-selected` ✚ | Selected/active row | `#E3E8EF` | `#2D2D2D` | hardcoded |
| `--surface-active` ✚ | Pressed | `#DADFE6` | `#333333` | hardcoded |
| `--surface-border` | Primary border | `#E5E5E5` | `#2A2A2A` | exists |
| `--surface-divider` | Thin inner divider | `#F3F4F6` | `#222222` | exists |
| `--text-primary` | Primary text | `#111827` | `#E5E5E5` | exists |
| `--text-secondary` | Secondary text | `#6B7280` | `#A3A3A3` | exists |
| `--text-muted` | Muted/placeholder | `#9CA3AF` | `#525252` | exists |
| `--text-disabled` ✚ | Disabled text | `#C4C9D0` | `#404040` | hardcoded |
| `--text-on-accent` ✚ | Text on filled accent | `#FFFFFF` | `#FFFFFF` | hardcoded |
| `--focus-ring` ✚ | Focus outline | `#4a6741` (luxury-600) | `#7d8471` (luxury-500) | hardcoded `ring-*` |
| `--state-success` ✚ | Success | `#4a6741` | `#86EFAC` | unused token / raw green |
| `--state-error` ✚ | Error | `#EF4444` | `#FCA5A5` | unused token / raw red |
| `--state-warning` ✚ | Warning | `#F59E0B` | `#FBBF24` | unused token |
| `--state-info` ✚ | Info | `#7d8471` | `#A3A3A3` | unused token |
| `--shadow-sm/md/lg/xl` ✚ | Elevation | `0 …/0.05` | `0 …/0.3` | manual `dark-*` shadow |
| `--scrollbar-thumb` ✚ | Scrollbar | `rgba(0,0,0,.10)` | `rgba(255,255,255,.08)` | 4 hardcoded variants |
| `--syntax-*` ✚ | hljs theme (8 roles) | gray #111827→#6b7280 | #E5E5E5→#525252 | hardcoded in index.css |

Type scale to formalize: add `2xs: 10px/14px`, `3xs: 9px/12px` to `fontSize`; codemod `text-[11px]`→`text-xs`, `text-[12px]`→`text-sm`, `text-[14px]`→`text-base`.

### Top 10 token / global-style problems (ranked)

1. Two parallel theming systems — manual `dark:` (1633) + gray (1704) vs auto `surface-*` (483). Pick one (surface-*), codemod the rest. (F1, P1, HIGH)
2. Arbitrary `text-[Npx]` everywhere — 614 uses, 100 files; the fontSize scale is bypassed even for sizes that already have tokens. (F6, P1, HIGH)
3. Missing state tokens — hover/selected/active/disabled/focus-ring/state-colors don't exist as tokens; all hand-rolled. (F5, P1, HIGH)
4. prose-chat + hljs = ~500 lines hardcoded hex (Tailwind-default grays), the largest single token bypass. (F13, P2, HIGH)
5. `dark.*` palette duplicates surface/text hex under different names. (F2, P2, MED)
6. 250 hardcoded hex in `.tsx` — half are UI chrome that should be tokens; lib themes (xterm/mermaid) aren't theme-aware. (F14, P2, MED)
7. Two divergent motion systems — Tailwind keyframes (4 of 5 dead) + ms durations vs framer-motion `animations.ts` in seconds. (F10, P2, MED)
8. Manual `dark-*` shadows + 50× `transition-all`. (F9/F11, P2, MED)
9. 4 redundant scrollbar variants, three of them 2px with four different hardcoded thumb colors. (F12, P2, MED)
10. Dead tokens — `luxury.*` (3 uses), `success/error/warning/info` (0 uses), `tracking-*-wide` name-collides; `#121212` has three names. (F4/F8/F15, P3, LOW)

Worst hardcoding hotspots: `src/components/ui/TerminalPanel.tsx`, `src/pages/VoicePage.tsx`, `src/pages/WorkspacePage.tsx`, `src/components/ModelLibraryPanel.tsx`, `src/components/SettingsDebugPanel.tsx`.

---

## Appendix B — Agent 2: Components & UI Primitives (full report)

Scope: `src/components/` (133 component files).

### Headline numbers

| Metric | Count | Source |
|---|---|---|
| Total component files | 133 (`.tsx`/`.ts`) | `src/components/**` |
| Raw `<button className=...>` | **277 across 92 files** | grep |
| `<Button>` primitive used in JSX | **0** | grep |
| Files importing `Button` | **1** (`FasterWhisperStatus.tsx` only) | grep |
| Hand-rolled modal backdrops (`fixed inset-0 ... backdrop-blur`) | **~14 distinct** | grep |
| `<Modal>` primitive used outside its own file | **0** | grep |
| Raw `<input>` | 28 across 20 files | grep |
| Raw `<textarea>` | 10 across 10 files | grep |
| Raw `<select>` (native) | 2 (WorkspacePage) | grep |
| `<Select>` primitive used | 0 in components/ (used in pages only) | grep |
| Hand-rolled toggle switches duplicating `Toggle.tsx` | ~4 files | grep |
| `style={{ }}` inline styles | **101 across 44 files** | grep |
| `animate-spin` inline spinners (no Spinner primitive) | 38 across 22 files | grep |
| Bespoke z-index values (`z-[...]`) | 70 across 47 files | grep |
| Repeated `rounded-* border border-{gray,surface}` card chrome | 39 across 23 files | grep |

Central finding: a primitive layer exists (`Button`, `Card`, `Modal`, `Select`, `Toggle`, `SettingsRow`) but is almost entirely unadopted. `Button` and `Modal` are effectively dead code.

### Q1 — Primitive vs product mixing in `components/ui/`

`components/ui/` holds ~60 files, but only ~7 are true generic primitives.

TRUE generic primitives (keep): `Button.tsx`, `Card.tsx`, `Modal.tsx`, `Select.tsx`, `Toggle.tsx`, `SettingsRow.tsx`, `ExternalLink.tsx`.

Product-specific components that DO NOT belong in `/ui`:

| File | Lines | What it is | Proposed home |
|---|---|---|---|
| `TerminalPanel.tsx` | 603 | xterm.js PTY terminal | `features/workspace/terminal/` |
| `BrowserPanel.tsx` | 457 | embedded browser host | `features/workspace/browser/` |
| `NativeBrowserHost.tsx` | — | Tauri webview host | `features/workspace/browser/` |
| `ArtifactPanel.tsx` + `artifact/*` | 141 | artifact viewer | `features/artifacts/` |
| `ToolCallCard`, `ToolCallChain`, `ToolApprovalCard`, `ToolPermissionCard`, `HarnessPermissionModal`, `HarnessStepCard`, `InlineToolSteps`, `ActivityCard`, `ActivityCardHeader` | — | agent tool-call UI | `features/agent/` or `features/tools/` |
| `ThinkingBlock`, `chain/*`, `StreamingText` | — | reasoning display | `features/chat/reasoning/` |
| `content/*` (AgentContent, MemoryContent, ProgressContent, SearchResultContent, SimpleToolContent, LocationCard, WeatherCard) | — | tool-result renderers | `features/tools/content/` |
| `renderers/*` (CsvTable, HtmlPreview, JsonRenderer, LatexRenderer, SvgRenderer, TextBlock) | — | content-type renderers | `features/renderers/` |
| `CodeBlock`, `MarkdownComponents`, `MermaidDiagram` | 362/225/213 | markdown rendering | `features/markdown/` |
| `VoiceOrb`, `TokenRing`, `ChibiAvatar`, `ClaudeCodeIcon` | 209/—/206 | brand/voice visuals | `features/voice/` or `brand/` |
| `AppsPopover`, `AskUserQuestionCard`, `ConnectionStatusBar`, `ContextIndicator`, `DocumentStorageModal`, `ErrorDisplay`, `ShortcutRecorder`, `SummaryPanel`, `TaskPill`, `TodoWriteCard`, `VideoPlayer`, `shaders-hero-section` | — | misc product | various `features/*` |

Roughly 53 of 60 `/ui` files are misfiled. Category: architecture. Risk: low (moves only). Priority: medium.

### Q2 — Button / Input / Select / Modal adoption audit

`Button.tsx` (`src/components/ui/Button.tsx:1-68`): well-built. Variants `primary | ghost | outline | destructive`; sizes `sm | md | lg`; props `leftIcon`, `rightIcon`, `loading`, `className`, full `HTMLMotionProps` passthrough. Spinner built in. Adoption: 0 JSX usages. Imported by exactly 1 file (`FasterWhisperStatus.tsx`, 8 usages — `:175,185,243,338,347,382,430`). Against 277 raw `<button className=...>` across 92 files. Worst offenders: `BrowserPanel.tsx` (15), `ProjectContextPicker.tsx` (11), `WorkspacePage.tsx` (11), `ModelLibraryPanel.tsx` (8), `TitleBar.tsx` (8), `MessageActions.tsx` (8), `ManagePanel.tsx`/`ConversationsDropdown.tsx`/`SettingsDebugPanel.tsx`/`ExtensionsPage.tsx` (7 each). Category: design-system + architecture. Risk: medium. Priority: high.

`Modal.tsx`: clean primitive with `Modal`, `ModalHeader`, `ModalDivider`, `ModalFooter`; sizes `sm|md|lg|xl`; `disableBackdropClose`. Adoption: 0 outside its own file. Instead ~14 hand-rolled `fixed inset-0 ... backdrop-blur` overlays: `CommandPalette.tsx:104`, `ChatPage.tsx:368`, `ExtensionsPage.tsx:400`, `ModelLibraryPanel.tsx:554`, `AppConnectModal.tsx:50`, `OfflineModal.tsx:41`, `UnrealSetupModal.tsx:16`, `PermissionDialog.tsx:20`, `ProjectContextPicker.tsx:177/229/240`, `RenameModal.tsx:22/30`, `HarnessPermissionModal.tsx:34/43`, `DocumentStorageModal.tsx:54`, `MarkdownComponents.tsx:53`. Each picks its own z-index (`z-50`, `z-[100]`, `z-[200]`, `z-[300]`, `z-[9999]`) and backdrop opacity/blur. Category: both. Risk: medium. Priority: high.

`Select.tsx` (Radix-backed, good): used in pages but ~0 in `components/`. Native `<select>` only in `WorkspacePage.tsx` (2). Inputs: no `Input`/`Textarea` primitive exists — 28 raw `<input>` + 10 raw `<textarea>` each carry bespoke class strings. Priority: medium.

`Toggle.tsx`: only 1 `role="switch"` (its own). But 4 files hand-roll toggle-shaped switches (`IntelligenceView`, `ModelsPage`, `ExtensionsPage`, `AppConnectModal`). Priority: medium.

### Q3 — Duplicated implementations

- Modals/backdrops: ~14 copies. No shared primitive used.
- Dropdowns/popovers: hand-rolled portal+click-outside+escape logic duplicated in `ExternalLink.tsx:55-79`, `ProjectContextPicker.tsx`, `ModelLibraryPanel.tsx`, `ConversationsDropdown.tsx`, `AppsPopover.tsx`, `NavPopup.tsx`. `createPortal` in 4 component files. No `Popover`/`Dropdown` primitive.
- Cards: `Card.tsx` exists but raw chrome `rounded-* border border-{gray,surface} bg-surface-base` appears 39 times across 23 files.
- Icon buttons: `p-1.5 rounded hover:bg-{gray,surface}` pattern 10+ times; no `IconButton`. The Modal's own close button (`Modal.tsx:92-100`) is a hand-rolled icon button.
- Spinners: `animate-spin` 38× across 22 files — no standalone `Spinner`.

### Q4 — Repeated Tailwind class clusters (worst)

1. Card chrome `rounded-xl border border-gray-* dark:border-surface-border bg-* dark:bg-surface-base` — 39 occurrences / 23 files.
2. Modal shell `fixed inset-0 z-* flex items-center justify-center bg-black/NN backdrop-blur-*` — ~14.
3. Input field `px-3 py-2 text-sm bg-white/surface border rounded-md` — recurring across 28 raw inputs.
4. Icon button `p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-surface-lift transition-colors` — repeated; verbatim in `Modal.tsx:94`.
5. Toggle pill `h-5 w-9 rounded-full transition-colors` — 5 files.
6. Primary pill button `bg-gray-900 dark:bg-gray-200 text-white dark:text-gray-900 rounded-full hover:bg-gray-800` — `ExternalLink.tsx:127` and elsewhere.

### Q5 — Inline styles

101 `style={{ }}` across 44 files. Heaviest: `FloatingIsland.tsx` (12), `JsonRenderer.tsx` (8), `VoiceOrb.tsx` (7), `TranscriptionOverlay.tsx` (6), `ConversationRail.tsx` (6), `PulseCardView.tsx`/`IslandAtoms.tsx` (5 each), `HeroBanner.tsx`/`ChibiAvatar.tsx`/`BrowserPanel.tsx` (3-4 each). Much is legitimately dynamic (animation transforms in overlay/island/voice components). But arbitrary inline colors/spacing in `JsonRenderer`, `HeroBanner`, `ComposioCards`, `MarkdownComponents` are static and should be Tailwind. Priority: low-medium.

### Q6 — Inconsistent props/variants across primitives

| Primitive | variant prop | size prop | className passthrough | onClose/onChange |
|---|---|---|---|---|
| `Button` | `variant` ✓ | `size` ✓ | ✓ + `...HTMLMotionProps` | — |
| `Card` | `variant` ✓ | `padding` (not `size`) | ✓ + `...HTMLAttributes` | — |
| `Modal` | ✗ | `size` ✓ | ✓ (manual, no spread) | `onClose` ✓ |
| `Select` | ✗ | ✗ | ✓ (manual) | `onChange` ✓ |
| `Toggle` | ✗ | `size` (`sm|md` only) | ✓ (manual) | `onChange` ✓ |
| `SettingsRow` | `orientation` | ✗ | ✓ | — |

Inconsistencies: size scales differ; only Button/Card spread native props (Select/Toggle/Modal swallow `id`/`aria-*`/`data-*`); no shared `variant` convention.

### Q7 — Oversized / multi-responsibility components

- `ModelLibraryPanel.tsx` (732) — filter constants/predicates, portal+modal shell, provider rail, model list, detail card, search, grouping/sort. Split: extract `useModelFilters`, split rail/list/detail; reuse `Modal`.
- `TerminalPanel.tsx` (603) — xterm lifecycle, PTY IPC, theme defs, tab management, resize. Move IPC + theme to `useTerminalSession`/`terminalService`.
- `SettingsDebugPanel.tsx` (506) — many independent debug sections; split per concern.
- `BrowserPanel.tsx` (457) — webview host + nav toolbar (15 raw buttons) + state; split toolbar out.

### Q8 — Missing abstractions

Confirmed absent: `Input`, `Textarea`, `Badge`/`Pill`, `Tooltip`, `Dropdown`/`Popover`, `Spinner`/`Loader`, `EmptyState`, `IconButton`, `Drawer`, `Panel`.

Should exist: `IconButton` (close-button + 10+ repeats), `Input`/`Textarea` (38 raw), `Popover`/`Dropdown` (4+ hand-rolled; can wrap Radix), `Spinner` (38 repeats), `Badge`/`Pill`, `Tooltip` (replaces `title=`), `EmptyState`, `Panel`/`Drawer`.

Library usage: `sonner` wired centrally (good — a thin `notify()` wrapper would standardize). `cmdk` used only in `CommandPalette.tsx`. Radix Select used in `Select.tsx` only — Radix Dialog/Popover/Tooltip are obvious bases for missing primitives.

### Proposed component taxonomy

`components/ui/` — primitives only (add missing): `Button`, `IconButton`*, `Card` (+Header/Body/Divider), `Modal` (+Header/Footer/Divider), `Select`, `Input`*, `Textarea`*, `Toggle`, `SettingsRow`/`SettingsSection`, `ExternalLink`, `Badge`*, `Spinner`*, `Tooltip`*, `Popover`/`Dropdown`*, `EmptyState`*, `Panel`/`Drawer`* (* = to create).

`components/layout/`: `Container`, `MainLayout`, `TitleBar`, `FloatingMenu`, `NavPopup`, `ContextMenu`.
`components/feedback/`: `ConnectionStatusBar`, `ErrorDisplay`, `OfflineIndicator`, `OfflineModal`, `UpdateBanner`, `SplashScreen`, `FasterWhisperStatus`/`OllamaStatus`/`LMStudioStatus`/`LocalProviderStatus`.
`components/overlays/`: `FloatingIsland`, `IslandAtoms`, `PulseCardView`, `TranscriptionOverlay`, `CommandPalette`, `PermissionDialog`, `InlinePermissionRequest`.
`features/chat/`: everything in `chat/`; plus `ThinkingBlock`, `chain/*`, `StreamingText`, `CollapsibleUserText`.
`features/workspace/`: `rightWorkspace/*`, `TerminalPanel`, `BrowserPanel`, `NativeBrowserHost`.
`features/agent-tools/`: `ToolCallCard`, `ToolCallChain`, `ToolApprovalCard`, `ToolPermissionCard`, `Harness*`, `InlineToolSteps`, `ActivityCard*`, `TodoWriteCard`, `TaskPill`, `content/*`.
`features/artifacts/`: `ArtifactPanel`, `artifact/*`, `SummaryPanel`.
`features/markdown/`: `CodeBlock`, `MarkdownComponents`, `MermaidDiagram`, `renderers/*`.
`features/models/`: `ModelLibraryPanel`, `ModelPicker`, `ProviderIcon`, `TierSelector`.
`features/extensions/`: `extensions/*`.
`features/voice/`: `VoiceOrb`, `VoiceInput`, `AudioWaveform`.
`brand/`: `StudioMark`, `ChibiAvatar`, `ClaudeCodeIcon`, `shaders-hero-section`.

### Ranked top 10 component problems

1. `<Button>` primitive is dead code — 277 raw buttons, 0 `<Button>` usages, 1 importer. (design-system+arch, high)
2. `<Modal>` primitive unadopted — ~14 hand-rolled backdrops with divergent z-index/opacity/blur. (both, high)
3. No z-index scale — 70 bespoke `z-[...]` values (`z-50`→`z-[10000]`). (design-system, high)
4. `/ui` folder polluted — ~53 of 60 files are product-specific. (architecture, medium)
5. Card chrome copy-pasted 39× despite `Card.tsx` existing. (design-system, high)
6. Missing input layer — no `Input`/`Textarea`; 38 raw fields. (design-system, high)
7. Missing `IconButton`/`Spinner`/`Popover` — 38 inline spinners, 4 hand-rolled portal popovers, 10+ icon buttons. (design-system, high)
8. Oversized multi-responsibility panels — `ModelLibraryPanel` (732), `TerminalPanel` (603), `BrowserPanel` (457). (architecture, medium)
9. 101 inline `style={{}}` — much static styling that belongs in Tailwind/CSS vars. (design-system, low-med)
10. Inconsistent primitive APIs — size scales differ; only Button/Card spread native props; duplicated `Toggle` switches. (design-system, medium)

Note: `src/components/index.ts` barrel exports only 3 of 7 primitives, omits Card/Modal/SettingsRow/ExternalLink.

---

## Appendix C — Agent 3: Pages & Feature Architecture (full report)

Scope: `src/` only.

### Executive characterization

This is a layer-organized codebase drifting into a hybrid mess. The top-level split is classic technical-layer (`pages/`, `components/`, `hooks/`, `contexts/`, `services/`, `utils/`, `types/`, `constants/`, `config/`). There is no feature/ directory and no feature-folder discipline — every feature (chat, voice, computer-use, workspace, transcription) is smeared horizontally across all layers. The few sub-folders that exist (`pages/settings/`, `pages/manage/`, `pages/activity/`, `contexts/chat/`) are inconsistent, ad-hoc local exceptions. Naming is inconsistent across three suffix conventions (`Page` / `View` / `Panel`), constants live in four places, types in ten. No path aliases — all imports relative.

Single most important structural fact: there is no router. `App.tsx` does manual conditional rendering; "navigation" is a `switch(currentView)` inside `HomePage.tsx` (lines 82–105) driven by local `useState`. Router-style artifacts (`ProtectedRoute`, `AuthCallback` path check) exist but are vestigial.

### Findings

**1. No router; navigation is a switch statement.** Location: `src/App.tsx` (243–272), `src/pages/HomePage.tsx` (67–106). Pages selected by `switch (currentView)` over a `View` string union (`src/types/navigation.ts`). `ProtectedRoute` and `/oauth/callback` pathname check are leftovers. No deep-linking, no route-based code-splitting, every page statically imported into `HomePage` (17–28) and bundled eagerly. Recommended: commit to the switch (delete `ProtectedRoute`) or adopt a real router with lazy routes. Risk: Medium · Priority: Medium.

**2. `contexts/chat/` is a feature module masquerading as a context.** Location: `src/contexts/chat/` (14 files; `ChatProvider.tsx` = 1355 lines, plus `buildChatRequest.ts`, `buildSendContext.ts`, `catchUp.ts`, `contextCompactor.ts`, `messageBuilder.ts`, `notifications.ts`, `projectContextStorage.ts`, `toolClassifier.ts`, `toolExecutor.ts`, `constants.ts`, `types.ts`). Not a context — it's the entire chat feature's business logic. `ChatContext.tsx` is a 13-line backward-compat re-export shim. A 1355-line provider holding tool execution + token pruning + notifications + storage is the central god-object. Recommended: Promote to `features/chat/` with `provider/`, `request/`, `tools/`, `context/` submodules. Risk: High · Priority: High.

**3. Constants fragmented across FOUR locations.** `src/utils/constants.ts` (19 lines) · `src/config/constants.ts` (222 lines) · `src/constants/animations.ts` + `splashTiming.ts` (90 + 2) · `src/contexts/chat/constants.ts` (76 lines). No rule distinguishes them. `config/` also holds `autoMode.ts` and `tauriConfig.ts`. Recommended: One `src/constants/` for app-wide static values; keep `src/config/` strictly for environment/runtime config; feature-local constants stay with the feature. Risk: Low · Priority: Medium.

**4. `.tsx` files in `utils/` — JSX in a utility layer.** `src/utils/mcpRegistry.tsx` (226 lines, contains `Context7RegistryIcon` SVG + icon-returning registry) · `src/utils/toolCardUtils.tsx` (130 lines). `utils/` should be pure, JSX-free helpers. Recommended: Move `mcpRegistry.tsx` → `src/components/mcp/` (or `features/mcp/registry.tsx`); move `toolCardUtils.tsx` → near tool-card components. Risk: Low · Priority: Medium.

**5. Pages: flat-file vs folder inconsistency.** Flat: `ChatPage.tsx` (677), `WorkspacePage.tsx` (981), `VoicePage.tsx` (512), `ComputerUsePage.tsx` (386), `ModelsPage.tsx` (427), `ExtensionsPage.tsx` (454). Folders: `pages/settings/` (5 `*View.tsx` + `shared.tsx`), `pages/manage/`, `pages/activity/`. The two largest pages got no folderization. Folderized pages use `View` suffix while parent is `Page`. Recommended: `WorkspacePage` and `ChatPage` are top folderization candidates. Risk: Medium · Priority: High (for Workspace/Chat).

**6. Types fragmented across `src/types/` + 9 co-located `types.ts`.** Central: `src/types/{conversation,index,navigation,pulse}.ts`. Co-located: `agent/types.ts`, `components/rightWorkspace/types.ts`, `contexts/chat/types.ts`, `pages/activity/types.ts`, `pages/manage/types.ts`, `services/ai/types.ts`, `services/connection/types.ts`, `services/inputs/image/types.ts`, `services/storage/backends/types.ts`. `src/types/index.ts` (182 lines) is a catch-all. Co-located types are good — problem is the inconsistency and the fat central `index.ts`. Recommended: shared domain types in `src/types/`; feature/module-local types co-located. Risk: Low · Priority: Low.

**7. Inconsistent / incomplete barrel exports.** `contexts/index.ts` (5 of 11) · `hooks/index.ts` (7 of ~40) · `components/index.ts` (18 of ~50) · plus `contexts/chat/index.ts`, `components/brand/index.ts`, `components/rightWorkspace/index.ts`, `services/connection/index.ts`. Barrels wildly partial; both import styles coexist with no rule. Recommended: make barrels complete and mandatory, or delete the partial ones. Risk: Low · Priority: Medium.

**8. No path aliases — all imports relative.** `tsconfig.json` (no `baseUrl`/`paths`). 8 files reach `../../../`. Recommended: Add `paths: { "@/*": ["src/*"] }` (plus Vite `resolve.alias`). Prerequisite for folder moves. Risk: Low · Priority: High (enables everything else).

**9. `services/` granularity is inconsistent.** Single-file "folders": `services/chat/` (1: `searchConversations.ts`), `services/context/` (1), `services/agents/` (1), `services/mcp/` (1: `mcpInvoker.ts`), `services/local/` (1: `daemonClient.ts`). Vs `services/ai/` = 18 files (8+ `model*Service.ts`, near-duplicate names `modelService`/`modelsService`/`modelFilter`/`modelCapabilityService`/`modelUtils`). `services/chat/searchConversations.ts` overlaps `services/conversations/`. Recommended: Collapse single-file folders; split `services/ai/` into `ai/models/`, `ai/streaming/`, `ai/chat/`; resolve `modelService`/`modelsService`. Risk: Low–Medium · Priority: Medium.

**10. Naming convention drift: Page vs View vs Panel.** `pages/*Page.tsx` vs `pages/settings/*View.tsx` + `pages/manage/*View.tsx` vs `components/rightWorkspace/*Panel.tsx`. Plus mixed casing — PascalCase components vs lowercase `components.tsx`, `helpers.ts`, `shared.tsx`. Recommended: `*Page` = top-level routed view; `*View` = sub-section; `*Panel` = docked/resizable surface. PascalCase = one component per file; lowercase plural only for intentional multi-export barrels. Risk: Low · Priority: Low.

### Proposed target architecture

```
src/
  app/            # App.tsx, main.tsx, MainApp, AppRouter, provider composition, init
  pages/          # ONLY thin route entries (one file each), delegate to features/
  features/       # feature modules — each: components/ hooks/ services/ context/ types.ts constants.ts
    chat/         #  ← contexts/chat/* + ChatPage + components/chat/* + hooks/useAgentChat,useChatScroll,useAtMention…
    voice/        #  ← VoicePage + LiveSessionContext + hooks/useLiveSession,useTTS,useVoiceInput
    workspace/    #  ← WorkspacePage(981) + components/rightWorkspace/* + hooks/useTerminalPanel,useBrowserPanel,useRightWorkspace
    computerUse/  #  ← ComputerUsePage + hooks/useComputerUse + services/computerUse
    transcription/#  ← TranscribePage + hooks/useAudioRecorder,useFasterWhisper + services/fasterWhisper
    settings/     #  ← pages/settings/*View + SettingsContext
    manage/       #  ← pages/manage/*
    activity/     #  ← pages/activity/*
    models/ extensions/ memories/ mcp/  # ← utils/mcpRegistry.tsx lands in features/mcp/registry.tsx
  components/     # GENERIC shared UI only (ui/, layout/, brand/, icons/)
  hooks/          # GENERIC hooks only: useDebounce, useOnClickOutside, useCrossPlatform, useAutoResizeTextarea, useAppUpdater
  contexts/       # GLOBAL app contexts only: Auth, Settings, Models, Navigation, Offline, CommandPalette
  services/       # cross-cutting infra only: connection, storage, network, errors, logging, platform, notifications, auth
  utils/          # PURE helpers only — no .tsx, no JSX
  constants/      # ALL app-wide static values (merge utils/constants + config/constants statics + constants/*)
  config/         # runtime/env config only (autoMode, tauriConfig)
  types/          # shared domain types only (slim index.ts); feature types co-located
  styles/ assets/ tokens/
```

Top-offender mapping:
| Current | → Destination |
|---|---|
| `contexts/chat/` (15 files, 1355-line provider) | `features/chat/` |
| `pages/WorkspacePage.tsx` (981) + `components/rightWorkspace/` | `features/workspace/` |
| `pages/ChatPage.tsx` (677) | `features/chat/ChatPage.tsx` |
| `utils/mcpRegistry.tsx`, `utils/toolCardUtils.tsx` | `features/mcp/`, `components/ui/` |
| `pages/settings/`, `manage/`, `activity/` | `features/{settings,manage,activity}/` |
| Feature hooks (`useLiveSession`, `useComputerUse`, `useTerminalPanel`, `useBrowserPanel`, `useFasterWhisper`, `useAudioRecorder`) | their feature folder |
| `utils/constants.ts` + statics from `config/constants.ts` + `constants/*` | unified `constants/` |
| `services/{chat,context,agents,mcp,local}` (1-file each) | flatten/merge |

### Proposed naming + import conventions
- Suffixes: `*Page` routed screen · `*View` sub-section · `*Panel` docked surface · `*Provider`/`use*` contexts/hooks · `*Service` infra.
- Files: PascalCase = exactly one React component. lowercase only for `index.ts` barrels. Convert `components.tsx`/`shared.tsx`/`helpers.ts` into folders or role-specific names.
- Imports: add `@/*` alias. Cross-feature imports go through the feature's `index.ts` barrel only. Make barrels complete or delete them — no partials.

### Top 10 architecture problems (ranked)
1. `contexts/chat/` is a disguised feature module with a 1355-line god-provider.
2. No router — navigation is a `switch` + `useState`, no lazy loading.
3. No feature folders — every feature smeared across all layers.
4. No path aliases; do this first.
5. `WorkspacePage` (981) & `ChatPage` (677) un-folderized while smaller pages folderized.
6. Constants in 4 locations.
7. `.tsx` (JSX) files inside `utils/`.
8. Partial/inconsistent barrels.
9. `services/ai/` 18-file grab-bag with near-duplicate names + 5 one-file "folders".
10. Three naming suffixes for screens + mixed file casing.

### Dead-code candidates (with evidence)
| File | Evidence | Confidence |
|---|---|---|
| `src/components/ui/ChibiAvatar.tsx` | Grep across repo (excluding self) = 0 importers | High — dead |
| `src/pages/ComingSoon.tsx` | Only matches are its own definition; never imported (HomePage uses inline "Help" div) | High — dead |
| `src/components/ProtectedRoute.tsx` | Exported in barrel but App.tsx has no router; auth gating via bare `if` | High — vestigial |
| `src/pages/SplashPreviewPage.tsx` | Reachable only via `?splashPreview=1` (`App.tsx:42,280`) | Medium — dev-only, keep if intentional |
| `src/pages/ShaderWelcomePage.tsx` | Live — rendered for unauthenticated users (`App.tsx:255,267`). NOT dead | n/a |
| `shaders-hero-section` | No file/symbol found anywhere in `src/` | Likely already removed |
| `TranscribePage`/`MemoriesPage`/`VoicePage` | All routed via `HomePage` switch — NOT dead | n/a |

Caveat: confirm `ChibiAvatar` and `ComingSoon` aren't referenced dynamically before deletion. `SplashPreviewPage` is intentionally URL-gated dev tooling.

---

## Appendix D — Agent 4: Interaction, Accessibility & Motion (full report)

Read-only. Quantities are ripgrep counts over `src/`.

### Headline metrics

| Signal | Count | Implication |
|---|---|---|
| `hover:` utilities | **349** across 108 files | Hover is everywhere… |
| `focus-visible:` utilities | **12** across 6 files | …but keyboard focus is almost absent |
| `focus:ring` | 7 | scattered |
| `focus:outline` | 24 | scattered, competes with `focus:ring` |
| `outline-none` | **40** across 27 files | many kill the native ring |
| `disabled:` utilities | 52 / 26 files | inconsistent (also `opacity-50` hand-rolled) |
| `active:` utilities | 18 / 13 files | rare; press feedback mostly via framer `whileTap` |
| `role="dialog"` | **1** | 16 modal overlays, 1 has the role |
| `aria-modal` | **0** | no modal announces itself to AT |
| `prefers-reduced-motion` | **1** (JS only, `useAutoResizeTextarea.ts:35`) | critical motion-a11y gap |
| `duration: 0.x` inline (framer) | **195** / 85 files | per-component magic numbers |
| `ease: [...]` inline cubic-beziers | ~54 occurrences | bespoke easings everywhere |
| `duration-NNN` inline (CSS classes) | **252** / 81 files | tailwind duration tokens unused |
| `toast(` call sites | spread across 6 files | no wrapper, but centralized lib |

### Findings by category

**1. Focus rings — CRITICAL a11y gap.** `src/index.css` has no `:focus-visible` rule; `tailwind.config.js` has no focus-ring token; `Button.tsx:31` is the only place with a real ring (`focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2`). 4 different focus paradigms coexist: (a) `focus-visible:ring` (12 total), (b) `focus:ring` (7), (c) `focus:outline-none focus:ring`, (d) `outline-none` with no replacement (40 occurrences, 27 files — e.g. `CommandPalette.tsx:129`, `Select.tsx:56`). The majority of interactive elements define no focus style. WCAG 2.4.7 failure. Risk: High. Priority: 1.

**2. Reduced-motion — CRITICAL a11y gap.** Only `useAutoResizeTextarea.ts:35` checks `matchMedia("(prefers-reduced-motion: reduce)")`. Zero `@media (prefers-reduced-motion)` in CSS; framer components never gate on `useReducedMotion()`. Infinite animations run unconditionally — `OfflineModal.tsx` (falling tears `repeat: Infinity`, floating face, pulsing halo), `animate-pulse`/`animate-spin`/`shimmer`/`listening`, `SPIN_ANIM` (`animations.ts:81`), splash exit. WCAG 2.3.3. Highest-leverage fix: one global CSS block + one framer hook. Risk: High. Priority: 2.

**3. Modals — no focus trap, no Esc, no ARIA, heavy duplication.** `ui/Modal.tsx` does not trap focus, does not close on Esc (only backdrop click), has no `role="dialog"`, no `aria-modal`, no `aria-labelledby`, does not restore focus on close. Bespoke re-implementations bypass it entirely: `PermissionDialog`, `HarnessPermissionModal`, `RenameModal`, `DocumentStorageModal`, `AppConnectModal`, `UnrealSetupModal`, `OfflineModal`, plus inline modals in `ExtensionsPage.tsx:400`, `ChatPage.tsx:368`, `MarkdownComponents.tsx:53`. Measured inconsistencies: backdrop opacity (`bg-black/10,/25,/30,/40,/50,/60,/80` — 7 scrims), blur (`[2px],[3px],[5px],-sm,none`), z-index (`z-50,z-[100],z-[200/201],z-[300],z-[9998/9999]`), entry durations (0.15/0.18/0.2/0.22/0.25/0.28/0.3/0.4s), eases (`[0.16,1,0.3,1]`,`[0.4,0,0.2,1]`,`[0.23,1,0.32,1]`,`easeOut`). Esc handled only by `RenameModal` + `CommandPalette`. WCAG 2.1.2, 4.1.2. Risk: High. Priority: 3.

**4. Backdrop / blur treatment — not tokenized.** 20 `fixed inset-0 ... backdrop-blur` sites + decorative `backdrop-blur-2xl` on NavPopup/ContextMenu/FloatingIsland/SplashPreview. No `--scrim`/`bg-overlay` token. Risk: Medium. Priority: 6.

**5. Popovers / context menus / tooltips.** `ContextMenu.tsx`: bespoke window-level contextmenu listener; closes on outside mousedown but not Escape, no `role="menu"`, no arrow-key nav, no focus management. `MessageActions.tsx:201` and `ChatComposer.tsx:238` DO use `role="menu"`/`role="menuitem"` — applied in 2 places but not in ContextMenu/NavPopup/AppsPopover/FloatingMenu. Tooltips: no tooltip primitive; 151 `title=` attributes across 60 files. `useOnClickOutside.ts` (mousedown + Escape) is the good shared pattern, used by 7 popovers. Risk: Medium. Priority: 7.

**6. Command palette — mostly good.** `CommandPalette.tsx` uses `cmdk` (arrow nav, `data-[selected=true]` styling, debounced search, Esc at :119, `Command.Empty`). Best-implemented interaction surface. Gaps: input `focus:outline-none` with no ring; backdrop/animation still hand-rolled. Low priority.

**7. Loading states — many ad-hoc spinners, no primitive.** No shared Spinner/Skeleton/Loader. `Button.tsx:62` hand-rolls a border-spinner; `animate-spin` on phosphor `SpinnerGap`/`Spinner` scattered (WorkspacePage ×7, etc.); `animate-pulse` dots/skeletons in ActivityPage (×4), ContextIndicator, ActiveToolBar; `shimmer` used once (`ActivityCard.tsx:79`); plain "Loading..." text vs "Loading…" vs `EmptyState` reused as loader (`WorkspacePage.tsx:853`). Risk: Medium. Priority: 5.

**8. Empty & error states — duplicated.** `EmptyState` defined locally inside `WorkspacePage.tsx:102`, not exported. Error UI split: `ErrorDisplay.tsx`, `ErrorBoundary.tsx`, inline toasts via `errorNotificationService.ts`. Risk: Low–Medium. Priority: 8.

**9. Toasts — centralized lib, no wrapper.** `sonner` mounted once in `App.tsx:33` (`<Toaster richColors position="top-center">`). `toast()` called raw from 5+ modules. No `notify.success/error` wrapper. Priority: 9.

**10. Contrast risks.** `--text-muted: #525252` on dark `#121212` ≈ 3.0:1 — fails AA for normal text. `--text-muted: #9CA3AF` (light) on white ≈ 2.6:1 — fails AA. `dark:text-gray-600 (#525252)` used for 10–11px helper text (ContextMenu:98, CommandPalette:94). Placeholder `dark:placeholder-gray-600` borderline. Risk: Medium. Priority: 4.

**11. Disabled state — two competing conventions.** `disabled:opacity-50` (Button hand-codes `opacity-50 cursor-not-allowed` at :50; 52 `disabled:` utilities) vs ad-hoc conditional class strings. No semantic disabled token. Risk: Low. Priority: 10.

**12. Selected/active state — no token.** Expressed three ways: framer `whileTap` scale (Button, PRESS_SCALE), `data-[selected=true]:bg-gray-100` (CommandPalette), `data-[state=checked]`/`data-[highlighted]` (Radix Select), ad-hoc `aria-selected` (TierSelector). Risk: Low–Medium.

### Proposed interaction-state token set + focus-ring rule

```
/* semantic interaction tokens (CSS vars, light + dark like surface-*) */
--state-hover:    var(--surface-raised);   /* hover surface */
--state-active:   var(--surface-lift);      /* pressed/selected surface */
--state-selected: var(--surface-lift);
--focus-ring:     #111827;  /* light */     /* dark: #E5E5E5 */
--scrim:          rgb(0 0 0 / 0.50);         /* single modal backdrop */
```

Single focus-ring rule (global, replaces the 40 ad-hoc `outline-none`):
```css
:where(a, button, input, select, textarea, [role="button"], [tabindex]):focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
  border-radius: inherit;
}
*:focus:not(:focus-visible) { outline: none; }
```
z-index scale token: `z-overlay (40)`, `z-modal (50)`, `z-popover (60)`, `z-toast (70)`, `z-context (80)`.

### Proposed motion rules

- Adopt the existing tokens. `tailwind.config.js` already defines `transitionDuration` (fast 150 / normal 250 / slow 350) and `transitionTimingFunction` — essentially unused (252 inline `duration-NNN`). Mandate `duration-fast/normal/slow` + `ease-standard`; forbid raw `duration-[..]`.
- Framer: route everything through `constants/animations.ts`. The 195 inline `duration: 0.x` + ~54 inline `ease: [...]` collapse into these. Standardize on 3 durations (0.15/0.2/0.3) and 2 eases (`[0.16,1,0.3,1]` enter, `[0.4,0,0.2,1]` move).
- Reduced-motion policy:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .001ms !important; animation-iteration-count: 1 !important;
    transition-duration: .001ms !important; scroll-behavior: auto !important;
  }
}
```
  and gate framer entrances with `const reduce = useReducedMotion()`.

### Proposed accessibility rules

1. Every modal: `role="dialog" aria-modal="true" aria-labelledby` + focus trap + Esc + focus restore — implemented once in `Modal.tsx`.
2. No `outline-none` without the global `:focus-visible` ring (lint rule).
3. Icon-only buttons require `aria-label` (151 `title=` should become `aria-label` where icon-only, real tooltip otherwise).
4. Menus use `role="menu"/menuitem"` + arrow-key nav + Esc (standardize on MessageActions pattern + `useOnClickOutside`).
5. Build a real `Tooltip` primitive (Radix) to replace native `title=`.
6. Contrast floor: muted text ≥4.5:1 — raise dark `#525252`→ ~`#737373`, light `#9CA3AF`→ ~`#6B7280`; stop using gray-600 for <12px text.

### Ranked top 10 interaction/a11y problems

1. No reduced-motion support anywhere (1 JS check, 0 CSS).
2. No focus-visible ring system — 12 `focus-visible:` vs 349 `hover:`, 40 `outline-none` suppress native ring.
3. Modals don't trap focus, lack `role="dialog"`/`aria-modal` (1/0), inconsistent Esc.
4. Muted-text contrast failures — `#525252` on `#121212` (~3:1), `#9CA3AF` on white (~2.6:1).
5. No shared loading primitive.
6. Backdrop/scrim/blur/z-index untokenized — 7 scrim opacities, 4 blur radii, 6 z-index tiers.
7. ContextMenu & popovers lack menu ARIA + keyboard nav + Esc.
8. EmptyState/error states duplicated.
9. Toasts called raw — no `notify` wrapper.
10. Disabled & selected states untokenized.

Highest leverage: items 1 and 2 are each a single global CSS block plus one hook/rule; item 3 is one `Modal.tsx` upgrade that eliminates ~7 bespoke modals.

---

## Appendix E — Agent 5: Icons & Product Language (full report)

Scope: `src/` only. All counts real, derived from grep.

### Full Icon-Source Inventory

| Source | Count | Notes |
|---|---|---|
| `@phosphor-icons/react` imports | **107 files** | Primary library. 115 distinct icons. ~532 render sites (by `size={n}`). |
| `simple-icons` (provider/brand SVG paths) | **2 files** | `ProviderIcon.tsx` (9 marks), `rightWorkspace/ProjectLauncher.tsx` (9 dev-app marks) |
| Inline `<svg>` | **46 occurrences / 24 files** | Heaviest: `mcpRegistry.tsx` (6), `ExtensionIcons.tsx` (4), `MarkdownComponents.tsx` (4), `ProjectLauncher.tsx` (4), `VideoPlayer.tsx` (3) |
| Custom icon components | 6 files | `WorkspaceIcons.tsx`, `ClaudeCodeIcon.tsx`, `ProviderIcon.tsx`, `ExtensionIcons.tsx`, `StudioMark.tsx`, `mcpRegistry.tsx` |
| Raster/`<img>` icons | 3 assets | `playwright-icon.png`, `unreal-icon.webp` |
| `react-color` | (dependency only) | No icon usage in `src/` |
| Emoji-as-icon | **0** | None — good. |

Phosphor weight distribution (394 total `weight=`): bold 181, regular 140, fill 48, duotone 17, thin 4, plus ~9 conditional toggles. Three+ weights actively mixed.

Phosphor `size={n}` distribution (532 sites): `13`×101, `10`×72, `12`×70, `14`×67, `16`×63, `11`×52, `15`×31, `18`×20, `9`×15, `17`×8, `20`×7, `22`×6, `8`×5, `26`×5, plus `7,24,28,32,40,56,116`. ~20 distinct sizes, no scale.

Separately, 121 `w-N h-N` / `size-N` Tailwind sizing occurrences across 57 files — a second, parallel sizing system.

### Findings

**F1 — No size scale; ~20 ad-hoc pixel sizes.** 532 `size={n}` sites across ~100 files. 20 distinct sizes (7–116px), odd values (`9,11,13,17`) dominate. Recommended: token scale `{xs:12, sm:14, md:16, lg:20, xl:24}` via `<Icon>` wrapper. Design-system. Risk: Low. Priority: P1.

**F2 — Two parallel sizing mechanisms (`size` prop vs `w-N h-N`).** Phosphor `size={n}` vs inline svg `w-4 h-4`/`size-4` (121 sites, 57 files). Both. Risk: Low. Priority: P2.

**F3 — Stroke weight mixed (no single stroke language).** bold 181 / regular 140 / fill 48 / duotone 17 / thin 4. `ChatHeader.tsx` mixes `regular`+`fill`; `mcpRegistry.tsx` uses `bold` and `fill`; `ComingSoon.tsx` uses `duotone`. Recommended: `regular` resting, `fill` only for active/selected (the `weight={active?"fill":"regular"}` pattern in `FloatingMenu`/`NavPopup`). Ban `thin`/`duotone`. Design-system. Risk: Low. Priority: P1.

**F4 — Duplicate "settings/manage" (Gear vs GearSix vs SlidersHorizontal).** `LoginPage.tsx:136` `Gear`; `shaders-hero-section.tsx:106` `Gear`; `WorkspacePage.tsx:970` `GearSix`; `ManagePage.tsx:231,262`, `ExtensionsPage.tsx:175`, `IntelligenceView.tsx:144`, `FloatingMenu`/`NavPopup` `SlidersHorizontal`. Three glyphs for configuration. `NavPopup`/`FloatingMenu` use SlidersHorizontal = "Manage", Gear = "Settings" — a distinction undermined elsewhere. Recommended: Gear = Settings, SlidersHorizontal = Manage, retire GearSix. Risk: Medium. Priority: P1.

**F5 — Duplicate "send/submit" (ArrowUp vs PaperPlaneRight vs PaperPlaneTilt vs ArrowCircleUp).** `ChatComposer.tsx:353` `ArrowUp`; `SideChatPanel.tsx:144` `ArrowUp`; `TranscribePage.tsx:269` `PaperPlaneRight`; `AskUserQuestionCard.tsx:92` `PaperPlaneTilt`; `UpdateBanner.tsx:46` `ArrowCircleUp`. Recommended: canonicalize send = `ArrowUp`. Risk: Medium. Priority: P1.

**F6 — Duplicate "loading/refresh" (ArrowsClockwise vs ArrowClockwise vs SpinnerGap vs Spinner vs CircleDashed).** `ArrowsClockwise` (ActivityPage, ModelsPage, ExtensionsPage, WhitelistView, AiModelsView, IntelligenceView, ModelLibraryPanel, ContextMenu, MessageActions); `ArrowClockwise` (LMStudioStatus, OllamaStatus, OfflineModal, ErrorBoundary, FasterWhisperStatus, SettingsDebugPanel); `SpinnerGap` (WorkspacePage ×9, ComputerUsePage); `Spinner` (ComputerUsePage); `CircleDashed` (ShortcutsView). Most fragmented concept. Recommended: `ArrowsClockwise` = manual refresh; `SpinnerGap` (animate-spin) = indeterminate loading. Retire the rest. Both. Risk: Medium. Priority: P1.

**F7 — Close icon: only `X` used, but no shared component (44 sites / 33 files).** Consistent on `X` (no `XCircle` for close — good), but each of 33 files re-imports and re-sizes independently (11–18). Recommended: `<CloseButton>` / `<IconButton icon={X}>`. Architecture. Risk: Low. Priority: P2.

**F8 — Custom-icon components inconsistent in color strategy (hardcoded fills break theming).** `ClaudeCodeIcon.tsx:27,41-55` hardcoded `BRAND = "#CC785C"` and `fill="white"` (intentional brand, but can't adapt). `mcpRegistry.tsx:36-81` Gmail/Calendar/Drive/Sheets/Tasks hardcode brand hexes (16 fills). `ExtensionIcons.tsx` — `BrowserAutomationIcon`/`Context7Icon`/`GithubLetterIcon` use `currentColor`; `StudioMarkIcon` hardcodes `fill="white"`. `WorkspaceIcons.tsx:39,53` `currentColor` strokes but hardcodes `stroke="white"` for checks (breaks light themes). `ProviderIcon.tsx` correct (`fill="currentColor"`, themed badge, `xs/sm/md` enum). `StudioMark.tsx` correct. Three prop conventions coexist. Recommended: standard `IconProps {size?: number; className?: string}` + `currentColor` for monochrome marks; multi-color brand logos as a separate documented category; fix `fill="white"`. Both. Risk: Medium. Priority: P1 for white fills, P2 for prop unification.

**F9 — Provider/brand logos split across two unrelated mechanisms.** `ProviderIcon.tsx` (AI providers via simple-icons + monogram fallback) vs `ProjectLauncher.tsx:5-15` (dev-app logos via simple-icons, separate import) vs `mcpRegistry.tsx`/`ExtensionIcons.tsx` (service logos as hand-rolled inline SVG + PNG). Recommended: one `BrandLogo` keyed by slug, backed by simple-icons with monogram fallback (generalize ProviderIcon). Architecture. Risk: Medium. Priority: P2.

**F10 — No central icon registry / taxonomy; icons imported ad-hoc in 107 files.** Every consumer imports directly with per-file aliasing (`XIcon as X`); import style varies (`ContextMenu.tsx:3` and `shaders-hero-section.tsx:7` import bare names). Recommended: `src/components/icons/index.ts` exporting a curated semantic set re-mapped to chosen Phosphor glyphs + fixed default weight. Both. Risk: Low. Priority: P1 (unblocks all semantic fixes).

### Proposed Icon Taxonomy & Rules

1. Single-library policy. UI glyphs → Phosphor only, imported through a curated `src/components/icons/` barrel by semantic name. Inline `<svg>` for general UI disallowed (brand logos excepted).
2. Weight. One resting weight: `regular`. `fill` reserved for active/selected state only. Ban `thin`, `duotone`, default-`bold`.
3. Size scale. Token set, no raw numbers: `xs=12, sm=14, md=16, lg=20, xl=24`. Expose via `<Icon>` wrapper.
4. Color rule. Monochrome UI + monochrome marks → `currentColor` always. Multi-color brand logos a separate documented "brand" category permitted to hardcode brand hex. Fix the `fill="white"` cases.
5. Where icons live: `src/components/icons/` — semantic barrel + custom monochrome glyphs (move `WorkspaceIcons.tsx`, `ClaudeCodeIcon.tsx`). `src/components/brand/` — multi-color brand logos: generalize ProviderIcon into `BrandLogo`, absorb MCP/extension/ProjectLauncher logos. Keep `StudioMark.tsx`.

Semantic concept → icon mapping (proposed canon):

| Concept | Canonical glyph | Retire |
|---|---|---|
| Close / dismiss | `X` (via `<CloseButton>`) | — |
| Send / submit | `ArrowUp` | PaperPlaneRight, PaperPlaneTilt, ArrowCircleUp |
| Refresh (action) | `ArrowsClockwise` | ArrowClockwise |
| Loading (indeterminate) | `SpinnerGap` + animate-spin | Spinner, CircleDashed-as-loader |
| Settings (app) | `Gear` | GearSix |
| Manage / tune | `SlidersHorizontal` | — |
| Delete | `Trash` | — |
| Copy | `Copy` | CopySimple (ContextMenu) |
| Success / done | `CheckCircle` (fill) | bare Check for status |
| Error | `XCircle` / `WarningCircle` | (don't reuse plain `X`) |
| Warning | `Warning` | WarningCircle for inline |
| Expand/collapse | `CaretDown` / `CaretRight` | — |
| Edit | `PencilSimple` | — |
| Search | `MagnifyingGlass` | — |

### Ranked Top 10 Icon Problems

1. No semantic icon registry — 107 files import raw glyphs; root cause of all duplicate-meaning bugs.
2. "Loading/refresh" fragmented into 5 glyphs — two near-identical refresh icons used interchangeably.
3. "Send/submit" = 4 glyphs.
4. "Settings/manage" = 3 glyphs.
5. Stroke weight unbranded — 5 weights live.
6. No size scale — ~20 distinct pixel sizes.
7. `fill="white"` hardcoded in custom marks — `StudioMarkIcon`, `WorkspaceIcons` checks → invisible/wrong on light theme.
8. Two parallel sizing systems — `size={n}` (532) vs `w-N h-N`/`size-N` (121).
9. Three separate brand-logo systems; only ProviderIcon has a fallback.
10. No shared close/icon-button primitive — `X` re-imported in 33 files.

Key files: `src/components/ProviderIcon.tsx` (model to generalize), `src/utils/mcpRegistry.tsx` and `src/components/extensions/ExtensionIcons.tsx` (hardcoded-hex brand SVGs), `src/components/icons/WorkspaceIcons.tsx` and `src/components/ui/ClaudeCodeIcon.tsx` (white-fill theming risk), `src/components/layout/FloatingMenu.tsx` + `NavPopup.tsx` (correct active=fill pattern).
