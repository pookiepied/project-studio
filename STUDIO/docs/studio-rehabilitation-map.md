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

Observed source-like folder snapshot on 2026-07-18, excluding common install,
build, target, and vendor output during a dirty worktree:

| Area | Files | Current contract |
| --- | ---: | --- |
| `src/` | 550 | Primary React application source. Treat as the main feature/shell rehabilitation target. |
| `src-tauri/` | 85 | Desktop platform layer: Tauri config, Rust commands, native windows, tray, plugins, and platform bridges. Audit with startup/window contracts before moving app shell code. |
| `library/` | 160 | Bundled MCP servers and skills. This is capability-library source, not generic shared app code. It needs its own dead-code/build pass because the root Knip config ignores `library/mcp-servers/**` and `library/skills/**`. |
| `daemon/` | 16 | Small local provider bridge for Ollama and LM Studio with its own package, TypeScript build, and Node tests. Treat as a local service boundary rather than frontend code. |
| `scripts/` | 6 | Build/release/vendor/installer utilities referenced by package scripts. Audit by script entry point and package-script usage, not by app imports. |
| `web/` | 4 | Separate web entry/build variant using `vite.config.web.ts` and `web-main.tsx`. Keep distinct from the desktop app shell until surface variants are explicit. |
| `gate/` | 2 | Ratchet baselines for lint and cycles. Preserve as quality-gate state unless replacing the gate process. |
| `public/` | 7 | Static app/web assets. Audit through asset references and packaging behavior. |
| `docs/` | 2 | Local architecture/rehabilitation documentation for this effort. |

Root manifest signals:

- `package.json` defines the primary verification commands: `typecheck`,
  `deadcode`, `ratchet:lint`, `ratchet:cycles`, and `gate`.
- `package.json` also defines operational entry points for Tauri, vendor sync,
  web builds, preview, and installer asset generation.
- `knip.json` currently scans only `src/main.tsx`, `web/web-main.tsx`,
  `src/**/*.{ts,tsx}`, and `web/**/*.{ts,tsx}`. It ignores `src-tauri/**`,
  `daemon/**`, `library/mcp-servers/**`, `library/skills/**`, `scripts/**`,
  and `vendor/**`, so root `npm run deadcode` cannot prove those ignored
  areas are unused.
- `daemon/package.json` identifies `daemon/` as
  `studio-harness-provider-daemon`, a local provider bridge with `build`,
  `dev`, `start`, and `test` scripts.

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

Live monolith measurement snapshot on 2026-07-18:

These measurements include the current dirty worktree. They are triage evidence,
not ownership of the active UI, backend, or harness work.

Largest app/source files now observed:

| File | Lines | Triage |
| --- | ---: | --- |
| `src/features/manage/modelRegistry/curatedRegistrySnapshot.ts` | 11519 | Data/snapshot candidate. Do not split by hand until generated/source-of-truth status is known. |
| `src/features/artifacts/components/ArtifactLabPanel.tsx` | 1870 | New largest hand-authored app surface and currently dirty. Audit artifact lab responsibilities before any extraction. |
| `src/features/workspace/pages/WorkspacePage.tsx` | 1045 | Dirty and actively growing around workspace-domain work. Needs a workspace state/controller map before the next split. |
| `src/features/chat/pages/ChatPage.tsx` | 675 | Still large but blocked behind shell/global dock ownership re-audit. |
| `src/features/chat/context/ChatProvider.tsx` | 573 | Still a state coordinator. Continue only after shell/workspace dirty work stops changing provider responsibilities. |
| `src/core/errors/comprehensiveDiagnostics.ts` | 558 | Candidate for diagnostic collector extraction after app-shell tracks are quiet. |
| `src/features/chat/components/LeftWorkspaceSidebar.tsx` | 511 | Dirty and geometry-related. Do not split before layout/panel ownership is settled. |
| `src/features/chat/context/useSendPipeline.ts` | 509 | Send pipeline subsystem candidate; likely safer after provider state boundaries are stable. |
| `src/features/voice/hooks/useLiveSession.ts` | 501 | Voice session lifecycle candidate; preserve `HomePage` provider lifetime contract. |
| `src/features/settings/components/SettingsDebugPanel.tsx` | 496 | Settings/debug UI candidate; likely lower collision risk than shell/workspace if file is clean. |
| `src/features/workspace/terminal/TerminalPanel.tsx` | 489 | Workspace tool-surface candidate; classify with right-workspace surface model. |
| `src/features/manage/components/ModelRegistryView.tsx` | 471 | Manage/model boundary candidate; keep manage as admin surface consuming model capability. |
| `src/features/workspace/rightWorkspace/ReviewPanel.tsx` | 469 | Workspace panel candidate; classify with right-workspace tab ownership. |
| `src/features/voice/hooks/useAudioRecorder.ts` | 468 | Already partially extracted; reasonable future slice when shell work is inactive. |
| `src/lib/tokenManager.ts` | 461 | Large for `lib/`; classify whether this is generic utility, auth/core infrastructure, or feature state before moving. |
| `src/runtime/transport/wsPool.ts` | 459 | Runtime transport candidate; should remain under runtime until transport contract is documented. |
| `src/features/chat/context/useStreamHandlers.ts` | 458 | Streaming protocol/event candidate; DSML continuation already extracted. |

