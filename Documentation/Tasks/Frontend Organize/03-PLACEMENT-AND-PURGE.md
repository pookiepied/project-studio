# 03 — Placement Map, Purge List & Caveats

## Current → target

| Current location | Target | Notes |
|---|---|---|
| `services/ai/` (loop parts: chat/stream orchestration) | `ai/studio/` | The pieces that become the loop core. Refactor into a portable core is **separate later work** — reorg just stages the home. |
| `services/ai/` (gateway/model/api clients) | `infrastructure/gateway/` + `infrastructure/api/` | **Thin clients only.** Strip provider-selection logic (see purge). |
| `services/ai/mcpService.ts` | `infrastructure/mcp/` | |
| `cliBridges/` + `services/ai/claudeBridgeService.ts` | `ai/claude-code/` | **Mechanical relocation, no logic edits.** |
| `services/errors/` | `systems/errors/` | |
| `services/logging/` | `systems/logging/` | |
| `services/notifications/` | `systems/notifications/` | |
| `permissions/` (top-level, 9 files) | `systems/permissions/` | Chat permission-UI cards stay in `features/chat`. |
| (new) domain ownership + handoff policy | `systems/domain/` | New home for cloud/local ownership logic. |
| `services/storage/` | `infrastructure/storage/` | |
| `services/platform/` | `infrastructure/platform/` | `studioPaths.ts` already lives here — first step taken. |
| `services/files/` | `infrastructure/files/` | |
| `services/network/`, `services/connection/` | `infrastructure/network/` | |
| `services/auth/` | `infrastructure/auth/` | |
| `services/skills/` | `infrastructure/skills/` | App-bootstrap bundled-skill deployment. |
| `services/local/`, `services/localCapabilities/` | `infrastructure/local/` | **Daemon client removed** (see purge). |
| `services/conversations/` | `infrastructure/storage/` (or `features/chat` long-term) | Consumes `infrastructure/platform` paths. |
| `contexts/` (global: Auth, Settings, Navigation, Offline, CommandPalette) | `app/providers/` | |
| `contexts/` (scoped: Artifact, Browser, LiveSession, Recording) | their `features/` | |
| `components/` (primitives) | `shared/ui/` | |
| `components/layout/` | `shared/layout/` | |
| `shell`/window chrome (`TitleBar`, overlays, `FloatingIsland`) | `shell/` | |
| `hooks/`, `utils/`, `types/`, `constants/` | `shared/` | `utils/` must stay JSX-free. |
| `config/` (autoMode, tauriConfig) | `app/config/` | |
| `artifacts/examples.ts` | `features/artifacts/` | |
| `tokens/tokens.css`, `styles/typography.css`, `styles/fonts.ts` | `design/` | |

## Purge list — delete / thin on the way through

Do **not** carry these into the new tree alive:

1. **Daemon (retired by architecture).** `services/ai/daemonService.ts`,
   `services/local/daemonClient.ts`, `hooks/useDaemon.ts`, and the daemon paths in
   `services/local/index.ts`. ~15 files reference `daemon` — each gets rewritten
   against the loop or deleted. Live UI touchpoints to rewire:
   `components/LMStudioStatus.tsx`, `components/LocalProviderStatus.tsx`,
   `features/models/context/useModels.ts`, `services/ai/localUsageService.ts`,
   `services/ai/mediaService.ts`, `services/ai/sseStream.ts`,
   `services/ai/chatService.ts`, `services/ai/aiService.ts`.
2. **Legacy SSE chat path.** `services/ai/sseStream.ts` + `aiService.chatStream`.
   `chatService.ts`'s own header calls it "legacy" — superseded by the loop's
   streaming (WebSocket to DO / in-process locally).
3. **Provider-selection guts.** The selection/routing logic inside
   `services/ai/model*` (`modelService`, `modelFilter`, `modelCapabilityService`,
   `localModelDetection`, `ollamaService`). Provider selection is the **gateway
   worker's** job. What remains in the frontend is a thin catalog/display client.
4. **Empty dead dir.** `services/browser/` (0 files).

## Migration caveats (learned the hard way — see revamp D-606)

- **Phase 4 COPIED, not moved.** Some trees were duplicated, leaving byte-for-byte
  dead orphans that still lint and can be edited by mistake. A batch was deleted
  2026-07-07. **Expect more.** Before deleting a suspected orphan, confirm no
  imports reference it.
- **Path-string grep misses relative imports.** `grep "fasterWhisper"` found the
  symbol but not `import … from "../fasterWhisper"`. **Always `tsc --noEmit`
  after any delete** — it's the only reliable catch.
- **Dual-build gate.** After each slice: `tsc --noEmit` clean, `npm run build`
  (desktop) green, `npm run web:build` (web) green, no new ESLint warnings.
