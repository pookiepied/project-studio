# 01 — How It Works Today

This document is the ground-truth mental model. Everything here was read from the
source; file paths are real. Read it before touching anything.

---

## 1. The two things this task fixes

**A. The Local Runtime has no home.** There is a genuine, working subsystem that lets
the cloud agent run tools on the user's physical machine. It is spread across ~14
files in 6 unrelated directories, plus Rust, plus the cloud Worker. Nobody imports
"the runtime" — they import a dozen loosely-related pieces. This task gives it a
name and one folder.

**B. `STUDIO/src/` is half-organized.** `features/` is mostly healthy and
feature-based. But `services/` is a 19-subfolder junk drawer mixing infra with
feature logic with runtime glue; `components/` mixes shared primitives with feature
code; and there are loose top-level folders (`permissions/`, `hooks/`, `contexts/`,
`infrastructure/`) with unclear ownership. This task imposes a clean layering.

---

## 2. The Local Runtime data path (end-to-end)

The app is a **Tauri desktop app** (React front-end + Rust core). The agent loop
runs **in the cloud** (`chat/` Worker). The Local Runtime is the machinery that
connects the two so cloud-decided tool calls execute locally.

There are exactly **two bundled local MCP servers**, each a Node process built to a
single bundle:

- `studio-harness` — filesystem, shell, git, LSP, code-intel, etc.
  (`STUDIO/mcp-servers/studio-harness/`). Its running state is also the
  **connectivity signal**: when it is up, the cloud enables local-tool mode
  (`local_engine_connected = true`).
- `computer-use` — desktop automation, system settings, vision, network
  (`STUDIO/mcp-servers/computer-use/`). Separately permissioned; more sensitive.

### Step-by-step

1. **Spawn (Rust).** [`STUDIO/src-tauri/src/mcp.rs`](../../../STUDIO/src-tauri/src/mcp.rs)
   is the subprocess host. `McpManager` holds `HashMap<name, McpProcess>`, spawns
   `node <dist/index.js>` with piped stdin/stdout, performs the MCP `initialize`
   handshake, and speaks **line-delimited JSON-RPC** over the pipe. Tauri commands:
   `mcp_start_server`, `mcp_stop_server`, `mcp_call_tool`, `mcp_get_tools`,
   `mcp_list_running`, `mcp_run_setup`, plus path resolvers
   `mcp_resolve_studio_harness_server_path` / `mcp_resolve_computer_use_server_path`.
   There is a **180s hard timeout** at this layer. No HTTP, no daemon — just a pipe.

2. **Lifecycle (React).** [`hooks/useHarnessInit.ts`](../../../STUDIO/src/hooks/useHarnessInit.ts)
   is the launcher: first-run permission modal → start granted servers → 30s
   health-check loop → auto-restart on crash (also listens to Rust's
   `mcp-server-status` events). The server catalogue and the start/stop/manifest
   primitives live in [`services/local/localMcpControl.ts`](../../../STUDIO/src/services/local/localMcpControl.ts).

3. **Discovery (local → cloud).** On start, the app calls `mcp_get_tools`, then
   pushes that manifest to the cloud registry via
   [`services/ai/mcpService.ts`](../../../STUDIO/src/services/ai/mcpService.ts)
   (`syncManifest`). That is how the cloud learns which local tools exist.

4. **Turn kickoff (local → cloud).**
   [`features/chat/context/buildChatRequest.ts`](../../../STUDIO/src/features/chat/context/buildChatRequest.ts)
   reads `mcp_list_running`, filters by conversation scope, and stamps
   `running_mcp_servers` + `local_engine_connected` into the request body.
   [`services/conversations/wsPool.ts`](../../../STUDIO/src/services/conversations/wsPool.ts)
   opens `wss://…/agents/chat-agent/{convId}` and sends `{type:"start", body}`.

5. **The decision (cloud).**
   [`chat/src/agent/ChatAgent.ts`](../../../chat/src/agent/ChatAgent.ts) is a
   Durable Object running the ReAct loop.
   [`chat/src/agent/steps/tools.ts`](../../../chat/src/agent/steps/tools.ts) routes
   each tool call by `executionTarget`: `cloud` / `remote_mcp` run server-side, but
   `mcp` / `client` / `local` are collected into `pendingClientToolCalls` and emitted
   as a **`local_tools_pending`** WebSocket message. The DO then persists
   `pendingMessages` and waits.