Largest adjacent-system files now observed:

| File | Lines | Triage |
| --- | ---: | --- |
| `library/mcp-servers/harness/studio-harness/src/tools/git/git.ts` | 853 | Harness file is dirty; do not clean or split until harness work is committed or handed over. |
| `src-tauri/src/commands.rs` | 846 | Native command surface is dirty; audit command groups before Rust extraction. |
| `library/mcp-servers/harness/studio-harness/src/tools/lsp/ide.ts` | 537 | Harness LSP subsystem candidate, currently in dirty harness area. |
| `src-tauri/src/mcp.rs` | 508 | Native MCP integration candidate; classify with bundled MCP/library and runtime contracts. |
| `library/mcp-servers/harness/studio-harness/src/tools/lsp/manager.ts` | 502 | Harness LSP lifecycle candidate, currently dirty. |
| `library/mcp-servers/harness/studio-harness/src/tools/git/definitions.ts` | 481 | Harness schema/definition surface; may be generated or deliberately verbose. |
| `src-tauri/src/lib.rs` | 460 | Startup/window lifecycle owner. Do not split before readiness contract is designed. |
| `daemon/src/routes/chat.ts` | 257 | Daemon route candidate; smaller than app monoliths but owns streaming/local-provider behavior. |

Current extraction priority once dirty ownership is resolved:

1. Do not touch harness files until the active harness deletion/rebuild work is
   committed or explicitly handed over.
2. For app code, decide whether `ArtifactLabPanel.tsx` is experimental,
   product-owned, or registry/demo-owned before extracting it; it is now the
   largest hand-authored app file.
3. Resume workspace extraction only after the workspace-domain dirty files are
   committed or handed over, starting with a state/controller map rather than UI
   chunks.
4. Resume chat page/provider extraction only after global dock and top-chrome
   ownership are reconciled.
5. Prefer clean, lower-collision files such as diagnostics, settings debug, or
   voice recorder/session hooks if implementation work must proceed while shell
   and workspace are active.

Artifact Lab responsibility triage:

`src/features/artifacts/components/ArtifactLabPanel.tsx` is currently dirty and
is the largest hand-authored app file. It is a lab/catalog surface, while the
production artifact rendering path lives mostly in
`src/features/markdown/renderers/ArtifactRenderer.tsx` and
`src/features/markdown/renderers/artifacts/`.

Observed responsibilities inside `ArtifactLabPanel.tsx`:

| Responsibility | Current evidence | Candidate extraction |
| --- | --- | --- |
| Catalog IDs and family grouping | `CatalogArtifactId`, `CatalogFamily`, `ARTIFACT_OPTIONS`, `FAMILY_OPTIONS`, `FAMILY_SELECT_OPTIONS`, and `artifactFamily`. | `artifactLabCatalog.ts` or `artifactLabOptions.ts`. |
| Tool activity demo fixtures | `ActivityStatus`, `ToolActivityCall`, `ToolActivityGroup`, and `ACTIVITY_GROUPS`. | `artifactLabActivityFixtures.ts`. |
| Web/source fixtures | `SOURCE_RESULTS` and `buildWebArtifact`. | `fixtures/webArtifacts.ts`. |
| Generated media fixtures | Inline generated SVG data URLs, `GENERATED_VIDEO_URL`, `buildImageArtifact`, and `buildVideoArtifact`. | `fixtures/generatedMediaArtifacts.ts`; keep literal SVG fixture data out of the page component. |
| Connector data fixtures | Gmail messages, calendar events, Drive files, GitHub items, Todoist tasks, and per-family builders. | One fixture module per connector family, or a `fixtures/connectors/` folder if the set keeps growing. |
| Artifact builder routing | `buildArtifact` dispatches by ID prefix to each family builder. | `artifactLabBuildArtifact.ts` after fixture modules exist. |
| Chat-copy/status-copy helpers | `statusCopy` and `promptCopy` map fixture IDs to preview copy/icons. | `artifactLabPreviewCopy.tsx` because it returns React icons. |
| Runtime activity preview UI | `activityTone`, `ActivityShimmer`, `ToolCallRow`, `ToolActivityCard`, and `ActivityPreviewPanel`. | `ArtifactActivityPreview.tsx`. |
| Page shell and controls | `ArtifactLabPanel` owns selected ID state, family/type selects, chat-like fixture layout, and `ArtifactRenderer` invocation. | Keep as the root component after fixture and preview extractions. |

