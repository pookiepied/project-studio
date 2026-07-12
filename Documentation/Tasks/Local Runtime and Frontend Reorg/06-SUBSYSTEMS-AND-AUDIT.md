# 06 — Subsystem Inventory, Interconnections & Audit

This document answers three questions the reorg must get right:
1. **What subsystems exist**, and where each one lives after the reorg.
2. **How they share code** (import direction, cross-cutting hubs) — so we import from
   one home instead of inlining or duplicating.
3. **What's actually wrong today** (bugs + structural risks found while verifying).

All findings below were read from source, not assumed.

---

## 1. Subsystem inventory

`STUDIO/src/` is ~15 real subsystems across three tiers. Tier = import layer (imports
flow **downward only**: `app → features → {runtime, core} → {types, ui, lib, design}`).

### Tier 1 — App shell (`app/`)
| # | Subsystem | Home | Owns |
|---|---|---|---|
| 1 | **App shell / bootstrap** | `app/` | entry, providers, router, window shell, global mount-once components (shortcuts, tray/island, overlay window) |

### Tier 2 — Features (`features/`)
| # | Subsystem | Home | Owns |
|---|---|---|---|
| 2 | **Chat** | `features/chat/` | conversation UI + turn orchestration + streaming + conversation persistence + attachments. The central composer of everything else. |
| 3 | **Models** | `features/models/` | model library, selection, provider status (Ollama/LM Studio), capability/usage |
| 4 | **Voice & Transcription** | `features/voice/`, `features/transcription/` | recording, TTS, live session, Faster-Whisper |
| 5 | **Extensions** | `features/extensions/` | MCP-server marketplace + Composio connectors (consumes the MCP Registry) |
| 6 | **Workspace** | `features/workspace/` | right-side panels: browser, terminal, side chat, project launcher/apps |
| 7 | **Artifacts + Markdown** | `features/artifacts/`, `features/markdown/` | code/doc/artifact rendering, renderers |
| 8 | **Memories** | `features/memories/` | memory graph UI |
| 9 | **Permissions (UI)** | `features/permissions/` | approval cards, permission notifications (consumes the engine in Tier 3) |
| 10 | **Settings / Activity / Auth** | `features/settings/`, `features/activity/`, `features/auth/` | config UI, health/log dashboard, sign-in |

### Tier 3 — Runtime & Core (infrastructure)
| # | Subsystem | Home | Owns |
|---|---|---|---|
| 11 | **Local Runtime** ⭐ | `runtime/` | cloud-driven local execution: process lifecycle, WS transport, invoke contract, permission-gated execution, tool-card UI. **The task's headline subsystem.** |
| 12 | **Permissions (engine)** | `core/permissions/` | tool-call authorization: allow/prompt/deny, risk classes, grant scopes, path scoping. **Cross-cutting** — consumed by runtime + chat + settings + home. |
| 13 | **Connection Manager** | `core/connection/` | cross-cutting event hub: WS/tool/MCP status events, retry registration. **Cross-cutting** — emitted to by runtime, consumed by UI. |
| 14 | **MCP Registry** | `core/mcpRegistry/` | REST client to the cloud MCP-registry worker. **Shared** by runtime (manifest sync) and Extensions (browse/install). |
| 15 | **Daemon / Local Models** | `core/daemon/` | HTTP/SSE client to the local LLM proxy (`STUDIO/daemon/`). **Not** the runtime — different transport, different purpose (D-10). |
| 16 | **Platform / Storage / Network / Errors / Notifications** | `core/*` | tray, overlay, autostart, shortcuts; unified/secure/conversation storage; apiManager + fallback; diagnostics; toasts/bell |

**Out of scope (do not touch):** **CLI Bridge** (`cliBridges/`), **Skills** deploy
(`core/skills/`), the bundled MCP servers (`library/mcp-servers/`), `vendor/`, `daemon/` server
code itself.

---

## 2. How subsystems share code (the "import, don't inline" map)

The whole point of the reorg is that shared logic has **one home** and everyone
**imports** it. These are the cross-cutting hubs and exactly who depends on them
(verified by grep):

### Hub: Permissions engine (`core/permissions/`)
Consumed by **12 files** across 4 subsystems:
- Runtime: `runtime/execution/executeLocalTools.ts` (the gate itself)
- Chat: `ChatPage`, `ChatComposer`, `PermissionModeSelector`, `ProjectContextPicker`,
  `ChatProvider`, `buildChatBody`, `context/types`
