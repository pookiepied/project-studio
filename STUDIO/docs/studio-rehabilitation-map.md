# Studio Rehabilitation Map

This document is the working map for making Studio easier to understand,
maintain, and safely refactor. It is intentionally conservative: first map the
system, then remove proven dead code, then split monoliths, then rename or move
files once ownership is clear.

Last evidence pass: 2026-07-18.
Baseline checkpoint: `d44311e chore: checkpoint studio worktree`.
Current observed checkpoint: `3719af8 Checkpoint Studio UI and coding workflow`.

Current checkout note:

- The worktree currently contains broad uncommitted work across Backend, Studio
  harness, package manifests, Studio shell/chat/workspace files, and new
  workspace-domain files. Treat this map update as an audit checkpoint, not as
  ownership of that active UI/backend work.
- Do not begin broad shell/CSS restructuring, page moves, or visual redesign
  until the architecture audit tracks below are mapped against the live
  worktree.
- `src/features/chat/components/ChatFloatingDock.tsx` is absent in the current
  worktree. Older entries that describe that file are historical extraction
  notes; the live dock ownership appears to have moved toward the global shell
  dock path and must be re-audited before any further dock work.

## Goals

- Make the project human-readable for contributors.
- Remove unused, stale, duplicate, and misleading code only after evidence.
- Split monolithic files by responsibility, not by arbitrary line count alone.
- Keep changes scoped and checkpointed so each phase can be reviewed.
- Avoid batch rename or move scripts for structural changes.
- Fix bugs and optimize after the structure is clear enough to reason about.

## Current Shape

Studio is a React, Vite, TypeScript, and Tauri application with supporting
runtime code.

Top-level areas:

| Area | Current role | Treatment |
| --- | --- | --- |
| `src/` | Frontend application source | Primary rehabilitation target |
| `src-tauri/` | Tauri shell, Rust commands, desktop bridge | Audit as platform layer |
| `daemon/` | Local backend service for model/provider behavior | Audit after frontend map |
| `library/` | MCP servers and skills bundled with Studio | Treat as bundled capability library |
| `vendor/` | Bundled third-party/runtime binaries and trees | Do not mix into app cleanup queue |
| `scripts/` | Build, release, vendor, and installer utilities | Audit separately |
| `public/` | Static assets | Asset inventory pass |
| `web/` | Web entry/build variant | Keep separate from desktop app shell |
| `gate/` | Quality gate data | Preserve unless replacing gate process |
| `dist/` | Build output | Ignore for architecture work |

Current file counts after the first dead-code proof pass:

- `src`: 490 files
- `library`: 192 files
- `src-tauri`: 85 files
- `daemon`: 16 files
- `scripts`: 6 files
- `web`: 4 files
- `gate`: 2 files
- `vendor`: 4919 files

`vendor/` is large by design and should be classified as bundled runtime
material, not ordinary source debt.

## Existing Architecture Signal

The strongest existing architecture rule is in `eslint.config.js`:

```text
features -> runtime/ui -> core/lib -> types
```

Meaning:

- `app/` composes the application shell, routes, providers, and global UI.
- `features/` owns product features and may depend on lower layers.
- `runtime/` owns local runtime integration, transport, tool execution, and
  runtime-facing UI.
- `ui/` owns generic presentation and primitives.
- `core/` and `lib/` own shared infrastructure and utilities.
- `types/` owns shared type surfaces.

The rule is useful, but the names `core`, `lib`, and `runtime` are still
conceptual. They should not be renamed until their contents are classified more
precisely.

## `src/` Inventory

Current `src/` top-level areas:

| Area | Files | Notes |
| --- | ---: | --- |
| `features/` | 274 | Dominant app code; already feature-oriented |
| `core/` | 71 | Shared infrastructure, but broad naming |
| `app/` | 45 | App composition, routes, shell, globals |
| `ui/` | 28 | Brand, feedback, icons, primitives |
| `runtime/` | 27 | Runtime transport/execution/server integration |
| `lib/` | 24 | Mixed utilities and hooks |
| `design/` | 7 | Tokens, CSS systems, motion/font constants |
| `types/` | 6 | Shared types, some overlap with feature types |
| `cliBridges/` | 5 | Claude CLI bridge |
| root files | 3 | `main.tsx`, `index.css`, `vite-env.d.ts` |

Largest feature clusters:

| Feature | Files | Lines |
| --- | ---: | ---: |
| `chat` | 94 | 13811 |
| `manage` | 14 | 13253 |
| `workspace` | 23 | 5078 |
| `models` | 24 | 3242 |
| `voice` | 16 | 2931 |
| `settings` | 15 | 2089 |
| `extensions` | 16 | 1785 |
| `markdown` | 14 | 1752 |

Largest `core` clusters:

| Subsystem | Files | Lines |
| --- | ---: | ---: |
| `storage` | 10 | 1803 |
| `errors` | 5 | 1435 |
| `permissions` | 9 | 1203 |
| `platform` | 11 | 1155 |
| `network` | 5 | 906 |

Largest `runtime` clusters:

| Subsystem | Files | Lines |
| --- | ---: | ---: |
| `ui` | 6 | 763 |
| `execution` | 7 | 664 |
| `transport` | 3 | 555 |
| `servers` | 5 | 545 |

## Monolith Candidates

Line count is only a signal. Each file still needs a responsibility review
before splitting.

| File | Lines | Initial read |
| --- | ---: | --- |
| `src/features/manage/modelRegistry/curatedRegistrySnapshot.ts` | 11519 | Generated or snapshot-like data; classify before editing |
| `src/features/chat/context/ChatProvider.tsx` | 573 | Provider still owns turn orchestration and wiring; model/context helpers, access prompts, streaming lifecycle, conversation display pagination, conversation bootstrap, tool permission evaluation, background service effects, project context state, engine/session state, and title generation were extracted |
| `src/features/workspace/pages/WorkspacePage.tsx` | 1045 | Live dirty work has grown the page again; now mixes workspace-domain data, page state, shell/surface composition, and new workspace styling hooks. Audit before splitting because several related files are uncommitted. |
| `src/features/chat/pages/ChatPage.tsx` | 675 | Page composition remains heavy; composer panels, top chrome, overlays, composer dock measurement, composer input wiring, environment controls, project registry wiring, turn-status policy, and conversation composer dock were extracted, but current shell/dock changes need re-audit. |
| `src/core/errors/comprehensiveDiagnostics.ts` | 558 | Diagnostic collectors may be separable; shared report types and text formatter were extracted |
| `src/features/voice/hooks/useAudioRecorder.ts` | 468 | Hook still mixes recording state and chunk transcription; browser setup, cleanup, and finalization/rephrase helpers were extracted |
| `src/features/chat/context/useStreamHandlers.ts` | 458 | Streaming protocol/event logic candidate; DSML continuation was extracted |
| `src/features/activity/pages/ActivityPage.tsx` | 451 | Page now focuses on display state and rendering; data fetching, loading state, refresh, and log polling were extracted |
| `src/features/chat/components/ChatFloatingDockRows.tsx` | 381 | Remaining row/action UI from the former chat dock path. Recheck live consumers before extracting or removing because the parent dock file is absent in the dirty worktree. |
| `src/features/workspace/rightWorkspace/RightWorkspacePanel.tsx` | 330 | Right workspace surface now composes new conversation workspace panels and geometry behavior; audit surface ownership before additional panel splits. |
| `src/features/workspace/rightWorkspace/ConversationWorkspacePanel.tsx` | 327 | New untracked conversation workspace surface. Classify with workspace lifecycle and shell/page ownership before treating as stable structure. |

