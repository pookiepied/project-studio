# Frontend Structure and Organization Audit

Status: Read-only audit expansion completed on 2026-07-10.

This report expands the first audit with the concrete structure, naming,
movement, import-boundary, and monolith-breakdown recommendations requested.
No source files were edited. Recommendations came from focused subagent slices
plus a local read-only pass over `chat` and `workspace`.

## Executive Answer

Yes: the frontend audit task includes project structure suggestions, naming
changes, project organization, file move recommendations, import cleanup,
inline-to-shared extraction, monolithic file breakdown, and UI/functionality/
runtime separation.

The codebase already has a useful top-level split (`app`, `features`, `core`,
`runtime`, `ui`, `design`), but several files live under technically valid
folders with misleading ownership. The next phase should not invent a new app;
it should make the existing architecture honest.

## Target Top-Level Shape

```txt
STUDIO/src/
  app/
    boot/
    entry/
    navigation/
    overlay/
    routing/
    shell/
    theme/
  core/
    auth/
    localProviders/
    native/
    network/
    platform/
    storage/
  design/
    global/
    tokens.css
    typography.css
    fonts.ts
  features/
    artifacts/
    auth/
    chat/
    extensions/
    markdown/
    overlay/
    permissions/
    profile/
    projects/
    transcription/
    voice/
    workspace/
  runtime/
    capabilities/
    events/
    execution/
    invoke/
    servers/
    transport/
  shared/
    formatting/
    hooks/
    keyboard/
  ui/
    brand/
    feedback/
    icons/
    primitives/
```

## Highest Priority Moves

| Current path | Proposed path | Reason |
|---|---|---|
| `STUDIO/src/app/routes/HomePage.tsx` | `STUDIO/src/app/shell/StudioWorkspaceRoot.tsx` | It is the authenticated workspace root, not a simple route page. It owns providers, page registry, layout mounting, transitions, and feature view state. |
| `STUDIO/src/app/AppRouter.tsx` | `STUDIO/src/app/routing/AppRouter.tsx` | Route/auth/API gating concern belongs under routing. |
| `STUDIO/src/types/navigation.ts` | `STUDIO/src/app/navigation/view.types.ts` | `View` is app navigation state, not a global domain type. |
| `STUDIO/src/ui/layout/MainLayout.tsx` | `STUDIO/src/app/shell/AppLayout.tsx` | Imports app contexts, app shell config, and workspace shell chrome; not reusable UI layout. |
| `STUDIO/src/ui/layout/TitleBar.tsx` | `STUDIO/src/app/shell/standard/StandardTitleBar.tsx` | Native app chrome with Tauri window controls. |
| `STUDIO/src/ui/layout/NavPopup.tsx` | `STUDIO/src/app/navigation/StandardNavMenu.tsx` | App navigation catalog, not generic layout. |
| `STUDIO/src/ui/layout/AccountMenu.tsx` | `STUDIO/src/app/navigation/AccountMenu.tsx` | Account/nav app concern. |
| `STUDIO/src/app/shell/FloatingPanel.tsx` | `STUDIO/src/app/navigation/WorkspaceNavDock.tsx` | It is grouped navigation plus theme/notification controls. |
| `STUDIO/src/app/routes/OverlayPage.tsx` | `STUDIO/src/app/overlay/OverlayWindow.tsx` | Special Tauri window entry, not normal route. |
| `STUDIO/src/app/routes/SplashPreviewPage.tsx` | `STUDIO/src/app/dev/SplashPreview.tsx` | Dev/preview route. |
| `STUDIO/src/app/routes/ShaderWelcomePage.tsx` | `STUDIO/src/features/auth/WelcomePage.tsx` | Authentication surface. |
| `STUDIO/src/app/routes/AuthCallback.tsx` | `STUDIO/src/features/auth/AuthCallbackPage.tsx` | Auth callback logic imports auth services directly. |
| `STUDIO/src/app/routes/ProjectsPage.tsx` | `STUDIO/src/features/projects/ProjectsPage.tsx` | Product feature page. |
| `STUDIO/src/app/routes/ProfilePage.tsx` | `STUDIO/src/features/profile/ProfilePage.tsx` | Product/account feature page. |
| `STUDIO/src/app/routes/TemporaryPage.tsx` | `STUDIO/src/features/chat/temporary/TemporaryChatPage.tsx` | Uses chat composer/messages and markdown rendering. |

## App Startup / Routing Breakdown

`STUDIO/src/main.tsx` and `STUDIO/src/app/App.tsx` currently own too many startup
concerns directly. Keep `main.tsx` as the Vite entry, but make it thin.