- Permissions UI: `ComposerApprovalCard`, `usePermissionNotifications`
- Settings/Home: `PermissionsView`, `HomePage`
→ **This is why the engine belongs in `core/`, not inside any feature.** Today it is
split across `permissions/` (engine) + `features/permissions/` (UI); the reorg unifies
the engine in `core/permissions/` and leaves only UI in the feature.

### Hub: Connection Manager (`core/connection/`)
Emitted to by the runtime (`wsPool`, `executeLocalTools`, `useRuntimeInit`) for every
WS/tool/MCP status change; consumed by chat + app UI for retry/toasts. It is the
decoupling layer that lets the UI observe runtime health **without importing the
runtime's internals** — keep it that way.

### Hub: MCP Registry (`core/mcpRegistry/`)
Verified importers: `features/extensions/{ManagePanel, ServerBrowseCards, useMcpServers}`,
`features/chat/hooks/useAtMention`, and the runtime's `manifestSync`. Shared → `core/`.

### Hub: Shared message DTOs (`src/types/chat.ts`) — D-9
`LocalToolCall`, `ToolResultItem`, `AutoRoutedInfo`, `APIChatMessage` are used by both
runtime and chat. They sit in the neutral leaf so neither layer imports "upward."

### Runtime's public contract (`runtime/protocol.ts` + `runtime/index.ts`)
Chat talks to the runtime **only** through `@/runtime` — `useAgentChat`, `wsPool`,
`executeLocalTools`, `buildChatBody`, the tool-card UI, and the protocol types. No
feature deep-imports a runtime internal. That barrel *is* the subsystem boundary.

### The two transports (do not conflate)
- **Cloud agent** ⇄ **Local Runtime**: **WebSocket** (`wsPool` ↔ `chat/` DO). Carries
  `local_tools_pending` / `tool_results`.
- **Local models** ⇄ **Daemon**: **HTTP + SSE** (`daemonClient` → `http://localhost`).
  Carries `/v1/chat/completions`. **No WebSocket** (D-10).

### Dependency sketch
```
                 app/  (wires everything)
                   │
        ┌──────────┴───────────┐
     features/chat        other features
        │   │  │                 │
        │   │  └── @/runtime ─────┼──────────┐
        │   └────── @/core/permissions       │
        │            @/core/connection       │
        │            @/core/storage          ▼
        │                              runtime/ (WS ⇄ cloud)
        └── @/core/daemon (HTTP/SSE ⇄ local models)
                   │
   runtime/ & core/ ──► @/types, @/ui, @/lib, @/design   (leaves)
```

---

## 3. Audit — bugs & structural risks found

Severity: 🔴 correctness risk · 🟠 structural/maintainability · 🟡 minor. Each is
**flagged, not fixed** here unless the reorg naturally resolves it (marked *resolved-by-reorg*).