## Dead-Code Signals

`npx knip --reporter compact` currently reports:

- 0 unused files after the first proof pass
- 0 unused exports
- 0 unused exported types
- 0 duplicate exports after the duplicate-export proof pass

Unused files removed in the first proof pass:

- `src/features/chat/components/ProjectContextPicker.tsx`
- `src/features/workspace/rightWorkspace/WorkspaceHomePanel.tsx`
- `src/features/workspace/rightWorkspace/WorkspacePlaceholderPanel.tsx`
- `src/lib/hooks/useFetchState.ts`

Removal evidence:

1. `knip` reported each file as unused.
2. Name and path searches found no live imports, route references, or public
   barrel exports.
3. Remaining references were stale prompts, lint baseline entries, this map, or
   comments.
4. TypeScript verification passed after removal.

Duplicate exports removed in the duplicate-export proof pass:

- `src/core/config/tauriConfig.ts`: removed unused default export; kept
  canonical named `TAURI_CONFIG`.
- `src/design/fonts.ts`: removed unused `*_STACK` aliases; kept canonical
  `FONT_SANS` and `FONT_MONO`.

## Dependency Cycle Signal

`npx madge --circular --extensions ts,tsx src` reports no circular
dependencies after the browser cycle removal pass.

## Naming Concerns

Names to review after classification:

- `core`: broad infrastructure bucket; subfolders are clearer than the parent.
- `lib`: mixed utilities; decide whether each item is shared utility, feature
  logic, runtime support, or design support.
- `runtime`: overlaps mentally with Tauri, daemon, MCP servers, and local
  execution. It may need a clearer name or stronger internal README.
- `library`: exists both at Studio root and conceptually inside source
  discussions. Root `library/` currently means bundled MCP servers and skills.
- `manage` vs `models`: both touch model/provider concepts and need boundary
  clarification.
- `workspace`, `rightWorkspace`, and `workspace/browser`: clarify whether these
  are product feature surfaces, layout regions, or tool integrations.

Rename only after imports and ownership are understood. Prefer small manual
renames with one commit per coherent concept.

## Target Organization Rules

Use these rules before moving files:

1. Feature-specific UI, hooks, services, context, and types live under
   `src/features/<feature>/`.
2. Shared visual components with no product logic live under `src/ui/`.
3. Design tokens, typography, motion, and CSS systems live under `src/design/`.
4. Runtime transport, tool execution, local server manifests, and runtime
   permission UI live under `src/runtime/` until a clearer name is chosen.
5. Cross-cutting infrastructure lives under `src/core/`, but each subfolder
   should have a domain-specific name.
6. Small generic helpers live under `src/lib/`; anything with product behavior
   should move toward a feature or core subsystem.
7. Shared type barrels should not duplicate feature-local types. Prefer
   feature-local `types.ts` unless multiple layers need the type.
8. Generated or snapshot data should be marked clearly and excluded from
   monolith cleanup unless the generation process is changing.
9. Root `library/`, `daemon/`, and `src-tauri/` are adjacent systems. Do not
   fold them into `src/`.
10. Avoid new cross-feature deep imports. Use feature public surfaces when they
    exist, and create them deliberately when they do not.

## Phase Plan

### Phase 0: Baseline and map

Status: complete for the current `knip` dead-code proof pass.

Completed:

- Created checkpoint commit `d44311e`.
- Confirmed clean worktree after checkpoint.
- Confirmed `npm run typecheck` passes.
- Confirmed `npm run ratchet:lint` passes.
- Confirmed `npm run ratchet:cycles` passes against the current baseline.
- Captured initial file counts, large files, dead-code signals, and cycle signal.

Next:

- Keep this document updated as the map becomes more exact.

### Phase 1: Dead-code proof pass

Status: in progress.

Completed:

- Removed the 4 unused files reported by `knip`.
- Removed the 4 duplicate export pairs reported by `knip`.
- Removed `FONT_DISPLAY` after the duplicate-export cleanup revealed it had no
  live consumers.
- Removed 8 unused animation exports from `src/design/motion.ts`; kept the
  live shared `chevronRotateTransition`.
- Removed or privatized unused exports from small `src/lib` helpers while
  preserving their live public functions.
- Removed or privatized unused app-level convenience exports while preserving
  the live app shell and settings surfaces.
- Removed or privatized unused CLI bridge exports while preserving the live
  Claude bridge surface.
- Removed or privatized unused core config/project helper exports while
  preserving the live model-tier and project-registry surfaces.
- Removed or privatized unused core logging/error-reporting exports while
  preserving the live logger and stored-error surfaces.
- Removed or privatized unused core network, platform, and storage convenience
  exports while preserving live diagnostics, overlay, shortcut, and settings
  surfaces.
- Removed unused permission grant and barrel exports while preserving the live
  permission engine, runtime scoping, and Settings permissions surface.
- Removed unused notification barrel exports while preserving the live
  notification store, service, and agent-result adapter.
- Removed unused local MCP registry wrapper exports while preserving and
  reformatting the live startup registry sync path.
- Privatized the activity health-card status indicator while preserving the
  live `HealthCard` component surface.
- Removed the unused artifact example markdown export while preserving the live
  artifact example data used by the artifact lab.
- Removed or privatized unused chat attachment helper exports while preserving
  live validation, document indexing, uploads, and cache restoration.
- Removed the unused high-level image vision service and trimmed the image
  attachment barrel to the live compression/base64 utility surface.
- Removed unused chat composer style constants while preserving the shared
  composer controls still used across chat, voice, and model selection.
- Trimmed the chat context barrel to the live `ChatProvider` and `useChat`
  surface, and removed stale chat-local tool classification constants now owned
  by the runtime UI classifier.