Proposed structure:

```txt
STUDIO/src/app/entry/
  mountApp.tsx
  preMountDom.ts
  desktopReloadGuard.ts
  globalErrorListeners.ts
  windowMode.ts

STUDIO/src/app/boot/
  bootSequence.ts
  boot.types.ts
  useAppBoot.ts
  boot.constants.ts

STUDIO/src/core/platform/
  appLifecycleService.ts
```

Move these responsibilities:

| Current owner | Proposed owner | Responsibility |
|---|---|---|
| `main.tsx` | `app/entry/preMountDom.ts` | Early theme and workspace-shell class setup. |
| `main.tsx` | `app/entry/desktopReloadGuard.ts` | Ctrl+R prevention in desktop mode. |
| `main.tsx` | `app/entry/globalErrorListeners.ts` | `error` and `unhandledrejection` listeners. |
| `App.tsx` | `app/boot/boot.types.ts` | `InitializationStep`. |
| `App.tsx` | `app/boot/useAppBoot.ts` | React boot state orchestration. |
| `App.tsx` | `app/boot/bootSequence.ts` | Ordered boot actions with fatal/non-fatal results. |
| `App.tsx` | `core/platform/appLifecycleService.ts` | `init_secure_storage` and `app_ready`. |
| `AppRouter.tsx` | `app/routing/useApiConfigGate.ts` | API configuration check. |
| `AppRouter.tsx` | `app/routing/useBackgroundConversationToast.ts` | Background-completed-conversation toast. |
| `HomePage.tsx` | `app/navigation/viewRegistry.tsx` | Current view/page switch. |

## UI / Design System Boundary

`STUDIO/src/ui/primitives` should contain true reusable controls. It currently
contains feature/runtime/product components.

| Current path | Proposed path | Reason |
|---|---|---|
| `ui/primitives/HarnessPermissionModal.tsx` | `features/permissions/components/LocalCapabilitiesModal.tsx` | Product permission flow, not primitive. |
| `ui/primitives/TodoWriteCard.tsx` | `features/chat/components/TaskWriteCard.tsx` | Chat tool card; current name/export mismatch. |
| `ui/primitives/AskUserQuestionCard.tsx` | `features/chat/components/AskUserQuestionCard.tsx` | Chat/tool interaction card. |
| `ui/primitives/ConnectionStatusBar.tsx` | `features/chat/components/ConnectionStatusBar.tsx` | Uses connection/chat state. |
| `ui/primitives/StreamingText.tsx` | `features/chat/components/StreamingMarkdown.tsx` | Streaming markdown behavior, not primitive text. |
| `ui/primitives/TokenRing.tsx` | `features/chat/components/ContextTokenRing.tsx` | Context-window visualization. |
| `ui/primitives/VideoPlayer.tsx` | `features/markdown/components/VideoPlayer.tsx` | Markdown/artifact media renderer. |
| `ui/primitives/ExternalLink.tsx` | `features/markdown/components/MarkdownExternalLink.tsx` plus `core/platform/externalLinkService.ts` | Markdown link behavior plus native opener. |
| `ui/primitives/ClaudeCodeIcon.tsx` | `ui/brand/ClaudeCodeMark.tsx` | Brand mark. |
| `ui/primitives/StudioIcon.tsx` | `ui/brand/StudioAppIcon.tsx` | Brand asset wrapper. |
| `ui/overlays/FloatingIsland.tsx` and atoms | `features/overlay/components/*` | Product overlay feature, not generic overlay primitive. |

Recommended primitive-only set:

```txt
STUDIO/src/ui/primitives/
  Badge.tsx
  Button.tsx
  EmptyState.tsx
  IconButton.tsx
  Input.tsx
  SearchInput.tsx
  SegmentedControl.tsx
  Select.tsx
  Spinner.tsx
  Textarea.tsx
  Toggle.tsx
```

## CSS / Token Organization

`STUDIO/src/index.css` combines base CSS, focus/motion rules, scrollbars,
syntax highlighting, and chat prose. Split it by ownership:

| Current | Proposed |
|---|---|
| `src/index.css` base body/html/focus/motion | `src/design/global/base.css`, `accessibility.css`, `motion.css` |
| `src/index.css` scrollbar rules | `src/design/global/scrollbars.css` |
| `src/index.css` `.prose-chat` | `src/features/markdown/styles/prose.css` |
| `src/index.css` `.hljs` and code syntax | `src/features/markdown/styles/syntax.css` |

Also update stale comments in `tailwind.config.js` and `index.css` that still
mention old `src/styles` or `src/tokens` paths while the real files are under
`src/design`.

