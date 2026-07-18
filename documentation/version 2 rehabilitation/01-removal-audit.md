# Version 2 Rehabilitation: Removal Audit

Evidence pass: 2026-07-18
Current checkpoint inspected: `d6ed7bb docs: refresh studio checkpoint guidance`
Scope: `STUDIO/` desktop/frontend tree, with supporting references from `docs/architecture/` and `documentation/`.

This audit is the first Version 2 pass for retiring the old Desktop-local runtime
and relay direction in favor of this product model:

- Studio Web owns cloud-first execution through cloud runtimes, Context Engine,
  Tool Pool, Tool Execution, Registry, Studio Data, Gateway, connectors, agents,
  skills, and cloud MCP/native tools.
- Studio CLI owns local workspace execution, local repo/files/terminal/git
  authority, local session mechanics, local coding tools, and headless local
  agent operation.
- Studio Desktop owns the native shell, account/session UX, cloud service access,
  Studio CLI orchestration, local review/visibility surfaces, and product UI.

This document is not a deletion patch. Every removal candidate below still needs
a second verification pass before any source deletion.

## Removal Principle

Remove code when it belongs to one of these old assumptions:

1. Desktop runs its own local agent runtime.
2. Desktop owns local MCP lifecycle as the local execution substrate.
3. Desktop owns local coding transcript/session storage separately from Studio
   CLI.
4. Desktop exposes generic third-party CLI engines as first-class chat engines.
5. Desktop duplicates direct file, shell, browser, and git execution that Studio
   CLI should own.

Keep or migrate code when it supports the new Desktop role:

1. Native shell, windows, auth, settings, update, account, and cloud service UX.
2. Studio CLI launch, headless protocol, streaming, session selection, and event
   display.
3. Cloud chat/workspace access where Desktop is a client of Studio Cloud.
4. Review/diff/side-chat surfaces that consume Studio CLI or cloud events.
5. Computer-use/native tools as backup/source material for Studio CLI MCP/tooling.

## Executive Removal List