- Privatized chat conversation helpers that were only used inside their owning
  files: Claude tool-name mapping, Claude native ID prefixing, and conversation
  owner resolution.
- Removed unused legacy chat history helpers for raw conversation
  import/export and last-response regeneration; the live regenerate flow is
  handled by conversation actions and the send pipeline.
- Trimmed unused extensions component exports and removed stale decorative
  separator comments from the extension icon helpers while preserving the live
  Extensions page surface.
- Trimmed unused Manage component barrel exports and privatized the model
  registry currency helper that is only used by its formatter module.
- Removed the unused markdown video processing placeholder while preserving the
  live video player used by markdown code blocks.
- Trimmed unused model-context barrel exports and removed or privatized
  model-helper surfaces that are only used inside their owning modules.
- Removed the unused Settings permissions management view and the permission
  grant inspection helpers that only supported that dead surface.
- Trimmed unused Edge TTS local exports while preserving the live voice list,
  install/config detection, synthesis, model-id helpers, and chunking surface.
- Privatized or removed unused voice overlay, workspace app-detection,
  agent-workflow, and rephrase-prompt helper exports while preserving their
  live public APIs.
- Removed an unused runtime v2 local relay and privatized runtime constants,
  manifest sync helpers, and back-compat re-exports that had no live callers.
- Trimmed unused UI icon and primitive barrel exports, removed three unused
  primitive shell/modal components, and converted the icon barrel comments to
  plain ASCII.
- Privatized UI-only helper types for primitive component sizes/options and
  removed unused icon type re-exports.
- Privatized app/model-local helper types and removed stale model filter preset
  type exports while cleaning touched comment artifacts.
- Privatized feature-local activity/chat attachment helper types, removed stale
  chat type re-exports, and cleaned touched chat type comments.
- Trimmed unused workspace barrel type exports and privatized workspace/runtime
  helper types.
- Privatized the remaining core/service helper types, trimmed stale project,
  storage, Parakeet, and tool type surfaces, and removed the last deprecated
  unused type alias.
- Removed separator-art and unnecessary Unicode punctuation from the platform
  overlay and global-shortcut services as the first comment-artifact cleanup
  pass.
- Updated stale live comments that referenced deleted code.
- Updated `gate/lint-baseline.json` with the project ratchet command after the
  deleted files made old baseline entries stale.
- Verified no unused files, unused exports, unused exported types, or duplicate
  exports remain in the `knip` report.
- Verified `npm run typecheck`.

Remaining scope:

- Move to the cycle-removal phase.
- Continue broader stale-comment and naming cleanup as separate scoped passes.

Rules:

- Do not delete from `vendor/`, generated snapshots, or package lock files.
- Do not delete exported APIs that are intended for external/plugin use without
  checking their boundary.
- Verify with `npm run typecheck` after each deletion group.

### Phase 2: Cycle removal

Status: complete.

Completed:

- Broke the `BrowserPanel.tsx` and `NativeBrowserHost.tsx` cycle by moving the
  shared `BrowserTab` contract into `src/features/workspace/browser/types.ts`.
- Updated browser consumers to import the shared type from that leaf module.
- Updated `gate/cycles-baseline.json` to lock the circular-import baseline at
  zero.
- Verified with `npx madge --circular --extensions ts,tsx src` and
  `npm run ratchet:cycles`.

### Phase 3: Feature boundary map

Status: in progress.

Current boundary map:

| Feature | Owns | Current consumers | Boundary notes |
| --- | --- | --- | --- |
| `chat` | Conversation UX, composer/message surfaces, chat provider state, send/stream pipeline, conversation storage, attachments, Claude bridge integration, chat-local project context, conversation search/statuses | `app`, `workspace`, `voice`, `transcription`, `extensions`, `permissions`, `models`, `types` | This is currently both a product feature and a shared AI/conversation service surface. Future splits should separate UI composition, provider state, attachment processing, conversation persistence, and AI transport more clearly before renaming. |
| `workspace` | Workspace page, right workspace tabs, browser/terminal/files/review side panels, project launcher/app detection, agent workflow service | `app`, `chat`, `artifacts`, workspace internals | The top-level feature is mostly a side-surface/tooling area. `rightWorkspace/` is a layout region and may deserve a clearer name after monolith splits. Browser types now live in `browser/types.ts` to keep host/panel dependencies acyclic. |
| `manage` | Management page, model registry administration views, whitelist/AI model management views, registry snapshot/service/formatting | `app`, `models` | `manage` should remain an admin/configuration surface. It may consume model/provider primitives from `models`, but model discovery, filtering, provider icons, and model picker behavior should not move into `manage`. `curatedRegistrySnapshot.ts` is snapshot-like data and should be treated as generated or data-owned before editing. |
| `models` | Shared model/provider catalog access, model filtering, model picker/library components, provider icons, local provider status/hooks, Ollama/LM Studio status, model context provider | `app`, `chat`, `manage`, `settings`, `activity`, `core diagnostics` | This is the shared model capability layer. It may expose stable UI primitives and service functions to other features, but it should not own chat conversation behavior or manage/admin workflows. |

Import direction guidance:

1. `manage` may import from `models`; `models` should not import from `manage`.
2. `chat` may import model selection/context APIs from `models`; `models`
   should not import chat UI. Existing `models -> chat` imports are limited to
   shared composer styles and local usage name extraction and should be retired
   during later boundary cleanup.
3. `workspace` may embed chat side-panel UX through the public chat context and
   components, but workspace-specific state should stay in `workspace`.
4. Shared cross-layer DTOs belong in neutral leaf modules such as `src/types/`
   or feature-local `types.ts` only when the type is not needed across layers.
5. Snapshot/generated registry data should be marked as data, not treated as a
   monolith to split by hand.

Next:

- Add short feature-local README files or expand this map after the first
  monolith split confirms the practical ownership boundaries.
- Retire the remaining awkward cross-feature imports in small, verified slices
  after the large files are easier to reason about.

### Architecture audit tracks

Map these contracts before any further shell/CSS restructuring, page moves, or
renames. The current dirty UI work is an investigation/input track, not a
competing implementation owner.