## Runtime / Native Boundary

Direct Tauri imports should live behind typed adapters except at explicit native
host boundaries.

| Current path / logic | Proposed owner |
|---|---|
| `app/App.tsx` `init_secure_storage`, `app_ready` | `core/platform/appLifecycleService.ts` |
| `ui/layout/TitleBar.tsx` window controls | `core/platform/desktopWindowService.ts` and app shell UI |
| `app/shell/WindowTrafficLights.tsx` window controls | `core/platform/desktopWindowService.ts` |
| `ui/primitives/ExternalLink.tsx` opener invoke | `core/platform/externalLinkService.ts` |
| `features/chat/components/ProjectContextPicker.tsx` dialog/fs commands | `features/chat/projectContext/projectContextFileService.ts` |
| `features/workspace/terminal/TerminalPanel.tsx` PTY invoke/listen | `features/workspace/terminal/terminalSessionService.ts` and `useTerminalSessions.ts` |
| `features/workspace/rightWorkspace/projectAppsShell.ts` | `features/workspace/projectApps/projectAppsNativeService.ts` |
| `features/extensions/hooks/useMcpServers.ts` Tauri MCP calls | `runtime/servers/mcpServerControl.ts` |
| `features/chat/services/claudeBridgeService.ts` | `cliBridges/claude/claudeBridgeService.ts` |
| Faster Whisper invoke/listen/path/file logic | `features/transcription/services/fasterWhisper/fasterWhisperNativeAdapter.ts` |

Runtime UI should move out of `runtime` if the goal is UI/functionality
separation:

| Current path | Proposed path |
|---|---|
| `runtime/ui/ToolPermissionCard.tsx` | `features/chat/runtime-ui/ToolPermissionCard.tsx` |
| `runtime/ui/RuntimeStepCard.tsx` | `features/chat/runtime-ui/RuntimeStepCard.tsx` |
| `runtime/ui/InlineToolSteps.tsx` | `features/chat/runtime-ui/InlineToolSteps.tsx` |
| `runtime/ui/toolCardRegistry.tsx` | `features/chat/runtime-ui/toolCardRegistry.tsx` |
| `runtime/ui/toolCardUtils.tsx` | `features/chat/runtime-ui/toolCardUtils.tsx` |

Potential bug/risk: `src-tauri/tauri.conf.json` allows `localhost:11434` and
`10110`, while `core/daemon/daemonClient.ts` defaults to `11435`. Either add
`11435` to CSP or proxy daemon calls through Tauri commands.

## Local Provider / Daemon Naming

`core/daemon` is too generic and mixes local provider lifecycle with localhost
HTTP.

| Current path | Proposed path |
|---|---|
| `core/daemon/useDaemon.ts` | `core/localProviders/useLocalProviderDaemon.ts` or feature hook under `features/models/hooks` |
| `core/daemon/daemonClient.ts` | `core/localProviders/localProviderClient.ts` |
| `features/chat/services/daemonService.ts` | `core/localProviders/localInferenceStream.ts` |

## `src/lib` Replacement Plan

`src/lib` is a catch-all. It should be emptied gradually, one cluster at a time.

| Current path | Proposed path |
|---|---|
| `src/lib/api.ts` | `src/core/network/apiClient.ts` |
| `src/lib/tokenManager.ts` | `src/core/auth/tokenManager.ts` |
| `src/lib/theme.ts` | `src/app/theme/theme.ts` or `src/design/theme.ts` |
| `src/lib/formatters.ts` | `src/shared/formatting/index.ts` |
| `src/lib/hooks/useOnClickOutside.ts` | `src/shared/hooks/useOnClickOutside.ts` |
| `src/lib/hooks/useDebounce.ts` | `src/shared/hooks/useDebounce.ts` |
| `src/lib/hooks/useExclusivePanel.ts` | `src/ui/overlays/useExclusivePanel.ts` |
| `src/lib/hooks/useAutoResizeTextarea.ts` | `src/ui/primitives/textarea/useAutoResizeTextarea.ts` |
| `src/lib/hooks/useCachedIcon.ts` | `src/features/extensions/hooks/useCachedIcon.ts` |
| `src/lib/modelUtils.ts` | `src/features/models/modelUtils.ts` |
| `src/lib/artifact.ts` | `src/features/artifacts/artifact/serialization.ts` |
| `src/lib/chatParser.ts` | `src/features/chat/services/chatParser.ts` |
| `src/lib/responseParser.ts` | `src/features/chat/services/responseParser.ts` |
| `src/lib/dsmlParser.ts` | `src/features/chat/services/dsmlParser.ts` |
| `src/lib/harnessEventUtils.ts` | `src/runtime/events/harnessEventUtils.ts` |
| `src/lib/tokenEstimator.ts` | `src/features/chat/tokens/tokenEstimator.ts` |
| `src/lib/projectContextUtils.ts` | `src/features/chat/context/projectContextUtils.ts` |
| `src/lib/turnAnchors.ts` | `src/features/chat/utils/turnAnchors.ts` |
| `src/lib/prompts.ts` | `src/features/settings/rephrasePrompts.ts` |
| `src/lib/audioLevels.ts` | `src/features/voice/utils/audioLevels.ts` |
| `src/lib/textMerger.ts` | `src/features/transcription/utils/textMerger.ts` |
| `src/lib/shortcutFormatter.ts` | `src/shared/keyboard/shortcutFormatter.ts` |

