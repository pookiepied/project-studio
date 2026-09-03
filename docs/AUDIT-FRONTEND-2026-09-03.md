# STUDIO — Complete Frontend Forensic Audit

**Date:** 2026-09-03
**Target:** `STUDIO/` (the Tauri desktop client). `STUDIO HARNESS/`, `Backend/`, `opencode/` were **not** audited — they are separate packages and out of scope for a *frontend* audit.
**Method:** Read-only. Every non-test source file under `STUDIO/src/` was read in full or in substantial part, plus `index.css`, `package.json`, `vite.config.ts`, `index.html`, `main.tsx`, `App.tsx`. No file was modified. Counts come from `grep`/`find`/`wc` over the tree, not estimation.
**Supersedes:** `STUDIO/AUDIT-FRONTEND-2026-08-22.md` (155 files then; 263 now — the codebase has grown ~70% in twelve days, almost entirely in `features/chat` around the live harness path).

---

## 1. Executive Summary

Studio's frontend is a **single-window React 19 + Tailwind v4 + Framer Motion desktop client** for one activity: having a conversation with an agent. It is **not** a typical "messy frontend." It has already been through multiple documented consolidation passes, and the evidence of that is everywhere:

- **One design-token layer, rigorously single-sourced.** Colour, radius, elevation, motion, and the type scale live in `src/index.css` (`@theme`) and `src/design/tokens/*.ts`, with a runtime dev-guard (`assertScaleDefaults`) that fails the build if the two disagree. Comments in the CSS narrate the removal of "fourteen files reaching for `duration-150`", "eight files hand-writing shadows", "eleven call sites putting a `leading-*` beside a role class". Those classes of drift are gone.
- **One icon registry.** `src/components/icons/registry.tsx` maps ~60 concepts to marks, with a dev-time `assertUnique` that throws if two concepts share a Lucide component. Every concept is referenced.
- **A small, coherent primitive set.** Nine primitives: `Button`, `IconButton`, `TextField`/`TextArea`, `Dialog`, `Popover`(+`MenuItem`/`MenuLabel`/`MenuSeparator`), `Tooltip`, `Segmented`, `StepSlider`, plus `StateNote` and the `Placeholder` family.
- **A monochrome visual language** (every colour is `oklch(... 0 ...)` — chroma 0) with exactly two deliberate hue exceptions: `--danger` and the five `--voice-*` state colours.

Where duplication **does** exist, it is at the **component-composition layer**, not the token layer:

1. **Two parallel transcript-rendering stacks** — a "demo/gallery" stack (`Transcript`, `UserMessage`, `AssistantMessage`) and a "live" stack (`LiveTranscript`, `LiveUserMessage`, `AssistantTurn`). The gallery is the only surface that uses the first; everything real uses the second. `UserMessage` and `LiveUserMessage` are near-identical.
2. **`WorkingDots` defined three times** (`ArtifactMotion.tsx` exported, `DictationBar.tsx` local, `ReadAloud.tsx` local) with slightly different timings.
3. **Four "no-harness / failed → StateNote + busy retry button" blocks** copy-pasted across `SidebarStates`, `ModelLibraryDialog` (`CatalogFailure`), `ArchivePane`, `ProjectPage`.
4. **A recurring "quiet row" `<button>` shape** (`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-ui text-muted-foreground … hover:bg-tint hover:text-foreground`) hand-written ~15+ times with no `Row`/`NavRow` primitive.
5. **Copy-button-with-checkmark-swap** written three times (`CodeBlock`, `TextBlock`, `MessageActions`).
6. **Inline-rename `<input>`** written twice, nearly identically (`IdentityLine`, `ConversationRow`).
7. **Modal scrim + scale-in shell** implemented three times (`Dialog` primitive, `MediaLightbox`, `CommandPalette`).

None of these are architecturally dangerous. There are **no P0 findings**. The frontend is maintainable, internally consistent, and unusually well documented (most files carry a multi-paragraph rationale docblock). The highest-leverage cleanup is consolidating the transcript stacks and lifting 4–5 small shared components.

**Data note:** most surfaces render from the live harness event stream. The remaining fixture-only surfaces are the **artifact gallery** (`domain/session/gallery/`, a scripted showcase of every artifact kind) and the **placeholder settings panes** (10 of 17 sections show a "this section will hold…" list — layout settled, values not wired). Both are deliberate and documented.

---

## 2. Audit Coverage (proof of repository coverage)

