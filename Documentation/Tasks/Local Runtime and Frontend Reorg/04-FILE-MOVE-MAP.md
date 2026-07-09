# 04 — File Move Map

The exhaustive lookup table: every file that moves, every rename, every monolith to
split, and the dead-code list. Paths are relative to `STUDIO/src/` unless prefixed.
Use `git mv` so history and review-as-rename are preserved.

> Legend: **→** move (path change only). **⇒** move **and rename**. **✂** split.
> **☠ VERIFY-FIRST** delete only after proving unreferenced (D-7).

---

## A. Into `runtime/` (the Local Runtime carve-out)

| Current | Target |
|---|---|
| `services/mcp/mcpInvoker.ts` | → `runtime/invoke/invokeMcpTool.ts` |
| `services/mcp/index.ts` | delete (its only line re-exports mcpInvoker; the barrel is now `runtime/index.ts`) |
| `services/local/localMcpControl.ts` | ✂ split → `runtime/servers/catalog.ts` (server defs + permission read/set) **and** `runtime/servers/manifest.ts` (`mcp_get_tools` + `syncManifest` + `resolveLocalMcpPath` + `startLocalMcp`/`stopLocalMcp`) |
| `services/ai/mcpService.ts` | ⇒ **`core/mcpRegistry/registryClient.ts`** (NOT runtime — it is dual-use: the runtime syncs manifests through it, but Extensions/marketplace UI also browses/installs servers through it. Verified importers: `features/extensions/{ManagePanel,ServerBrowseCards,useMcpServers}`, `features/chat/hooks/useAtMention`, plus runtime. Shared → `core/`.) `runtime/servers/manifestSync.ts` calls it. |
| `hooks/useAgentChat.ts` | → **`runtime/transport/useAgentChat.ts`** (it is the React driver over `wsPool`, i.e. runtime glue — D-9. Its types `ChatRequestBody`/`AgentChatHandlers` move to `runtime/protocol.ts`; `ChatProvider` imports the hook from `@/runtime`.) |
| `services/ai/types.ts` | ✂ **split by consumer (D-9):** `LocalToolCall` / `ToolResultItem` / `AutoRoutedInfo` / `APIChatMessage` → `src/types/chat.ts` (neutral leaf, imported by both runtime and chat); `ChatRequest` / `ChatResponse` / `TranscribeResponse` / `VisionChatMessage` → `features/chat/services/types.ts`. Repoint the 10 importers accordingly. |
| `services/localCapabilities/localCapabilityService.ts` | → `runtime/capabilities/capabilityService.ts` |
| `services/localCapabilities/types.ts` | → `runtime/capabilities/types.ts` |
| `services/localCapabilities/index.ts` | fold into `runtime/index.ts` |
| `hooks/useHarnessInit.ts` | ✂ split → `runtime/servers/lifecycle.ts` (pure start/stop/health/restart) **and** `runtime/servers/useRuntimeInit.ts` (React wrapper + modal state). Keep the back-compat exports `HARNESS_PERMISSION_KEY` / `COMPUTER_USE_PERMISSION_KEY` re-exported from the barrel until callers are updated. |
| `features/chat/context/buildChatRequest.ts` | → `runtime/capabilities/buildChatBody.ts` |
| `services/conversations/wsPool.ts` | → `runtime/transport/wsPool.ts` |
| `services/conversations/wsMessages.ts` | → `runtime/transport/wsMessages.ts` |
| `features/chat/context/toolExecutor.ts` | ✂ split → `runtime/execution/executeLocalTools.ts` (main loop + permission gate) + `runtime/execution/workspaceDefaults.ts` (`applyWorkspaceDefaults`) + `runtime/execution/builtinTools.ts` (`task_write` / `get_location` / `ask_user_question` handlers) |
| `features/chat/context/toolClassifier.ts` | → `runtime/ui/classifyToolDisplay.ts` |
| `features/chat/tools/mcpRegistry.tsx` | ⇒ `runtime/ui/toolCardRegistry.tsx` |
| `features/chat/tools/ToolPermissionCard.tsx` | → `runtime/ui/ToolPermissionCard.tsx` |
| `features/chat/tools/HarnessStepCard.tsx` | ⇒ `runtime/ui/RuntimeStepCard.tsx` |
| `features/chat/tools/InlineToolSteps.tsx` | → `runtime/ui/InlineToolSteps.tsx` |
| `features/chat/tools/toolCardUtils.tsx` | → `runtime/ui/toolCardUtils.tsx` |
| — | **NEW** `runtime/protocol.ts` — extract the WS message shapes currently hand-typed in `chat/src/agent/ChatAgent.ts` and `services/conversations/wsPool.ts`; both `wsPool` and `wsMessages` import from here. |
| — | **NEW** `runtime/index.ts` — barrel (public surface in doc 03 §2). |