| # | Sev | Finding | Evidence | Disposition |
|---|---|---|---|---|
| B1 | 🔴 | **WS protocol is hand-duplicated in 3 places** (`chat/…/ChatAgent.ts`, `wsPool.ts`, `useAgentChat.ts`) with no shared type. A live symptom already exists: `wsPool` swallows `"Unknown message type"` errors from older backends that don't recognise the keepalive `ping`. | `wsPool.ts` ~L472 comment + guard | ✅ **DONE** — `runtime/protocol.ts` is the single source; cross-ref comment in `ChatAgent.ts:97`. **Post-Phase-1 follow-up:** the Phase 1 pass left `PoolConnectionStatus` declared *twice* (protocol.ts + wsPool.ts, byte-identical — `tsc` cannot catch a structurally identical duplicate). Now imported from `../protocol`. |
| B2 | 🟠 | **Latent cross-layer cycle**: `wsPool` imports `ChatRequestBody`/`AgentChatHandlers` from `hooks/useAgentChat`. Naive reorg makes `runtime → features`. | grep confirmed 3 importers | *resolved-by-reorg*: D-9 moves those types to `runtime/protocol.ts` + `src/types/`. |
| B3 | 🟠 | **`mcpService` is dual-purpose** (local manifest sync **and** Extensions marketplace) but sits under `services/ai/`, coupling two subsystems through an accidental location. | grep: 5 distinct importers | *resolved-by-reorg*: → `core/mcpRegistry/` (D-9). |
| B4 | 🟡 | **Local-model streaming can't call tools**: daemon streaming branch is explicitly `tool calls not supported in streaming mode yet`. So a local model in stream mode silently loses tool use. | `daemon/src/routes/chat.ts` L46 | ✅ **FIXED** — streaming now runs the same tool loop (assembles `delta.tool_calls`, executes, continues on the same response stream). Also fixed an unbuffered SSE split that dropped frames straddling a chunk boundary. Regression test: `daemon/test/chat.stream.test.cjs` (`npm test`). |
| B5 | 🟠 | **Manifest sync is best-effort/racy**: `syncLocalMcpManifest` retries once after 4s then gives up with "KV manifest may be stale until next launch." Cloud can hold a stale local-tool list → the agent may call a tool the manifest no longer matches. | `localMcpControl.ts` L137-161 | ✅ **FIXED** in `runtime/servers/manifestSync.ts`: bounded exponential backoff w/ jitter, a deferred queue drained on `ws:reconnected`, in-flight de-duplication, and an order-insensitive content version stamp that skips redundant pushes. |
| B6 | 🟠 | **Permission engine split across two trees** (`permissions/` + `features/permissions/`), consumed by 12 files. | grep (see §2) | *resolved-by-reorg*: unify engine in `core/permissions/`. |
| B7 | 🟡 | **Platform logic split** across `services/platform/` and `infrastructure/platform/` (same concern, two folders). | file tree | *resolved-by-reorg*: merge into `core/platform/`. |
| B8 | 🟡 | **Duplicate `rightWorkspace/` location** (`components/rightWorkspace/ResizeHandle` vs the real `features/workspace/rightWorkspace/`). Functionality is NOT dead (D-6). | file tree | *resolved-by-reorg*: consolidate into the feature. |
| B9 | 🔴→🟠 | **`ChatProvider.tsx` (2079 lines)** owns the send pipeline, streaming handlers, tool orchestration, conversation state, and persistence at once. High blast-radius for any change; the tool-orchestration part is entangled with the runtime. | line count + reads | ✅ **DONE** — runtime parts left in Phase 1; Phase 5 split the rest into `runClaudeTurn` / `useStreamHandlers` / `useSendPipeline` / `useConversationActions`. Now 967 lines of state + composition. |
| B10 | 🟡 | **Repeated hard-coded 5-min timeouts** (approval, question, global-access) copy-pasted in `toolExecutor`. | `toolExecutor.ts` L268/405/470 | ✅ **DONE** — centralized in `runtime/execution/constants.ts`. |
| B11 | 🟡 | **Reconnect relies on CF fiber resume**: `wsPool` clears `lastSentBody` on done/error and does not auto-resend on reconnect, trusting the Durable Object fiber to still be running. If the DO evicted, a mid-turn reconnect yields no resume. | `wsPool.ts` onopen/onclose | Flag as a known runtime edge; document in `runtime/transport/`. No change now. |

**Note on scope:** B4 and B5 were originally deferred as out-of-scope for the
structure-only reorg. They have since been fixed on request, in their own commits,
*after* the structural phases landed — see their rows above. B11 remains a known,
documented edge. Everything marked *resolved-by-reorg* is handled by executing
docs 04–05 as written.

**Audit status:** B1 ✅ · B2 ✅ · B3 ✅ · B4 ✅ · B5 ✅ · B6 ✅ · B7 ✅ · B8 ✅ ·
B9 ✅ · B10 ✅ · B11 documented (no change).

---

## 4. What "done" looks like for the subsystem structure

- Every subsystem in §1 has exactly **one** home folder; nothing is split across two
  trees (B6/B7/B8 gone).
- Every cross-cutting hub in §2 is imported from its single home — **zero inlined or
  duplicated** copies of permission logic, connection events, registry calls, or wire
  types.
- The Local Runtime exposes **one barrel** (`@/runtime`); no feature deep-imports its
  internals.
- Import direction is strictly downward (a lint rule can enforce later — deferred, D-8).
- The two transports remain clearly separated (runtime = WS, daemon = HTTP/SSE).