Add narrow barrels after moves:

```txt
src/core/auth/index.ts
src/core/network/index.ts
src/shared/formatting/index.ts
src/shared/hooks/index.ts
src/features/chat/services/index.ts
src/features/artifacts/index.ts
src/features/models/index.ts
```

Avoid a new mega-barrel. Heavy packages such as Mermaid, PDF.js, KaTeX, Three,
Recharts, and syntax highlighting should stay feature-lazy and should not leak
through shared barrels.

## Core Import Direction Problems

`core` should not import up into features. Current concerns:

| Current path | Problem | Proposed fix |
|---|---|---|
| `core/network/fallbackService.ts` | Imports model/chat attachment types. | Split generic network retry helpers into `core/network`; move model/chat fallback behavior to feature services. |
| `core/storage/chatHistoryService.ts` | Imports chat conversation storage and Claude adapters. | Move to `features/chat/conversations/chatHistoryService.ts` or `features/chat/storage/chatHistoryService.ts`. |
| `core/storage/fileConfigService.ts` | Imports model migration from `features/models`. | Move config ownership to settings, or extract neutral model-id migration utility. |
| `core/daemon/useDaemon.ts` | Imports app hooks/context. | Move hook to `features/models/hooks` or `app/hooks`; keep core daemon service hook-free. |

## Chat Feature Monolith Breakdown

`features/chat/ChatPage.tsx` is not just a page. It is a view orchestrator that
combines conversation state, model state, storage-scope state, panel state,
composer state, attachment state, TTS, permissions, project context, Claude
account status, layout, and rendering.

Recommended split:

```txt
features/chat/page/
  ChatPage.tsx
  ChatWorkspaceLayout.tsx
  EmptyConversationView.tsx
  ConversationView.tsx
  FloatingComposerDock.tsx
  useChatPageState.ts
  useComposerState.ts
  useConversationListState.ts
  useChatPanelState.ts
```

Concrete extractions:

| Current in `ChatPage.tsx` | Proposed owner |
|---|---|
| `BOTTOM_SCROLL_CLEARANCE` and composer dock measurement | `features/chat/page/FloatingComposerDock.tsx` plus `useComposerDockHeight.ts` |
| `CLAUDE_TRANSCRIPT_BANNER` / `CLAUDE_FORK_BUTTON` | `features/chat/components/ClaudeTranscriptBanner.tsx` |
| `composerProps` assembly | `features/chat/page/useComposerState.ts` |
| `composerMetaRow` | `features/chat/components/ComposerMetaRow.tsx` |
| conversation dropdown editing state | `features/chat/page/useConversationListState.ts` |
| right workspace/summary/browser/artifact/terminal wiring | `features/chat/page/useChatPanelState.ts` |
| empty-state JSX | `features/chat/page/EmptyConversationView.tsx` |
| conversation-state JSX | `features/chat/page/ConversationView.tsx` |
| global `inject-chat-text` / `focus-chat-input` listeners | `features/chat/page/useChatInputEvents.ts` |

Large supporting files to split later:

| Current path | Suggested split |
|---|---|
| `features/chat/context/ChatProvider.tsx` | provider shell, reducer/state machine, persistence effects, streaming actions, local/Claude engine adapters. |
| `features/chat/context/useSendPipeline.ts` | validation, attachment preparation, engine selection, cloud send, local/Claude send, post-send side effects. |
| `features/chat/context/useStreamHandlers.ts` | event parsing, text accumulation, tool handling, DSML/harness events, completion handling. |
| `features/chat/components/ProjectContextPicker.tsx` | UI picker, native file service, recent projects store, access-mode controls. |
| `features/chat/components/ChatComposer.tsx` | text area, attachment menu, model/engine controls, reasoning controls, permission mode controls. |

