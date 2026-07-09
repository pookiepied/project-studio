# 03 — Target Structure

The finished shape. Doc 04 is the file-by-file map to get here; doc 05 is the order.
This document is the destination you are aiming at.

---

## 1. Top-level `STUDIO/src/`

```
src/
  main.tsx                     ← entry (stays at root; Vite/index.html points here)
  index.css                    ← global stylesheet root (stays at root)
  vite-env.d.ts

  app/                         ← BOOTSTRAP ONLY — no feature logic
    App.tsx                    ← decides which tree to mount (was src/App.tsx)
    AppProviders.tsx           ← NEW: the provider nest extracted from App.tsx
    AppRouter.tsx              ← NEW: routing extracted from App.tsx
    routes/                    ← routing targets that are not "features"
      HomePage.tsx
      OverlayPage.tsx
      ShaderWelcomePage.tsx
      ProfilePage.tsx
      ProjectsPage.tsx
      AuthCallback.tsx
    shell/                     ← was src/shell/ (window chrome)
    contexts/                  ← was src/contexts/ (global React contexts)
    globals/                   ← app-wide mount-once components
      GlobalShortcutHandler.tsx
      GlobalContextEvents.tsx
      ConditionalFeatures.tsx
      OfflineIndicator.tsx

  runtime/                     ← THE LOCAL RUNTIME (see §2)

  features/                    ← one folder per product feature (see §3)

  ui/                          ← shared PRESENTATIONAL primitives only
    ui/                        ← was components/ui/*  (Button, Input, Badge, …)
    brand/                     ← was components/brand/*
    icons/                     ← was components/icons/*
    feedback/                  ← was components/feedback/* (Splash, Offline, Update…)
    overlays/                  ← was components/overlays/* (CommandPalette, FloatingIsland…)
    layout/                    ← was components/layout/* (MainLayout, TitleBar, NavPopup…)
    notifications/             ← was components/notifications/*

  core/                        ← cross-cutting infrastructure services
    storage/                   ← was services/storage/*  (+ services/web/* folded in)
    network/                   ← was services/network/*
    errors/                    ← was services/errors/*
    logging/                   ← was services/logging/*
    platform/                  ← was services/platform/* + infrastructure/platform/*
    notifications/             ← was services/notifications/*
    connection/                ← was services/connection/*
    daemon/                    ← was services/local/daemonClient.ts + hooks/useDaemon.ts
    skills/                    ← was services/skills/*
    config/                    ← was src/config/ + src/constants/

  lib/                         ← pure helpers (was src/utils/) + truly-global hooks
    hooks/                     ← useDebounce, useOnClickOutside, useAutoResizeTextarea…

  design/                      ← was src/styles/ + src/tokens/ (+ fonts)
  types/                       ← global shared types (was src/types/)
  assets/                      ← unchanged
```

**Removed top-level folders after migration:** `components/`, `services/`,
`contexts/`, `hooks/`, `infrastructure/`, `permissions/`, `pages/`, `shell/`,
`styles/`, `tokens/`, `utils/`, `constants/`, `config/`, `conversations/`
(their contents are redistributed above and in §3).

> `cliBridges/` stays exactly where it is (D-2). It is intentionally absent from the
> move map.

---

## 2. The `runtime/` module (the whole point of the task)

```
runtime/
  index.ts                     ← the ONLY public entry other code imports (barrel)
  protocol.ts                  ← NEW: the runtime's public contract — WS envelope
                                  types (start / tool_results / local_tools_pending /
                                  done / stream / error) + ChatRequestBody +
                                  AgentChatHandlers + PoolConnectionStatus. Today these
                                  are hand-duplicated in ChatAgent.ts AND wsPool.ts AND
                                  useAgentChat.ts — this is the single source of truth.
                                  (Neutral message DTOs LocalToolCall/ToolResultItem/
                                  AutoRoutedInfo/APIChatMessage live in src/types/ so
                                  both runtime and chat import them downward — D-9.)

  servers/
    catalog.ts                 ← LOCAL_MCP_SERVERS defs + read/set permission
                                  (from services/local/localMcpControl.ts)
    lifecycle.ts               ← start / stop / health-check / auto-restart, no React
                                  (extracted from hooks/useHarnessInit.ts)
    manifestSync.ts            ← runtime's use of the registry: push local tool
                                  manifests to the cloud. Calls core/mcpRegistry.
                                  NOTE: the registry REST client itself (mcpService.ts)
                                  is dual-use (runtime + Extensions marketplace) so it
                                  lives in core/mcpRegistry/, NOT here — D-9/§3.
    manifest.ts                ← mcp_get_tools + syncManifest
                                  (from services/local/localMcpControl.ts)
    useRuntimeInit.ts          ← thin React wrapper over lifecycle
                                  (was hooks/useHarnessInit.ts; keeps the modal state)

  transport/
    wsPool.ts                  ← from services/conversations/wsPool.ts
    wsMessages.ts              ← from services/conversations/wsMessages.ts
    useAgentChat.ts            ← from hooks/useAgentChat.ts (React driver over wsPool;
                                  it is runtime glue, NOT chat logic — D-9)

  invoke/
    invokeMcpTool.ts           ← Tauri invoke contract w/ timeouts + retries
                                  (from services/mcp/mcpInvoker.ts)

  execution/
    executeLocalTools.ts       ← the executor loop + permission gate
                                  (from features/chat/context/toolExecutor.ts)
    workspaceDefaults.ts       ← NEW: extracted applyWorkspaceDefaults()
    builtinTools.ts            ← NEW: extracted task_write / get_location /
                                  ask_user_question inline handlers

  capabilities/
    capabilityService.ts       ← what's running / capability reporting
                                  (from services/localCapabilities/*)
    buildChatBody.ts           ← running_mcp_servers + local_engine_connected
                                  (from features/chat/context/buildChatRequest.ts)

  ui/
    toolCardRegistry.tsx       ← was features/chat/tools/mcpRegistry.tsx
    classifyToolDisplay.ts     ← was features/chat/context/toolClassifier.ts
    ToolPermissionCard.tsx     ← was features/chat/tools/ToolPermissionCard.tsx
    RuntimeStepCard.tsx        ← was features/chat/tools/HarnessStepCard.tsx (renamed)
    InlineToolSteps.tsx        ← was features/chat/tools/InlineToolSteps.tsx
    toolCardUtils.tsx          ← was features/chat/tools/toolCardUtils.tsx
```