| Area | Current path(s) | Current role | V2 action |
| --- | --- | --- | --- |
| Desktop Local Runtime barrel | `STUDIO/src/runtime/**` | Public Local Runtime subsystem: WebSocket pool, local MCP lifecycle, local tool execution, chat body builder, runtime UI cards. | Replace with narrower `studio-cli` and cloud-client adapters; remove local-runtime execution once callers migrate. |
| Local MCP server catalogue/lifecycle | `STUDIO/src/runtime/servers/**`, `STUDIO/src-tauri/src/mcp.rs`, Tauri bundle resources | Starts bundled MCP subprocesses and exposes tools to chat/runtime. | Retire as Desktop execution substrate. Keep only if Studio CLI needs temporary compatibility or computer-use backup. |
| Bundled Studio Harness | `STUDIO/library/mcp-servers/harness/studio-harness/**` | Local coding/file/git/shell MCP server, now overlapping with OpenCode/Studio CLI. | Backup/reference first, then remove from Desktop bundle after Studio CLI owns local coding tools. |
| System MCP management packages | `STUDIO/library/mcp-servers/system/{mcp-management,skill-management,skill-execution}/**` | Desktop-local MCP/skill management/execution tooling. | Remove from Desktop bundle if Studio CLI/cloud registry owns MCP/skills. Migrate useful schemas/actions to Studio CLI or cloud workers. |
| Generic/Claude chat CLI bridge | `STUDIO/src/cliBridges/**`, `claude_bridge_*` in `STUDIO/src-tauri/src/commands.rs`, chat Claude state | Makes Claude Code a first-class chat engine beside Studio. | Replace with Studio CLI as the only first-class local chat/workspace engine. Keep generic terminal launch only outside chat engine flow. |
| Generic CLI tool tabs | `STUDIO/src/features/chat/cliTabs/**`, `STUDIO/src/features/workspace/terminal/CliTerminal.tsx` | Launches Claude, Codex, OpenCode, and terminal programs through PTY. | Do not keep as chat-engine bridge. Either remove or downgrade to advanced terminal/agent-runner surface. Studio CLI gets native first-class support. |
| Local conversation store | `STUDIO/src/features/chat/conversations/storage/**`, local branches in `chatHistoryService.ts` | Writes local conversation index, snapshot JSON, messages JSONL, and transcript Markdown. | Remove/migrate after Studio CLI session store/headless protocol becomes source of truth for local workspace history. |
| Claude transcript adapter | `STUDIO/src/features/chat/conversations/claude/**` | Reads Claude Code transcript files as native conversations. | Remove if Claude is no longer a first-class chat engine. Keep only as one-time import/migration tool if desired. |
| Chat engine selector/state | `EngineSelector.tsx`, `useChatEngineState.ts`, Claude metadata in chat types, permission engine config | Selects `studio` vs `claude`, stores Claude model/session/permission metadata. | Replace with source-of-truth model: cloud conversation vs local Studio CLI workspace. Avoid generic provider dropdown. |
| Direct local tool executor | `STUDIO/src/runtime/execution/**`, `invokeMcpTool.ts`, DSML continuation local execution | Executes builtin and MCP tools inside Desktop runtime. | Remove after Studio CLI/cloud runtimes own tool execution. Desktop should display tool events and request approvals, not execute agent tools itself. |
| Native browser panel | `STUDIO/src/features/workspace/browser/**`, `STUDIO/src-tauri/src/native_browser.rs` | Direct browser tab surface and child webview commands. | Product decision required. Remove if browser becomes Studio CLI/cloud tool output only; keep only if Desktop browser adds unique review/research value. |
| Direct terminal panel | `STUDIO/src/features/workspace/terminal/**`, `pty_*` commands | Full PTY terminal plus CLI runner. | Keep only as Studio CLI host/headless terminal or advanced terminal. Remove generic multi-agent terminal UX from primary product. |
| Files panel | `STUDIO/src/features/workspace/rightWorkspace/FilesPanel.tsx`, file previews, Monaco source view | Direct file browser/preview inside right workspace. | Likely replace with Studio CLI file/session output and focused review surfaces. Remove direct file manager if it duplicates CLI-owned workspace. |
| Git/review commands | `STUDIO/src-tauri/src/commands/git.rs`, `STUDIO/src/core/git/gitService.ts`, `ReviewPanel.tsx` | Direct Git branch/status/diff/stage/commit UI. | Keep review concept, but decide owner. Prefer Studio CLI for repo authority; Desktop may keep review UI over CLI/git events. |
| Local provider daemon | `STUDIO/daemon/**`, `local_provider_*` commands, local-provider hooks | Local Ollama/LM Studio provider bridge. | Likely remove from Desktop if local LLM/provider handling moves to Studio CLI. Keep only if CLI explicitly uses the daemon or Desktop still needs local model management. |
| Old cloud/local symmetry docs | `docs/architecture/Cloud and Local*.md` | Describes bundled local runtime symmetry with cloud runtimes. | Supersede with V2 architecture docs; keep as historical reference until final V2 plan exists, then archive or delete. |

## Concrete Evidence

### 1. `src/runtime` Is A Real Local Runtime, Not Just UI

Evidence:

- `STUDIO/src/runtime/index.ts` calls itself "the Local Runtime's public barrel".
- `STUDIO/src/app/AppRouter.tsx` imports `useRuntimeInit` and displays
  `LocalCapabilitiesModal` on desktop.
- Chat code imports `buildChatBody`, `getMcpServers`, `useAgentChat`,
  `executeLocalTools`, runtime tool cards, and permission helpers from
  `@/runtime`.
- `STUDIO/src/runtime/transport/wsPool.ts` owns multi-conversation WebSocket
  pooling and reconnect behavior.
- `STUDIO/src/runtime/execution/executeLocalTools.ts` executes builtin and MCP
  tools inside the Desktop runtime.
- `STUDIO/src/runtime/servers/catalog.ts` lists `studio-harness`,
  `computer-use`, `mcp-management`, `skill-management`, and `skill-execution`.

V2 decision:

- This should not remain the local execution authority.
- The future local authority is Studio CLI.
- Desktop should keep display components only if they are renamed/reworked as
  generic run-event UI fed by Studio CLI/cloud runtime events.

Second-pass verification before removal:

1. Inventory every `@/runtime` import.
2. Split imports into UI display, cloud WebSocket transport, local MCP lifecycle,
   and local tool execution.
3. Design replacement APIs:
   - `studioCliClient`
   - `cloudRuntimeClient`
   - `runEventDisplay`
4. Remove local runtime only after chat send/stream/tool event flows use the new
   clients.

### 2. Bundled MCP Servers Are Packaged Product Surface

Evidence:

- `STUDIO/src-tauri/tauri.conf.json` bundles:
  - `library/mcp-servers/harness/studio-harness/dist`
  - `library/mcp-servers/harness/studio-harness/node_modules`
  - `library/mcp-servers/desktop/computer-use/dist`
  - `library/mcp-servers/desktop/computer-use/node_modules`
  - `library/mcp-servers/system/mcp-management/dist`
  - `library/mcp-servers/system/skill-management/dist`
  - `library/mcp-servers/system/skill-execution/dist`
- `STUDIO/scripts/mcp-build.mjs` builds all five MCP packages before Tauri
  build.
- `STUDIO/src-tauri/src/mcp.rs` starts, stops, lists, and calls local MCP
  subprocesses, and resolves bundled server paths.
- `STUDIO/src/runtime/servers/catalog.ts` exposes those bundled servers to
  runtime lifecycle and permission logic.

V2 decision:

- Remove bundled MCP server execution from Desktop after Studio CLI owns local
  coding/tool execution.
- Keep `computer-use` as backup/source material. It may move into Studio CLI or
  into a separate native-tool package.
- Do not delete package folders first. First remove Desktop runtime dependency,
  then Tauri resources, then build script entries, then package folders.

Second-pass verification before removal:

1. Check Tauri resources.
2. Check `mcp-build.mjs`.
3. Check Rust `mcp.rs` command registration in `src-tauri/src/lib.rs`.
4. Check runtime catalog and Settings UI.
5. Build after each severing step.

### 3. Generic CLI Bridge Is Actually Claude-Specific

Evidence:

- `STUDIO/src/cliBridges/types.ts` defines `ChatEngine = "studio" | "claude"`.
- `STUDIO/src/cliBridges/claude/**` owns Claude account/model/effort command
  logic.
- `STUDIO/src-tauri/src/commands.rs` defines `claude_bridge_start` and
  `claude_bridge_stop`, spawning the `claude` executable.
- `ChatProvider`, `useSendPipeline`, `useChatEngineState`,
  `runClaudeTurn.ts`, `EngineSelector.tsx`, `PermissionModeSelector.tsx`, and
  chat types all carry Claude-specific state.
- `STUDIO/src/features/workspace/terminal/CliTerminal.tsx` separately launches
  terminal programs and labels non-OpenCode sessions as `"cli-bridge"`.

V2 decision:

- Do not keep Claude/Codex/OpenCode as equal chat engines.
- Keep a generic "run external terminal tool" capability only if it is useful
  as an advanced workspace utility.
- Make Studio CLI the only first-class local chat/workspace engine.
- If other agents need to run, expose them through Studio CLI or a separate
  agent-runner surface, not the main chat engine selector.

Answer to the user's specific CLI question:

- Native Studio CLI support should matter most.
- The generic CLI bridge should not stay in the chat engine path.
- A generic terminal/agent-runner can stay as a secondary tool, but it should not
  decide conversation ownership, transcript format, permission mode, or local
  workspace authority.

Second-pass verification before removal:

1. Replace `ChatEngine` with a V2 concept such as `ConversationAuthority` or
   `WorkspaceAuthority`.
2. Remove Claude-specific metadata only after migration/import story is decided.
3. Remove Tauri `claude_bridge_*` commands after all frontend call sites are
   gone.
4. Keep `CliTerminal` only if it becomes a generic terminal, not a chat engine.

### 4. Local Conversation Storage Conflicts With Studio CLI Authority