## Workspace Feature Monolith Breakdown

`features/workspace/WorkspacePage.tsx` is multiple pages and data flows in one
file: overview, artifacts, context documents, memory facts, automation routines,
activity timeline, upload/delete actions, and agent run history.

Recommended structure:

```txt
features/workspace/
  WorkspacePage.tsx
  constants.ts
  formatters.ts
  hooks/
    useWorkspaceContextData.ts
    useWorkspaceAgents.ts
    useWorkspaceTimeline.ts
  components/
    WorkspaceSidebar.tsx
    WorkspaceMetrics.tsx
    WorkspaceTimeline.tsx
    WorkspacePolicyPanel.tsx
  context/
    ContextSection.tsx
    DocumentList.tsx
    MemoryList.tsx
  automation/
    AutomationSection.tsx
    AgentRow.tsx
    CreateAgentForm.tsx
  overview/
    OverviewSection.tsx
  activity/
    ActivitySection.tsx
```

Concrete extractions:

| Current in `WorkspacePage.tsx` | Proposed owner |
|---|---|
| `WorkspaceSection`, `SECTIONS`, `CATEGORY_LABELS`, `STORAGE_LIMIT`, `ACCEPTED_TYPES` | `features/workspace/constants.ts` |
| `formatBytes`, `formatDate`, `formatRelative`, `runStatusIcon` | `features/workspace/formatters.ts` |
| `ToolbarButton`, `Metric` | Prefer existing `ui/primitives/Button`; if special, `features/workspace/components/WorkspaceToolbarButton.tsx` and `WorkspaceMetric.tsx` |
| `DocumentList` | `features/workspace/context/DocumentList.tsx` |
| `MemoryList` | `features/workspace/context/MemoryList.tsx` |
| `CreateAgentForm` | `features/workspace/automation/CreateAgentForm.tsx` |
| `AgentRow` | `features/workspace/automation/AgentRow.tsx` |
| document/memory load/delete/upload state | `features/workspace/hooks/useWorkspaceContextData.ts` |
| agents load/create/delete/run state | `features/workspace/hooks/useWorkspaceAgents.ts` |
| timeline calculation | `features/workspace/hooks/useWorkspaceTimeline.ts` |
| section rendering switch | separate section components under `overview`, `context`, `automation`, `activity` |

## Duplicate Behavior Extractions

| Duplicate behavior | Current examples | Proposed owner |
|---|---|---|
| Resize-panel mouse handling | artifact panel, browser panel, right workspace panels | `shared/hooks/useResizablePanel.ts` or `features/workspace/rightWorkspace/useResizablePanel.ts` if workspace-specific. |
| Clipboard copy with copied state | markdown, artifacts, error boundary, context menu, voice/transcription | `shared/hooks/useCopyToClipboard.ts` plus `core/platform/clipboardService.ts` if native behavior is needed. |
| Local storage guarded access | theme, shell config, auth, models, chat drafts, workspace apps | `shared/storage/safeLocalStorage.ts` or domain-specific stores using a common helper. |
| Raw card/button patterns | workspace, chat dropdowns, model library, extension cards | `ui/primitives/ActionTile.tsx`, `MenuItemButton.tsx`, `ToolbarButton.tsx`. |

## Proposed Audit-Driven Migration Order

1. Calibrate ESLint guardrails so primitives and documented carve-outs stop
   polluting lint output.
2. Move app-specific UI out of `ui/layout` and non-primitives out of
   `ui/primitives`.
3. Extract app boot/routing owners without changing behavior.
4. Move feature pages out of `app/routes`.
5. Introduce native/platform adapters and remove direct Tauri imports from UI.
6. Empty `src/lib` by cluster, starting with hooks/formatters, then auth/network,
   then feature-owned parsers/helpers.
7. Split `ChatPage.tsx` into orchestration hooks and render components.
8. Split `WorkspacePage.tsx` into sections, hooks, and feature components.
9. Move runtime React UI out of `runtime/ui`.
10. Review bundle/lazy-loading once import boundaries are honest.

## Validation Plan

For each future code-change loop:

```bash
npm run build
npm run lint
```

Manual checks by loop:

- App boot/routing: desktop launch, web launch, OAuth callback, overlay window,
  splash preview.
- UI moves: chat composer, dropdowns, buttons, menus, modal focus.
- Runtime adapters: window controls, external links, project picker, terminal,
  local MCP server controls.
- Chat split: send message, stream, stop, regenerate, edit, attachments,
  permissions, Claude mode, context picker.
- Workspace split: document upload/delete, memory delete, routine create/run,
  section switching.