6. **Local execution + permission gate.** `wsPool` receives `local_tools_pending` →
   `onLocalToolsPending` →
   [`features/chat/context/toolExecutor.ts`](../../../STUDIO/src/features/chat/context/toolExecutor.ts)
   (`executeLocalTools`). This runs the centralized
   [`permissions/`](../../../STUDIO/src/permissions) engine (allow / prompt / deny),
   applies workspace-path defaults, then calls
   [`services/mcp/mcpInvoker.ts`](../../../STUDIO/src/services/mcp/mcpInvoker.ts) →
   Tauri `mcp_call_tool` → Rust → the subprocess. A few "builtin" tools
   (`task_write`, `get_location`, `ask_user_question`) are handled inline here
   instead of hitting a subprocess.

7. **Resume (local → cloud).** `wsPool` sends `{type:"tool_results", results}`.
   Because the DO still holds `pendingMessages`, the client sends **~1 KB of results,
   not the full history**. The loop resumes and repeats until `done`.

### Why it feels nameless

The single coherent feature above is physically located as:

| Concern | Current location |
|---|---|
| Subprocess host (JSON-RPC over pipe) | `src-tauri/src/mcp.rs` |
| Server catalogue + start/stop/manifest | `services/local/localMcpControl.ts` |
| Cloud registry REST client | `services/ai/mcpService.ts` |
| Capability reporting (what's running) | `services/localCapabilities/*` |
| Lifecycle / health / restart (React) | `hooks/useHarnessInit.ts` |
| Turn-body builder (`running_mcp_servers`) | `features/chat/context/buildChatRequest.ts` |
| WebSocket transport + pending-tool orchestration | `services/conversations/wsPool.ts` |
| Wire-message parser | `services/conversations/wsMessages.ts` |
| Tauri invoke contract (timeouts, retries) | `services/mcp/mcpInvoker.ts` |
| Local execution + permission gating | `features/chat/context/toolExecutor.ts` |
| Tool-card display classification | `features/chat/context/toolClassifier.ts` |
| Tool-card UI registry | `features/chat/tools/mcpRegistry.tsx` + siblings |

That is the exact list doc 04 relocates into one `runtime/` module.

---

## 3. The frontend structural smells (concrete)

Full current layout of `STUDIO/src/` (top level): `artifacts/`, `assets/`,
`cliBridges/`, `components/`, `config/`, `constants/`, `contexts/`, `features/`,
`hooks/`, `infrastructure/`, `pages/`, `permissions/`, `services/`, `shell/`,
`styles/`, `tokens/`, `types/`, `utils/`, plus `App.tsx` / `main.tsx`.

**Smell 1 — `services/` is a junk drawer (19 subfolders).** It mixes:
- true cross-cutting infra (`storage`, `network`, `errors`, `logging`, `platform`,
  `notifications`, `connection`),
- Local Runtime glue (`mcp`, `local`, `localCapabilities`, `conversations/wsPool`),
- and feature logic (`ai/*`, `files/*`, `inputs/*`, `auth/*`, `conversations/*`).

**Smell 2 — `components/` mixes shared primitives with feature code.**
`components/ui`, `components/brand`, `components/icons` are genuinely shared. But
loose files like `ModelPicker.tsx`, `VoiceInput.tsx`, `AttachmentInput.tsx`,
`OllamaStatus.tsx`, `LMStudioStatus.tsx`, `AuthControls.tsx` are feature code parked
in the shared bucket.

**Smell 3 — duplicate `rightWorkspace/` location.** There are two:
`components/rightWorkspace/` (contains only `ResizeHandle.tsx`) and the real feature
`features/workspace/rightWorkspace/` (the panels: browser, side chat, project
launcher, etc.). The **functionality is real and stays** — only the stray
single-file folder needs consolidating into the feature.

**Smell 4 — split concerns across top-level folders.** Permissions live in both
`permissions/` (engine) and `features/permissions/` (UI). Platform lives in both
`services/platform/` and `infrastructure/platform/`. `hooks/` (30+ files) mixes
truly-global hooks with feature-specific ones.

**Smell 5 — monolith files.** Biggest offenders by line count:

| File | Lines |
|---|---|
| `features/chat/context/ChatProvider.tsx` | **2079** |
| `features/workspace/WorkspacePage.tsx` | 987 |
| `features/chat/ChatPage.tsx` | 911 |
| `hooks/useAudioRecorder.ts` | 751 |
| `services/errors/comprehensiveDiagnostics.ts` | 658 |
| `services/ai/modelService.ts` | 570 |
| `features/chat/context/toolExecutor.ts` | 537 |

**Smell 6 — naming collision risk.** `cliBridges/` uses the word "bridge." The
Local Runtime must **not** be named "bridge" or it will read as the same thing. See
doc 02.

**Smell 7 — dev-only scaffolding shipped in `pages/`.** `SplashPreviewPage.tsx`
(gated by `?splashPreview=1`) and `TemporaryPage.tsx` look like scaffolding, not
product. Candidates for removal — VERIFY-FIRST (doc 04 §Dead Code).