Evidence:

- `STUDIO/src/features/chat/conversations/storage/localConversationStore.ts`
  writes local conversation index, snapshots, message JSONL, and transcript
  Markdown.
- `chatHistoryService.ts` routes `scope === "local"` through
  `localConversationStore`.
- Chat state uses `conversationStorageScope` to switch local/cloud behavior.
- Claude transcript adapter reads Claude Code transcript files separately.
- `unifiedStorageService.ts` has cloud chat enablement and emits
  `studio:storage-ready`, while local conversation files are a separate path.

V2 decision:

- Studio CLI should own local session and transcript mechanics.
- Desktop can render/import/index local sessions, but should not invent a
  separate local transcript format if Studio CLI has one.
- Cloud conversations remain Studio Data/cloud-owned.

Second-pass verification before removal:

1. Define Studio CLI session storage protocol and query/import API.
2. Map local conversation history UI to Studio CLI sessions.
3. Add one-time migration/import only if existing local conversations matter.
4. Remove local store only after the UI no longer depends on it.

### 5. Workspace Right Panel Contains Several Products At Once

Evidence:

- `STUDIO/src/features/workspace/rightWorkspace/RightWorkspacePanel.tsx`
  switches between browser, terminal, files, review, side-chat, artifacts, and
  conversation workspace.
- `BrowserPanel.tsx` and `nativeBrowserService.ts` talk to Tauri native browser
  child webviews.
- `TerminalPanel.tsx` and `CliTerminal.tsx` talk to PTY commands.
- `FilesPanel.tsx`, Monaco preview, and Markdown preview implement direct file
  browsing/preview.
- `ReviewPanel.tsx` talks to direct Git command services.

V2 decision:

- Keep right workspace as a product surface, but remove generic tool-pane
  sprawl.
- Prefer surfaces that expose Studio CLI/cloud run state:
  - local run/session
  - review/diff
  - side chat
  - artifacts/results
  - maybe browser only if it has unique product value
- Browser/files/terminal should not all remain as first-class default panels if
  Studio CLI owns local workspace operation.

Second-pass verification before removal:

1. Decide final right-panel surface list.
2. Map each current panel to keep/remove/rebuild.
3. Remove panels only after navigation/tab state and shortcuts are updated.
4. Keep Git review UI if it becomes a view over Studio CLI/git events.

### 6. Tauri Native Commands Need Inventory Before Deletion

Evidence:

- `STUDIO/src-tauri/src/lib.rs` registers commands for app readiness, Git,
  Claude bridge, MCP, local registry, local control server, local provider,
  PTY, and native browser.
- `STUDIO/src-tauri/src/commands.rs` also contains local-provider daemon
  commands.
- `STUDIO/src-tauri/src/commands/git.rs` supports Git UI.
- `STUDIO/src-tauri/src/pty.rs` supports terminal/CLI panes.
- `STUDIO/src-tauri/src/native_browser.rs` supports native browser panes.
- `STUDIO/src-tauri/src/local_registry.rs` and `control_server.rs` support
  local MCP/skill registry and local control API.

V2 decision:

- Do not delete Tauri broadly.
- Remove command families only after their frontend surfaces or Studio CLI
  replacement paths are ready.
- Likely future command families:
  - keep: app shell, auth/storage/file dialogs, updater, secure storage
  - migrate/remove: Claude bridge
  - migrate/remove: MCP subprocess management
  - maybe keep: PTY only as Studio CLI host
  - maybe remove: native browser if browser panel is retired
  - maybe keep/rework: Git only if Desktop review stays direct

Second-pass verification before removal:

1. Build a Rust command inventory table.
2. Map every frontend `invoke(...)` caller.
3. Remove frontend callers before Rust command deletion.
4. Run TypeScript check and Rust/Tauri check after each command-family removal.

### 7. Local Provider Daemon Is Probably Old Architecture

Evidence:

- Root `STUDIO/daemon/` is a separate local provider bridge.
- Tauri `local_provider_*` commands manage daemon lifecycle.
- Settings/local provider hooks consume it.
- The V2 direction makes Studio CLI the local execution owner and Studio Cloud
  Gateway the cloud model owner.