| Track | Current signal | Next evidence to collect |
| --- | --- | --- |
| Startup lifecycle and readiness phases | The real app shell can mount behind the splash. Splash uses `z-modal` while traffic lights and chat chrome use `z-toast`. The `app_ready` signal has been observed before router/session restoration and splash completion. | Define explicit readiness phases for process boot, router restoration, session restoration, shell mount, and splash dismissal. Fix with a lifecycle mechanism, not a one-off z-index patch. |
| Window and surface variants | Main window shell, chat page, right workspace, global floating dock, traffic lights, splash, taskbar/session controls, artifact panels, and workspace panels overlap in responsibility. | Inventory every window/surface entry point and classify which shell owns visibility, geometry, focus, and persistence. |
| Page and shell ownership | `HomePage.tsx`, `FloatingPanel.tsx`, `ChatTopChrome.tsx`, `ChatPage.tsx`, `WorkspacePage.tsx`, and right-workspace panels all participate in top chrome or surface composition. | Decide which layer owns global dock state, page title swapping, taskbar/session controls, and chat/workspace-specific chrome. |
| Layer and portal registry | Live classes include `z-modal`, `z-toast`, `z-context`, fixed top chrome, fixed global panel frames, and absolute menu layers. | Create a registry of layer tokens, portal roots, and allowed owners before changing z-index values or moving overlay markup. |
| Layout, clipping, and scroll ownership | Chat message padding, composer dock height, push-layout sidebar, right workspace resizing, and workspace page CSS all affect available space. | Identify the single owner for root scroll, page scroll, overlay exclusion zones, resize handles, and clipping boundaries. |
| State ownership and persistence scopes | Chat provider, router state, session restoration, workspace lifecycle files, project registry, and local/cloud workspace sources all persist overlapping state. | Separate process/session/page/conversation/project/workspace persistence scopes and document restore order. |
| Theme and CSS authority | `index.css`, design tokens, Tailwind utility classes, `FloatingPanel` classes, and new `workspacePage.css` all affect app-level chrome. | Decide which files own global tokens, shell geometry variables, feature CSS, and local component styling before renaming or consolidating styles. |

Current files to reconcile first:

- `src/app/routes/HomePage.tsx`
- `src/app/shell/FloatingPanel.tsx`
- `src/app/shell/MainLayout.tsx`
- `src/app/shell/WorkspaceShellChrome.tsx`
- `src/app/shell/shellConfig.ts`
- `src/app/shell/workspaceLayoutStore.ts`
- `src/features/chat/pages/ChatTopChrome.tsx`
- `src/features/chat/pages/ChatPage.tsx`
- `src/features/chat/components/ChatFloatingDockRows.tsx`
- `src/features/workspace/pages/WorkspacePage.tsx`
- `src/features/workspace/pages/workspacePage.css`
- `src/features/workspace/life/`
- `src/features/workspace/rightWorkspace/RightWorkspacePanel.tsx`
- `src/features/workspace/rightWorkspace/ConversationWorkspacePanel.tsx`
- `src/features/workspace/rightWorkspace/workspacePanelGeometry.ts`

First-pass ownership findings from the live checkout:

| Area | Observed owner today | Rehabilitation risk |
| --- | --- | --- |
| App initialization | `src/app/App.tsx` owns frontend initialization steps and calls Tauri `app_ready` after `isInitialized`; splash removal separately waits for router readiness and minimum splash duration. | Rust may show/focus the real window before the router/session and splash lifecycle finish. Readiness needs named phases instead of a single frontend-ready event. |
| Native window visibility | `src-tauri/src/lib.rs` owns `app_ready`, startup show/focus, minimize-to-tray close behavior, and platform window rounding. | UI shell readiness and native visibility are coupled only by a broad `app_ready` command, so z-index symptoms can mask lifecycle timing bugs. |
| Shell mode selection | `src/main.tsx` pre-applies theme/shell classes before React; `src/app/shell/MainLayout.tsx` reapplies workspace shell classes and chooses workspace shell vs standard titlebar shell. | Two places mutate `html` shell classes and geometry vars. Keep them aligned or move toward a single shell lifecycle authority. |
| Provider and page routing | `src/app/routes/HomePage.tsx` owns current view state, the major providers below app providers, global shortcut/context listeners, permission host, and page transitions. | HomePage is both route switch and cross-feature provider host. Future page moves should not hide provider lifetime decisions inside feature folders. |
| Global dock frame/nav | `src/app/shell/FloatingPanel.tsx` owns the top-center global navigation frame and currently toggles `chatDockVisible` based on whether the active view is chat. | The state name is chat-specific while the dock is now global shell chrome; rename only after the dock/page ownership contract is settled. |
| Chat top chrome | `src/features/chat/pages/ChatTopChrome.tsx` owns chat title/project/context badges and the fixed top-right right-workspace controls. | Chat still owns shell-positioned controls via `z-toast`; this should be audited before moving chat files or changing layer tokens. |
| Workspace shell chrome | `src/app/shell/WorkspaceShellChrome.tsx` composes hover chrome, traffic lights, and the global floating panel. | This is the clearest candidate for the workspace-shell chrome boundary, but it does not yet own all fixed top chrome. |
| Cross-cutting layout widths | `src/app/shell/workspaceLayoutStore.ts` exposes module-level left/right width signals consumed outside normal props flow. | This is a small layout bus. Document allowed publishers/subscribers before expanding it or replacing it with context. |
| Right workspace surface | `src/features/workspace/rightWorkspace/RightWorkspacePanel.tsx` owns right-panel width, resize behavior, active-tab rendering, and the switch between conversation workspace and classic workspace. | It mixes layout geometry, tab rendering, and mode switching. Split only after deciding whether conversation workspace is a mode, tab, or separate surface. |
| Splash and layer tokens | `src/ui/feedback/SplashScreen.tsx` uses `z-modal`; global dock, traffic lights, and chat top chrome use `z-toast`; token values live in `src/design/tokens.css`. | Layer ordering is currently distributed. Build a layer/portal registry before changing token values. |
| Encoded/comment cleanup | `HomePage.tsx`, `App.tsx`, `main.tsx`, and `shellConfig.ts` still contain stale decorative separators or mojibake in comments. | ASCII/comment cleanup is valid rehabilitation work, but it should be a narrow cleanup slice after the architecture map is updated. |

Layer/CSS authority findings:

| Area | Intended authority | Live drift to resolve |
| --- | --- | --- |
| Z-index tokens | `src/design/tokens.css` defines `--z-overlay`, `--z-modal`, `--z-popover`, `--z-toast`, and `--z-context`; `tailwind.config.js` bridges them as `z-overlay`, `z-modal`, `z-popover`, `z-toast`, and `z-context`. | Some overlays still bypass the scale with inline `zIndex: 9998/9999` in chat dock rows and CLI tab previews, and local `z-10`/`z-[1]` values appear inside components. |
| Portal roots | Most app/feature overlays portal directly to `document.body` through `createPortal`; Radix select uses `RadixSelect.Portal`. | There is no app-level portal registry or named overlay host, so stacking, focus, and dismissal ownership are implicit at each call site. |
| Modal/backdrop surfaces | Modal-like overlays mostly use `z-modal` plus `bg-scrim` from design tokens. | A few surfaces use hardcoded backdrops such as `bg-black/40` or `bg-black/80`; classify whether these are deliberate media/lightbox exceptions or design-token drift. |
| Global base CSS | `src/index.css` owns reset, body/html backgrounds, transparent window variants, focus defaults, reduced motion, scrollbar treatment, drag helpers, and chat scroll anchors. | It also owns feature-adjacent helpers like chat scroll classes; decide whether those remain global utilities or move under feature CSS after shell contracts stabilize. |
| Workspace shell CSS | `src/app/shell/workspaceShell.css` owns `--studio-topbar-height`, `--studio-topbar-control`, hover chrome, and zen-window chat-header alignment. | The file applies `html, html body { background: transparent !important; }` globally despite being described as workspace-shell scoped, so standard/surface variants need an authority review before CSS restructuring. |
| Pre-React shell styling | `src/main.tsx` imports design CSS and pre-applies theme/shell/window-surface classes before React mounts. | `MainLayout.tsx` repeats workspace-shell class and geometry variable mutations after React mounts. Treat this as a lifecycle contract, not just CSS duplication. |
| Feature CSS additions | New dirty workspace work includes `src/features/workspace/pages/workspacePage.css`. | Decide whether feature CSS may own page-local layout only, or whether shell geometry variables and scroll/clipping rules must stay in app shell CSS. |

Layout, clipping, and scroll ownership findings:

| Area | Observed owner today | Rehabilitation risk |
| --- | --- | --- |
| Root app clipping | `src/app/shell/MainLayout.tsx` wraps the shell in `relative h-full w-full flex flex-col overflow-hidden` and gives page content `flex-1 overflow-hidden`. | Root scroll is intentionally disabled; every page/surface must own its own scroll container. Make this contract explicit before moving page wrappers. |
| Chat row layout | `src/features/chat/pages/ChatPage.tsx` owns the main chat flex row, left sidebar, chat column, and right workspace panel composition. | Chat currently coordinates both app-like shell surfaces and feature state. Splits should preserve the push-layout contract before extracting page sections. |
| Left workspace sidebar width | `src/features/chat/components/LeftWorkspaceSidebar.tsx` owns its local width state, resize interaction, `document.body` cursor/user-select mutation, and publishes width through `setLeftPanelWidth`. | Left sidebar width is feature-owned but consumed as shell geometry. Decide whether this remains a chat feature surface or becomes a shell surface. |
| Right workspace panel width | `src/features/workspace/rightWorkspace/RightWorkspacePanel.tsx` owns local width state, resize interaction, body cursor/user-select mutation, and publishes width through `setRightPanelWidth`. | Right-panel geometry is duplicated with left sidebar behavior. A future extraction should create a shared resize/geometry contract only after ownership is clear. |
| Width bus | `src/app/shell/workspaceLayoutStore.ts` carries left/right panel widths through a module-level observable. | Useful bridge for fixed chrome and push layouts, but it bypasses normal props/context ownership. Document publishers/subscribers before extending it. |
| Width constraints | `src/features/workspace/rightWorkspace/workspacePanelGeometry.ts` defines default/min/max width and the minimum remaining chat width. | Both left and right side panels reuse right-workspace geometry names. Rename only after deciding whether this is generic shell panel geometry. |
| Chat message scroll | `src/features/chat/hooks/useChatScroll.ts` owns auto-follow, stream-follow, prepend anchoring, infinite-scroll top sentinel, and forwarding wheel deltas from non-descendant overlays. | The scroll behavior is deliberate and should be treated as a subsystem before moving message-list or composer overlay code. |
| Chat message container | `src/features/chat/components/ChatMessageList.tsx` owns the actual `overflow-y-auto` message container, scrollbar class, top padding, and dynamic bottom padding. | The scroll container consumes composer measurements from the page; keep this explicit if splitting message layout further. |
| Composer overlay exclusion zone | `src/features/chat/pages/useComposerDockHeight.ts` measures the composer dock; `ChatConversationComposerDock.tsx` renders as an absolute bottom sibling and forwards wheel deltas into the message scroller. | The overlay is not a descendant of the scroller, so scroll and pointer behavior depends on cross-component coordination. Avoid moving it without a layout test. |
| Workspace page layout | `src/features/workspace/pages/workspacePage.css` owns a full-page `workspace-root` with `height: 100%`, `overflow: hidden`, staged flex/grid regions, nested scroll lists, and a local overlay. | This feature CSS now owns page-level clipping and hardcoded local surface variables. Decide whether it is a temporary experiment, a page-local skin, or a new design/CSS authority. |
| Conversation workspace panel | `src/features/workspace/rightWorkspace/ConversationWorkspacePanel.tsx` uses fixed grid row ratios inside the right panel and hidden overflow. | It behaves like a compact dashboard surface, not a normal tab panel. Classify it before merging it with classic workspace tabs. |

State ownership and persistence findings:

| Area | Observed owner today | Rehabilitation risk |
| --- | --- | --- |
| Startup readiness state | `src/app/App.tsx` owns initialization step, initialization error, router-ready flag, and splash visibility. `src/app/AppRouter.tsx` separately owns auth/API/runtime readiness and calls `onReady`. | Startup readiness is split across app initialization, router/auth checks, and splash timing. Treat this as a lifecycle contract before changing `app_ready` or splash behavior. |
| Provider lifetimes | `AppProviders.tsx` owns settings/models/auth/offline/TTS providers. `HomePage.tsx` owns navigation, recording, chat, and live-session providers below the router. | Provider placement encodes persistence lifetime. Moving pages or providers can reset chat, voice, permissions, or navigation state unexpectedly. |
| Settings persistence | `SettingsProvider` seeds sync defaults plus `studio-theme` from `localStorage`, then loads/saves through `configService` and unified storage. `MainLayout` also writes `studio-theme`. | Theme and settings persistence intentionally bridge pre-React and React phases; consolidate only after the shell lifecycle is explicit. |
| Unified storage | `core/storage/unifiedStorageService.ts` chooses Tauri FS or web storage, can enable a cloud backend for `chats/*`, and emits `studio:storage-ready` after cloud chat storage is enabled. | Only chat paths are cloud-routed here; other persisted data remains local. Do not assume “cloud enabled” means all Studio state is cloud-backed. |
| Auth/cloud switch | `AuthProvider` enables cloud chat storage after valid auth/login and disables it on logout. Logout also clears all `localStorage` keys. | Clearing all `localStorage` crosses many ownership scopes: shell mode, theme, workspace local state, chat drafts/preferences, permissions, model caches, and OAuth scratch state. Audit before changing logout or storage namespaces. |
| Conversation storage | `chatHistoryService.ts` routes cloud conversations through unified storage, local Studio conversations through `localConversationStore`, and Claude-owned conversations through the Claude adapter. | Conversation identity, owner, provider, and storage scope are intertwined. Rename/move work must preserve metadata semantics before touching storage paths. |
| Local conversation files | `localConversationStore.ts` writes snapshot JSON, messages JSONL, transcript Markdown, and a local index through Tauri file commands. | Local conversations are not just another `localStorage` cache; they are user-facing filesystem artifacts and need migration discipline. |
| Chat provider state | `ChatProvider.tsx` remains the coordinator for active conversation, pending messages, turn refs, streaming state, tool calls, session tasks, displayed-message pagination, engine/scope state, Claude metadata, project context, and memory flags. | It is still a state monolith even after extraction. Further splits should separate persisted conversation metadata from transient turn state and UI-only state. |
| Chat bootstrap | `useConversationBootstrap.ts` loads the most recent conversation on mount and again after `studio:storage-ready`; it also catches up pending completions. | Router-ready and chat-ready are different. App readiness should not imply the active conversation has been restored. |
| Chat engine preferences | `chatEnginePreference.ts` stores local chat-engine preferences in `localStorage` under `studio:chat-engine-preferences:v1`, including an empty-local default key. | This is independent of conversation files and can be wiped by broad localStorage clearing. Keep it scoped if logout/cache cleanup changes. |
| Project context persistence | `projectContextStorage.ts` stores per-conversation project context in a `localStorage` map named `studio_project_contexts`, while new local conversations also persist project metadata. | There are two project-context persistence paths. Reconcile before moving project/chat boundary code. |
| Workspace source state | `WorkspacePage.tsx` owns UI selection state, save/dirty state, force-local preference, capture draft, note revision view, and context preview. `workspaceService.ts` owns cloud calls and the local adapter under `studio.workspace.local.v1`. | Workspace is currently page-state-heavy and service-backed. Split UI sections only after extracting or documenting the workspace state controller. |
| Voice session state | `LiveSessionProvider` is mounted under `HomePage` but above pages, so voice state survives view changes and syncs to the Pulse overlay. | Voice session lifetime depends on provider placement, not route identity. Page reorganization must preserve this. |

Window and surface variant findings:

| Surface | Observed owner today | Rehabilitation risk |
| --- | --- | --- |
| Main desktop window | `src-tauri/tauri.conf.json` defines the primary Tauri window as frameless, transparent, hidden at launch, unfocused, and shown later through `app_ready`. | Native window behavior, splash timing, and React shell readiness are coupled across Rust config, Rust commands, and React startup. |
| Main React app | `src/app/App.tsx` renders `MainApp` unless query params request overlay or splash preview. `MainApp` owns initialization and wraps `AppProviders`. | Query-param routing happens before the normal provider tree. New window variants should be explicit so they do not accidentally run full app initialization. |
| Overlay window | `overlayService.ts` creates a persistent Tauri `WebviewWindow` labeled `overlay` at `/?w=overlay`; `OverlayPage.tsx` skips the app provider chain and communicates through Tauri events. | Overlay is a separate native window with separate theme, size, and positioning lifecycle. Do not treat it as an app overlay/portal. |
| Splash preview | `App.tsx` routes `?splashPreview=1` to `SplashPreviewPage`, which renders only splash preview controls and writes `studio-theme`. | Preview is a utility route that mutates theme state. Keep it classified separately from startup splash behavior. |
| Auth callback | `AppRouter.tsx` detects `/oauth/callback` and renders `AuthCallback` inside the normal provider stack after app initialization. | Callback is a route variant, not a separate window. It still depends on AuthProvider and can affect session/localStorage state. |
| Login/welcome surface | `ShaderWelcomePage.tsx` is selected by `AppRouter` when unauthenticated and owns its own context menu, theme toggle, and Tauri window controls. | It behaves like a shell-adjacent surface even though it is a route page. Shell/window-control ownership should be reconciled before moving auth pages. |
| Conversation windows | `conversationWindowService.ts` creates a new Tauri `WebviewWindow` per conversation with `/?view=chat&conversationId=...`; web fallback uses `window.open`. | The query params do not currently map to a dedicated route in `App.tsx`/`AppRouter`. Audit whether conversation windows restore the intended conversation or just boot the normal app. |
| Right workspace tabs | `RightWorkspacePanel.tsx` owns in-page tab surfaces: browser, terminal, files, review, side-chat, artifacts, and conversation workspace. | These are panels inside the main React tree, not windows. Their lifecycle is tied to chat/right-workspace state. |
| Side chat | `SideChatPanel.tsx` is a right-workspace tab with its own conversation state, opened from chat or workspace controls. | Side chat is a nested conversation surface and should not be confused with separate conversation windows. |
| Native browser child webviews | `src-tauri/src/native_browser.rs` creates child webviews inside the main window; `nativeBrowserService.ts` maps browser tab ids to labels such as `studio-browser-<tab>`. | Browser content is neither a React iframe alone nor a separate Tauri window. Geometry, visibility, and cleanup live across React panel state and Rust child-webview commands. |
| Web/html browser fallback | `BrowserPanel.tsx` also supports HTML/iframe-style rendering when native browser support is unavailable. | Browser panels have two rendering backends. Keep this backend split visible before reorganizing workspace browser files. |

Implementation gates before code changes:

Before any structural implementation in shell, chat, workspace, startup, or CSS,
the slice must name which contracts it touches and prove that the target files
are not owned by another active dirty-worktree task.