**Not moved (stays put):** `services/local/daemonClient.ts` and `hooks/useDaemon.ts`
→ these are the **daemon**, not the runtime (D-4). They go to `core/daemon/`.

---

## B. Into `core/` (infra services)

| Current | Target |
|---|---|
| `services/storage/*` | → `core/storage/*` |
| `services/web/webStorage.ts` | → `core/storage/backends/web.ts` (fold in) |
| `services/network/*` | → `core/network/*` |
| `services/errors/*` | → `core/errors/*` |
| `services/logging/*` | → `core/logging/*` |
| `services/platform/*` | → `core/platform/*` |
| `infrastructure/platform/studioPaths.ts` | → `core/platform/studioPaths.ts` (merge the two platform folders) |
| `services/notifications/*` | → `core/notifications/*` |
| `services/connection/*` | → `core/connection/*` |
| `services/skills/*` | → `core/skills/*` |
| `services/local/daemonClient.ts` | → `core/daemon/daemonClient.ts` |
| `services/local/index.ts` | rework → `core/daemon/index.ts` (drop the localMcp re-exports; those went to `runtime/`) |
| `hooks/useDaemon.ts` | → `core/daemon/useDaemon.ts` |
| `config/*` | → `core/config/*` |
| `constants/*` | → `core/config/constants/*` (or keep `core/constants/*` — pick one, be consistent) |
| `services/ai/mcpService.ts` | → `core/mcpRegistry/registryClient.ts` (dual-use cloud MCP registry client — see §A note). Extensions + runtime + chat all import from `@/core/mcpRegistry`. |

---

## C. Into `features/*` (feature logic pulled out of shared buckets)

### auth (NEW feature)
| Current | Target |
|---|---|
| `services/auth/googleSDK.ts`, `services/auth/tauriOAuth.ts` | → `features/auth/services/*` |
| `contexts/AuthContext.tsx` | → `features/auth/context/AuthContext.tsx` |
| `components/AuthControls.tsx`, `components/GoogleLoginButton.tsx` | → `features/auth/components/*` |
| `pages/AuthCallback.tsx` | → `app/routes/AuthCallback.tsx` (routing target, not the feature) |

### models
| Current | Target |
|---|---|
| `components/ModelPicker.tsx`, `TierSelector.tsx`, `ProviderIcon.tsx`, `OllamaStatus.tsx`, `LMStudioStatus.tsx`, `LocalProviderStatus.tsx` | → `features/models/components/*` |
| `services/ai/modelService.ts`, `modelFilter.ts`, `modelCapabilityService.ts`, `localModelDetection.ts`, `ollamaService.ts`, `localUsageService.ts` | → `features/models/services/*` |
| `hooks/useOllama.ts`, `hooks/useModes.ts` | → `features/models/hooks/*` |

### voice
| Current | Target |
|---|---|
| `components/VoiceInput.tsx`, `components/AudioWaveform.tsx` | → `features/voice/components/*` |
| `hooks/useAudioRecorder.ts`, `useVoiceInput.ts`, `useTTS.ts`, `useLiveSession.ts` | → `features/voice/hooks/*` |
| `contexts/RecordingContext.tsx`, `contexts/LiveSessionContext.tsx` | → `features/voice/context/*` |