V2 decision:

- Candidate removal unless Studio CLI explicitly uses this daemon.
- If local model support is desired, it should likely live in Studio CLI or a
  dedicated local-provider package owned by CLI, not Desktop runtime.

Second-pass verification before removal:

1. Check all `local_provider_*` frontend callers.
2. Decide whether Studio CLI will manage Ollama/LM Studio/provider probing.
3. Remove daemon bundle/startup only after replacement is clear.

## Suggested Removal Order

Do not delete by folder size. Delete by dependency direction.

1. Freeze the V2 product contract:
   - Desktop local execution authority is Studio CLI.
   - Cloud execution authority is Studio Cloud.
   - Desktop is shell/orchestrator/UI, not local agent runtime.
2. Create a caller inventory:
   - all `@/runtime` imports
   - all `invoke("mcp_*")`
   - all `invoke("claude_bridge_*")`
   - all `invoke("pty_*")`
   - all `invoke("native_browser_*")`
   - all local conversation store imports
3. Build the Studio CLI bridge contract:
   - launch/headless mode
   - session list/read
   - send turn/stream events
   - tool-call events
   - approval requests
   - file/git/review events
   - cancellation
   - error/reconnect semantics
4. Migrate chat local workspace from Claude/local runtime to Studio CLI.
5. Remove Claude chat engine path.
6. Migrate local conversation history to Studio CLI sessions.
7. Migrate or remove local MCP runtime.
8. Remove bundled MCP resources and `mcp-build` entries.
9. Delete retired MCP packages after packaging proof.
10. Simplify right workspace panels.
11. Remove old docs that describe the superseded local-runtime symmetry.

## Not Yet Approved For Removal

These areas need product decisions before classification:

- Browser panel and native browser child webviews.
- Files panel and Monaco preview.
- Direct Git service versus Studio CLI-owned Git/review output.
- Terminal panel as generic terminal versus Studio CLI host.
- Computer-use package location.
- Local provider daemon.
- Cloud/local scope UI wording.
- Whether existing local/Claude conversation history needs migration.

## New Documentation Plan

Version 2 rehabilitation should produce three documents before deletion begins:

1. `01-removal-audit.md`
   - This document.
   - Concrete remove/keep/migrate candidates.
2. `02-target-structure-audit.md`
   - Independent target structure proposal without being constrained by the old
     rehabilitation map.
   - Should cover folder names, cloud/local/CLI separation, monolith split
     targets, reusable component boundaries, and naming conventions.
3. `03-final-rehabilitation-plan.md`
   - Combined plan that merges:
     - the original `STUDIO/docs/studio-rehabilitation-map.md`
     - this V2 removal audit
     - the V2 target structure audit
   - This becomes the action checklist for implementation slices.

After `03-final-rehabilitation-plan.md` exists, the independent structure audit
can be archived or deleted if it is fully merged. Keep the removal audit as a
separate reference because deletion decisions need their own evidence trail.

## Immediate Next Audit

The next concrete audit should be a caller inventory, not implementation:

| Inventory | Command/evidence |
| --- | --- |
| Runtime callers | `rg "@/runtime|from \"@/runtime\"|from '@/runtime'" STUDIO/src` |
| MCP command callers | `rg "mcp_" STUDIO/src STUDIO/src-tauri/src` |
| Claude bridge callers | `rg "claude_bridge|runClaude|ChatEngine|ClaudeSession" STUDIO/src STUDIO/src-tauri/src` |
| Local conversation callers | `rg "localConversation|conversationStorageScope|studio:storage-ready" STUDIO/src` |
| PTY/native browser callers | `rg "pty_|native_browser_" STUDIO/src STUDIO/src-tauri/src` |
| Tauri bundle resources | inspect `STUDIO/src-tauri/tauri.conf.json` |
| MCP build ownership | inspect `STUDIO/scripts/mcp-build.mjs` |

This inventory should produce a deletion checklist with exact dependency
blockers for each candidate path.