| Gate | Required decision/evidence | Blocks until satisfied |
| --- | --- | --- |
| Dirty worktree ownership | Inspect `git status --short` and identify whether each target path is already dirty from another task. If so, either wait for that work to be committed, receive an explicit handoff, or stay map-only. | Edits to active UI, backend, harness, package, or generated files that are not part of the current slice. |
| Startup lifecycle | Define readiness phases for native process boot, pre-React shell setup, provider mount, auth/API checks, router/session restoration, active conversation restoration, shell mount, splash dismissal, and native show/focus. | `app_ready`, splash, startup z-index, native window visibility, and first-paint fixes. |
| Surface taxonomy | Classify the target as a native window, route variant, app shell chrome, page-owned surface, in-page panel, portal overlay, or child webview. | Moves or renames of shell/page/window files and any attempt to merge conversation windows, side chat, overlay windows, or right-workspace panels. |
| Shell/page ownership | Decide the owner for global dock state, page title swapping, top-right controls, taskbar/session controls, navigation/current view, and provider lifetime. | `HomePage.tsx`, `MainLayout.tsx`, `FloatingPanel.tsx`, `ChatTopChrome.tsx`, `ChatPage.tsx`, and workspace shell moves. |
| Layer/portal registry | Inventory current token use, direct `document.body` portals, Radix portals, inline z-index values, scrims, and fixed-position chrome. | z-index changes, overlay relocation, modal/backdrop consolidation, and portal-root refactors. |
| Layout/scroll ownership | Identify root scroll owner, page scroll owner, panel width publishers/subscribers, composer overlay exclusion zones, resize-handle behavior, and clipping boundaries. | Chat scroll, composer dock, left/right panel resizing, workspace page CSS, and root overflow refactors. |
| State/persistence scopes | Identify process, session, auth, page, conversation, project, workspace, and local filesystem state scopes plus restore order and migration behavior. | Logout/localStorage cleanup, conversation storage moves, project context moves, workspace service splits, and provider relocation. |
| Theme/CSS authority | Decide which files own global tokens, shell geometry variables, pre-React classes, feature CSS, component classes, and local visual experiments. | `index.css`, `workspaceShell.css`, `workspacePage.css`, `tokens.css`, Tailwind layer changes, and shell class consolidation. |

Next safe implementation candidates after the dirty tree is clean or handed over:

1. Do a no-behavior ASCII/mojibake/comment cleanup slice in a very small file
   set such as `App.tsx`, `HomePage.tsx`, `main.tsx`, `shellConfig.ts`, and
   `tokens.css`.
2. Add a startup lifecycle contract document or a small named readiness helper
   before changing `app_ready`, splash timing, or z-index values.
3. Create a layer/portal registry inventory before replacing inline z-index
   values or moving overlays.
4. Reconcile global dock naming such as `chatDockVisible` only after the
   shell/page ownership gate decides whether the dock is global shell chrome,
   chat chrome, or a mixed bridge.
5. Resume `WorkspacePage.tsx` and right-workspace extraction only after the
   current workspace dirty work is committed or explicitly handed over.

Stop conditions for implementation slices:

- If a target file is dirty from another owner, stop at map updates or request
  an explicit handoff for that path.
- If a slice cannot name its startup, surface, layer, layout, state, and CSS
  contracts, do the audit first.
- If verification is unreliable because package files or harness/runtime files
  are dirty from another task, report the limited verification scope instead of
  claiming behavior is proven.

### Phase 4: Monolith splits

Start with files that are large and actively edited, not generated data.

Completed:

- Extracted Workspace context document/memory list rendering into
  `src/features/workspace/pages/WorkspaceContextLists.tsx`.
- Extracted Workspace formatting/category helpers into
  `src/features/workspace/pages/workspaceFormat.ts`.
- Extracted Workspace automation routine form and run-history row rendering into
  `src/features/workspace/pages/WorkspaceAutomation.tsx`.
- Reduced `WorkspacePage.tsx` from the original 951-line baseline to 578 lines
  while keeping data loading, mutations, and section state in the page for now.
- Extracted right workspace tab chrome and empty launcher rendering into
  `src/features/workspace/rightWorkspace/RightWorkspaceChrome.tsx`.
- Reduced `RightWorkspacePanel.tsx` from the measured 606-line baseline to 284
  lines while keeping width, resize, and active-panel rendering in the panel.
- Extracted chat composer approval/question panels and Claude transcript notice
  into `src/features/chat/pages/ChatComposerPanels.tsx`.
- Reduced `ChatPage.tsx` from the measured 912-line baseline to 842 lines while
  keeping chat state, hooks, and page composition in place for now.
- Extracted ChatPage floating dock and top-right workspace controls into
  `src/features/chat/pages/ChatTopChrome.tsx`.
- Reduced `ChatPage.tsx` from 842 to 800 lines while keeping dock callbacks and
  workspace state transitions owned by the page.
- Extracted ChatPage file input, document storage modal, model library modal,
  rename modal, and at-mention popup into
  `src/features/chat/pages/ChatPageOverlays.tsx`.
- Reduced `ChatPage.tsx` from 800 to 775 lines while keeping overlay state and
  callbacks owned by the page.
- Extracted ChatPage floating composer dock height measurement into
  `src/features/chat/pages/useComposerDockHeight.ts`.
- Reduced `ChatPage.tsx` from 775 to 755 lines while preserving the existing
  composer overlay layout and scroll padding behavior.
- Extracted ChatPage composer input refs, key handling, focus restoration, and
  external text injection into `src/features/chat/pages/useChatComposerInput.ts`.
- Reduced `ChatPage.tsx` from 755 to 732 lines while keeping send validation
  and attachment handling in the page.
- Extracted ChatPage environment controls for conversation scope, engine
  availability, and autopilot syncing/toggling into
  `src/features/chat/pages/useChatEnvironmentControls.ts`.
- Reduced `ChatPage.tsx` from 732 to 688 lines while keeping composer props and
  top chrome wiring in the page.
- Extracted ChatPage project registry listing, folder selection, and active
  project registration into `src/features/chat/pages/useChatProjectRegistry.ts`.
- Reduced `ChatPage.tsx` from the current measured 627 to 609 lines while keeping top chrome project
  props and project context ownership unchanged.
- Extracted ChatPage turn-status derivation for streaming/tool activity into
  `src/features/chat/pages/useChatTurnStatus.ts`.
- Reduced `ChatPage.tsx` from 609 to 602 lines while keeping the message list
  layout and composer overlay behavior in the page.
- Extracted ChatPage conversation composer overlay, Claude transcript notice,
  pending queue, connection status, and permission cards into
  `src/features/chat/pages/ChatConversationComposerDock.tsx`.
- Reduced `ChatPage.tsx` from 602 to 564 lines while keeping the split-view
  layout and message list wiring in the page.
- Extracted ChatFloatingDock browser conversation/project rows and conversation
  action menu into `src/features/chat/components/ChatFloatingDockRows.tsx`.
- Reduced `ChatFloatingDock.tsx` from the measured 937-line baseline to 627
  lines and normalized moved row text/separator comments to ASCII.
- Extracted ChatFloatingDock project/conversation search and tree grouping into
  `src/features/chat/components/useChatFloatingDockTree.ts`.
- Reduced `ChatFloatingDock.tsx` from 592 to 545 lines while keeping browser
  rendering, menu state, and dock shell behavior in place.
- Extracted ChatProvider model context-window and vision support calculations
  into `src/features/chat/context/ChatProviderModelHelpers.ts`.