Suggested first split after handoff:

1. Extract pure catalog/options and non-React artifact fixtures first. This
   should reduce file size without changing rendering behavior.
2. Extract generated media fixture data separately because the inline SVG data
   is large and visually noisy.
3. Extract `ArtifactActivityPreview.tsx` once fixtures are out, because that is
   actual UI rather than data.
4. Leave `ArtifactLabPanel.tsx` as the page-level composition owner with only
   selection state, preview copy wiring, and `ArtifactRenderer`.

Boundary notes:

- Do not move production renderers from
  `src/features/markdown/renderers/artifacts/` during the lab split; they are
  the live markdown artifact rendering path.
- Do not rename the artifacts feature until the relationship between artifact
  lab, runtime activity, connector outputs, and markdown rendering is clearer.
- Because `ArtifactLabPanel.tsx`, `registry.ts`, and several artifact renderers
  are dirty now, this is audit evidence only until those files are handed over.

Workspace page responsibility triage:

`src/features/workspace/pages/WorkspacePage.tsx` is dirty and currently mixes
workspace controller state, persistence calls, local UI state, markdown editing,
quick capture, and large page sections. The new `workspace/life/` folder gives
the workspace domain a clearer service/type boundary, but the page still acts as
the state controller.

Observed responsibilities inside `WorkspacePage.tsx`:

| Responsibility | Current evidence | Candidate extraction |
| --- | --- | --- |
| Page-local helpers | `cx`, `boolish`, `relative`, `formatDate`, `noteSignature`, `makeStarterMarkdown`, and `downloadMarkdown`. | `workspacePageUtils.ts`, with download kept browser-only. |
| Small controls | `IconButton`, `FormatButton`, and the commented-out `ProjectPicker`. | Keep live controls near page or move to `WorkspaceControls.tsx`; remove commented legacy picker in a later cleanup slice if confirmed unused. |
| Snapshot and source state | `snapshot`, `loading`, `saving`, `saveState`, `forceLocal`, `savedNoteSignatures`, `noteSaveTimer`, and `load`. | `useWorkspaceController.ts` or `useWorkspaceSnapshot.ts`, after dirty work is handed over. |
| Selection and derived lists | Project/note/task selection state plus `projectNotes`, `projectTasks`, `selectedNote`, `selectedTask`, filtered notes/tasks, open/completed tasks. | `useWorkspaceSelection.ts` if it stays page-local, or fold into the controller hook. |
| Capture drawer state | `captureText`, `organized`, `organizing`, `workspace-capture-text` listener, local capture draft persistence, `organizeCapture`, and `acceptOrganized`. | `useWorkspaceCapture.ts`; keep localStorage key ownership explicit. |
| Note autosave and revisions | Dirty detection via `noteSignature`, delayed autosave, `saveNote`, `updateNoteLocal`, `loadNoteRevisions`, and `restoreRevision`. | `useWorkspaceNoteEditing.ts`, with conflict/save-state behavior preserved. |
| Project/task mutations | `createProject`, `createNote`, `createTask`, `toggleTask`, `resetLocal`, and source-aware optimistic snapshot updates. | Controller hook action surface; avoid scattering snapshot mutation rules across UI components. |
| AI context preview | `contextPreview`, `contextLoading`, `previewContext`, details-panel copy behavior. | `useWorkspaceContextPreview.ts`, or part of controller if context is a core workspace action. |
| Markdown editor behavior | `editorMode`, `editorRef`, `applyMarkdown`, `handleEditorKeyDown`, and markdown preview rendering. | `WorkspaceNoteCanvas.tsx` plus `useMarkdownEditorCommands.ts`. |
| Page shell/navigation | Workspace topbar, project rail, library/search/surface switch, canvas shell, details panel, quick-add modal/drawer. | Separate section components only after controller hook exists, so props stay small. |
| CSS and visual skin | `workspacePage.css` owns full-page clipping, aurora/project shader classes, pane layout, command bar, and nested scroll. | Do not split CSS until theme/CSS authority and layout/scroll contracts are settled. |