### chat
| Current | Target |
|---|---|
| `services/conversations/backgroundSessionTracker.ts` | → `features/chat/conversations/backgroundSessionTracker.ts` |
| `services/conversations/claude/*`, `ownership/*`, `preferences/*`, `storage/*` | → `features/chat/conversations/*` |
| `services/ai/chatService.ts`, `aiService.ts`, `sseStream.ts`, `pendingCompletion.ts`, `summarizationService.ts`, `mediaService.ts`, `daemonService.ts` | → `features/chat/services/*` (audit each) |
| `services/ai/composioService.ts` | → `features/extensions/services/composioService.ts` (Composio belongs to Extensions, not chat) |
| `services/ai/types.ts` | ✂ split — see §A (runtime/neutral types) and this feature's `services/types.ts` (chat HTTP shapes) |
| `services/files/*`, `services/inputs/*` | → `features/chat/attachments/*` |
| `components/AttachmentInput.tsx` | → `features/chat/components/AttachmentInput.tsx` |
| `hooks/useAgentChat.ts` | → **`runtime/transport/useAgentChat.ts`** (moved with the runtime — see §A, D-9. Not a chat file.) |

### other features
| Current | Target |
|---|---|
| `components/rightWorkspace/ResizeHandle.tsx` | → `features/workspace/rightWorkspace/ResizeHandle.tsx`; then delete empty `components/rightWorkspace/` |
| `services/extensions/appIconCache.ts` | → `features/extensions/services/appIconCache.ts` |
| `hooks/useComposio*` (if any), `hooks/useMcpServers` lives already in `features/extensions/hooks` | leave feature-local hooks where they are |

### permissions (pick ONE home)
| Current | Target |
|---|---|
| `permissions/*` (engine: config, engine, grants, model, paths, scope, toolRisk, types, index) | → **`features/permissions/engine/*`** (merge with the existing `features/permissions/`), **or** → `core/permissions/*` if you prefer it as infra. **Do not leave it split across two trees.** Recommended: `core/permissions/` because `runtime/execution` and chat both depend on it, and `core/` is the shared-infra layer. |
| `features/permissions/*` (UI: PermissionLayerHost, ComposerApprovalCard, usePermissionNotifications) | keep as `features/permissions/` UI; it imports the engine from its chosen home |

---

## D. Into `ui/` (shared presentational primitives)

| Current | Target |
|---|---|
| `components/ui/*` | → `ui/ui/*` (or flatten to `ui/*` — pick one; `ui/ui` is ugly, prefer flattening primitives to `ui/primitives/*`) |
| `components/brand/*` | → `ui/brand/*` |
| `components/icons/*` | → `ui/icons/*` |
| `components/feedback/*` | → `ui/feedback/*` |
| `components/overlays/*` | → `ui/overlays/*` |
| `components/layout/*` | → `ui/layout/*` |
| `components/notifications/NotificationBell.tsx` | → `ui/notifications/*` |
| `components/ErrorBoundary.tsx` | → `ui/ErrorBoundary.tsx` |

> Recommended concrete layout: `ui/primitives/` (was `components/ui`), `ui/brand/`,
> `ui/icons/`, `ui/feedback/`, `ui/overlays/`, `ui/layout/`. Avoid the `ui/ui/`
> double name.

---

## E. Into `app/` (bootstrap)