- Reduced `ChatProvider.tsx` from the measured 987-line baseline to 957 lines
  while keeping provider state ownership unchanged.
- Extracted ChatProvider global machine-access and system-management prompt
  state into `src/features/chat/context/useAccessPrompts.ts`.
- Reduced `ChatProvider.tsx` from 957 to 921 lines while keeping permission
  evaluation and provider public API unchanged.
- Extracted ChatProvider streaming rAF buffer and end-of-turn teardown into
  `src/features/chat/context/useStreamingLifecycle.ts`.
- Reduced `ChatProvider.tsx` from 921 to 880 lines while keeping stream refs
  and callbacks wired through the existing stream/send hooks.
- Extracted ChatProvider displayed-message upsert and lazy pagination into
  `src/features/chat/context/useConversationDisplay.ts`.
- Reduced `ChatProvider.tsx` from 880 to 851 lines while preserving the
  existing stream and conversation-action hook contracts.
- Extracted ChatProvider initial conversation loading, storage-ready reload, and
  pending-completion catch-up into
  `src/features/chat/context/useConversationBootstrap.ts`.
- Reduced `ChatProvider.tsx` from 851 to 820 lines while keeping the existing
  startup behavior wired through the display helpers and compaction path.
- Extracted ChatProvider local-tool permission evaluation and frozen action-mode
  state into `src/features/chat/context/useToolPermissionEvaluator.ts`.
- Reduced `ChatProvider.tsx` from 820 to 771 lines while keeping the stream
  handler permission callback contract unchanged.
- Extracted ChatProvider memory initialization and notification tracker wiring
  into `src/features/chat/context/useChatBackgroundServices.ts`.
- Reduced `ChatProvider.tsx` from 771 to 752 lines while preserving the
  existing background service side effects.
- Extracted ChatProvider project context state, metadata persistence, and pending
  pre-conversation project selection into
  `src/features/chat/context/useProjectContextState.ts`.
- Reduced `ChatProvider.tsx` from 752 to 731 lines while keeping first-message
  project persistence and conversation-action hooks wired through the same refs.
- Extracted ChatProvider storage-scope, Studio/Claude engine, Claude session,
  Claude permission/effort, and engine metadata sync into
  `src/features/chat/context/useChatEngineState.ts`.
- Reduced `ChatProvider.tsx` from 731 to 628 lines while preserving the same
  public provider fields and action-hook setter contracts.
- Extracted ChatProvider background conversation title generation into
  `src/features/chat/context/conversationTitleGeneration.ts`.
- Reduced `ChatProvider.tsx` from 587 to 573 lines while keeping conversation
  creation, project metadata persistence, and provider state ownership in place.
- Extracted the Studio stream handler's inline DSML tool-call continuation path
  into `src/features/chat/context/handleDsmlContinuation.ts`.
- Reduced `useStreamHandlers.ts` from 588 to 498 lines while keeping the same
  `handleStreamDone` control flow and continuation contract.
- Extracted voice-recorder browser setup helpers into
  `src/features/voice/hooks/audioRecorderSetup.ts`.
- Reduced `useAudioRecorder.ts` from the current 751-line measurement to 698
  lines while keeping the recording state machine inside the hook.
- Extracted voice-recorder resource cleanup into
  `src/features/voice/hooks/audioRecorderCleanup.ts`.
- Reduced `useAudioRecorder.ts` from 698 to 639 lines while keeping start/stop
  state transitions inside the hook.
- Extracted voice-recorder final transcription merging, optional rephrase,
  clipboard copy, and finalization error handling into
  `src/features/voice/hooks/audioRecorderFinalization.ts`.
- Reduced `useAudioRecorder.ts` from 570 to 468 lines while keeping recording
  state, chunk capture, and per-chunk transcription inside the hook.
- Extracted diagnostic report types and text export formatting into
  `src/core/errors/diagnosticTypes.ts` and
  `src/core/errors/diagnosticReportFormatter.ts`.
- Reduced `comprehensiveDiagnostics.ts` from 616 to 558 lines while keeping the
  diagnostics runner and existing public exports in place.
- Extracted ActivityPage data fetching, loading state, refresh orchestration,
  and request-log polling into `src/features/activity/pages/useActivityData.ts`.
- Reduced `ActivityPage.tsx` from 574 to 451 lines while keeping chart controls,
  derived stats, and page rendering in place.

Recommended order:

1. Audit startup/shell/window contracts from the architecture tracks above.
2. Reconcile the live workspace growth around
   `src/features/workspace/pages/WorkspacePage.tsx`,
   `src/features/workspace/life/`, and right-workspace panels.
3. Re-audit `src/features/chat/pages/ChatPage.tsx` with the new global dock and
   `ChatTopChrome` ownership before further chat page extraction.
4. Continue `src/features/chat/context/ChatProvider.tsx` only after confirming
   the dirty shell/workspace changes do not alter provider responsibilities.
5. Continue `src/features/voice/hooks/useAudioRecorder.ts` when the shell
   architecture track is not active.

Do not continue the historical `ChatFloatingDock.tsx` split until the removed
file and replacement global dock path are reconciled against the committed
state.

Split rule:

- Extract named responsibilities into nearby folders first.
- Keep imports local and readable.
- Avoid moving across major layers during the first split.
- Typecheck after each split.

### Phase 5: Naming and folder moves

Only begin after phases 1-4 clarify ownership.

Candidate decisions:

- Whether `core` should remain as the infrastructure layer or be renamed.
- Whether `lib` should be reduced to pure utilities.
- Whether `runtime` needs a clearer name or an internal README.
- Whether `manage` and `models` should be more explicitly separated.

### Phase 6: Bug fixing and optimization

Begin after the code is easier to navigate.

Targets:

- Bugs found during mapping.
- Performance issues in chat/workspace/model registry paths.
- Build, startup, and runtime stability.

## Verification Commands

Use these as phase gates:

```powershell
npm run typecheck
npm run ratchet:lint
npm run ratchet:cycles
npm run deadcode
```

For structural changes, prefer:

1. Make a small manual change.
2. Run the narrowest relevant check.
3. Run `typecheck`.
4. Commit the checkpoint if the change is coherent.

## Open Questions

- Is `curatedRegistrySnapshot.ts` generated? If yes, where is the generator or
  source of truth?
- Should `daemon/` eventually be treated as part of Studio's runtime layer, or
  as an independent local service?
- Is root `library/` purely bundled MCP/skills content, or will it also contain
  user-installable marketplace assets?
- Should `web/` remain a separate entry variant, or is it a distribution target
  for the same app shell?