`workspace/life/` boundary observed:

| File | Owns today | Notes |
| --- | --- | --- |
| `workspace/life/types.ts` | Domain DTOs: workspace, project, note, task, revision, context preview, snapshot, organized capture. | Good candidate to remain the workspace domain contract, but naming `life` should be revisited after the workspace domain stabilizes. |
| `workspace/life/workspaceService.ts` | Local seed/store, cloud requests, project/note/task CRUD, revisions, context preview, reset, and AI capture organization through chat service. | Service mixes cloud adapter, local adapter, domain mutations, and AI capture orchestration. Split only after page controller extraction makes call sites smaller. |

Suggested first workspace split after handoff:

1. Extract `useWorkspaceController.ts` with snapshot/source/load/save-state,
   selected IDs, derived selected entities, and mutation actions. Keep behavior
   identical and keep `WorkspacePage.tsx` as composition owner.
2. Extract `useWorkspaceCapture.ts` after the controller exists, because capture
   actions create notes/tasks and need a small controller action surface.
3. Extract `WorkspaceNoteCanvas.tsx` and markdown command helpers after autosave
   behavior is isolated.
4. Extract navigation/library/details/quick-add section components only after
   state props are small and stable.
5. Revisit the name `workspace/life/` only after the service has either stayed
   as the domain boundary or split into `workspace/domain`, `workspace/storage`,
   and `workspace/ai`.

Workspace stop conditions:

- Do not edit `WorkspacePage.tsx`, `workspacePage.css`,
  `workspace/life/workspaceService.ts`, right-workspace panels, or geometry
  files until the current workspace dirty work is committed or explicitly
  handed over.
- Do not move `workspacePage.css` rules while root scroll, page scroll, and
  shell clipping ownership are still under audit.
- Do not split `workspaceService.ts` before confirming cloud endpoint contracts
  and local-storage migration behavior.

Right-workspace surface triage:

The right-workspace area is dirty and currently represents multiple concepts at
once: a tab state hook, a resizable shell panel, a conversation dashboard/home
mode, and classic tool tabs for review, browser, terminal, files, side chat, and
artifacts.

Observed right-workspace responsibilities:

| Area | Owns today | Candidate boundary |
| --- | --- | --- |
| `useRightWorkspace.ts` | Visibility, tab list, active tab ID, tab creation/closing/updating, external open-state sync for terminal/browser/artifacts, side-chat de-dupe, browser-tab cleanup, and project-context reset. | Keep as the tab-state controller. It should not own panel width or visual rendering. |
| `RightWorkspacePanel.tsx` | Open animation, `workspaceWidth`, resize drag behavior, `setRightPanelWidth` shell layout publication, classic-vs-conversation mode, and tab render dispatch. | Split width/resize into a small hook only after layout ownership is settled; keep render dispatch close to the panel until tab contracts stabilize. |
| `workspacePanelGeometry.ts` | Default/min width, minimum remaining chat width, viewport-based max width, and width clamping. | Rename only after deciding whether this is generic shell side-panel geometry or right-workspace-specific geometry. |
| `ResizeHandle.tsx` | Visual separator and mouse-down entry point only. | Good small primitive, but behavior still lives in `RightWorkspacePanel`. |
| `types.ts` | Tab type/state contracts, project context shape, and external project app contracts. | Consider splitting tab-state types from external app launcher types if project launcher grows. |
| `ConversationWorkspacePanel.tsx` | Conversation activity chart, token/context summary, active agent rail, task chain, tool launcher nav, and close action. | Treat as a conversation dashboard/home surface, not a classic tab, until surface taxonomy says otherwise. |
| Classic tab renderers | `ReviewPanel`, `BrowserPanel`, `TerminalPanel`, `FilesPanel`, `SideChatPanel`, and `ArtifactPanel` are rendered by tab type. | Each renderer owns its tool-specific UI; the right-workspace shell should only pass state and lifecycle callbacks. |