| Current | Target |
|---|---|
| `App.tsx` | ✂ → `app/App.tsx` + extract `app/AppProviders.tsx` + `app/AppRouter.tsx` |
| `main.tsx` | stays at `src/main.tsx` (entry point) |
| `shell/*` | → `app/shell/*` |
| `contexts/*` (the ones not claimed by a feature: Settings, Offline, Navigation, CommandPalette, ArtifactPanel, BrowserPanel) | → `app/contexts/*` |
| `pages/HomePage.tsx`, `OverlayPage.tsx`, `ShaderWelcomePage.tsx`, `ProfilePage.tsx`, `ProjectsPage.tsx` | → `app/routes/*` |
| `components/GlobalShortcutHandler.tsx`, `GlobalContextEvents.tsx`, `ConditionalFeatures.tsx`, `OfflineIndicator.tsx` | → `app/globals/*` |
| `hooks/useAppUpdater.ts`, `useFeatures.ts`, `useNotifications.ts`, `useConnectionManager.ts` | → `app/hooks/*` (or `core/` if purely infra — judge per file) |

---

## F. Into `lib/` and `design/`

| Current | Target |
|---|---|
| `utils/*` | → `lib/*` |
| `hooks/useDebounce.ts`, `useOnClickOutside.ts`, `useAutoResizeTextarea.ts`, `useCachedIcon.ts`, `useExclusivePanel.ts`, `useOnClickOutside.ts` (truly-global) | → `lib/hooks/*` |
| `styles/*` | → `design/*` |
| `tokens/tokens.css` | → `design/tokens.css` |
| `styles/fonts.ts` | → `design/fonts.ts` |
| `types/*` | → `types/*` (stays; already a clean home) |
| `artifacts/examples.ts` | → `features/artifacts/examples.ts` (feature data, not top-level) |

---

## G. Monoliths to split (✂) — behavior unchanged

Do these **after** the moves that touch the same files (doc 05 orders them). Split by
responsibility; each extracted unit gets its own file and a test-by-hand pass.

| File (target location) | Split into |
|---|---|
| `features/chat/context/ChatProvider.tsx` (2079) | `useSendPipeline` (build + send a turn), `useStreamHandlers` (onChunk/onThinking/onDone wiring), `useConversationState` (messages/tasks/session state), `usePersistence` (save/load) — and **the tool-orchestration parts move to `runtime/`**. The provider ends as a thin composition. Do this **last** (Phase 5) once runtime + chat services are already relocated. |
| `features/workspace/WorkspacePage.tsx` (987) | panel layout vs. project-detection vs. terminal/browser hosting |
| `features/chat/ChatPage.tsx` (911) | extract orchestration into hooks; the list/composer/header are already components |
| `features/voice/hooks/useAudioRecorder.ts` (751) | recording state vs. encoding vs. device management |
| `core/errors/comprehensiveDiagnostics.ts` (658) | per-subsystem diagnostic collectors |
| `runtime/execution/executeLocalTools.ts` (was 537) | already split in §A into executor + workspaceDefaults + builtinTools |

> Monolith splitting beyond ChatProvider is **optional polish** — schedule it, but it
> is not required for the reorg to be "done." ChatProvider is the one that matters.

---

## H. Dead code — ☠ VERIFY-FIRST (D-7)

Prove each is unreferenced (grep `src/`, `index.html`, router) **before** deleting.

| Candidate | Why suspected | Action |
|---|---|---|
| `pages/TemporaryPage.tsx` | name says scaffolding | grep for `TemporaryPage`; if only self-ref, delete |
| `pages/SplashPreviewPage.tsx` | dev-only, gated by `?splashPreview=1` in `App.tsx` | if product doesn't need the preview route, remove it **and** the `IS_SPLASH_PREVIEW` branch in `App.tsx`. If kept, move to `app/routes/__dev__/`. |
| `components/rightWorkspace/` | empty after `ResizeHandle` moves | delete the folder (functionality is NOT dead — D-6) |
| `services/mcp/index.ts` | one-line re-export made redundant by `runtime/index.ts` | delete after callers point at `@/runtime` |
| any `index.ts` barrels left empty after moves | — | delete |

**Not dead — do not touch:** everything under `features/workspace/rightWorkspace/`,
`cliBridges/`, `daemon/`, `mcp-servers/`, `vendor/`.