### `runtime/index.ts` public surface (what the rest of the app is allowed to use)

Everything else imports **only** from `@/runtime`. Suggested exports:

- Lifecycle / init: `useRuntimeInit`, `startLocalMcp`, `stopLocalMcp`,
  `LOCAL_MCP_SERVERS`, `getLocalMcpServer`, permission read/set helpers.
- Turn plumbing: `wsPool`, `buildChatBody`, `getMcpServers`.
- Execution: `executeLocalTools` (+ its callback/result types).
- Invoke primitives: `invokeMcpTool`, `formatMcpError`, `truncateMcpOutput`,
  `extractMcpImages`.
- UI: `toolCardRegistry`, `classifyToolDisplay`, the card components.
- Types: everything from `protocol.ts`.

**Rule:** no file outside `runtime/` may deep-import a `runtime/**` internal path.
They import the barrel. This is what makes it "a subsystem" instead of "a dozen
files."

### Rust + cloud symmetry (optional / documentation)

- **Optional:** rename `src-tauri/src/mcp.rs` → `src-tauri/src/runtime.rs` (update
  `mod` declaration + `#[tauri::command]` registration). Cosmetic; do only if cheap.
- **Do not** restructure the cloud Worker here. Just add a one-line comment in
  `chat/src/agent/ChatAgent.ts` noting the protocol is mirrored in
  `STUDIO/src/runtime/protocol.ts` so the two stay in sync.

---

## 3. `features/` after migration

Keep the existing feature folders. Net changes:

| Feature | Change |
|---|---|
| `features/auth/` | **NEW.** Pull auth out of `services/auth/*`, `contexts/AuthContext.tsx`, and the loose `components/AuthControls.tsx` / `GoogleLoginButton.tsx`. |
| `features/chat/` | Absorbs `services/conversations/*` (claude adapter, storage, ownership, preferences → `features/chat/conversations/`) and `services/files/*` + `services/inputs/*` (→ `features/chat/attachments/`). **Sheds** all runtime glue: `toolExecutor`, `toolClassifier`, `tools/*`, `buildChatRequest` → `runtime/`. Splits `ChatProvider.tsx` (doc 04 §Monoliths). |
| `features/models/` | Absorbs loose model UI from `components/` (`ModelPicker`, `TierSelector`, `ProviderIcon`, `OllamaStatus`, `LMStudioStatus`, `LocalProviderStatus`) and the model services from `services/ai/*` (`modelService`, `modelFilter`, `modelCapabilityService`, `localModelDetection`, `ollamaService`, `localUsageService`, `useOllama`). |
| `features/voice/` | Absorbs `components/VoiceInput.tsx`, `components/AudioWaveform.tsx`, `hooks/useAudioRecorder.ts`, `hooks/useVoiceInput.ts`, `hooks/useTTS.ts`, `hooks/useLiveSession.ts`. |
| `features/permissions/` | **Merge** the top-level `permissions/` engine into this feature (or keep engine in `core/permissions/` if preferred — see doc 04 note). Pick one home; do not leave it split. |
| `features/workspace/` | Absorbs `components/rightWorkspace/ResizeHandle.tsx` (D-6). |
| `features/extensions/` | Absorbs `services/extensions/appIconCache.ts`. |

Each feature folder keeps its internal `components/`, `hooks/`, `services/`,
`context/`, `types.ts`, and `index.ts` barrel. Cross-feature imports go through the
feature's `index.ts`, never deep paths.

---

## 4. Import-alias reference (target)

`tsconfig` + Vite already resolve `@/*` → `src/*`. After migration the canonical
imports are:

```
@/app/...        @/runtime        @/features/<name>
@/ui/...         @/core/...        @/lib/...
@/design/...     @/types/...
```

`@/runtime` (barrel) is the **only** allowed runtime import path.