Mode split observed:

- `RightWorkspacePanel` initially shows `ConversationWorkspacePanel` when
  `classicWorkspaceVisible` is false.
- Launching any workspace tool sets `classicWorkspaceVisible` true and creates a
  classic tab.
- Closing the classic header currently returns to the conversation dashboard
  instead of closing the whole right-workspace surface.
- The same panel width is shared by conversation dashboard, classic tabs,
  browser, terminal, and artifact panel width callbacks.

Suggested first right-workspace split after handoff:

1. Document whether the conversation dashboard is a home mode, tab type, or
   separate surface. Do this before adding persistence or route semantics.
2. Extract `useRightWorkspacePanelWidth.ts` only after confirming the
   `workspaceLayoutStore` publisher/subscriber contract and left-sidebar width
   interaction.
3. Extract `renderWorkspaceTab` or `WorkspaceTabContent.tsx` only after the
   tab-state types are stable and side effects such as browser-tab cleanup stay
   in the controller.
4. Split `ConversationWorkspacePanel.tsx` into activity chart, usage/agent rail,
   task chain, and launcher sections only after its status as home/tab/surface is
   decided.
5. Revisit `workspacePanelGeometry.ts` naming after deciding whether left and
   right side panels share a generic shell geometry contract.

Right-workspace stop conditions:

- Do not edit right-workspace files while they are dirty unless this thread
  receives an explicit handoff for those paths.
- Do not move width logic without checking `workspaceLayoutStore`, chat push
  layout, `LeftWorkspaceSidebar`, browser width callbacks, terminal width
  callbacks, and artifact width callbacks.
- Do not turn `ConversationWorkspacePanel` into a tab or separate route until
  the surface taxonomy and page/shell ownership gates are satisfied.

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

### Target Organization Model

This is the first human-readable target shape. It is a direction for future
manual refactors, not permission to move files before the gates above are
satisfied.

| Layer | Intended meaning | Contributor mental model | Move/rename posture |
| --- | --- | --- | --- |
| `src/app/` | App composition, provider placement, routes, shell chrome, startup lifecycle, and window/surface selection. | "How the Studio application boots, chooses a surface, and composes features." | Keep shell/page ownership decisions here until startup, surface, and provider contracts are explicit. |
| `src/features/<feature>/` | Product capabilities with user-facing workflows, feature state, feature services, feature UI, and feature-local types. | "What Studio lets the user do." | Prefer feature-local extractions before cross-layer moves. Create public feature surfaces before other features consume internals. |
| `src/runtime/` | Runtime-facing integration with tools, local execution, permissions, local servers, and transport surfaces used by features. | "How Studio talks to executable or tool-like local/runtime capabilities." | Keep for now, but add README/contract before renaming; do not confuse with Tauri, daemon, or bundled MCP server source. |
| `src/core/` | Cross-cutting infrastructure that is not product-specific: config, storage, network, platform, errors, diagnostics, project metadata, and service primitives. | "Shared machinery used by many layers." | Keep parent name until subfolders are classified; strengthen subfolder names before considering a parent rename. |
| `src/ui/` | Generic reusable visual components, primitives, icons, branding, and feedback surfaces with no product workflow ownership. | "Reusable presentation pieces." | Move product-aware UI back into features; keep primitive exports small and intentional. |
| `src/design/` | Tokens, typography, motion, Tailwind bridges, and CSS authority for the design system. | "The visual language and global design rules." | Treat CSS moves as architecture work; do not consolidate styles until shell/theme authority is mapped. |
| `src/lib/` | Small framework-agnostic helpers and hooks with no product, runtime, or storage ownership. | "Tiny utilities." | Shrink over time by moving behavior-rich code into features/core/runtime and leaving only generic helpers. |
| `src/types/` | Shared DTOs and contracts needed across multiple layers. | "Types that truly cross boundaries." | Avoid broad type barrels; keep feature-local types inside features unless at least two layers need them. |
| `src/cliBridges/` | Bridges to external CLI-backed providers, currently Claude-focused. | "Adapters for CLI tools Studio can drive." | Keep separate while its bridge identity is clearer than runtime/core ownership; reassess after runtime contract work. |
| `src/main.tsx`, `src/index.css`, `src/vite-env.d.ts` | Browser/React entry, global CSS entry, and Vite ambient types. | "The frontend entry points." | Keep minimal; push product and shell responsibilities down into named app/design modules. |