| Metric | Value | Source |
|---|---:|---|
| Project root inspected | `D:\Creative Library\Workspace\Project Studio\STUDIO\` | — |
| Frontend source root | `STUDIO/src/` | — |
| Relevant directories inspected | **63** | `find src -type d` |
| Total source files (`.ts`/`.tsx`/`.css`) | **263** | `find` |
| — non-test files | **215** | `find … \| grep -v .test.` |
| — test files | **48** | `find -name "*.test.*"` |
| — `index.ts` barrels | 31 | `find -name index.ts` |
| — `.d.ts` files | 1 (`features/artifacts/media/elements.d.ts`) | `find` |
| Non-test source LOC | **32,214** | `wc -l` |
| Test LOC | **10,761** | `wc -l` |
| Total LOC | **~42,975** | `wc -l` |
| Test cases (`it(`/`test(` occurrences) | **~465** | `grep -o` |
| Routes discovered | **4** route kinds (`home`/`chat`/`project`/`settings`) | `stores/navigation/NavigationProvider.tsx` |
| Page/surface-level views | **9** (see §4) | manual |
| Modal / dialog / palette surfaces | **6** | manual |
| Icon concepts in registry | **~60** (52 Lucide-backed + 6 drawn + `ProviderMark` + `StudioMark`) | `registry.tsx`, `drawn.tsx` |
| `Icons.*` call sites | **127** in `.tsx`, plus 18 concept refs in `.ts` data files | `grep -o "Icons\."` |
| Font families shipped | **2** (Inter Variable, Instrument Serif) + system mono stack | `index.css` lines 2–3, 228–230 |
| Font asset weight on disk | Inter `files/` ≈ **1.2 MB**, Instrument Serif `files/` ≈ **144 KB** | `du -sh node_modules/@fontsource*/…/files` |
| Colour tokens (`--…` in palette) | **~44** distinct CSS custom properties (light) + full dark override set | `index.css` :root / .dark |
| Hard-coded hex/oklch/rgb in `.ts`/`.tsx` | **hex:** only `domain/session/gallery/marks.ts` (fixture SVG) + 2× `#000` in mask gradients (BlockFrame, CollapsibleText — alpha-only, colour irrelevant); **oklch:** 1 (`VoiceModeOverlay.tsx:390` inline shadow); **rgb/rgba:** 0 | `grep -rnE` |
| Radius utilities in use | `rounded-md`×43, `rounded-full`×41, `rounded-lg`×15, `rounded-xl`×6, `rounded-sm`×5, `rounded-xs`×3, `rounded-block-inner`×3, `rounded-block`×2, `rounded-2xl`×2 | `grep -o` |
| Elevation utilities in use | `shadow-raised`×5, `shadow-overlay`×4, `shadow-chip`×4, `shadow-lifted`×3, `shadow-modal`×3, `shadow-panel`×2 | `grep -o` |
| Type-role classes in use | `text-caption`×105, `text-ui`×87, `text-micro`×37, `text-body`×6, `text-title`×3; `studio-display`×3, `studio-heading`×3, `studio-prose`×5 | `grep -o` |
| Files importing `framer-motion` | **46** (non-test) | `grep -rl` |
| `<motion.*>` element usages | **76** (`motion.div`×40, `motion.span`×23, `motion.button`×4, `motion.p`×3, `motion.svg`×2, `motion.aside`×2, `motion.rect`×1, `motion.main`×1) | `grep -o` |
| `AnimatePresence` usages | 23 non-test files | `grep -rl` |
| `createPortal` usages | 4 (`Popover`, `Tooltip`, `MediaLightbox`, `ModelLibraryDialog`) | `grep -rl` |
| `aria-*` attributes | 42× `aria-label`, 9× `aria-expanded`, 4× `aria-haspopup`, 3× each `aria-current`/`aria-checked`, 2× `aria-pressed`, `aria-valuetext/now/min/max` | `grep -o` |
| `role="…"` | `status`×9, `dialog`×4, `alert`×4, `menu`×3, `tooltip`/`separator`/`radiogroup`/`radio`/`img`/`checkbox`×1 | `grep -o` |
| React state libraries | **0** (Redux/Zustand/Jotai/query libs all absent; hand-rolled context only) | `package.json` |
| `localStorage` keys | 2 (`studio.appearance` legacy fallback, `studio:workspace-handoff` one-shot) | `appearance.ts`, `handoff.ts` |
| `invoke(` (Tauri command) call sites | small, confined to `platform/tauri/*` + `useConversation.ts` (`get_harness_status`) + harness client | `grep` |

### Excluded from deep source audit — and why

| Path | Reason |
|---|---|
| `STUDIO/node_modules/` | Third-party dependency source. Not project-authored. Inspected only to measure shipped font weight. |
| `STUDIO/dist/` | Vite build output. Generated. |
| `STUDIO/src-tauri/` | Rust host process (window chrome, DWM corner, supervisor). Not frontend; consulted only for the `data-tauri-drag-region` / DWM-corner contract that `AppShell`/`Sidebar` comments reference. |
| `STUDIO/pnpm-lock.yaml`, `pnpm-workspace.yaml` | Lockfile / workspace manifest. Read as config, not as source. |
| `STUDIO HARNESS/`, `Backend/`, `opencode/`, `documentation/`, `report/`, `prompts/` | Separate packages / working notes. Out of scope for a frontend audit. `STUDIO HARNESS` was consulted only as the reference for what the frontend talks to. |
| `*.test.tsx` / `*.test.ts` (48 files, 10.7k LOC) | Read for behaviour signals and coverage counting, not line-by-line. |

**Coverage statement:** I inspected **215 project-owned non-test frontend files across 63 directories**, plus 3 root files and `index.css`. A further **48 test files** were consulted for coverage. Everything under `node_modules/`, `dist/`, and `src-tauri/` was intentionally excluded as generated or non-frontend.

---

## 3. Frontend Architecture Map

### 3.1 Source tree

```text
STUDIO/
├── index.html                     # <div id="root">, loads /src/main.tsx
├── src/
│   ├── main.tsx                   # createRoot; awaits loadAppearance() + primeDrafts() before first paint
│   ├── App.tsx                    # the only "routing": ?conversation=<id> → DetachedShell, else StudioApp (splash → AppShell)
│   ├── index.css                  # 1,308 lines — THE design system: @theme tokens, palette, type roles, prose, scrollbars, player
│   │
│   ├── design/                    #  8 files — the rules layer
│   │   ├── RULES.md               #  ~380-line rationale (the "why" behind every token)
│   │   ├── tokens/                #  typography.ts (TYPE scale + icon pairing), geometry.ts (RADIUS/CONTROL/SHELL/COMPOSER), motion.ts (DURATION/springs/surface variants)
│   │   └── theme/                 #  appearance.ts (Appearance model + tauri-plugin-store persistence), AppearanceProvider.tsx
│   │
│   ├── components/                # 27 files — renderer-agnostic UI atoms
│   │   ├── brand/                 #  StudioMark.tsx (5-tile staircase SVG; rest/busy/entrance)
│   │   ├── icons/                 #  Icon.tsx (defineIcon + IconStateContext), fromLucide.tsx, drawn.tsx (transport + SidebarToggle + VoiceWave), registry.tsx, ProviderMark.tsx (CSS-mask brand logos)
│   │   ├── primitives/            #  Button, IconButton, Dialog, Field(TextField/TextArea), Popover(+MenuItem), Segmented, Slider(StepSlider), Tooltip
│   │   ├── placeholder/           #  Placeholder / PlaceholderText / PlaceholderMark (skeleton system; owns the sweep)
│   │   └── state/                 #  StateNote (the failure-sentence shape)
│   │
│   ├── domain/                    # 24 files — types + fixture data + pure helpers
│   │   ├── artifacts/             #  parse.ts (```artifact fence → Artifact), types.ts
│   │   ├── attachments/           #  images.ts (turn-image rules: wire + vision)
│   │   ├── models/                #  catalog.ts, families.ts, slots.ts, types.ts (reasoning vocab)
│   │   ├── permissions/           #  modes.ts (PERMISSION_MODES), question.ts (wire record → sentence parts)
│   │   ├── projects/              #  ProjectIconMark.tsx (abstract silhouettes), types.ts
│   │   ├── providers/             #  icons.ts (resolveProviderIcon — harness catalog + session cache)
│   │   └── session/              #  context.ts, demo.ts, gallery/ (scene.ts 444 LOC scripted showcase, marks.ts fixture media), recents.ts, settings.ts, types.ts
│   │
│   ├── features/                  # 130 files — eight feature areas
│   │   ├── chat/                  #  ~55 files — the app. composer/, transcript/ (+live/, paging/, scroll/), markdown/ (+blocks/), streaming/, permissions/, first-turn, fork, useConversation(Transcript)
│   │   ├── artifacts/             #  ArtifactShell, ArtifactBlock, ArtifactMotion, registry, kinds/ (Generic, Media, WebSearch), media/ (Lightbox, VideoPlayer), sections/ (Sections, StatusDot)
│   │   ├── settings/             #  SettingsPage, sections.ts (SETTINGS_GROUPS), panes/ (registry, Pane, Appearance, General, Archive, placeholders), providers/ (ProvidersPane + 9 sub-components)
│   │   ├── models/               #  ModelLibraryDialog + library/ (FamilyGrid, FamilyModels, LibraryIndex, ModelDetail, ModelRow, SearchResults, LibrarySkeleton, views.ts, format.ts), CatalogStateNote
│   │   ├── voice/                #  VoiceModeProvider, VoiceModeOverlay, DictationBar, ReadAloud, useDictation, useMicInput, useVoiceMode, transcribe, speak, waveform
│   │   ├── rail/                 #  SideRail (+ ResizeHandle), RailTabs
│   │   ├── home/                 #  HomePage (one line + StartConversation)
│   │   ├── projects/             #  ProjectPage, NewProjectDialog
│   │   └── palette/              #  CommandPalette
│   │
│   ├── shell/                     # 21 files — the window frame
│   │   ├── AppShell.tsx           #  layout: Sidebar | routed page (Surface()) | SideRail; TopStrip; palette; menus; shortcuts (Cmd/Ctrl+K/B/N/,)
│   │   ├── DetachedShell.tsx      #  one conversation in its own window (renders the real ChatPage)
│   │   ├── SplashScreen.tsx
│   │   ├── ActionsMenu.tsx / SelectionMenu.tsx / ActionItems.tsx   # right-click + selection menus, shared verb list
│   │   ├── chrome/               #  TopStrip, IdentityLine, TurnMenu (model + reasoning), SessionControls (ContextMeter), TrafficLights
│   │   ├── sidebar/              #  Sidebar, ConversationRow, ProjectSection, SettingsTree, SidebarStates, ActivityMark
│   │   └── useCompactLayout.ts   #  matchMedia breakpoint (< ~900px + rail width → floating sidebar)
│   │
│   ├── stores/                    # 15 files — hand-rolled React context
│   │   ├── navigation/           #  route (tagged union) + sidebarOpen/paletteOpen + organize/sort + Settings visit bookkeeping
│   │   ├── rail/                 #  rail entries (cap 12), activeId, width, collapsed
│   │   └── workspace/            #  projects/conversations/messages/settings/running set; harness client wiring; demo-turns.ts, handoff.ts, title-refresh.ts, useDetachConversation, useDemoTurn
│   │
│   ├── platform/                  # 13 files — the ONLY Tauri boundary
│   │   ├── tauri/                #  window.ts (chrome, invoke), nativeMenus.ts (suppress webview menu/devtools), index.ts
│   │   └── harness/              #  contracts.ts (1,342 LOC wire schema), client.ts, conversation.ts, conversation-chunks.ts, connection.ts, transport.ts, index.ts
│   │
│   └── lib/                       #  4 files — cn.ts (tailwind-merge + custom role group), id.ts (newId), clipboard.ts (copyText), base64.ts
│
└── public/
    ├── favicon.ico
    └── demo/generated-loop.mp4    # 243 KB — fixture video for the gallery's media artifact
```

### 3.2 Layers, in dependency order

```
index.css  +  design/tokens        ← the vocabulary (values live here, once)
        ↓
lib  +  components (icons, primitives, placeholder, state, brand)
        ↓
domain (types, pure helpers, fixture data)
        ↓
platform (Tauri + harness wire contracts)
        ↓
stores (navigation, rail, workspace)  +  features/*/hooks
        ↓
features/* components   +   shell/*
        ↓
App.tsx  →  main.tsx
```

### 3.3 Entry points & the "router"

- `main.tsx`: `assertScaleDefaults()` (dev guard) → `await loadAppearance()` → `applyAppearance()` → `await primeDrafts()` → `createRoot(#root).render(<App initialAppearance={…}/>)`. Two top-level `await`s are deliberate: the native window is `visible:false` until `app_ready`, so a pre-paint read costs a frame nobody sees but avoids a flash at the wrong theme/size.
- `App.tsx`: reads `?conversation=<id>` from the URL once. Present → `<DetachedShell>` (one conversation, no navigation). Absent → `<StudioApp>` (splash for `SPLASH.minDurationMs = 1800ms`, then `<AppShell>`). The provider stack is **shared** by both: `MotionConfig reducedMotion="user"` → `AppearanceProvider` → `WorkspaceProvider` → `RailProvider` → `NavigationProvider`.
- There is **no react-router**. "Routing" is a `Route` tagged union in `NavigationProvider` (`home | chat | project | settings`), consumed by `AppShell.Surface()` (a plain module function, *called* not `<rendered/>`, to avoid remounting the whole page on every stream chunk — see the docblock, it's the fix for a 35-remounts-per-second bug).

### 3.4 State management

All state is **hand-rolled React context**. No Redux/Zustand/Jotai/react-query. Four stores + two feature providers:

| Store | Holds | Persisted? |
|---|---|---|
| `NavigationProvider` | `route`, `move` (push/pop/sibling, derived from hierarchy depth), `sidebarOpen`, `paletteOpen`, `sidebarOrganize`, `sidebarSort`, Settings-visit return point | No — restart → Home |
| `RailProvider` | rail `entries` (keyed by artifact id, cap `MAX_ENTRIES=12`), `activeId`, `width` (clamped 320–760), `collapsed` | No |
| `WorkspaceProvider` (943 LOC) | `projects`, `conversations`, `messages`, `settings` (model/reasoning/permission), `running` set, `catalog`, harness `storePhase`; every mutation (send, retry, fork, rename, pin, archive, remove, createProject, setBranch, setConversationSettings, …) | No — seeded from harness on connect; gallery seed always present |
| `AppearanceProvider` | `theme`, `uiSize`, `codeOffset`, `pointerCursor` | **Yes** — `preferences.json` via `@tauri-apps/plugin-store` in the OS config dir; `localStorage` fallback under `pnpm dev`; only *deviations* from defaults stored (reset = delete the entry) |
| `VoiceModeProvider` | one boolean (voice stage open) + the overlay | No |
| `IconStateContext` (`Icon.tsx`) | hover/press/on/live, published from `IconButton` (and any wrapper) down to glyphs | Presentation only |

Two `localStorage` keys total: `studio.appearance` (legacy migration fallback) and `studio:workspace-handoff` (one-shot snapshot before a detached window opens, removed on read). Composer drafts live in a **separate** `drafts.json` store (debounced 400ms, flushed on `pagehide`/`visibilitychange`, capped at 50 conversations).

---

## 4. Page / Route / Screen Inventory

### 4.1 Route-level surfaces (rendered by `AppShell.Surface()`)

| # | Surface | File | Route | Composer? | Turn settings in strip? | Notes |
|---|---|---|---|---|---|---|
| 1 | **Home** | `features/home/HomePage.tsx` | `{kind:'home'}` (default) | Yes (`StartConversation`) | Yes | One serif display line + one field. No recents, no grid (deliberate — sidebar owns conversations). |
| 2 | **Chat** | `features/chat/ChatPage.tsx` | `{kind:'chat', conversationId}` | Yes | Yes | Scrolling transcript + composer. Live path (`LiveTranscript`) for every ordinary conversation; demo path (`Transcript`) **only** for `GALLERY_CONVERSATION_ID`. Holds `ConnectionNotice`, `SendRefusal`, `ApprovalPrompt` above the composer. |
| 3 | **Project** | `features/projects/ProjectPage.tsx` | `{kind:'project', projectId}` | Yes (`StartConversation`, project-bound) | Yes | Header (icon + name + description), composer, Folders section, Conversations list. Falls back to Home if the project id is unknown. |
| 4 | **Settings** | `features/settings/SettingsPage.tsx` | `{kind:'settings', sectionId}` | No | No | Layout + routing only. Section lives in `route.sectionId` (so palette can deep-link, back/forward steps through sections). Renders one pane via `panes/registry.tsx`. Sidebar column shows `SettingsTree` instead of conversations while this route is active. |

### 4.2 Settings sub-panes (17 sections; one visible at a time)

`SETTINGS_GROUPS` (`features/settings/sections.ts`) defines 7 groups / 17 sections. `panes/registry.tsx` maps 4 to real panes; the other 13 fall to `PlaceholderPane` (10 have entries in `panes/placeholders.ts`; `git`/`worktrees`/`environments` are in a "Coding" group but only `environments` has a placeholder entry — `git` and `worktrees` sections exist but resolve to the "General is the honest landing" fallback).

| Section | Renderer | Status |
|---|---|---|
| general | `GeneralPane` | **Real** — execution-mode picker (`PERMISSION_MODES`), undo-history note, version note |
| appearance | `AppearancePane` | **Real** — theme / interface text / code text / pointer cursor (all `Segmented`), window reset, reset-to-defaults |
| archive | `ArchivePane` | **Real** — archived-chat list, multi-select, delete/clear (calls harness purge) |
| providers | `ProvidersPane` (+ 9 sub-components) | **Real** — the largest settings surface: connections, model library, capability-slot defaults, credential badges, probe line, add/remove connection & model dialogs |
| account, personalization, shortcuts, mcp, connectors, browser-use, skills, hooks, git, worktrees, environments | `PlaceholderPane` / fallback | **Placeholder** — "This section will hold: …" list + "Waiting on the harness. The layout is settled; the values are not wired." |

### 4.3 Modal / overlay surfaces

| # | Surface | File | Trigger | Construction |
|---|---|---|---|---|
| 5 | **Command palette** | `features/palette/CommandPalette.tsx` | `Cmd/Ctrl+K` | Own scrim + scale-in panel (does **not** use `Dialog`). Top-anchored (`pt-[16vh]`). Conversations + projects + settings sections + 3 commands, keyboard-driven. |
| 6 | **Model library** | `features/models/ModelLibraryDialog.tsx` | "Model library…" in `TurnMenu` | Uses `Dialog` primitive, `createPortal` to body. Three-level drill-down (families → family → model) with its own push/pop/sibling page transitions + a collapsible `LibraryIndex` rail. |
| 7 | **New project** | `features/projects/NewProjectDialog.tsx` | Sidebar "+", palette | `Dialog`. Name / mark picker / description / source folders (folder picker is demo-only — appends a plausible path). |
| 8 | **Add connection** | `features/settings/providers/AddConnectionDialog.tsx` | ProvidersPane | `Dialog`. Library-pick or custom endpoint; holds an API key in component-local `useState` only, cleared on close. |
| 9 | **Add model** / **Remove connection** | `AddModelDialog.tsx` / `RemoveConnectionDialog.tsx` | ProvidersPane | `Dialog`. |
| 10 | **Media lightbox** | `features/artifacts/media/MediaLightbox.tsx` | click a media artifact | Own scrim + scale-in panel (does **not** use `Dialog`), `createPortal`. `75vw` / `82vh` cap. |
| 11 | **Voice mode overlay** | `features/voice/VoiceModeOverlay.tsx` | mic-adjacent "Voice mode" button | Full-surface stage inside the rounded window (mounted last in `AppShell`), five state colours, transport control (`--control-xl`). |
| — | **ActionsMenu** (right-click) & **SelectionMenu** (text selected) | `shell/ActionsMenu.tsx` / `shell/SelectionMenu.tsx` | `contextmenu` / selection | Fixed-position menu, clamped to viewport, **not** portalled. Share their verb list via `ActionItems`. |

### 4.4 Panel workflows (not routes)

| Panel | File | Behaviour |
|---|---|---|
| **Sidebar** | `shell/sidebar/Sidebar.tsx` | Left column, 236px. Two states: open or gone (no icon rail). Below ~900px (or with rail open) it floats over the page with a scrim (`useCompactLayout`). Shows conversation/project list *or* `SettingsTree` depending on route. |
| **Side rail** | `features/rail/SideRail.tsx` | Right column, resizable 320–760px, holds artifacts opened out of the transcript. Mutually exclusive with the sidebar (opening one folds the other). Folded state leaves a restore pill on the right edge. |
| **Top strip** | `shell/chrome/TopStrip.tsx` | Transparent 40px layer over the page. Traffic lights + sidebar toggle + `ContextMeter` (left), `IdentityLine` (centre), `TurnMenu` (right, everywhere but Settings). |

### 4.5 Exact counts

```text
Route kinds:                       4   (home, chat, project, settings)
Route-level surfaces:              4   (Home, Chat, Project, Settings)
Settings sub-panes:               17   (4 real, 13 placeholder)
Modal / dialog / palette / stage: 7   (palette, model library, new project,
                                       add connection, add model, remove
                                       connection, media lightbox, voice
                                       overlay — 8 if voice counted)
Context menus:                     2   (ActionsMenu, SelectionMenu)
Resident panels:                   3   (sidebar, side rail, top strip)
Error / fallback screens:          2   (DetachedShell.Missing, unknown-route → Home)
Onboarding screens:                0   (none — "add a connection in Settings" is the closest thing)
Splash:                            1
```

---

## 5. UI Item Inventory (taxonomy)

Counts are of *implementations* and *call-site occurrences*, from `grep`.

### 5.1 Buttons

See §7 for the full button census. Headline:

| Family | Implementations | Notes |
|---|---|---|
| Labelled button | **1** (`Button.tsx`) — 4 variants (`primary`/`secondary`/`ghost`/`danger`) × 3 sizes (`sm`/`md`/`lg`) | Canonical. Has `busy` (spinner), `icon`, `fullWidth`. |
| Icon-only button | **1** (`IconButton.tsx`) — 4 sizes (`sm`/`md`/`lg`/`xl` = `--control-*`) × 2 tones (`quiet`/`solid`) | Always circular, always tooltip-labelled, publishes `IconState` to its glyphs. |
| Raw `<button>` (not a primitive) | **48 occurrences across 29 files** | Menu triggers, list rows, chevron toggles, hover-reveal overflow buttons, the folder-add dashed button, checkbox-shaped buttons, etc. |
| `<a>` styled as a row/button | ~6 (`WebSearchArtifact` result rows, `Sections` links, prose `a`) | External links only (`target="_blank" rel="noreferrer noopener"`). |

The 48 raw buttons are **not** 48 button styles — most are one of a handful of recurring shapes (see §5.8 and §14).

### 5.2 Text inputs

| Implementation | File | Used by | Height | Focus treatment |
|---|---|---|---|---|
| `TextField` (+ `type="password"`) | `primitives/Field/TextField.tsx` | AddConnection, AddModel, NewProject, DefaultsSection, ModelLibrary (settings), ModelLibraryDialog search | `px-2.5 py-1.5` (content height, ~`text-ui` + padding) | `focus:border-foreground/20 focus:shadow-[0_0_0_2px_var(--ring)]`, outline killed |
| `TextArea` | same file, shares `BASE` | NewProject description | `rows` prop | same |
| `ComposerField` (textarea) | `features/chat/composer/ComposerField.tsx` | Composer only | computed from `CONTROL.md` + `COMPOSER.paddingBlock`; grows to `COMPOSER.maxHeight=184` then scrolls | none (the *frame* breathes via shadow, not the field) |
| Bare `<input>` — palette search | `CommandPalette.tsx:150` | palette | `text-body`, transparent bg, no border | none |
| Bare `<input>` — model library search | `ModelLibrary.tsx:102` (settings) | slot picker popover | inside a `TextField`? no — it's a raw input in `<div className="p-1.5">` | — |
| Bare `<input>` — inline rename | `IdentityLine.tsx:63`, `ConversationRow.tsx:50` | rename in place | `bg-selected px-1.5 py-0.5`, no border, Enter/Escape/blur | selection ring only |
| Bare `<input type="range">` | `StepSlider.tsx`, hidden & stretched over a custom track | reasoning effort | — | invisible input, styled track |
| Bare `<input type="checkbox">` | `AddModelDialog.tsx:190`, `ModelLibrary.tsx` | capability ticks | `size-3.5 accent-current` (native checkbox — the ONE place a native checkbox is used) | native |
| Bare `<input type="file">` | `Composer.tsx:577` | image picker | `hidden` — click handler only | — |

**Total distinct text-input implementations: 4** (`TextField`, `TextArea`, `ComposerField`, and the palette/rename bare inputs which share no code). Plus native `range`/`checkbox`/`file`.

### 5.3 Selects / dropdowns / menus

There is **no `<select>` and no combobox primitive.** Every "pick from a list" is a `Popover` + `MenuItem` rows:

| Menu | File | Rows |
|---|---|---|
| Turn model/reasoning menu | `shell/chrome/TurnMenu.tsx` | Default model, Recent (≤3), "Model library…", Reasoning → sub-panel with `StepSlider` |
| Execution-mode menu | `chat/composer/PermissionControl.tsx` + `settings/panes/GeneralPane.tsx` | 3 `PERMISSION_MODES` rows (shared source) |
| Add-context menu | `chat/composer/AddMenu.tsx` | Files, Folder, Image / Set a goal, Plan first / Extensions |
| Sidebar organize/sort menu | `shell/sidebar/Sidebar.tsx` | organize (Project / In a list), sort (Priority / Last updated / Manual) |
| Conversation row menu | `shell/sidebar/ConversationRow.tsx` | Fork, Pin, Rename, Open in new window, Archive, Delete |
| Identity-line menu | `shell/chrome/IdentityLine.tsx` | Rename, Pin, Open in new window, Archive, Delete (+ branch menu) |
| Project section menu | `shell/sidebar/ProjectSection.tsx` | Open project, Copy working directory, Remove from Studio |
| Protocol menu (custom endpoint) | `settings/providers/AddConnectionDialog.tsx` | `LANGUAGE_PROTOCOL_CHOICES` |
| Slot-default picker | `settings/providers/DefaultsSection.tsx` | eligible models per capability slot + search field |
| Model-row menu | `settings/providers/ModelLibrary.tsx` (`ModelRowMenu`) | Rename, Hide/Show, Remove |
| Right-click / selection menu | `shell/ActionItems.tsx` | Copy, Select all, Ask about this / New conversation, Reload, Search, Settings |

`MenuItem` (one implementation) carries: reserved check column, `icon`, `hint` (trailing), `note` (second line), `destructive` (glyph goes red). ~11 distinct menus, **one row primitive**, **one popover primitive**.

### 5.4 Toggles / segmented / sliders

| Item | Implementation | Count of uses |
|---|---|---|
| Segmented control | `Segmented.tsx` (shared layout-animated thumb, `layoutId` required) | 5 (`AppearancePane` theme/uiSize/codeOffset/pointerCursor, `ApprovalPrompt` duration) — `layoutId`s: `settings-theme`, `settings-ui-size`, `settings-code-size`, `settings-cursor`, `approval-duration` |
| Step slider | `StepSlider.tsx` (native range over custom track + stop marks + thumb) | 2 (`TurnMenu` reasoning sub-panel, `ModelDetail` reasoning section) |
| On/off switch | — | **none as a dedicated component** — on/off is a 2-option `Segmented` (`AppearancePane` pointer cursor) |
| Checkbox | native `<input type="checkbox">` + a button styled as one (`ArchivePane` select) | 2 patterns |

### 5.5 Panels / cards / containers

| Item | Implementation | Notes |
|---|---|---|
| App shell (rounded window) | `AppShell.tsx` — one `borderRadius: SHELL.windowRadius` (20), `overflow-hidden` | Left corners round only when the sidebar is present; right corners round only when the rail is open. |
| Dialog panel | `Dialog.tsx` — `studio-blur`, `rounded-xl`, `shadow-modal`, scrim, `SPRING_SURFACE` enter | header (serif) + scrollable body + optional footer |
| Popover panel | `Popover.tsx` — `studio-blur`, `rounded-lg`, `shadow-overlay`, portal, viewport-clamped, flip-on-collision, ResizeObserver re-place | `min-w-48 max-w-[calc(100vw-1rem)]` |
| Artifact frame | `ArtifactShell.tsx` — **not a card**: `rounded-xl bg-surface-sunken p-3`, no border, no shadow | shared bubble + title + status line + summary + open-larger + provenance footer |
| Preview frame (code / draft) | `BlockFrame.tsx` — two boxes: outer `rounded-block bg-surface-raised p-2 shadow-lifted`, inner `rounded-block-inner bg-code-surface` | caption on the card *outside* the inner panel; `previewHeight` cap + mask fade, no "show all" |
| Settings pane | `Pane.tsx` + `Row.tsx` — fixed label column, fluid control column, `divide-y` rows | |
| Approval prompt card | `ApprovalPrompt.tsx` — `bg-surface-raised p-3 shadow-raised`, `borderRadius: COMPOSER.multilineRadius` | deliberately matched to the composer's multiline radius |
| User-message bubble | `UserMessage` / `LiveUserMessage` — `max-w-[85%] rounded-2xl rounded-br-md bg-selected px-3.5 py-2.5` | assistant replies get **no** container (deliberate asymmetry) |

### 5.6 Loading / empty / error states

| Item | Implementation | Notes |
|---|---|---|
| Skeleton primitives | `Placeholder` / `PlaceholderText` / `PlaceholderMark` | owns the sweep gradient (`SWEEP_GRADIENT`), `bg-selected` bone, `role="status"` on region, `aria-hidden` bones |
| Skeleton compositions | `SidebarStates.SidebarSkeleton`, `LibrarySkeleton`, `ArchivePane.ArchiveSkeleton`, `ProjectPage` inline, `ArtifactBlock.Arriving` | each hand-composes bones + a hand-written width array |
| Failure sentence | `StateNote.tsx` (primitive: title / verbatim detail / remedy control) | |
| Failure compositions | `SidebarUnavailable`, `CatalogFailure` (ModelLibraryDialog), `ArchivePane` inline, `ProjectPage` inline, `CatalogStateNote`, `ConnectionNotice.PhaseNotice`, `SendRefusal` | the "no-harness / failed + busy retry button" pair appears ~4× (see §14) |
| Empty state | plain sentence — "Nothing archived.", "Nothing here yet.", "No conversations" — never styled as failure (RULES §10) | |
| Transcript activity | `StudioMark busy` (thinking gap, `EarlierBoundary`, `Transcript`), `ActivityMark` (sidebar working), `RetryWait`, `SubmissionFailed`, `EndLine` | |

### 5.7 Iconography, illustration, decoration

See §11. `StudioMark` (brand), `ProviderMark` (vendor logos as CSS masks), `ProjectIconMark` (abstract silhouettes), `ActivityMark` (3×3 pulsing grid), `ContextMeter` (SVG ring), `StatusDot` (one dot, four fills), `VoiceWave` (drawn waveform), the drawn transport family (`StopSquare`/`PlayTriangle`/`PauseBars` — span-based, not SVG), `SidebarToggle` (SVG frame + HTML divider).

### 5.8 Recurring composed items with **no primitive** (consolidation candidates)

| Shape | Occurrences | Where |
|---|---:|---|
| "Quiet nav row" `<button className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-ui text-muted-foreground transition-colors duration-fast hover:bg-tint hover:text-foreground">` | ~15+ | `Sidebar.Action`, `IdentityLine` project button, `TurnMenu` back rows (×2), `ModelDetail` back row, `Sidebar` account button, `FamilyCard`, `ModelRow`, `IndexRow`, `ProjectPage` conversation rows, palette rows, … |
| Hover-reveal overflow trigger `<button className="flex size-5 shrink-0 items-center justify-center rounded-full … opacity-0 group-hover/x:opacity-100">` | 4 | `ConversationRow`, `ProjectSection`, `Sidebar` (sidebar options), `Sidebar` (new project) |
| Sliding selection chip `<motion.span layoutId={…} className="absolute inset-0 rounded-md bg-selected">` | 3 (+ Segmented's thumb) | `ConversationRow` (`sidebar-selection`), `SettingsTree` (`settings-tree-selection`), `LibraryIndex` (`library-index`) |
| Copy button with `AnimatePresence mode="wait"` copy↔check swap + 2000ms timeout | 3 | `CodeBlock`, `TextBlock`, `MessageActions` |
| Inline rename `<input value onBlur=commit onKeyDown={Enter→commit, Escape→cancel}>` | 2 | `IdentityLine`, `ConversationRow` |
| "no-harness / failed → StateNote + busy retry button" | 4 | `SidebarUnavailable`, `CatalogFailure`, `ArchivePane`, `ProjectPage` |
| `WorkingDots` (three cycling dots) | **3 definitions** | `ArtifactMotion` (exported, `size-[3px]`, delay `0.36`), `DictationBar` (local, `size-[3px]`, delay `0.18`), `ReadAloud` (local, delay `0.18`) |
| `capital(word)` helper | 2 identical defs | `TurnMenu.tsx`, `ModelDetail.tsx` |
| `isRecord(value)` helper | 3 identical defs | `ToolGroups.tsx`, `useConversation.ts`, `platform/harness` (context.ts uses its own) |
| Skeleton width array `['58%','41%',…]` | 4 hand-written arrays | `SidebarStates`, `LibrarySkeleton`, `ArchiveSkeleton`, `ProjectPage` |
| Scrim + scale-in modal shell | 3 | `Dialog` (primitive), `MediaLightbox`, `CommandPalette` |
| Fixed-position viewport-clamped menu + outside-pointerdown/Escape dismiss | 4 | `Popover`, `Tooltip`, `ActionsMenu`, `SelectionMenu` |

---

## 6. Component / Implementation Inventory

### 6.1 Reusable primitives (`components/`)

| Component | File | Public API surface | Consumers (files) |
|---|---|---|---|
| `Button` | `primitives/Button/Button.tsx` | `variant`, `size`, `disabled`, `busy`, `type`, `icon`, `fullWidth` | ~10 (Settings panes, dialogs, StateNote actions, ModelLibraryDialog) |
| `IconButton` | `primitives/IconButton/IconButton.tsx` | `label` (required), `size`, `tone`, `active`, `disabled`, `tooltipSide` | ~20 (chrome, composer, dialogs, rail, message actions, block frames) |
| `TextField` / `TextArea` | `primitives/Field/TextField.tsx` | `value`, `onChange`, `placeholder`, `type` (`text`\|`password`), `autoComplete`, `ariaLabel`, `onKeyDown` | ~8 |
| `Dialog` | `primitives/Dialog/Dialog.tsx` | `open`, `onClose`, `title`, `footer`, `width`, `height` | 4 (NewProject, AddConnection, AddModel, RemoveConnection, ModelLibraryDialog) |
| `Popover` (+ `MenuItem`, `MenuLabel`, `MenuSeparator`) | `primitives/Popover/*` | `open`, `onOpenChange`, `trigger`, `side`, `align` / `onSelect`, `selected`, `icon`, `hint`, `note`, `destructive` | ~11 menus |
| `Tooltip` | `primitives/Tooltip/Tooltip.tsx` | `label`, `side` | via `IconButton` + a few direct (`ContextMeter`, `TurnMenu`, `PermissionControl`, sidebar "New project") |
| `Segmented` | `primitives/Segmented/Segmented.tsx` | `options`, `value`, `onChange`, `ariaLabel`, `layoutId` (required) | 5 |
| `StepSlider` | `primitives/Slider/StepSlider.tsx` | `steps`, `value`, `onChange`, `minLabel`, `maxLabel` | 2 |
| `StateNote` | `components/state/StateNote.tsx` | `title`, `detail`, `action` | ~5 directly + several compositions |
| `Placeholder` / `PlaceholderText` / `PlaceholderMark` | `components/placeholder/Placeholder.tsx` | `sweep`, size | ~5 skeleton compositions |
| `StudioMark` | `components/brand/StudioMark.tsx` | `busy`, `entrance`, `size` | splash, thinking block, sidebar activity fallback, `EarlierBoundary`, `Transcript` |
| Icon system | `components/icons/*` | `Icons.<concept>` → component taking `size`, `state`, `className`, `style`; `ProviderMark provider` | 127 tsx call sites |

### 6.2 Feature-level components with a single caller (fine — feature-scoped, not "one-off flaws")

`HomePage`, `ProjectPage`, `NewProjectDialog`, `SettingsPage`, every `panes/*`, `providers/*` sub-component, `models/library/*`, `voice/*`, `rail/*`, `palette/*`, most `transcript/*` and `transcript/live/*`. Feature components with one caller are the norm and correct here; they are not counted as "one-off implementations" in the pejorative sense.

### 6.3 Genuinely one-off UI implementations that duplicate a concept

- `CredentialBadge.tsx` — "the app has exactly one badge; a primitive extracted from a single use is a guess about the second one" (docblock says as much — **intentional**).
- `ContextMeter` — the only SVG ring gauge; one caller.
- `ActivityMark` — the only 3×3 pulsing grid; one caller (sidebar), one fallback pattern.
- The drawn transport (`StopSquare`/`PauseBars` as spans, `PlayTriangle` as SVG) — deliberately *not* SVG for pixel-grid reasons (long docblock in `drawn.tsx`).

### 6.4 Shared lib / utility inventory

| Utility | File | Consumers | Verdict |
|---|---|---:|---|
| `cn(...classes)` | `lib/cn.ts` | ~everywhere (`clsx` + `tailwind-merge` taught the custom `text-micro/caption/ui/body/title` group) | Active, load-bearing |
| `newId(prefix)` | `lib/id.ts` | conversation ids, fork ids, first-turn | Active |
| `copyText(text)` | `lib/clipboard.ts` | `CodeBlock`, `TextBlock`, `MessageActions`, `ActionItems` | Active |
| `base64` helpers | `lib/base64.ts` | image attachments, provider-icon data URIs | Active |
| `effectiveTurnSettings` | `domain/session/settings.ts` | `ChatPage`, `TopStrip`, `TurnMenu`, `StartConversation`, `fork` | Active, single derivation (good) |
| `contextUsage` | `domain/session/context.ts` | `TopStrip` → `ContextMeter` | Active |
| `visionRefusal` | `domain/attachments/images.ts` | `ChatPage`, `StartConversation` | Active |
| `familyCatalog` / `familyName` / `connectionsOf` | `domain/models/families.ts` | model library | Active |
| `contextHint`/`contextFull`/`priceHint`/`priceFull`/`rowCapabilities` | `models/library/format.ts` | 3 model-library surfaces | Active, single source (good) |
| `classifyFailureKind` / `failureRemedy` | `chat/transcript/failure-kind.ts` | `AssistantTurn.EndLine`, `ConnectionNotice`, `SubmissionFailed`, `RetryWait` context | Active, shared (good) |
| `hostOf(href)` | `artifacts/sections/Sections.ts` (exported) | `WebSearchArtifact`, `Sections` | Active |
| `segment` / `createRateEstimator` / `useSmoothText` | `chat/streaming/*` | live transcript + demo `AssistantMessage` | Active |
| `formatClock` / `waveform` | `voice/waveform.ts` | `DictationBar` | Active |
| `capital(word)` | duplicated in `TurnMenu.tsx` + `ModelDetail.tsx` | 2 | **Duplicate — lift to `lib/` or `models/`** |
| `isRecord(value)` | duplicated in `ToolGroups.tsx` + `useConversation.ts` | 2 | **Duplicate — trivial, lift to `lib/`** |

No unused utilities were found. Everything in `lib/` has ≥2 consumers.

---

## 7. Button Audit (dedicated census)

### 7.1 Underlying implementations

| # | Implementation | Kind |
|---|---|---|
| 1 | `Button.tsx` | labelled, filled/outlined |
| 2 | `IconButton.tsx` | icon-only, circular |
| 3 | 48× raw `<button>` | one-offs, mostly one of ~4 recurring shapes (§5.8) |
| 4 | `<a>` styled as row | external-link rows |
| 5 | `<motion.button>` | 4 — the rail restore pill (`AppShell`), the sidebar compact scrim (`Sidebar`), the jump-to-latest FAB (`ChatPage`), inside `Segmented` option loop it's a plain `<button>` |

### 7.2 `Button` variants (the canonical system)

| Variant | Classes (abridged) | Meaning |
|---|---|---|
| `primary` | `bg-primary text-primary-foreground shadow-chip hover:bg-primary/90 active:bg-primary/80` | the one thing the page wants |
| `secondary` | `border bg-surface text-foreground shadow-chip hover:bg-tint` | a real action |
| `ghost` | `border-transparent text-muted-foreground hover:bg-tint hover:text-foreground` | should not compete |
| `danger` | `border-danger/35 text-danger hover:bg-danger/10` — **outlined, never filled** | loses data |

### 7.3 `Button` sizes

| Size | Classes | Height |
|---|---|---|
| `sm` | `h-7 rounded-md px-2.5 text-caption` | 28px |
| `md` | `h-8 rounded-lg px-3 text-ui` | 32px |
| `lg` | `h-10 rounded-lg px-4 text-ui` | 40px |

### 7.4 `IconButton` sizes / tones

| Size | Value | Tone `quiet` | Tone `solid` |
|---|---|---|---|
| `sm`/`md`/`lg`/`xl` | `var(--control-sm/md/lg/xl)` = `--ui-size` × 2 / 7⁄3 / 8⁄3 / 11⁄3 → **24 / 28 / 32 / 44px** at default | `text-muted-foreground hover:bg-tint` (+ `bg-selected` when `active`) | `bg-primary text-primary-foreground hover:opacity-85` (+ glyph forced to `primary-foreground`) |

### 7.5 Counts

```text
Underlying button implementations:                 2 canonical + raw <button> (48) + <a>-as-row
Visual variants (canonical):                       Button: 4 × 3 = 12;  IconButton: 4 × 2 = 8
Radii on buttons:                                  rounded-md (sm), rounded-lg (md/lg), rounded-full (IconButton) — 3, all from the scale
Heights on buttons:                                Button 28/32/40 (h-7/8/10);  IconButton 24/28/32/44 (--control-*)
Font sizes on buttons:                             text-caption (sm), text-ui (md/lg) — 2 roles, no literals
Icon sizes in buttons:                             mark sized 1.1em of the button's text unless a --icon-* step is passed
Hover behaviours:                                  1 pattern — background chip appears; glyph NEVER darkens (RULES §1)
Active behaviours:                                 1 — chip stays (bg-selected / opacity)
Disabled treatments:                               2 — Button: opacity-45 + pointer-events-none;  IconButton: opacity-40
Loading treatments:                                Button: <Spinner/> (rotating arc) replacing the label in-place;
                                                   Composer send: <WorkingRing/> (stroked SVG circle) OUTSIDE the button
```

### 7.6 Findings

- **No duplicate button *system*.** `Button` and `IconButton` are cleanly separated by shape (rectangular vs circular) and role (labelled vs tooltip-labelled).
- **`Spinner` (Button.tsx) and `WorkingRing` (Composer.tsx) are two rotating-arc spinners** with different construction (border-arc vs stroked SVG circle). `WorkingRing` has a long docblock justifying why it isn't the border-arc version. **Intentional specialisation**, but the *concept* ("indeterminate rotating arc") is drawn twice.
- **The 48 raw `<button>`s** are the real opportunity: ~15+ of them are the same "quiet nav row" shape, ~4 are the same hover-reveal overflow trigger. A `NavRow` / `RowButton` primitive would absorb both. (P2)
- Every button radius/height/font-size comes from a token or the `--control-*` scale. **Zero literal px on a button.**

---

## 8. Iconography System

### 8.1 Sources

| Source | Mechanism | Count |
|---|---|---|
| Lucide (`lucide-react`) via `fromLucide` | wraps the finished component in a `motion.span`, applies `.studio-icon` + sizing + optional whole-glyph motion | **52 concepts** in `REGISTRY` |
| Drawn here via `defineIcon` / bespoke | `Icon.tsx` glyph-as-data (`p`/`f`/`c`/`r`/`l` + per-part motion) or hand-built span/svg | **6**: `sidebar` (SVG frame + HTML divider), `voice` (VoiceWave path), `stop`/`pause` (spans, not SVG), `play` (SVG triangle) |
| `ProviderMark` | vendor logo as a **CSS mask** on a `currentColor` span (source SVGs are monochrome), resolved from `domain/providers/icons.ts` (harness catalog + session cache); falls back to a monogram, then an empty stroked tile | 1 component, ~11 call sites |
| `StudioMark` | 5 `motion.rect` tiles on a 96×128 canvas, `fill="currentColor"` | 1 |
| `ProjectIconMark` | abstract silhouettes (deliberately not pictorial — "a flask says the project is an experiment") | 1, `PROJECT_ICONS` set |
| Raster / emoji / CSS-generated icons | **none** | 0 |
| SVG asset files (`.svg` imported) | **none** — every mark is code or a mask data-URI | 0 |

### 8.2 Registry discipline

- `assertUnique(REGISTRY)` runs at module load in dev and **throws** if two concepts point at the same Lucide component. This is why there is genuinely **no "same icon, different meaning"** in the app.
- Explicitly-avoided collisions documented in `registry.tsx`: `Gauge` (reasoning) is *not* also providers; permission modes are a **transport triad** (`Pause`/`PenLine`/`FastForward`), *not* shields; `artifact` fallback is `Box`, *not* `Target`/`goal`; `openLarger` is `Maximize2`, *not* `PanelRight` (which is the sidebar family).

### 8.3 "Same meaning, different icon" — one genuine case

`Icons.disclosure` (`ChevronRight` + quarter-turn) vs `Icons.expand` (`ChevronDown`, static):

- `disclosure` — tree/section chevrons (sidebar sections, project sections, `ThinkingBlock`, `ToolGroups`, `TurnMenu` sub-panel back via `rotate-180`, `ModelDetail` back via `rotate-180`) — **8 uses**, animates.
- `expand` — `IdentityLine` title affordance, `GeneralPane`/`AddConnectionDialog` menu triggers, `CollapsibleText` "Show more" (via `rotate-180`) — **4 uses**, static `ChevronDown`.

Both mean "there is more here." Two different chevron directions + one animated, one not. **Minor inconsistency** (P3): a menu trigger uses `Icons.expand` (down chevron) while a disclosure uses `Icons.disclosure` (right chevron that turns down) — arguably a deliberate distinction (menu vs tree), but a reader can't easily tell.

### 8.4 Icon usage frequency (top)

```
Icons.disclosure  8    Icons.check      7    Icons.delete   6    Icons.add     6
Icons.close       8    Icons.stop       5    Icons.pin      5    Icons.more    5
Icons.copy        5    Icons.settings   4    Icons.project  4    Icons.newChat 4
Icons.failed      4    Icons.expand     4    …                  (tail: 1 each)
```

The tail (`goal`, `plan`, `mcp`, `connector`, `skill`, `hook`, `browserUse`, `permission*`, settings-section marks) is used **once each**, mostly through the `PERMISSION_MODES` / `SETTINGS_GROUPS` data tables. **Every registry concept is referenced.** `Icons.foo` appears only in a `fromLucide` docstring example — not a real usage, not a dead concept.

### 8.5 Stroke / sizing rules (enforced by `.studio-icon` in `index.css`)

- Every mark renders inside `.studio-icon`, which forces `color: var(--muted-foreground)` — a glyph **never inherits `currentColor`** from the text beside it, in any state. Two documented opt-outs: `IconButton` `solid` tone (mark on a filled chip), `MenuItem` `destructive` (glyph is the warning).
- `vector-effect: non-scaling-stroke` on all shapes → ~1.2px painted stroke at every size.
- Text-adjacent marks size at `1.1em`; standalone marks use `--icon-xs/sm/md/lg` = `--ui-size` ± {−1, +1, +3, +9}. `ProviderMark` uses its own larger `--provider-mark` / `--provider-tile` (vendor logos are drawn for business cards, not 12px).

---

## 9. Typography System

### 9.1 Families

| Family | Package | Where imported | Role |
|---|---|---|---|
| **Inter Variable** | `@fontsource-variable/inter` | `index.css:2` (`@import '@fontsource-variable/inter';`) | `--font-sans` — everything *read* (UI + transcript prose) |
| **Instrument Serif** | `@fontsource/instrument-serif` | `index.css:3` | `--font-display` — the *one statement* a page makes: `.studio-display` (home greeting, page titles), `.studio-heading` (dialog headers, sidebar wordmark). Nowhere else. |
| System mono | — (`ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, monospace`) | `index.css:230` | `--font-mono` — code, inline code, approval-prompt code parts, model ids. **No mono font is shipped.** |

### 9.2 The scale (`design/tokens/typography.ts` ↔ `index.css`, guarded by `assertScaleDefaults`)

| Role | Class | Size (at `--ui-size:12`) | Line-height | Weight | Tracking | Paired icon |
|---|---|---:|---:|---:|---:|---:|
| micro | `.text-micro` | `ui − 2` = **10** | 1.45 | 500 | +0.045em | 11 |
| caption | `.text-caption` | `ui − 1` = **11** | 1.5 | 400 | +0.006em | 13 |
| ui | `.text-ui` | `ui` = **12** | 1.55 | 400 | 0 | 13 |
| body | `.text-body` / `.studio-prose` | `ui` = **12** (level with `ui`) | **1.7** (loosest) | 400 | −0.003em | 13 |
| title | `.text-title` | `ui + 7` = **19** | 1.3 | 590 | −0.014em | 21 |
| display | `.studio-display` | `ui + 19` = **31** | 1.15 | (serif) | — | 31 |
| heading | `.studio-heading` | `ui + 7` = **19** (serif) | 1.25 | — | — | — |

Code size = `--ui-size + --code-offset` where `--code-offset ∈ {−2, −1, 0}` (default −1) — an *offset*, not an absolute, so "one step under" holds at every setting.

### 9.3 Usage distribution

```
text-caption   105   (36%)     ← the workhorse for secondary text
text-ui         87   (30%)     ← controls, menus, rows, composer
text-micro      37   (13%)     ← section headers, counts, hints
text-body        6   ( 2%)     ← transcript prose only (+ .studio-prose class, 5×)
text-title       3   ( 1%)
studio-display   3
studio-heading   3
```

### 9.4 Findings

- **Roles, never sizes** — holds almost perfectly. `grep -rn "text-\[" ` → **2** hits: `ToolGroups.tsx:92` (`font-mono text-[11px] leading-relaxed`) and `Sections.tsx:210` (`text-[color:var(--code-string)]` — a colour, not a size). `text-sm`/`text-xs`/etc.: **0**.
- **One violation to fix:** `ToolGroups.tsx:92` uses `text-[11px] leading-relaxed` instead of `text-caption`. This is the last raw font-size + raw leading pair in the app (RULES §6: "One size, one leading"). (P3)
- **`assertScaleDefaults()`** in dev compares `index.css`'s `:root` fallback against `typography.ts` and `console.error`s on drift.
- **Font weight on disk:** `@import '@fontsource-variable/inter'` (bare, no `/index.css` subpath) pulls the package's default entry, which imports **every subset** (latin, latin-ext, cyrillic, cyrillic-ext, greek, greek-ext, vietnamese). `files/` is ~**1.2 MB** of woff2+woff. Runtime `unicode-range` means non-latin subsets are only fetched if the glyphs are used (they never are — the app is English-first), but they still ship in the bundle/`dist`. Narrowing to `@import '@fontsource-variable/inter/latin.css'` (and the serif's `latin`) would cut the shipped font payload substantially. (P2, performance)
- **Unused font faces:** Instrument Serif ships regular + italic; only regular is used (`.studio-display`/`.studio-heading` never set `font-style: italic`). (P3)

---

## 10. Colour System

### 10.1 Palette — monochrome, chroma 0, oklch

All values in `index.css` `:root` (light) with a full `.dark` override. **~44 custom properties.**

| Token | Light | Dark | Role |
|---|---|---|---|
| `--surface` | `oklch(1 0 0)` | `oklch(0.205 0 0)` | base plane |
| `--surface-sunken` | `oklch(0.979 0 0)` | `oklch(0.164 0 0)` | behind surface (window ground, artifact ground, code table) |
| `--surface-raised` | `oklch(1 0 0)` | `oklch(0.235 0 0)` | above surface (composer, dialogs) |
| `--background` | = surface | = surface | |
| `--foreground` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` | text |
| `--muted` | `oklch(0.968 0 0)` | `oklch(0.271 0 0)` | opaque swatch (inline code, segmented track) |
| `--muted-foreground` | `oklch(0.553 0 0)` | `oklch(0.706 0 0)` | secondary text **and every icon** |
| `--tint` | `oklch(0.145 0 0 / 5%)` | `oklch(1 0 0 / 6.5%)` | hover — **translucent**, composites |
| `--selected` | `oklch(0.145 0 0 / 8%)` | `oklch(1 0 0 / 11%)` | active/selection — translucent |
| `--hairline` / `--border` | `oklch(0.145 0 0 / 7.5%)` | `oklch(1 0 0 / 8%)` | 1px separators (dark inverts to a *light* edge) |
| `--ring` | `oklch(0.145 0 0 / 45%)` | `oklch(1 0 0 / 45%)` | keyboard focus |
| `--primary` / `--primary-foreground` | `0.205` / `0.985` | `0.94` / `0.205` | the heaviest thing (primary button, tooltip, send chip) |
| `--overlay` | `oklch(1 0 0 / 93%)` | `oklch(0.235 0 0 / 93%)` | blur surfaces (`.studio-blur`) |
| `--scrim` | `oklch(0.145 0 0 / 16%)` | `oklch(0 0 0 / 40%)` | modal backdrop |
| `--code-surface` | `oklch(0.973 0 0)` (lighter) | `oklch(0.178 0 0)` (darker) | code panel — "inset means further from the light" |
| **`--danger` / `--danger-foreground`** | `oklch(0.55 0.19 25)` / `0.985` | `oklch(0.68 0.16 25)` / `0.205` | the **one hue in the chrome** — only for "this destroys something" |
| **`--voice-connecting/listening/thinking/speaking/blocked`** | `0.62 0` / `0.58 .12 245` / `0.68 .12 80` / `0.58 .11 155` / =danger | lifted in dark | the **second hue exception** — voice-mode stage only, "readable from across a room" |
| `--shadow-tint-weak/tint/strong` + `--shadow-hairline` | black at 6/12/26% | black at 24/38/55% (+ light hairline) | what the elevation scale is tinted with |
| `--code-comment/keyword/string/number/function/type` | 6 low-chroma hues in `.studio-code` | lighter variants in `.dark .studio-code` | syntax highlighting — "six colours, none of them shouting" |

### 10.2 Elevation scale (`@theme`)

```
--shadow-chip     0 1px 2px …weak
--shadow-raised   0 2px 10px …weak, + 1px hairline ring
--shadow-lifted   0 6px 20px -4px …tint, + 1px hairline ring
--shadow-overlay  0 12px 36px -10px …strong
--shadow-modal    0 24px 64px -18px …strong
--shadow-panel    8px 0 28px -12px …strong   (compact sidebar, cast sideways)
```

Dark mode deepens **every step at once** by raising the tint opacity and inverting the hairline to a light edge. Components are forbidden from writing `dark:shadow-[…]` (RULES §4; the one that did silently broke the composer's dark-mode focus lift).

### 10.3 Findings

- **`grep -rn "dark:"` → 1 hit, and it's inside a comment.** There is essentially no per-component dark-mode override anywhere. This is exemplary.
- **Hard-coded colours:** the only ones outside `index.css` are in `domain/session/gallery/marks.ts` (fixture SVG placeholders for the gallery's media artifacts — legitimate fixture data), `#000` in two mask-image gradients (`BlockFrame`, `CollapsibleText` — the `#000` is only providing alpha=1 for a mask, the hue is meaningless), and one inline `boxShadow: 'inset … oklch(0 0 0 / 18%), inset … oklch(1 0 0 / 14%)'` in `VoiceModeOverlay.tsx:390`.
- **Near-duplicate greys:** none in the tokens (they were consolidated). The scale steps (`0.145`, `0.164`, `0.178`, `0.205`, `0.235`, `0.271`, `0.553`, `0.706`, `0.968`, `0.973`, `0.979`, `1.0`) are each used for one role. No `#1A1A1A` / `#191919` / `#1B1B1B` situation exists.
- **Potential token-consolidation candidate (P3):** `VoiceModeOverlay`'s inline `oklch` shadow could be a token (`--shadow-voice-inset` or reuse the elevation scale). One occurrence.
- **`text-destructive` vs `text-danger`:** `grep` shows both. `--danger` is the defined token; `text-destructive` appears in `AssistantTurn.EndLine`, `SubmissionFailed`, `ConnectionNotice`, `ToolGroups`. Tailwind v4 with no `--color-destructive` token means `text-destructive` **resolves to nothing** (no such utility) — these spans are likely rendering at inherited colour, not danger red. **Possible bug (P2):** the failure/error text that's *meant* to be red may not be. Needs a runtime check. `text-danger` (the correct token) is used in `ArtifactBlock`, `ArchivePane`, `AddConnectionDialog`, `AddModelDialog`, `ModelLibrary`, `DefaultsSection`, `ArtifactShell`, `Sections`.

---

## 11. Spacing / Shape System

### 11.1 Spacing grid (`geometry.ts` `SPACE`, private)

```
none 0 · hair 2 · xs 4 · sm 6 · md 8 · lg 12 · xl 16 · 2xl 24 · 3xl 32
```

"Nothing in the app uses a value that is not here" — mostly true; Tailwind spacing utilities (`gap-1.5`, `px-2.5`, `py-1.5`, `p-3`, `mt-0.5`) are on the 4px grid via Tailwind's own scale (`1.5` = 6px, `2.5` = 10px, `3.5` = 14px). `gap-0.5` (2px) = `SPACE.hair`.

### 11.2 Radius (`RADIUS` in `geometry.ts` ↔ `--radius-*` in `@theme`)

```
xs 8 · sm 10 · md 12 · lg 14 · xl 18 · window/2xl 20 · pill 9999
+ --radius-block 20 / --radius-block-inner 12   (the concentric card/panel pair, 8px padding between → 20−8=12)
```

**Concentric rule:** container radius R with padding P holds children of radius R−P. Written out for every nested pair. `Popover` (`lg` panel, 4px pad → `sm` rows), `Segmented` (`lg` track, 2px pad → `md` rows), `BlockFrame` (`block`/20 outer, `block-inner`/12 inner).

### 11.3 Radius usage in `.tsx`

```
rounded-md         43   (12px — the default row/menu/chip radius)
rounded-full       41   (IconButton, badges, dots, pills, chips)
rounded-lg         15   (14px — popover panels, segmented tracks, some cards)
rounded-xl          6   (18px — dialogs, artifact ground, multiline composer)
rounded-sm          5   (10px — menu rows, tiny fields)
rounded-xs          3   ( 8px — inline code, kbd)
rounded-block-inner 3
rounded-block       2
rounded-2xl         2   (20px — user-message bubbles: rounded-2xl rounded-br-md)
```

**No `rounded-[…]` arbitrary radius** except `ActivityMark.tsx:57` (`rounded-[1px]` — a 3px cell, deliberately near-square). Composer radius is set inline from `COMPOSER.restingRadius` / `COMPOSER.multilineRadius` (animated, needs real numbers).

### 11.4 Control geometry (`CONTROL` / `--control-*`)

All derived from `--ui-size`:

```
--control-sm  = --ui-size × 2      → 24px   (compact round buttons, menu affordances)
--control-md  = --ui-size × 7/3    → 28px   (default icon buttons, composer row)
--control-lg  = --ui-size × 8/3    → 32px   (largest chrome round control)
--control-xl  = --ui-size × 11/3   → 44px   (voice transport only)
```

`round()` applied via `@supports (width: round(1px,1px))` so control sizes land on whole device pixels (the fix for the composer stop-square looking off-centre at 125%/150% Windows scaling).

### 11.5 Findings

- **Spatial system is coherent.** One 4px grid, one radius scale descending from the window's 20, one control scale derived from the type size.
- **Arbitrary Tailwind values are modest:** `max-w-[…]`×28 (reading measures, menu caps, truncation caps), `h-[…]`×19 (mostly `h-[1lh]` — the icon-on-first-line trick), `max-[48rem]:…`×9 (model-library index collapse), `size-[…]`×7 (`size-[var(--control-*)]`), `w-[…]`×6, `transition-[…]`×5. Most are *deriving from tokens* (`h-[var(--control-lg)]`, `size-[var(--control-md)]`) rather than inventing numbers.
- **`h-[1lh]`** is a recurring idiom (~10×) for "one line box tall, so a mark centres on the text's first line." It's correct and documented in RULES §6, not a smell.
- **Magic layout numbers that are *not* tokens:** `MIN_PAGE_WIDTH = 520` (`SideRail`), `COMPACT_WIDTH = 900` (`useCompactLayout`), `MENU_WIDTH = 208` / `MENU_HEIGHT = 252` (`ActionsMenu`/`SelectionMenu`), `pt-[16vh]` (palette), `w-[75vw] max-w-[1100px] max-h-[82vh]` (lightbox), `-top-14` (jump-to-latest FAB). These are one-off layout constants, reasonable, but not centralised. (P3)

---

## 12. Motion System

### 12.1 The vocabulary (`design/tokens/motion.ts` ↔ `index.css`)

| Token | Value | Use |
|---|---|---|
| `DURATION.fast` / `--duration-fast` | 120ms | hover, chips, state changes on visible things |
| `DURATION.base` / `--duration-base` | 180ms | entering/leaving — popovers, view crossfades, collapses |
| `DURATION.slow` / `--duration-slow` | 260ms | whole surface — palette, sheet, composer reshape |
| `EASE_OUT` / `--ease-out-quint` | `cubic-bezier(0.16, 1, 0.3, 1)` | the house curve |
| `SPRING_PANEL` | stiffness 320, damping 34, mass 0.9 | sidebar, rail (drag/toggle-paced) |
| `SPRING_SNAPPY` | 460 / 36 / 0.6 | popovers, chips, segmented thumb, selection chips, context menus |
| `SPRING_SURFACE` | 380 / 30 / 0.8 | dialogs, palette |
| `FADE` | opacity 0↔1, `base`, `EASE_OUT` | |
| `SURFACE_PUSH` / `SURFACE_POP` / `SURFACE_SIBLING` + `surfaceVariants()` | x ±32 in / ∓24 out, `slow`; sibling = pure crossfade `base` | page handovers (shell + model library only) |
| `COLLAPSE` | height 0↔auto, `base` (duration, never spring — spring overshoot on measured height reflows) | thinking block, tool groups, project section, sidebar section |
| `staggerDelay(i)` | `min(i × 0.025, 0.2)` — **capped** | artifact lists |
| `SPLASH` | `minDurationMs 1800`, `exitDuration 0.62`, `markExitDuration 0.34`, `revealDuration 0.7` | the one exception to the ~300ms ceiling |

### 12.2 Usage

- **46 files** import `framer-motion`. **76 `<motion.*>` element usages.** **23 files** use `AnimatePresence`.
- Distribution: `components` 10, `shell` 10, `features/chat` 10, `features/artifacts` 5, `features/voice` 3, `features/models` 2, one each for rail/home/palette/settings, `design` 1. `stores`, `domain`, `platform`, `features/projects` — **0** (correct: motion is a view concern).
- Reduced motion: handled **twice, globally, never in a component** — `<MotionConfig reducedMotion="user">` (root) + `@media (prefers-reduced-motion: reduce)` in `index.css` (collapses transitions to ~1 frame so `transitionend` still fires). One deliberate per-component check: `useSmoothText` reads `matchMedia` to skip the per-frame reveal entirely.

### 12.3 Ambient (looping) animations — outside the interaction ceiling by design

| Animation | Duration | File |
|---|---|---|
| `Button.Spinner` rotate 360 | 0.7s linear ∞ | `Button.tsx` |
| `Composer.WorkingRing` rotate 360 | 1.1s linear ∞ | `Composer.tsx` |
| `Placeholder` sweep x −60%→60% | 1.8s easeInOut ∞ | `Placeholder.tsx` |
| `WorkingDots` opacity pulse | 1.1s ∞ (×3 defs) | `ArtifactMotion`, `DictationBar`, `ReadAloud` |
| `StatusDot` running pulse | 1.2s ∞ | `StatusDot.tsx` |
| `ArtifactMotion.WorkingHalo` pulse | 1.8s ∞ | `ArtifactMotion.tsx` |
| `StudioMark busy` tile shimmer | 1.4s ∞ (per-tile stagger 0.12) | `StudioMark.tsx` |
| `ActivityMark` grid sweep | 1.6s ∞ (per-cell stagger) | `ActivityMark.tsx` |
| `SplashScreen` mark settle | 0.8s | `SplashScreen.tsx` |
| `VoiceModeOverlay` breathing | 1.6s ∞ | `VoiceModeOverlay.tsx` |
| `DictationBar`/`ReadAloud` bars | 1.1s ∞ | voice |
| `AssistantTurn` text caret | `animate-pulse` (Tailwind) | `AssistantTurn.tsx` |

### 12.4 Findings

- **The interaction motion system is genuinely unified.** Every hover/press/enter/leave/handover picks from the three durations + three springs. `grep -rE "duration-\[?[0-9]"` → **0** (no `duration-150`, no arbitrary duration utilities). `duration-fast`×52, `duration-base`×7, `duration-slow`×0 in `.tsx` (slow only via the token in Framer/inline).
- **Ambient loops are a looser set:** durations `0.7 / 1.1 / 1.2 / 1.4 / 1.6 / 1.8`. These are "still working" indicators and RULES §10 explicitly permits them, but there is **no token for ambient/loop duration** — each file picks 1.1 or 1.8 by hand. A `LOOP.slow` / `LOOP.fast` pair (or just standardising on 1.1s for dots and 1.6–1.8s for sweeps) would tidy this. (P3)
- **`WorkingDots` × 3** (§5.8) — the clearest motion duplication. Same three-dot pulse, three implementations, delays `0.36` vs `0.18`. (P2)
- **Direction-aware exits** use `surfaceVariants()` + `custom` prop correctly in both places a handover can reverse (`AppShell`, `ModelLibraryDialog`). Documented failure mode (frozen exit props replaying the previous move) is avoided.

---

## 13. Interaction System

### 13.1 Control state model (RULES §1 — "one state, one channel")

| State | What moves | What must NOT |
|---|---|---|
| rest | nothing | — |
| hover | the background chip appears (`--tint`) | the glyph must not darken/thicken/move |
| press | the chip deepens; `Button` scales to 0.97; `IconButton` does **not** scale | the button must not translate |
| active | the chip stays (`--selected`) | the glyph must not darken |

Enforced by: `.studio-icon { color: var(--muted-foreground) }` (glyph never inherits row colour), `IconStateContext` (the *button* publishes state, so the whole 28px target drives the 14px mark), `TONE_CLASS` in `IconButton` (no `hover:text-foreground` on the glyph).

### 13.2 Motion-as-meaning (the missing contrast is paid for by movement)

| Glyph | Motion | Trigger |
|---|---|---|
| `disclosure` (chevron) | quarter turn (`TURN`) | `on` |
| `add` (plus) | 45° → cross (`CROSS`) | `on` (menu open) |
| `send` (arrow) | lift `y: -1.5` (`LIFT`) | hover |
| `reload` (retry) | wind `rotate: -38` (`WIND`) | hover |
| `settings` (gear) | `rotate: 22` (`TURN_SLIGHT`) | hover |
| `delete` (trash) | lid lift `y: -1` (`LIFT_LID`) | hover |
| `jumpToLatest` (down arrow) | `y: 1.5` | hover |
| `SidebarToggle` divider | slides right 3.4u (HTML element, `left` transition) | `on` (panel open) — **not** on hover (deliberate: "the divider twitched every time the pointer crossed the button") |

### 13.3 Recurring interaction patterns — consistent

- **Hover-reveal chrome that keeps its height** (`MessageActions`, `BlockFrame` actions were *made* always-visible after this, `ArtifactShell` open-larger, `ConversationRow`/`ProjectSection` overflow, `WebSearchArtifact` external-link icon, `RailTabs` close) — always `opacity` only, never mount/unmount, and stays visible while a child has focus.
- **Escape bound to `document`, not the panel** (`Dialog`, `Popover`, `CommandPalette`, `MediaLightbox`, `ActionsMenu`, `SelectionMenu`) — so it works after focus drifts into a child menu.
- **Dismiss on `pointerdown` not `click`** (`Popover`, `ActionsMenu`, `SelectionMenu`) — so the closing menu doesn't flash its focus ring on the way out.
- **Sliding selection chip** (`layoutId`) for "which row am I in" — `ConversationRow`, `SettingsTree`, `LibraryIndex`. `SURFACE_SIBLING` is a pure fade *because* this chip supplies the travel.

### 13.4 Findings — inconsistencies

| # | Pattern | Variants | Severity |
|---|---|---|---|
| 1 | **Modal shell** | `Dialog` (primitive, centred), `MediaLightbox` (own scrim, `75vw` custom), `CommandPalette` (own scrim, top-anchored `pt-[16vh]`) | P2 — the scrim + `AnimatePresence` + scale-in enter is copy-pasted 3×; only the panel geometry differs. Extract a `<ModalScrim>` / `<Overlay>` that `Dialog`, `MediaLightbox`, `CommandPalette` all wrap. |
| 2 | **Floating layer placement** | `Popover` & `Tooltip` (portal + `getBoundingClientRect` + clamp + flip), `ActionsMenu` & `SelectionMenu` (fixed position + `Math.min` clamp, **no portal**, own dismiss listeners) | P2 — `ActionsMenu`/`SelectionMenu` re-implement placement + outside-click + Escape. They already share `ActionItems` for *contents*; a shared `<FloatingMenu at={{x,y}} onDismiss>` would unify placement too. |
| 3 | **Disclosure chevron** | `Icons.disclosure` (right, turns) vs `Icons.expand` (down, static) for "there's more" | P3 (see §8.3) |
| 4 | **Rename affordance** | inline `<input>` in `IdentityLine` & `ConversationRow` (near-identical), vs `Rename` opening the same inline `<input>` from a menu, vs `ModelLibrary` rename which is inline with Save/Cancel buttons | P3 — three subtly different inline-rename UXes. |
| 5 | **"Working" indicator** | `Spinner` (Button), `WorkingRing` (Composer send), `StudioMark busy`, `ActivityMark`, `WorkingDots` (×3), `StatusDot` running, `WorkingHalo` | P2 — seven visual vocabularies for "in flight". RULES §10 justifies most (structural, not a spinner), but `Spinner`+`WorkingRing` overlap and `WorkingDots` is literally tripled. |
| 6 | **Copy-with-confirm** | identical logic in `CodeBlock`, `TextBlock`, `MessageActions` | P2 — extract `<CopyButton text size>`. |

---

## 14. Duplication Analysis

Ranked by consolidation value.

### D1 — Two parallel transcript-rendering stacks (P1, ARCHITECTURE/DUPLICATION)

| Concern | Demo/gallery stack | Live stack |
|---|---|---|
| List | `transcript/Transcript.tsx` | `transcript/live/LiveTranscript.tsx` |
| User message | `transcript/UserMessage.tsx` | `transcript/live/LiveUserMessage.tsx` |
| Assistant message | `transcript/AssistantMessage.tsx` | `transcript/live/AssistantTurn.tsx` |
| Data source | `conversation.messages` (seeded `Message[]`) | `useConversationTranscript` projection (`TranscriptItem[]`) |
| Callers | `ChatPage` **only when** `conversation.id === GALLERY_CONVERSATION_ID` | `ChatPage` for every other conversation, `DetachedShell` |

`UserMessage` and `LiveUserMessage` are ~40 lines each and **structurally identical** (same bubble classes, same `CollapsibleText`, same `MessageActions visible={hovered} align="end"`). `Transcript` and `LiveTranscript` share `useTranscriptWindow` + `EarlierBoundary` + `StudioMark busy` but diverge on item typing.

**Origin:** the demo stack predates the live harness path; the gallery kept it. **Impact:** every transcript change risks being made in one stack and not the other; the gallery drifts from the real UI. **Recommendation:** collapse the gallery onto the live projection shape (feed the scripted `scene.ts` through `seededFrom`-style adaptation into `TranscriptItem[]`), then delete `Transcript`/`UserMessage`/`AssistantMessage`. This also removes `stores/workspace/demo-turns.ts`, `useDemoTurn.ts`, and the `Composer`'s "demo transport" branch (`send`/`stop` from the workspace store — "exactly one caller left").

### D2 — `WorkingDots` × 3 (P2, DUPLICATION)

`ArtifactMotion.tsx` exports one. `DictationBar.tsx` and `ReadAloud.tsx` each define a private one. Delays differ (0.36 vs 0.18), sizes match (`size-[3px]`). Lift the exported one; parametrise the delay/size if the voice ones genuinely need to be faster.

### D3 — "no-harness / failed + busy retry button" × 4 (P2, DUPLICATION)

`SidebarUnavailable`, `ModelLibraryDialog.CatalogFailure`, `ArchivePane` (inline), `ProjectPage` (inline). Each: a `useState` busy flag, `StateNote` with `title`/`detail`/`action`, a `<Button variant="secondary" size="sm" busy={asking} onClick={() => { setAsking(true); void ensureStore().finally(...) }}>` with label "Start the harness" or "Try again". Extract `<HarnessUnavailable phase onRetry>`.

### D4 — Copy-with-confirm × 3 (P2, DUPLICATION)

`CodeBlock`, `TextBlock`, `MessageActions` — identical `AnimatePresence mode="wait"` copy↔check swap + 2000ms `setTimeout`. Extract `<CopyButton text label size>`.

### D5 — Modal scrim shell × 3 (P2, DUPLICATION)

`Dialog`, `MediaLightbox`, `CommandPalette` — same `studio-blur-scrim fixed inset-0 z-50 … bg-scrim` + `AnimatePresence` + inner `initial={{opacity:0, scale:0.97}}` + `SPRING_SURFACE`. Extract `<Overlay onClose anchor="center"|"top">`.

### D6 — Floating menu placement + dismiss × 2 (P2, DUPLICATION)

`ActionsMenu` and `SelectionMenu` re-implement viewport clamping + `pointerdown`/`Escape` dismiss + `SPRING_SNAPPY` panel. They already share `ActionItems`. Extract `<FloatingMenu at onDismiss>`.

### D7 — "Quiet nav row" `<button>` shape × 15+ (P2, DESIGN SYSTEM)

No `NavRow` / `RowButton` primitive. The class string `flex items-center gap-1.5 rounded-md px-1.5 py-1 text-ui text-muted-foreground transition-colors duration-fast hover:bg-tint hover:text-foreground` (± `truncate`, ± leading icon, ± trailing hint) is retyped everywhere. A primitive with `icon`/`label`/`hint`/`selected`/`onClick` would absorb `Sidebar.Action`, `IdentityLine` project button, `TurnMenu`/`ModelDetail` back rows, the account button, `FamilyCard`, and several list rows.

### D8 — Sliding selection chip × 3 (P3, DUPLICATION)

`<motion.span layoutId absolute inset-0 rounded-md bg-selected>` in `ConversationRow`, `SettingsTree`, `LibraryIndex` (each with its own `layoutId` — correctly, to avoid one chip flying between surfaces). Extract `<SelectionChip layoutId active>` (renders null when `!active`).

### D9 — Inline rename `<input>` × 2 (P3)

`IdentityLine`, `ConversationRow`. Extract `<InlineRename value onCommit onCancel>`.

### D10 — `capital()` × 2, `isRecord()` × 3 (P3, trivial)

Lift to `lib/`.

### D11 — Skeleton width arrays × 4 (P3)

Each skeleton hand-writes `['58%','41%',…]`. Minor; a `randomishWidths(n)` helper or a shared constant would do.

### Non-duplication (intentional variation, do NOT consolidate)

- `Button.Spinner` vs `Composer.WorkingRing` — different because one replaces a label in-place and one is a halo *outside* the button (both have docblocks explaining why).
- `Dialog` vs `MediaLightbox` panel geometry — genuinely different (centred fixed-width vs media-sized).
- `MediaArtifact` handling image + video in one component — deliberate (docblock: "the difference is one `<img>` vs one `<video>`").
- Demo `useSmoothText` vs live `useSmoothText` — same hook, both call it. Not duplicated.
- `CatalogStateNote` vs `StateNote` — different on purpose (menu-sized sentence vs page-sized failure block).

---

## 15. Dead / Unused / Legacy Analysis

### CONFIRMED UNUSED

**None.** Every `components/`, `primitives/`, `lib/`, `stores/`, `domain/` export has at least one consumer. Every icon concept is referenced. No unused hooks. No unreferenced feature components (feature components with one caller are expected).

### PROBABLY UNUSED / near-dead

| Item | Status | Note |
|---|---|---|
| `stores/workspace/demo-turns.ts`, `useDemoTurn.ts` | **near-dead** | Only caller is the artifact gallery. `Composer`'s default `send`/`stop` path (`useWorkspace().send`) has "exactly one caller left" per its own docblock. Removed if D1 is done. |
| `transcript/Transcript.tsx`, `UserMessage.tsx`, `AssistantMessage.tsx` | **near-dead** | Gallery-only (D1). |
| `domain/session/demo.ts` | **near-dead** | "What remains of the demo is what still has a caller" — the canned reply. Gallery-adjacent. |
| `first-attach.ts` `FirstAdmission.at` field | **live but read by nothing** | Docblock: "Nothing reads it. It was the anchor for a row that counted the wait, and that row is gone." Kept deliberately for the next thing that measures a wait. |
| `PendingSubmission.at`, `ThinkingSpan` bookkeeping | similar — kept, not read | documented |
| `Icons.foo` | not a concept | docstring example only |
| `media-fullscreen-button`, `media-duration-display`, `media-poster-image` in `elements.d.ts` | declared, not used | the `.d.ts` declares more `media-chrome` elements than `VideoPlayer` renders (only `media-play-button`/`time-display`/`time-range`/`mute-button` are used). Harmless type declarations. (P3) |

### ACTIVE

Everything else.

### LEGACY / SUSPICIOUS (used, but flagged)

| Item | Why flagged |
|---|---|
| The whole demo/gallery transcript path | Functional and reachable, but it is "a display of artifacts, not a conversation" — a second rendering stack kept alive for a showcase. |
| `PLACEHOLDERS` (10 settings sections) + `PlaceholderPane` | Deliberate scaffolding ("waiting on the harness"), but 13 of 17 settings sections have no real content. If the harness work stalls, this is a large surface of "coming soon". Not dead — it's a roadmap rendered as UI. |
| `NewProjectDialog` folder picker | Demo-only ("appends a plausible path rather than opening the OS dialog"). Documented as a one-function swap. |
| `ProjectSection` "Copy working directory" menu item | `onSelect={() => setMenuOpen(false)}` — closes the menu, does nothing else. Stub. (P3) |
| `AddMenu` items: Files, Folder, Set a goal, Plan first, Extensions | All `onSelect={pick()}` — close the menu, no handler. Only "Image" is wired (`pick(onImage)`). Stubs. (P2 — these read as working affordances) |
| `IdentityLine` branch menu "New worktree" | `onSelect={() => setBranchOpen(false)}` — stub. (P3) |

---

## 16. Accessibility Findings

### Definite / strong

- **Keyboard focus is real and keyboard-only:** `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px }` globally; `TextField` draws its own inner ring and kills the outer outline (`focus-visible:outline-none!`) to avoid a double ring clipped by `overflow` ancestors.
- **Chrome is `user-select: none` by default;** content opts back in via `.studio-selectable` / `.studio-prose`.
- **`role="status"` on every skeleton region** (9×) with a spoken `aria-label`; bones are `aria-hidden`.
- **`role="dialog" aria-modal aria-label`** on `Dialog`, `MediaLightbox`, `CommandPalette`, the model library.
- **`role="menu"` / `menuitem` / `menuitemradio`** on popovers and context menus; `MenuItem` sets `aria-checked` when it's a radio row.
- **`Segmented` = `role="radiogroup"` + `role="radio" aria-checked`**; `StepSlider` = native `range` with `aria-label` + `aria-valuetext`.
- **`IconButton` requires a `label`** (used as `aria-label` *and* the tooltip) — no unlabelled icon button can exist.
- **`Tooltip`** opens on `:focus-visible`, not raw focus.
- **`SideRail.ResizeHandle`** = `role="separator" aria-orientation="vertical" aria-valuenow/min/max` + ArrowLeft/Right keyboard resize.
- **`role="alert"`** on the 4 form-error `<p>`s (AddConnection, AddModel).
- **IME-safe Enter:** `ComposerField` checks `event.nativeEvent.isComposing` so Enter during a CJK conversion doesn't send.

### Likely issues

| # | Issue | Where |
|---|---|---|
| A1 | **`text-destructive` is not a Tailwind v4 utility** (no `--color-destructive` token). Error/failure text meant to be red may be rendering at inherited colour. | `AssistantTurn.EndLine`, `SubmissionFailed`, `ConnectionNotice`, `RetryWait` context, `ToolGroups` "failed". Contrast + meaning both affected. **P2, verify at runtime.** |
| A2 | **`ArchivePane` select checkbox** is a `<button role="checkbox" aria-checked>` but the surrounding row isn't a group/list; screen-reader row context is thin. | `ArchivePane.tsx` |
| A3 | **`MenuItem` with `note`** puts a second line inside the button; the note isn't associated via `aria-describedby`, so a SR reads label+note as one run (probably fine, worth noting). | `MenuItem.tsx` |
| A4 | **`CommandPalette` list** has no `role="listbox"`/`option` and no `aria-activedescendant` — arrow-key navigation moves a visual highlight only; a SR user tabbing gets plain buttons. | `CommandPalette.tsx` |
| A5 | **`AddModelDialog` capability checkboxes** use `title={hint}` for the hint — `title` is unreliable for SR and touch. | `AddModelDialog.tsx:196` |
| A6 | **`ToolGroups` level-3 detail** is `font-mono text-[11px]` — small; JSON dumps in an 11px mono block. Zoom/readability. | `ToolGroups.tsx:92` |
| A7 | **Focus trap** — `Dialog` doesn't appear to trap focus inside the panel (Escape works, click-out works, but Tab can leave). No `focus-trap` library. | `Dialog.tsx` |
| A8 | **`ContextMeter`** SVG has `aria-hidden` on the `<svg>` but the wrapping `Tooltip` label carries the percentage — OK, but the visible `{percent}%` text beside it is not in a labelled region. | `SessionControls.tsx` |

### Unknown (runtime-only)

- Contrast of `--muted-foreground` (0.553 light / 0.706 dark) against `--surface` — likely passes AA for `text-caption`+ but not verified.
- Whether the drawn transport spans (`StopSquare` etc.) announce anything — they're `aria-hidden`, so they rely on the `IconButton` label. Fine.
- Voice mode overlay's state-colour semantics for colour-blind users (mitigated: it also has motion + a label).

---

## 17. Performance / Weight Findings

### Dependencies (`package.json`, runtime)

```
react 19 / react-dom 19          framer-motion ^12
@tauri-apps/api ^2 + plugin-store  clsx + tailwind-merge
react-markdown ^10 + remark-gfm + remark-math + rehype-katex + rehype-raw + rehype-sanitize
react-syntax-highlighter ^16     katex ^0.18     media-chrome ^4
lucide-react ^1                  @fontsource-variable/inter + @fontsource/instrument-serif
tailwindcss ^4 + @tailwindcss/vite
```

### Findings

| # | Finding | Severity |
|---|---|---|
| P-1 | **`@import '@fontsource-variable/inter'` (bare)** pulls every subset (~1.2 MB woff2+woff on disk). Narrow to `/latin.css` (and Instrument Serif's latin). English-first app; non-latin subsets are never used. | **P2** |
| P-2 | **`katex/dist/katex.min.css` imported unconditionally** (~23 KB CSS) + KaTeX JS via `rehype-katex`. Math is rare in replies. Could be lazy-loaded when a `$…$` is detected. | P3 |
| P-3 | **`react-syntax-highlighter` — well handled.** Uses the `Light` build with **12 hand-registered grammars**, not the ~200-grammar default. `useInlineStyles={false}` so the theme is CSS (no per-render style object). Good. | — (positive) |
| P-4 | **`media-chrome` (~4.x)** loaded via bare `import 'media-chrome'` at module scope in `VideoPlayer.tsx` — pulls the whole custom-elements bundle even for conversations with no video. Could be dynamic. | P3 |
| P-5 | **`react-markdown` + 6 plugins re-run per streamed chunk** — mitigated by `StreamedMarkdown` segmenting into memoised blocks (only the tail re-parses) and `Markdown` being `memo`'d. Good engineering; the risk is if someone adds a non-memoised consumer. | — (mitigated) |
| P-6 | **`AppShell` remount bug is fixed** (`Surface()` is called, not rendered) but is fragile — a future refactor that makes it `<Surface/>` re-introduces 35 remounts/sec during a stream. The docblock is the only guard. | P3 (tech debt) |
| P-7 | **Transcript windowing** (`useTranscriptWindow`, `INITIAL=40`, `BATCH=24`) — solid. Not a virtual list (deliberate — rows vary wildly in height); batches + `IntersectionObserver` + a layout-effect scroll correction. Chromium scroll anchoring is turned off on the viewport to avoid a double correction. | — (positive) |
| P-8 | **`public/demo/generated-loop.mp4` (243 KB)** ships in every build for the gallery's media artifact. | P3 |
| P-9 | **`ProviderMark` fetches vendor logos** via `resolveProviderIcon` (harness catalog, session-cached, null cached as firmly as success) — no per-render network, no third-party favicon requests anywhere in the app (`WebSearchArtifact` deliberately uses a letter-in-a-disc instead of favicons). | — (positive) |
| P-10 | **No code-splitting / lazy routes.** Everything is one bundle. For a desktop app of this size (~32k LOC) that's defensible, but the model library, voice mode, and settings/providers are large leaf features that never load until used. | P3 |

### Duplicate assets / libraries

- **No duplicate UI library** (Lucide is the only icon lib; no second one).
- **No duplicate font of the same family.**
- **One video-player library** (`media-chrome`), styled entirely via `.studio-player` CSS variables.
- **`WorkingDots` ×3** and the near-duplicate transcript stack are the only "duplicate implementation" weight.

---

## 18. Architectural Issues

**None at P0.** The architecture is sound and unusually well-reasoned. Issues worth naming:

| # | Issue | Severity | Notes |
|---|---|---|---|
| AR-1 | **Two transcript stacks** (D1). | P1 | The one real structural duplication. |
| AR-2 | **`WorkspaceProvider` is 943 LOC and holds everything** — projects, conversations, messages, settings, running set, catalog, harness client wiring, lifecycle subscription, demo turns. It re-publishes a new conversation object on every stream chunk (~28ms), which is why `AppShell.Surface()` had to become a plain function. | P2 | Not broken, but it's the single largest render-churn source and the fragility behind AR-3. Splitting harness-wiring out of the store would help. |
| AR-3 | **`AppShell.Surface()` remount fragility** (P-6). | P3 | One misstep re-introduces a severe stream stutter. |
| AR-4 | **Settings is 13/17 placeholder.** | P2 (roadmap risk, not code) | The layout/routing/tree machinery is all built; the content isn't. If harness work for MCP/connectors/skills/hooks/git stalls, this is a lot of visible "coming soon". |
| AR-5 | **No focus trapping in modals** (A7). | P2 | |
| AR-6 | **`text-destructive` non-token** (A1). | P2 | Likely a real rendering bug for error text. |
| AR-7 | **Stubbed menu items that look live** (`AddMenu` Files/Folder/Goal/Plan/Extensions, `ProjectSection` "Copy working directory", branch "New worktree"). | P2 | A user clicking "Set a goal" gets a closed menu and nothing. Either wire, disable, or mark "soon". |
| AR-8 | **`platform/harness/contracts.ts` is 1,342 LOC** of wire schema in one file. | P3 | It's parse-not-assert (good), but hard to navigate. |

---

## 18A. Monolith Files — one file, many jobs

Non-test files by LOC, with what is crammed into each and where the seams are. (`index.css` and `contracts.ts` are the two true giants; everything at 400+ is a candidate.)

| File | LOC | What's inside (the distinct jobs) | Split into |
|---|---:|---|---|
| `platform/harness/contracts.ts` | 1,342 | The entire wire schema — connection contracts, chunk facts, snapshot facts, model capability, reasoning vocab, turn settings, approval records, execution modes, seam failures. ~15 concern-groups, one flat file. Parse-not-assert (good). | `contracts/{connection,chunks,snapshot,model,turn,approval,failure}.ts` re-exported by `contracts/index.ts` |
| `index.css` | 1,308 | `@theme` tokens + `:root`/`.dark` palettes + base reset + `@layer components` (type roles, prose, tables, syntax theme) + scrollbars + `.studio-player` + unlayered KaTeX cap | `styles/{tokens,palette,base,type,prose,scroll,player}.css` behind one `index.css` |
| `features/chat/transcript/projection.ts` | 1,049 | Renderable shapes + segment construction (`appendDelta`/`appendToolCall`/`answerToolCall`) + `settleSubmissionFailure` rules + `seededFrom` snapshot seeding + `applyChunks` + pending-submission bookkeeping | `projection/{shapes,segments,settlement,seed,apply}.ts` |
| `stores/workspace/WorkspaceProvider.tsx` | 943 | Projects + conversations + messages + turn settings + running set + catalog + harness client wiring + lifecycle subscription + ~25 mutations. Also **imports `defaultListen` from `features/chat`** (inverted dep — see M2). | `workspace/{state,mutations,harness-sync,catalog}.ts(x)` |
| `platform/harness/conversation.ts` | 786 | Conversation-stream client + chunk decoding + reattach/offset + liveness | `harness/conversation/{client,decode,liveness}.ts` |
| `features/chat/useConversation.ts` | 741 | `ConversationPhase` state machine + `reduceChunks` (pure) + liveness timer + lifecycle subscription + `submit`/`abort`/`resume` + `defaultContactFor` (**calls `invoke`/`listen` directly** — see M1) | phase hook / `reduceChunks` (pure, colocate or `transcript/`) / `defaultContactFor` → `platform/harness/contact.ts` |
| `platform/harness/conversation-chunks.ts` | 695 | Chunk-fact decoding | fold into the `conversation/` split |
| `platform/harness/client.ts` | 683 | One class, ~20 methods — connections, models, defaults, probe, conversation CRUD, approvals, catalog, lifecycle | `client/{connections,models,defaults,approvals,conversations,catalog}.ts` |
| `features/chat/composer/Composer.tsx` | 673 | Draft wiring + image pick/encode + send/stop receipt logic + dictation integration + the 4-way reshape animation (`SHAPE_MOTION`, grid track) + `WorkingRing` + the file `<input>` | `composer/{useComposerSend,useComposerImages}.ts` + `WorkingRing.tsx`; layout stays in `Composer.tsx` |
| `features/settings/providers/AddConnectionDialog.tsx` | 460 | Three forms (pick / library / custom) + draft assembly + protocol guards + `ProbeOutcome` in one component | `AddConnectionDialog/{PickMode,LibraryForm,CustomForm,ProbeOutcome}.tsx` |
| `shell/sidebar/Sidebar.tsx` | 459 | Compact scrim + brand band + drag region + standing actions + section header + organize/sort menu + flat-vs-grouped list + loose section + footer + the `Action` sub-component | `Sidebar/{BrandBand,SidebarMenu,ConversationList,SidebarFooter}.tsx` |
| `domain/session/gallery/scene.ts` | 444 | 444 lines of hand-authored scripted showcase content — a **feature fixture in `domain/`** | move to `features/chat/gallery/scene.ts` |
| `features/voice/VoiceModeOverlay.tsx` | 396 | Full-screen stage + 5 states + transport + inline `oklch` shadow + breathing animation + transcript | `VoiceMode/{Stage,Transport}.tsx` + `useVoiceStage.ts` |
| `shell/chrome/TurnMenu.tsx` | 365 | The turn pill **plus** `ModelPanel` / `ReasoningPanel` / `reasoningSteps` / label helpers — model-library UI living in window chrome, overlapping `features/models/` | `shell/chrome/TurnMenu.tsx` (thin trigger) + `features/models/picker/{ModelPanel,ReasoningPanel}.tsx` |

## 18B. Misplaced Code — wrong folder / wrong layer

Layer order implied by `RULES.md` + the tree: **`design`/`styles` → `lib` → `components` → `domain` → `platform` → `stores` → `features`/`shell` → `App`.** Lower layers must not import higher. Verified with `grep`.

| ID | Finding | Evidence | Fix | Sev |
|---|---|---|---|---|
| **M1** | **Tauri usage outside `platform/`.** RULES: "`platform/` is the sole Tauri seam." | `features/chat/useConversation.ts:2-3` imports `invoke` + `listen`; `defaultContactFor` calls `get_harness_status`, hook subscribes to `LIFECYCLE_EVENTS`. `design/theme/appearance.ts:1` + `features/chat/composer/drafts.ts:1` import `@tauri-apps/plugin-store`. | `defaultContactFor` + lifecycle list → `platform/harness/{contact,lifecycle}.ts`; wrap the store as `platform/store.ts` (both `appearance` and `drafts` consume it) | P2 |
| **M2** | **`stores/` imports `features/`** — inverted dependency. | `stores/workspace/WorkspaceProvider.tsx:34` → `import { defaultListen } from '@/features/chat/useConversation'` | move `LIFECYCLE_EVENTS` + `defaultListen` to `platform/harness/lifecycle.ts` (below both consumers) | P2 |
| **M3** | **`components/` imports `domain/`** — a "primitive" that isn't portable. | `components/icons/ProviderMark.tsx:3` → `@/domain/providers/icons` (`resolveProviderIcon`, which talks to the harness catalog) | move `ProviderMark` to `domain/providers/`, or inject `resolveProviderIcon` as a prop | P3 |
| **M4** | **`domain/session/` is four categories in one folder.** | `types.ts` (conversation types), `settings.ts` (turn-settings derivation), `context.ts` (context-window math), `recents.ts` (localStorage of recent **models** — a `models/` concern), `demo.ts` + `gallery/` (fixtures) | split → `domain/conversation`, `domain/turn`, `domain/models` (recents); fixtures leave `domain/` | P3 |
| **M5** | **Pure helpers stranded in feature files.** | `hostOf()` in `artifacts/sections/Sections.tsx`; `failure-kind.ts` (quota/rate-limit classification, no React, 4 consumers) buried in `transcript/`; `capital()` ×2, `isRecord()` ×3, two time-formatters (`formatSeconds` in `ThinkingBlock`, `formatClock` in `voice/waveform`) | `lib/{url,text,guards,time}.ts`; `failure-kind.ts` → `domain/failures/` | P3 |
| **M6** | **`features/chat/` root is a dumping ground.** | `first-attach.ts`, `first-turn.ts`, `fork.ts`, `useConversation.ts`, `useConversationTranscript.ts` all at the chat root beside `ChatPage.tsx` | `features/chat/connection/` | P3 |
| **M7** | **Loose files at folder roots + one misnamed file.** | `shell/` root: `ActionItems`/`ActionsMenu`/`SelectionMenu` ungrouped while `chrome/` + `sidebar/` exist → `shell/menus/`. `stores/workspace/demo-turns.ts` + `useDemoTurn.ts` (gallery concerns) → `features/chat/gallery/`. `shell/chrome/SessionControls.tsx` holds only `ContextMeter` → rename `ContextMeter.tsx`. | as noted | P3 |
| — | **Cross-feature import edges** (coupling, not misplacement; none circular): `home→chat`, `projects→chat` (shared `StartConversation`), `rail→artifacts` & `chat→artifacts` (render artifacts), `chat→voice` (composer + 2 transcript comps — the heaviest, 3 files), `palette→settings` (imports `ALL_SECTIONS` data). All acceptable. | `grep` | — | — |

## 18C. Target Category / Sub-category Folder Structure

Behaviour-neutral — import paths only. `bold` = folder, `←` = new or moved-in, `⟨split⟩` = a monolith broken up.

```text
src/
├── styles/               ← index.css split
│   index.css  tokens.css  palette.css  base.css  type.css  prose.css  scroll.css  player.css
├── lib/                  cn  id  base64  clipboard  ←url  ←text  ←guards  ←time
├── design/               tokens/  theme/                     (unchanged)
├── components/
│   ├── icons/   primitives/
│   ├── feedback/         ← placeholder + state (StateNote)
│   └── identity/         ← brand (StudioMark)   [ProviderMark leaves → domain/providers]
├── domain/               types + PURE logic only — no fixtures
│   ├── conversation/     ← session/types.ts
│   ├── turn/             ← session/settings.ts, session/context.ts
│   ├── models/           + session/recents.ts
│   ├── providers/        icons.ts + ←ProviderMark.tsx
│   ├── failures/         ← features/chat/transcript/failure-kind.ts
│   └── artifacts/  permissions/  projects/  attachments/
├── platform/             THE ONLY Tauri seam
│   ├── tauri/            window  nativeMenus
│   ├── store.ts          ← wraps plugin-store (appearance + drafts)
│   └── harness/
│       ├── contracts/    ⟨connection chunks snapshot model turn approval failure⟩
│       ├── client/       ⟨connections models defaults approvals conversations catalog⟩
│       ├── conversation/ ⟨client decode liveness⟩
│       ├── lifecycle.ts  ← LIFECYCLE_EVENTS + defaultListen
│       ├── contact.ts    ← defaultContactFor
│       └── transport.ts  connection.ts
├── stores/               imports platform, never features
│   ├── navigation/  rail/
│   └── workspace/        ⟨state mutations harness-sync catalog⟩  handoff  title-refresh
│                         (demo-turns, useDemoTurn → features/chat/gallery)
├── shell/
│   ├── AppShell  DetachedShell  SplashScreen
│   ├── chrome/           TopStrip  IdentityLine  TrafficLights  ←ContextMeter
│   ├── menus/            ← ActionItems  ActionsMenu  SelectionMenu
│   └── sidebar/Sidebar/  ⟨BrandBand SidebarMenu ConversationList SidebarFooter⟩
└── features/
    ├── chat/
    │   ├── ChatPage.tsx
    │   ├── connection/   ← useConversation(Transcript)  first-turn  first-attach  fork
    │   ├── transcript/
    │   │   ├── projection/ ⟨shapes segments settlement seed apply⟩
    │   │   └── live/  paging/  scroll/   (Transcript/UserMessage/AssistantMessage → deleted, D1)
    │   ├── composer/     ⟨+ useComposerSend  useComposerImages  WorkingRing⟩
    │   ├── markdown/  streaming/  permissions/
    │   └── gallery/      ← scene  marks  demo   (from domain/session + stores/workspace)
    ├── models/
    │   ├── library/
    │   └── picker/       ← ModelPanel  ReasoningPanel  (the picking half of shell/chrome/TurnMenu)
    ├── settings/providers/AddConnectionDialog/  ⟨PickMode LibraryForm CustomForm ProbeOutcome⟩
    ├── voice/
    │   ├── io/           speak  transcribe  useMicInput  waveform
    │   └── ui/           VoiceMode/  DictationBar  ReadAloud
    └── artifacts/  rail/  home/  projects/  palette/
```

**Net moves:** 7 fixture files leave `domain/`+`stores/` → `features/chat/gallery/`; 4 Tauri leaks → `platform/`; 1 inverted `stores→features` dep fixed by relocating `defaultListen`; 1 `components→domain` leak (`ProviderMark`); ~10 monoliths gain concern sub-folders; the `features/chat` root (5 loose files) and `shell` root (3 menu files) gain sub-folders. Roadmap: folded into **R10** (WorkspaceProvider split), **R18** (contracts split) — plus new items **R11 (close the Tauri seam + inverted deps, P2)**, **R12 (break up the monoliths, P2)**, **R13 (sub-categorise flat folders + evict fixtures, P3)**.

---

## 19. Design-System Inconsistencies (specific examples)

1. **`text-destructive` (no token) vs `text-danger` (token).** ~5 files use the former, ~8 the latter, for the same "this is an error" meaning. `text-destructive` resolves to no utility in Tailwind v4.
2. **`Icons.expand` (static down chevron) vs `Icons.disclosure` (animated right→down chevron)** for "there is more here." Used on menu triggers vs tree rows respectively — the distinction is defensible but invisible to a reader.
3. **Modal enter animation:** `Dialog` uses `SPRING_SURFACE` + `scale 0.97→1`; `CommandPalette` uses `SPRING_SURFACE` + `scale 0.97→1` + `y: -6→0`; `MediaLightbox` uses `SPRING_SURFACE` + `scale 0.97→1`. Nearly the same, hand-copied, one adds a `y`.
4. **Skeleton bone width:** four hand-written percentage arrays with no shared source.
5. **`WorkingDots` timing:** `0.36` (artifacts) vs `0.18` (voice) delay between dots.
6. **Ambient loop durations:** `0.7 / 1.1 / 1.2 / 1.4 / 1.6 / 1.8` — no token.
7. **`ToolGroups.tsx:92`** `text-[11px] leading-relaxed` — the last raw size+leading pair.
8. **`Sections.tsx:210`** `text-[color:var(--code-string)]` borrows a syntax-highlight token for a `+N` diff-additions stat (the deletions `−N` beside it correctly uses `text-danger`).
9. **Row `<button>` shape** retyped 15+ times (D7).
10. **`h-8` vs `h-[var(--control-md)]`** — `SettingsTree` rows use `h-8` (literal 32), `PermissionControl` was explicitly changed *from* `h-8` *to* `h-[var(--control-md)]` (28) because it sits in the composer row. `GeneralPane`'s mode trigger uses `h-7`. Control heights beside each other don't all derive from `--control-*`.
11. **Menu trigger buttons** are each hand-built (`GeneralPane`, `AddConnectionDialog` protocol, `DefaultsSection`, `TurnMenu`, `PermissionControl`, `IdentityLine`, `ConversationRow`, `ProjectSection`, `Sidebar`) — there's no `<MenuButton>` trigger primitive, so `aria-haspopup="menu" aria-expanded` + the chevron + the hover classes are repeated.

---

## 20. Recommended Canonical System

What *is already* canonical and should stay the reference:

| Concern | Canonical | Keep |
|---|---|---|
| Colour / radius / elevation / duration | `index.css` `@theme` + `design/tokens/*` | ✅ — do not add a fourth source |
| Type | 5 roles (`micro`/`caption`/`ui`/`body`/`title`) + `display`/`heading`; code as an offset | ✅ |
| Icons | `Icons.<concept>` registry + `assertUnique` | ✅ |
| Labelled button | `Button` (4 variants × 3 sizes) | ✅ |
| Icon button | `IconButton` (4 sizes × 2 tones, always circular) | ✅ |
| Text field | `TextField` / `TextArea` (+ `ComposerField` for the one special case) | ✅ |
| Menu | `Popover` + `MenuItem`/`MenuLabel`/`MenuSeparator` | ✅ |
| Modal | `Dialog` | ✅ — and `MediaLightbox`/`CommandPalette` should be *rebased on it* (or a shared `<Overlay>`) |
| Toggle | `Segmented` (with `layoutId`) | ✅ |
| Dial | `StepSlider` | ✅ |
| Failure sentence | `StateNote` | ✅ |
| Skeleton | `Placeholder` family | ✅ |
| Page handover | `surfaceVariants()` + `custom` | ✅ |

**New primitives to add** (each replaces a duplication above):

| New primitive | Replaces | Effort |
|---|---|---|
| `<CopyButton text label size>` | D4 (3 sites) | S |
| `<WorkingDots>` (promote + parametrise) | D2 (3 defs) | S |
| `<HarnessUnavailable phase onRetry>` | D3 (4 sites) | S |
| `<Overlay onClose anchor>` (wraps scrim + enter) | D5 (`Dialog`, `MediaLightbox`, `CommandPalette`) | M |
| `<FloatingMenu at onDismiss>` | D6 (`ActionsMenu`, `SelectionMenu`) | M |
| `<NavRow icon label hint selected onClick>` | D7 (15+ sites) | M |
| `<SelectionChip layoutId active>` | D8 (3 sites) | S |
| `<InlineRename value onCommit onCancel>` | D9 (2 sites) | S |
| `<MenuButton open label>` (haspopup trigger) | inconsistency #11 | S |
| `LOOP` motion token | inconsistency #6 | S |
| `lib/text.ts` (`capital`), `lib/guards.ts` (`isRecord`) | D10 | S |

---

## 21. Replacement / Consolidation Map

```
TRANSCRIPT (P1)
  Transcript.tsx  ───┐
  UserMessage.tsx ───┼──►  LiveTranscript + LiveUserMessage + AssistantTurn
  AssistantMessage ──┘      (feed scene.ts through a TranscriptItem[] adapter)
  Affected: ChatPage (1 branch), stores/workspace/demo-turns.ts + useDemoTurn.ts
            (deletable), Composer demo-transport branch (deletable),
            domain/session/demo.ts (deletable)

WORKING INDICATORS (P2)
  ArtifactMotion.WorkingDots ─┐
  DictationBar.WorkingDots  ──┼──►  <WorkingDots delay? size?>
  ReadAloud.WorkingDots     ──┘
  Affected: 3 files

  Button.Spinner ───┐  (KEEP SEPARATE — documented specialisation, but
  Composer.WorkingRing ─┘   both are "rotating arc"; note the overlap)

HARNESS-DOWN STATE (P2)
  SidebarUnavailable ──────┐
  CatalogFailure ──────────┼──►  <HarnessUnavailable phase onRetry
  ArchivePane inline ──────┤          label={"Start the harness"|"Try again"}>
  ProjectPage inline ──────┘
  Affected: 4 files

COPY BUTTON (P2)
  CodeBlock copy ───┐
  TextBlock copy ───┼──►  <CopyButton text label size>
  MessageActions ───┘
  Affected: 3 files

MODAL SHELL (P2)
  Dialog scrim ─────────┐
  MediaLightbox scrim ──┼──►  <Overlay onClose anchor="center"|"top">
  CommandPalette scrim ─┘        (Dialog wraps it; the other two use it directly)
  Affected: 3 files

FLOATING MENU (P2)
  ActionsMenu placement+dismiss ──┐
  SelectionMenu placement+dismiss ┴──►  <FloatingMenu at={{x,y}} origin onDismiss>
  (both already share ActionItems for contents)
  Affected: 2 files, ~150 LOC removed

QUIET NAV ROW (P2)
  Sidebar.Action, IdentityLine project btn, TurnMenu back ×2, ModelDetail back,
  Sidebar account btn, FamilyCard, ModelRow, IndexRow, ProjectPage rows,
  palette rows, PlaceholderPane list items …  (15+)
        ↓
  <NavRow icon label hint selected onClick />
  Affected: ~10 files

SELECTION CHIP (P3)
  ConversationRow ("sidebar-selection") ─┐
  SettingsTree ("settings-tree-selection")┼──►  <SelectionChip layoutId active/>
  LibraryIndex ("library-index") ────────┘
  Affected: 3 files

INLINE RENAME (P3)
  IdentityLine ──┐
  ConversationRow┴──►  <InlineRename value onCommit onCancel/>

TINY HELPERS (P3)
  capital() ×2 → lib/text.ts
  isRecord() ×3 → lib/guards.ts
```

**Estimated blast radius if all done:** ~30 files touched, ~600–800 LOC net removed, one whole rendering stack deleted, one settings-scaffolding decision (AR-4) surfaced for a product call.

---

## 22. Prioritized Remediation Roadmap

### P0 — Fundamental

*(none)*

### P1 — High

| ID | Type | Item | Files |
|---|---|---|---|
| R1 | ARCHITECTURE / DUPLICATION | **Collapse the demo transcript stack onto the live projection** (D1 / AR-1). Adapt `scene.ts` → `TranscriptItem[]`; delete `Transcript`, `UserMessage`, `AssistantMessage`, `demo-turns.ts`, `useDemoTurn.ts`, the `Composer` demo branch. | ~8 |

### P2 — Medium

| ID | Type | Item |
|---|---|---|
| R2 | BUG / ACCESSIBILITY | Fix `text-destructive` → `text-danger` (or add `--color-destructive`) in `AssistantTurn.EndLine`, `SubmissionFailed`, `ConnectionNotice`, `ToolGroups`. Verify error text is actually red at runtime. (A1 / AR-6) |
| R3 | UX / TECH DEBT | Wire, disable, or mark "soon" the stub menu items: `AddMenu` (Files/Folder/Goal/Plan/Extensions), `ProjectSection` "Copy working directory", branch "New worktree". (AR-7) |
| R4 | DUPLICATION | `<CopyButton>` (D4), `<WorkingDots>` promote (D2), `<HarnessUnavailable>` (D3). |
| R5 | DUPLICATION | `<Overlay>` (D5) + rebase `MediaLightbox` / `CommandPalette` on it. |
| R6 | DUPLICATION | `<FloatingMenu>` (D6) — unify `ActionsMenu` / `SelectionMenu` placement. |
| R7 | DESIGN SYSTEM | `<NavRow>` primitive (D7) + `<MenuButton>` trigger (inconsistency #11). |
| R8 | PERFORMANCE | Narrow font imports to `/latin.css` (P-1). |
| R9 | ACCESSIBILITY | Add focus trapping to `Dialog` / modals (A7). Add `role="listbox"`/`option` + `aria-activedescendant` to `CommandPalette` (A4). |
| R10 | ARCHITECTURE | Split harness client wiring + lifecycle subscription out of `WorkspaceProvider` (AR-2) to reduce the ~28ms render-churn surface. |
| R11 | PRODUCT | Decide the fate of the 13 placeholder settings sections (AR-4) — ship, hide, or timeline. |

### P3 — Low

| ID | Type | Item |
|---|---|---|
| R12 | VISUAL POLISH | `ToolGroups.tsx:92` → `text-caption` (inconsistency #7). |
| R13 | DESIGN SYSTEM | `<SelectionChip>` (D8), `<InlineRename>` (D9), `capital`/`isRecord` to `lib/` (D10), skeleton-width helper (D11). |
| R14 | DESIGN SYSTEM | `LOOP` motion token for ambient animations (inconsistency #6). |
| R15 | DESIGN SYSTEM | Reconcile `Icons.expand` vs `Icons.disclosure` usage (inconsistency #2 / §8.3). |
| R16 | TECH DEBT | Add a lint/test that fails if `AppShell.Surface` becomes `<Surface/>` (P-6). |
| R17 | PERFORMANCE | Lazy-load KaTeX CSS/JS (P-2), `media-chrome` (P-4), model-library/voice/providers chunks (P-10). |
| R18 | TECH DEBT | Split `platform/harness/contracts.ts` (1,342 LOC) into per-concern modules (AR-8). |
| R19 | CLEANUP | Trim `elements.d.ts` to the elements `VideoPlayer` actually renders. |
| R20 | DESIGN SYSTEM | Move `oklch` inline shadow in `VoiceModeOverlay.tsx:390` to a token. |

---

## 23. Audit Coverage Manifest

| Area | Dirs | Files (non-test) | Read | Method |
|---|---:|---:|---|---|
| root (`index.html`, `main.tsx`, `App.tsx`, `index.css`, `vite.config.ts`, `package.json`) | 1 | 6 | full | Read tool |
| `design/` | 5 | 8 | full | full text |
| `components/` | 9 | 22 | full | full text (2,958-line dump) |
| `shell/` | 5 | 21 | full | full text (dump) |
| `stores/` | 4 | 11 | ~partial (`WorkspaceProvider` first ~40 lines + API surface via consumers) | dump + grep |
| `platform/` | 3 | 13 | headers + key files (`contracts.ts` structure, `useConversation` full) | dump + Read |
| `lib/` | 1 | 4 | full | dump |
| `domain/` | 8 | 24 | docblocks + key files (`modes.ts`, `sections.ts`, `slots.ts`, `format`, `families`, `parse`, `types` full; `gallery/scene.ts` skimmed) | Bash + Read |
| `features/artifacts/` | 4 | 16 | full | full text (dump) |
| `features/chat/` | ~8 | ~40 | full — composer, markdown, blocks, streaming, permissions, transcript (+live, paging, scroll), fork, first-turn, useConversation(Transcript), ChatPage | full text (2 dumps) |
| `features/models/` | 2 | 15 | full | full text (dump) |
| `features/settings/` | 4 | ~22 | full | full text (dump) |
| `features/voice/` | 1 | 10 | DictationBar/ReadAloud full; VoiceModeOverlay/Provider, hooks, transcribe/speak/waveform via docblocks + grep | dump + Bash |
| `features/rail/` `home/` `projects/` `palette/` | 4 | ~8 | full | full text (dump) |
| **Totals** | **63** | **215** | **≈195 read in full, ≈20 via docblock+grep+consumers** | — |
| tests | — | 48 | consulted for coverage counts + behaviour signals | grep |
| excluded | — | `node_modules`, `dist`, `src-tauri` | intentional (see §2) | — |

**Evidence anchors** (verifiable): `src/index.css` (1,308 lines), `src/design/tokens/{typography,geometry,motion}.ts`, `src/design/RULES.md`, `src/components/icons/registry.tsx` (60 concepts + `assertUnique`), `src/components/primitives/*` (9 primitives), `src/stores/navigation/NavigationProvider.tsx` (4-kind `Route`), `src/features/settings/sections.ts` (17 sections), `src/features/settings/panes/registry.tsx` (4 real), `src/features/settings/panes/placeholders.ts` (10 placeholders), `src/features/chat/transcript/live/LiveTranscript.tsx` vs `src/features/chat/transcript/Transcript.tsx` (the two stacks), `grep -c` results quoted in §2.

---

## 24. Interactive HTML Artifact

A standalone, filterable HTML explorer of this audit is published as an Artifact (link provided in the chat response). It contains:

- **Overview** — counts (files, LOC, routes, surfaces, icons, tokens, motion primitives).
- **Surface explorer** — every route / pane / modal / panel as a card with file, trigger, composer/turn-settings flags, and known issues.
- **Item explorer** — buttons, inputs, menus, toggles, panels, loading/empty/error, working indicators, iconography — each with a visual reconstruction (rendered with the discovered token values), implementation name, call-site count, states, and "replace with" scope.
- **Design-system explorer** — the monochrome palette (light + dark swatches), the type scale, radius scale, elevation scale, `--control-*` scale, the motion vocabulary, the two hue exceptions.
- **Duplication explorer** — D1–D11 with locations, similarity, and the consolidation target.
- **Dead / legacy explorer** — the near-dead demo stack, the 13 placeholder settings sections, the stub menu items.
- **Consolidation map** — the D→primitive graph from §21, with affected-file counts.
- **Roadmap** — P1–P3 filterable by type (bug / a11y / perf / duplication / design-system / architecture / tech-debt).

The artifact is a reference tool for a developer; this markdown file is the machine-readable model for an LLM. They cover the same findings.