Preferred feature-internal shape once a feature is large enough:

```text
src/features/<feature>/
  components/      reusable feature UI pieces
  context/         feature provider and state orchestration
  hooks/           feature-specific hooks
  pages/           route/page-level composition
  services/        feature-owned side effects, persistence, or API adapters
  types.ts         feature-local contracts
  index.ts         small public surface, only when another layer needs it
```

Not every feature needs every folder. Small features should stay flat until a
second responsibility appears.

Public surface rules:

1. A feature public `index.ts` should export only stable surfaces used outside
   the feature.
2. Deep imports inside the same feature are acceptable; deep imports across
   features should be treated as debt unless the target is clearly a stable
   submodule.
3. Cross-feature imports should read like product composition, not shared state
   tunneling.
4. Shared services should move down to `core/` or `runtime/` only when they are
   genuinely product-neutral.
5. Snapshot/generated data should have a visible owner and generation story
   before anyone edits or splits it by hand.

Deferred naming decisions:

- Keep `core`, `runtime`, and `lib` names until their contents have local
  README/contract notes or equivalent map coverage.
- Do not rename `rightWorkspace` until the surface taxonomy decides whether it
  is a layout region, workspace feature mode, or app shell panel.
- Do not collapse root `library/` into `src/lib/`; root `library/` is bundled
  capability source, while `src/lib/` is app utility code.
- Do not merge `manage` and `models`; the current target is `models` as shared
  model/provider capability and `manage` as admin/configuration surface.

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

Scope clarification:

The completed `knip` pass proves the configured app/web scope only. It does not
prove that adjacent Studio systems are unused, because `knip.json` intentionally
ignores `src-tauri/**`, `daemon/**`, `library/mcp-servers/**`,
`library/skills/**`, `scripts/**`, and `vendor/**`.

Dead-code proof matrix:

| Area | Current automated coverage | Required proof before removal |
| --- | --- | --- |
| `src/` app source | Covered by root `npm run deadcode`, `typecheck`, `ratchet:lint`, and `ratchet:cycles`. | Knip signal plus import search, typecheck, ratchet gates, and a narrow behavior check when the file owns runtime behavior. |
| `web/` entry variant | Covered by root Knip through `web/web-main.tsx` and by `web:build`. | Knip signal plus `npm run web:build`; confirm the file is not part of desktop-only fallback behavior. |
| `src-tauri/` | Ignored by root Knip; compiled through Tauri/Rust toolchain, not TypeScript imports. | Rust/Tauri reference search, command/event invocation search from `src/`, Tauri build/check evidence, and startup/window contract review. |
| `daemon/` | Ignored by root Knip; has its own `daemon/package.json`. | Daemon package `build`/`test`, route/service reference search, and confirmation of how Studio starts or bundles the local provider bridge. |
| `library/mcp-servers/` | Ignored by root Knip; each MCP server has its own package entry and build script. | Per-server package build, registry/manifest reference search, bundled-library packaging check, and MCP tool surface review. |
| `library/skills/` | Ignored by root Knip; skill files are data/manifest-driven. | Skill manifest/catalog reference search and packaging/install-path evidence. Do not delete skill assets based on TypeScript import absence. |
| `scripts/` | Ignored by root Knip but referenced by root package scripts and release workflows. | Root package-script reference, CI/release/vendor workflow search, and manual review of external invocation names. |
| `public/` | Not meaningfully covered by TypeScript dead-code tools. | Static asset reference search across HTML/CSS/TS/Tauri/web manifests and packaged-app verification for icons or favicons. |
| `vendor/` | Ignored by root Knip and large by design. | Vendor manifest/sync-script evidence and bundle/runtime lookup proof. Treat as external runtime material, not normal source. |
| `gate/` | Used by ratchet scripts rather than app imports. | `scripts/ratchet.mjs` reference plus successful ratchet command. Preserve unless replacing the quality-gate process. |

Current dirty-tree constraint:

- The MCP harness under `library/mcp-servers/harness/studio-harness/` is
  currently dirty with many deleted and modified tool files. Do not make
  dead-code claims or cleanup commits in that area until the active harness work
  is committed or explicitly handed over.

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

Startup lifecycle contract triage:

The startup problem is a lifecycle problem, not a stacking-order problem. The
main Tauri window is configured hidden/unfocused, React renders the real app
tree behind a splash overlay, and `app_ready` currently asks Rust to show/focus
the native window before the app has proven that router/session restoration and
splash dismissal are complete.

Observed startup phases today:

| Phase | Current owner | Current signal | Risk |
| --- | --- | --- | --- |
| Native window creation | `src-tauri/tauri.conf.json` and `src-tauri/src/lib.rs` | Main window is frameless, transparent, `visible: false`, and `focus: false`. | Native window visibility is intentionally delayed, but the delay is coupled to one broad frontend signal. |
| Pre-React shell setup | `src/main.tsx` | Applies `data-window-surface`, early theme class, overlay class, and workspace-shell `zen-window` geometry before React mounts. | Duplicates shell/theme work later in `MainLayout`; must remain aligned until there is one shell lifecycle owner. |
| Surface routing | `src/app/App.tsx` module-scope query checks | `?w=overlay` skips full initialization, `?splashPreview=1` renders preview, otherwise `MainApp`. | Window/surface variants branch before providers. New variants need explicit classification. |
| Frontend initialization | `MainApp` in `src/app/App.tsx` | Initializes secure storage, global error handler, unified storage, theme/auth/offline placeholder steps, and bundled local skills, then sets `isInitialized`. | This phase is currently treated as enough to call native `app_ready`, but it is not enough to prove the app is interactive. |
| Native show/focus | `MainApp` calls `invoke("app_ready")`; Rust `app_ready` shows/focuses the main window. | Called in `requestAnimationFrame` immediately after `isInitialized` flips. Rust respects `should_show_on_ready`. | Native window may appear while router/auth/API checks, session restoration, and splash minimum duration are still pending. |
| Provider/router readiness | `AppProviders` and `AppRouter` | App providers mount, AuthProvider loads, API config is checked, runtime init modal may appear, then `onReady` sets `isRouterReady`. | Router-ready does not mean conversation-ready or workspace-ready; it only means the route can render. |
| Page/provider restoration | `HomePage`, chat provider/bootstrap, workspace page/service | HomePage mounts feature providers; chat bootstrap may load most recent conversation after mount and after `studio:storage-ready`. | App readiness should not imply active conversation/session restoration is complete. |
| Splash dismissal | `MainApp` | Waits for `isInitialized`, `isRouterReady`, no error, and `STARTUP_SPLASH_MIN_MS`, then unmounts `SplashScreen` with `SPLASH_EXIT_DURATION_SECONDS`. | Splash is an in-window overlay using `z-modal`; top chrome can appear above it if other chrome uses a higher layer. |
| Interactive shell | `MainLayout`, `WorkspaceShellChrome`, `HomePage`, feature pages | Shell classes, global dock, hover chrome, and page content are active. | There is no single `interactive` signal after splash exit and page/session restore. |

Contract needed before code changes:

1. Split the single `app_ready` meaning into named readiness states such as
   `frontend_initialized`, `router_ready`, `session_restore_started`,
   `session_restored`, `splash_minimum_elapsed`, `splash_dismissed`,
   `shell_interactive`, and `native_visible`.
2. Decide which state is allowed to call native show/focus. The likely
   candidate is not `frontend_initialized`; it should be at least
   router-ready plus an intentional native visibility decision.
3. Decide whether native visibility should happen while splash is visible or
   only after splash exit begins. If it happens under the splash, top chrome
   layers must be suppressed or classified, not merely moved by z-index.
4. Preserve overlay and splash-preview branches as separate surface variants
   that do not run full startup lifecycle.
5. Keep `MainLayout` and `main.tsx` shell class mutations synchronized until a
   single shell lifecycle owner is introduced.

Suggested future implementation order:

1. Add a small startup lifecycle helper or context that records readiness phases
   without changing behavior.
2. Route the existing `isInitialized`, `isRouterReady`, and splash timer through
   that helper, still preserving the current visual behavior.
3. Move the native `app_ready` call behind the selected readiness phase after
   the lifecycle evidence is visible in code.
4. Only then revisit layer tokens or chrome visibility during splash.

Startup stop conditions:

- Do not change `z-modal`, `z-toast`, splash z-index, or traffic-light z-index
  as the primary startup fix.
- Do not move `app_ready` without naming the readiness phase that owns native
  show/focus.
- Do not treat `AppRouter.onReady` as conversation/session restoration without
  checking `HomePage`, `ChatProvider`, and `useConversationBootstrap`.

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
