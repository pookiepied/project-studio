# STUDIO — Architecture Decisions 2026

> Living document. Every decision has a **Current State** (from 10-agent codebase audit), **User's Position** (from recorded conversation), and **Decision** (with reasoning anchored to code facts). Annotate disagreements and we iterate.

*Last updated: 2026-06-14 — Rev 24 (Obj 2b Phase 2 COMPLETE: GatewayAdapter wired, unused Layer A duplicates removed from chat/src/gateway/, both workers tsc clean.)*

---

## Table of Contents

1. [Dead Code & Cleanup](#1-dead-code--cleanup)
2. [Provider Architecture & AI Gateway](#2-provider-architecture--ai-gateway)
3. [Frontend Dependencies](#3-frontend-dependencies)
4. [Artifact / Canvas Panel](#4-artifact--canvas-panel)
5. [Document Ingestion & Knowledge Base](#5-document-ingestion--knowledge-base)
6. [Computer Use & Studio Local](#6-computer-use--studio-local)
7. [Agent Architecture & Workflow Page](#7-agent-architecture--workflow-page)
8. [Memory System](#8-memory-system)
9. [Credits & Telemetry](#9-credits--telemetry)
10. [Composio & MCP Ecosystem](#10-composio--mcp-ecosystem)
11. [Cloudflare vs VPS — The Real Analysis](#11-cloudflare-vs-vps--the-real-analysis)
12. [Priority Roadmap](#12-priority-roadmap)
13. [Centralized Connection Management System](#13-centralized-connection-management-system)
14. [Agent Architecture Cleanup + Pre-Deploy Audit](#14-agent-architecture-cleanup--pre-deploy-audit-checklist)
15. [Refactor-First Phase — The Next 1-2 Months](#15-refactor-first-phase--the-next-1-2-months)

---

## 1. Dead Code & Cleanup

### Current State

| Target | Actual State |
|--------|-------------|
| `auth/src/lib/tracker.ts` | **Does not exist** at that path. The real tracker client lives in `/tracker/src/lib/` and is distributed to other workers. |
| `extention/` directory | **Active Chrome extension source** — the Browser Automation MCP. NOT dead. NOT in the release build. |
| `ModelsPage` | **Production-ready** (427 lines, full search/filter/pricing) but **orphaned from routing**. Not in View union type, not imported in HomePage. |
| `flexAuth / engine key` | **Was implemented, then removed.** Remnant dead code exists: frontend `STUDIO/src/utils/api.ts:40-43` still sends `x-engine-key` header; `api/docs/GATEWAY_REFERENCE.md` still documents it. Backend auth middleware only accepts JWTs. |

### User's Position
All points agreed. Clarification on flexAuth: "We completely removed this functionality. It was implemented, we removed it — there is just dead code remaining."

### Decision

**`auth/src/lib/tracker.ts`** — Nothing to do. Path was wrong.

**`extention/`** — Keep. The Chrome extension source lives here. Decision needed on whether to bundle browser-automation in the release build (currently excluded from `scripts/release.mjs`). See Section 10.

**`ModelsPage`** — Wire into navigation. Three changes:
1. Add `"models"` to `View` union in `STUDIO/src/types/navigation.ts:15`
2. Import `ModelsPage` in `HomePage.tsx`
3. Add case in `renderView()` switch + nav link

**`flexAuth` remnants** — Remove:
- Delete lines 40-43 in `STUDIO/src/utils/api.ts` (the `x-engine-key` header send)
- Update `api/docs/GATEWAY_REFERENCE.md` to reflect JWT-only auth

---

## 2. Provider Architecture & AI Gateway

### Current State

**CF AI Gateway status: NOT ENABLED.**

Verified: `ai/wrangler.toml` line 38 shows `# wrangler secret put CF_AI_GATEWAY_ACCOUNT_ID` commented out. No secrets are set. The implementation code is complete — factory in `providers/index.ts:102-103` builds gateway URLs when credentials present — but credentials are absent. The gateway is dormant.

**Provider factory**: Centralized at `providers/index.ts:createProvider()`. API keys centralized in `getApiKey()` at `providers/index.ts:71-88`. Not scattered — already one function.

**Auto-router mode**: Currently `"static"` — all requests get `alibaba:qwen3-max-preview` regardless of task. Dynamic 5-tier classifier is implemented but disabled.

**Default `ENABLED_PROVIDERS`**: `groq, openrouter, google, alibaba, minimax, cloudflare, fal`

### User's Position
- CF AI Gateway: "It should be already implemented and running." — **Correction: it is coded but not configured. Secrets have never been set.**
- Provider cleanup: Not just env vars — need to remove adapter code too for dropped providers.
- MiniMax: **KEEP** — only for audio (TTS/voice cloning). Not for LLM routing.
- FAL: **KEEP** — image and video generation.
- API key management: Use CF AI Gateway's built-in **credential store** (set keys once in Cloudflare dashboard, reference by provider name) instead of individual `wrangler secret` per provider.

### Decision

**Step 1 — Enable CF AI Gateway (zero code, set secrets):**

```bash
wrangler secret put CF_AI_GATEWAY_ACCOUNT_ID   # from CF dashboard
wrangler secret put CF_AI_GATEWAY_NAME          # your gateway name
wrangler secret put CF_AI_GATEWAY_TOKEN         # if dashboard auth is on
```

After this, all calls to Anthropic, OpenAI, Google, Groq, Mistral, xAI, DeepSeek, OpenRouter, Perplexity route through the gateway automatically. Cloudflare dashboard shows logs, caching, cost per provider.

**Step 2 — CF AI Gateway credential store:**

In the Cloudflare AI Gateway dashboard, you can store provider API keys centrally under a gateway and reference them by provider name without passing keys in the request. This eliminates individual `wrangler secret put` calls for gateway-supported providers.

Providers that can use gateway credentials: Anthropic, OpenAI, Google, Groq, Mistral, xAI, DeepSeek, OpenRouter, Perplexity.

Providers that still need individual secrets (not gateway-compatible): Alibaba, MiniMax, FAL.

**Step 3 — Provider list after cleanup:**

| Provider | Keep | Reason |
|----------|------|--------|
| Anthropic | ✅ | Primary premium |
| OpenAI | ✅ | Coverage + o-series |
| Google | ✅ | Gemini Flash = best cheap model |
| Groq | ✅ | Fastest inference for simple tier |
| DeepSeek | ✅ | Strong free/cheap option |
| xAI | ✅ | Grok-3 coverage |
| OpenRouter | ✅ | Meta-aggregator, covers everything else |
| Alibaba | ✅ | Free models (Qwen) |
| MiniMax | ✅ | **Audio/TTS only** — not LLM routing |
| FAL | ✅ | Image + video generation |
| Mistral | ❌ | Covered by OpenRouter |
| Cerebras | ❌ | Covered by OpenRouter |
| Cohere | ❌ | Covered by OpenRouter |
| Perplexity | ❌ | Covered by OpenRouter |

For removed providers: delete the discovery file in `ai/src/gateway/discovery/providers/`, remove from `getApiKey()` map, remove from adapter factory switch. The adapter base class file can stay.

**Step 4 — Enable dynamic tier routing:**

Change `AUTO_MODE` from `"static"` to `"dynamic"` in `ai/src/gateway/services/router/config.ts`. Every request then gets classified and routed to the appropriate model tier. This alone reduces cost significantly (simple questions stop hitting expensive models).

---

## 3. Frontend Dependencies

### Current State (321 source files scanned)

| Dependency | Files Using | Status |
|------------|-------------|--------|
| `@phosphor-icons/react` | 92 files | ✅ Keep — only icon library |
| `lucide-react` | 0 (not in package.json) | Already gone |
| `three` | MemoriesGraph.tsx (direct import) | ✅ Keep — 3D memory graph |
| `react-force-graph-3d` | MemoriesGraph.tsx | ✅ Keep — uses three |
| `@pixiv/three-vrm` | **0 files** | ❌ Remove |
| `@xyflow/react` | **0 files** | ❌ Remove |
| `LiquidOrb3D.tsx` component | **0 imports in pages** | ❌ Dead — replaced by ChibiAvatar |
| `mermaid` | MermaidDiagram.tsx | ✅ Keep |
| `katex` | LatexRenderer.tsx | ✅ Keep |
| `pdfjs-dist` | pdfAttachmentService.ts | ✅ Keep |
| `@xterm/xterm` | TerminalPanel.tsx | ✅ Keep |

### Key Correction: LiquidOrb3D

`ChibiAvatar.tsx` explicitly states in its header comment that it "replaces LiquidOrb3D." Zero imports of `LiquidOrb3D` exist in any page or component outside the file itself. The voice page now uses ChibiAvatar (SVG + Framer Motion). LiquidOrb3D.tsx is dead code.

Three.js itself stays because `MemoriesGraph.tsx` imports `* as THREE from "three"` directly for the 3D force-directed memory graph.

### Decision

**Remove:**
```bash
cd STUDIO
npm uninstall @pixiv/three-vrm @xyflow/react
```

**Delete:**
- `STUDIO/src/components/ui/LiquidOrb3D.tsx` — dead, replaced by ChibiAvatar

**Keep:** Three.js (needed by MemoriesGraph), everything else.

---

## 4. Artifact / Canvas Panel

### Current State

The chat page is a `flex row` with two existing resizable right-side panels: BrowserPanel and TerminalPanel. Both use the same context + AnimatePresence + drag-resize pattern.

Current tool execution display: `ActiveToolBar.tsx` — sits above the chat input, shows compact pill + expandable tool cards. Per user: "really clunky."

Code blocks are rendered via `CodeBlock.tsx` with syntax highlighting, copy, collapse, and special renderers for: mermaid, latex, svg, csv, json, video.

### User's Position
"I agree, but it's not just adding a new window — we need a proper formatter. We need to be able to click on agents and see what they're doing: transcriptions, how many tokens they're burning, timing, failures, all of this. Need to completely understand the UX flow. Also: **remove the ActiveToolBar entirely**."

### Decision

**This is a full UX design + implementation project, not just a panel addition.**

The panel infrastructure exists and is reusable. What's missing is the design thinking around what every state looks like.

**What the Artifact Panel needs to show:**

*Code artifacts:*
- Full editor view with syntax highlighting (extend CodeBlock)
- Copy, download, run (if shell-executable) buttons
- Language badge + line count
- Diff view if AI modified existing code

*Document artifacts:*
- Clean reading view (reuse MarkdownComponents)
- Export as .md / .txt
- Word count, estimated read time

*Agent activity (replaces ActiveToolBar):*
- Which agent is running and its current goal
- Live tool call stream: tool name → args preview → result status (✓/✗)
- Token burn rate (input + output tokens so far)
- Elapsed time
- Expandable per-tool result with full args/output
- Error detail when a tool fails

*Session summary (when agent completes):*
- Total tokens used + estimated cost
- Tools called (count per tool)
- Duration
- What was produced (links to artifacts)

**Remove `ActiveToolBar.tsx`** — all tool execution context moves into the artifact panel's agent activity view. The top-of-input area should show only a minimal "running..." badge with a click-to-open behavior that opens the panel.

**New file structure:**
```
STUDIO/src/components/artifacts/
  ArtifactPanel.tsx           — main panel shell (mirror BrowserPanel)
  views/CodeArtifactView.tsx  — code editor view
  views/DocumentArtifactView.tsx
  views/AgentActivityView.tsx — real-time agent execution view
  ArtifactTabs.tsx            — tab strip at top of panel
STUDIO/src/contexts/ArtifactPanelContext.tsx
STUDIO/src/hooks/useArtifactPanel.ts
```

**UX flow:**
1. User sends message → agent starts → panel auto-opens to AgentActivityView
2. When agent produces code → CodeArtifactView tab appears automatically
3. When agent produces a document → DocumentArtifactView tab appears
4. Multiple artifacts from one session = multiple tabs in the panel
5. Panel persists across messages (artifacts accumulate per conversation)

---

## 5. Document Ingestion & Knowledge Base

### Current State

Full attachment pipeline exists and works:
- Attachment button in ChatComposer accepts images, text files, PDFs, code files
- Large text (>100K chars): chunked, embedded (bge-base-en-v1.5), stored in Vectorize with `session_id` scope, 24h R2 TTL
- Small text: injected inline into message
- PDFs: text extracted via pdfjs-dist, or page images for scanned PDFs
- RAG tool: cosine search filtered by `session_id` → returns ranked chunks

**The gap**: Documents are session-scoped. Cross-conversation persistent knowledge base does not exist. R2 storage on Workers Paid plan: 10GB included.

### User's Position
"The UI part — you're just talking about backend. Where the heck will the functionality be? Our WorkspacePage — think astronomically about what we're gonna have there. That's how serious this page should be. Memory is somewhere else — we should probably create a whole layer called 'User' that has workspace, memory, all these things. The artifact panel at the right side should have functionality to click and see what documentation we have. Also: storage limitations — Cloudflare doesn't have unlimited storage, we need to handle this properly."

### Decision

**The WorkspacePage redesign is the container for this — design it before implementing the backend.**

**WorkspacePage vision (proposed):**

The WorkspacePage becomes the "User Control Center" — everything about the user's persistent context, not just a session.

```
WorkspacePage
├── Knowledge Base
│   ├── Documents tab — uploaded PDFs/text, with search, tag, delete
│   ├── Usage: X MB / 500 MB (show storage consumption)
│   └── Upload controls with size limits enforced
├── Memory
│   ├── Facts tab — browse/search/delete memory facts
│   ├── Conversations tab — past conversation summaries
│   └── Profile tab — identity, preferences, what the AI knows about you
├── Agents (future)
│   ├── My Agents — user-defined scheduled agents
│   └── Run History — past agent execution logs
└── Settings (user-level preferences)
```

**Storage limits for documents:**
- Enforce per-user document storage limit (suggested: 100MB soft, 500MB hard)
- Show usage bar in the UI
- On upload: check user's current usage before indexing
- Auto-cleanup: oldest documents first when approaching limit

**Artifact panel → document quick access:**
- Artifact panel sidebar shows "My Documents" list (fetched from KB)
- Click any document → opens in DocumentArtifactView for reading
- "Use in chat" button → injects document into current conversation context

**Backend changes:**
1. New D1 table: `user_documents (id, user_id, name, chunk_count, size_bytes, r2_path, created_at, tags)`
2. Change Vectorize filter: `session_id` scope for temp uploads; `user_id` scope for KB documents
3. Change R2 path: `kb/{userId}/{docId}` (permanent) vs `temp/{sessionId}/{docId}` (24h TTL)
4. New API routes: `GET/DELETE /v1/kb/docs`, `GET /v1/kb/usage`
5. Size validation on upload before indexing

---

## 6. Computer Use & Studio Local

### Current State

**175+ tools** across 4 local MCP servers. The vision pipeline exists and is more complete than expected:

- `screenshot_and_analyze` → returns `McpImageContent` (LLM receives actual pixels, not a file path)
- `click_at`, `type_text`, `press_hotkey`, `drag_and_drop`, `scroll_at` → all implemented
- `get_ui_tree`, `click_ui_element` → Windows UIA accessibility tree
- `ocr_screen` → Windows.Media.Ocr native (requires language pack installed)
- `list_windows`, `focus_window`, `launch_app` → all implemented
- 66 system tools, 13 network tools, 23 harness tools, 18 playwright tools

The computer use loop is mechanically possible: `screenshot_and_analyze` → LLM decides action → `click_at` / `type_text` → repeat. But it's not orchestrated as a coherent workflow.

### User's Position
"It's a really bad MCP server. Not similar to how Anthropic actually uses computer use — it's really different. We're trying our best to have native tools but it's really, really bad. A proper native seamless computer use needs to be created. Studio Local needs to be handled in a much better way. This will be a completely separate workflow."

### Decision

**The mechanical capability exists. What's missing is the architecture layer between "raw tools" and "computer use."**

The gap is real and the user's instinct is correct — having individual tools (screenshot, click, type) is not the same as computer use. Anthropic's computer use is a single loop where the model controls the screen with full context of previous states. What STUDIO has is a toolbox without a workflow.

**What needs to be built:**

**1. Computer Use Agent mode** — A dedicated agent that:
- Takes a high-level goal ("Open Blender, create a sphere, render it")
- Maintains a running screenshot history (last N states)
- Continuously: screenshot → analyze → act → screenshot
- Knows when it's done (screenshot matches expected state, or goal is achieved)
- Reports failures with the screenshot that caused them

**2. Better Studio Local architecture:**

Current: 4 separate servers (harness, desktop, system, network) with 175 tools scattered across them.

The problem: The AI doesn't know which server to call for what. Having 175 tools in the context is too many — most models start making mistakes at >40 tool definitions.

Proposed: **Group tools into contextual modes.**

```
Computer Use Mode (when user says "do X on my computer"):
  Active tools: screenshot_and_analyze, click_at, type_text, 
                press_hotkey, drag_and_drop, get_ui_tree,
                focus_window, launch_app, get_clipboard, set_clipboard
  Inactive: all system/network tools

Developer Mode (when working on code):
  Active tools: read_file, edit_file, write_file, bash, powershell,
                git_*, grep, glob, lsp
  Inactive: UI automation tools

System Mode (when managing the machine):
  Active tools: get_system_stats, list_processes, kill_process,
                list_audio_devices, set_volume, list_displays
  Inactive: UI automation, file tools
```

This reduces tool count per request from 175 to ~10-15 relevant ones.

**3. OCR fix:**

Add fallback in `ocr_screen`: if `Windows.Media.Ocr` returns "engine unavailable", automatically fall back to `screenshot_and_analyze` and ask the vision model to read the text. One code change in `ocrFile.ts`.

**4. Vision-based element detection (longer term):**

Current approach: `get_ui_tree` gives accessibility tree, `click_ui_element` by ID. This works for native apps that expose UIA. It doesn't work for games, custom UI frameworks, or anything that doesn't implement accessibility APIs.

Next step: Annotate screenshots with bounding boxes from the UIA tree overlay, so the LLM can correlate what it sees in the screenshot with what it can click by ID.

---

## 7. Agent Architecture — Full Redesign

*This section supersedes all prior agent architecture notes. The current agent system is being completely replaced. Nothing in `ai/src/orchestration/specialists/` ships as-is.*

### What Gets Removed

| Component | Location | Why |
|-----------|----------|-----|
| `ResearchSubAgent` | `ai/src/orchestration/specialists/ResearchSubAgent.ts` | Bad implementation. Replaced by OmniAgent. |
| `CodingSpecialist` | `ai/src/orchestration/specialists/coding/` | Replaced by dedicated CodingAgent with proper file-reading protocol. |
| `ResearchSpecialist` | `ai/src/orchestration/specialists/research/` | Replaced by OmniAgent. |
| `BaseSpecialistGraph` | `ai/src/orchestration/specialists/base/` | Replaced by new agent base in `agents/` Worker. |
| All cloud tools embedded in `ai/` | `ai/src/orchestration/tools/cloud/` | Move to dedicated MCP Tools Worker. `ai/` never owns tools. |

### Worker Naming

| Folder | Worker name | Notes |
|--------|-------------|-------|
| `chat/` | `studio-chat` | Renamed from `ai/` |
| `gateway/` | `studio-gateway` | Extracted from `ai/src/gateway/` |
| `agents/` | `studio-agents` | New; OmniAgent + CodingAgent DOs |
| `mcp/` | `studio-mcp` | Central MCP hub/registry (new) |
| `mcp/memory/` | `studio-mcp-memory` | Renamed from `studio-memory` |
| `mcp/youtube/` | `studio-mcp-youtube` | Rename of existing YouTube transcript worker |
| `tracker/` | `studio-tracker` | Existing; rename only |
| `api/` | `api` | No prefix — centralized, app-agnostic |
| `auth/` | `auth` | No prefix — centralized, app-agnostic |

`api` and `auth` carry no Studio prefix intentionally: they are designed to be centralized infrastructure usable by any future product on the same account.

---

### Full Worker Architecture

**`ai/` is renamed to `chat/`.** After removing specialists → `agents/`, gateway → `gateway/`, and MCP → `studio-mcp`, what remains in `chat/` is purely: ChatAgent DO + WebSocket session management + cron dispatcher. Renamed accordingly.

```
Public (internet-accessible):
  studio.com          → Cloudflare Pages (STUDIO frontend)
  api.studio.com      → api Worker (auth, user data, Composio, KB, job queue)

Internal only (Service Bindings — no public routes):
  studio-chat         → ChatAgent DO, WebSocket sessions, cron dispatcher
  studio-gateway      → LLM routing, provider adapters, model discovery, CF AI Gateway
  studio-agents       → OmniAgent DO, CodingAgent DO (future specialist DOs)
  studio-mcp          → Central MCP hub/registry (routes to sub-workers below)
  studio-mcp-memory   → Memory storage + extraction + retrieval
  studio-mcp-youtube  → YouTube transcript extraction
  studio-tracker      → Telemetry, usage, cost tracking
  auth                → JWT issuing, token management
```

**Why separate `gateway/` from `chat/`:**
Both `chat/` (ChatAgent) and `agents/` (OmniAgent, CodingAgent) call LLMs. If the gateway stays inside `chat/`, then `agents/` would depend on `chat/` just to make an LLM request — wrong dependency direction. Separated, both Workers call `gateway/` independently.

**MCP Hub design (`studio-mcp`):**
`chat/` and `agents/` only ever call `studio-mcp` — they never call memory, YouTube, or any capability worker directly. The hub is a registry + router, not a host. It holds no tool implementations. Each capability lives in its own dedicated Worker, bound to the hub via Service Binding. The hub routes MCP protocol requests to the correct sub-worker based on tool/resource namespace.

Local MCP servers (filesystem, browser, daemon tools) that don't need Cloudflare hosting are also registered to `studio-mcp`. The hub is aware of them and signals the daemon to handle those requests.

**Service Binding dependency graph:**
```
api              → auth                token validation
api              → studio-chat         WebSocket routing + agent sessions
studio-chat      → studio-gateway      LLM calls
studio-chat      → studio-agents       spawn + poll agent DOs
studio-chat      → studio-mcp          ALL MCP (memory inject, tool calls, capabilities)
studio-agents    → studio-gateway      LLM calls (independent of chat)
studio-agents    → studio-mcp          ALL tool calls via MCP hub
studio-gateway   → studio-tracker      per-LLM-request cost + token tracking
studio-mcp       → studio-mcp-memory   memory storage + retrieval
studio-mcp       → studio-mcp-youtube  transcript extraction
studio-mcp       → studio-tracker      MCP usage tracking
```

Cross-Worker calls use **Service Bindings** — Cloudflare internal network, no internet hop. Same performance characteristic as local function calls. No latency concern.

### The `agents/` Worker

Two agent DOs to build, in order:

---

#### OmniAgent

**Purpose:** One powerful general-purpose agent. Replaces ResearchSubAgent + ResearchSpecialist + CodingSpecialist. Can handle any task type: research, analysis, writing, data work, multi-step workflows.

**Design principles:**
- Not specialized — handles anything well rather than doing one thing narrowly
- Parallel by default: when a task has independent sub-problems, spawns parallel sub-tasks and merges results
- All tools come from `mcp/tools/` via Service Binding — the OmniAgent has no embedded tool implementations
- `runFiber()` for hibernation-safe execution — can run for hours in the background
- Reports progress via structured status updates; parent (ChatAgent) polls via Service Binding

**System prompt discipline:**
- Strong tool-use methodology: think before acting, plan before searching, synthesize before reporting
- Parallel tool call enforcement: never do sequentially what can be done in parallel
- Clear output format: findings, confidence level, sources, gaps

---

#### CodingAgent

**Purpose:** Specialist for all code tasks. The current problem with LLM coding agents is they jump straight to editing without properly understanding the codebase. This agent enforces a deliberate protocol.

**File-reading protocol (enforced in system prompt and tool design):**

```
Phase 1 — Orientation (always first, no exceptions)
  ├─ list_project_files()          — get full directory tree
  ├─ read_config_files()           — package.json, tsconfig, wrangler.toml
  └─ understand_project_structure() — identify key entry points, patterns

Phase 2 — Targeted reading (parallel)
  ├─ identify relevant files for the specific task
  └─ read_files_batch([file1, file2, file3...]) — reads N files in parallel, not one by one

Phase 3 — Cross-reference
  ├─ grep_codebase(pattern)        — find usages, imports, related code
  └─ build mental model of dependencies and patterns

Phase 4 — Act
  └─ Only now: make changes, write code, submit patches
```

**The agent should never**:
- Start editing without completing Phase 1
- Read files one at a time when a batch read is possible
- Assume file contents — always read before modifying
- Ignore existing patterns — read similar files first to match conventions

**Tools (backed by local tools when machine is available, cloud tools otherwise):**
- `list_project_files` — directory tree with file metadata
- `read_files_batch` — parallel multi-file read
- `grep_codebase` — semantic + literal search
- `understand_dependencies` — parse imports, trace data flow
- `write_file`, `edit_file` — write-back after understanding phase is complete
- `run_tests` — validate changes
- `explain_change` — generate human-readable summary of what changed and why

---

### The `studio-mcp` Hub

**Purpose:** Central MCP registry and router. The only MCP endpoint that `studio-chat` and `studio-agents` ever call. It does NOT host any tools or implement any capabilities itself.

**What it does:**
- Maintains a registry of all connected MCP sub-workers (bound via Service Bindings)
- Routes inbound MCP protocol requests to the correct sub-worker based on tool/resource namespace
- Registers and routes local MCP servers (daemon-side, not CF-hosted) — signals daemon when a request targets a local tool
- Single binding for `studio-chat` and `studio-agents` — they never need to know which sub-worker handles what

**Sub-workers registered to the hub:**

| Worker | Namespace | What it handles |
|--------|-----------|-----------------|
| `studio-mcp-memory` | `memory/*` | Fact storage, injection, retrieval, vector search |
| `studio-mcp-youtube` | `youtube/*` | Transcript extraction |
| Local (daemon) | `local/*` | Filesystem, browser, computer-use tools |
| Future: `studio-mcp-search` | `search/*` | Web search, web fetch, Jina reader |
| Future: `studio-mcp-media` | `media/*` | Image + video generation |

**What stays in `studio-chat` inline (not routed through MCP hub):**
- Composio tools (user's connected apps — tight OAuth loop, inline in conversation)
- Dynamic MCP tool discovery (`DynamicMCPTool` — user-added external MCP servers)
- Think / todoWrite / skillRead (lightweight agentic scaffolding, chat-only)

**Transition note:** `studio-mcp-memory` is a rename/reorganization of the existing `studio-memory` worker. The core implementation stays the same — only the worker name and the call path changes (chat → hub → memory instead of chat → memory directly).

**External access (future):** `mcp.studio.com` — expose the hub as a real public MCP server. External LLMs, Claude Desktop, other MCP clients register against it. Auth via same JWT system. Not built yet — after internal architecture is stable.

### A2A Communication

With separated Workers, A2A is Service Binding fetch, not same-Worker RPC:

```typescript
// ChatAgent in ai/ Worker — spawning OmniAgent
const agentsWorker = this.env.AGENTS; // Service Binding
await agentsWorker.fetch(`/agents/omni-agent/${agentId}/start`, {
  method: 'POST',
  body: JSON.stringify({ goal, context, tools }),
});

// Polling progress
const status = await agentsWorker.fetch(`/agents/omni-agent/${agentId}/status`);

// OmniAgent calling a tool via mcp/tools/ Worker
const mcpWorker = this.env.MCP_TOOLS; // Service Binding
const result = await mcpWorker.fetch('/mcp', {
  method: 'POST',
  body: JSON.stringify({ tool: 'web_search', params: { query } }),
});
```

All stays within Cloudflare network. Latency overhead: ~1ms per Service Binding hop. Acceptable.

### Scheduled Agents & Offline Behavior

One fixed `*/1 * * * *` cron in `ai/` Worker:
- Reads `user_agents` D1 table for due schedules
- `execution_target: 'cloud'` → spawns OmniAgent or CodingAgent DO via `agents/` Service Binding
- `execution_target: 'local'` → writes job to D1 queue → Tauri app picks it up when online (runs late, not dropped)

Machine offline → local jobs queue → run when machine reconnects. Cloud agents unaffected by machine state.

### D1 Schema

```sql
CREATE TABLE user_agents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  goal TEXT NOT NULL,
  tools_allowed JSON,
  trigger_type TEXT,       -- 'manual' | 'cron' | 'webhook'
  cron_expression TEXT,
  execution_target TEXT DEFAULT 'cloud',  -- 'cloud' | 'local'
  agent_type TEXT DEFAULT 'omni',         -- 'omni' | 'coding' | future types
  status TEXT DEFAULT 'active',
  created_at INTEGER
);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES user_agents(id),
  user_id TEXT NOT NULL,
  status TEXT,             -- 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  result TEXT,
  error TEXT,
  tokens_used INTEGER,
  cost_usd REAL,
  started_at INTEGER,
  completed_at INTEGER
);
```

---

## 8. Memory System

### Current State

**Memory extraction is fully automatic.** After every conversation, `ctx.waitUntil()` fires an extraction job (zero latency impact). An LLM reads the last 30 messages and extracts facts, entities, relations — deduplicated at >92% semantic similarity, reinforced on repeat encounters. Memory is injected into every chat request: profile (top-6 per category) + last 3 conversation summaries + top 5 semantic matches.

**What's broken:**
- `MemoriesPage` calls `/adapters/openai/v1/memories` — **endpoint does not exist**. Page silently fails. Users can't browse/manage memories through the UI.
- Decay system (schema has `decay_rate`, `expires_at`) — no cron job to apply it.

**User's note:** "We never actually created the whole memory system properly — we moved from Supabase to Cloudflare and it's kind of broken currently."

### Assessment

The migration from Supabase to Cloudflare was completed at the MCP worker level (D1 + Vectorize). The extraction and injection pipeline works. The UI is broken because the REST bridge was never added. The Supabase-era data did not migrate (user starts fresh), but new data accumulates correctly from every conversation going forward.

### Decision

**Fix the UI endpoint (30 min). Defer everything else.**

Two API routes in `api/src/routes/adapters/openai.ts`:
```
GET    /adapters/openai/v1/memories      → proxy to memory_list MCP tool
DELETE /adapters/openai/v1/memories/:id  → proxy to memory_delete MCP tool
```

This unbreaks MemoriesPage. All the data is already there.

**What to defer:**
- Decay/eviction cron job (schema ready, execution missing)
- Memory profile auto-detection improvements
- Conversation history raw storage (privacy tradeoff, not urgent)

---

## 9. Credits & Telemetry

### Current State

**Tracking is working and NOT broken by the LangGraph migration.**

Working:
- Per-request: token counts (exact), cost (exact from provider or estimated from 78-model pricing table), latency, provider, model, status, tool call count
- ActivityPage: 95% functional — chart, provider cards, request log, system health all working
- `CREDITS_KV`: 15-minute cache for OpenRouter balance (not a global ledger)

**One broken piece:**

ActivityPage calls `GET /adapters/openai/v1/tracking/me` — this route **does not exist** in `api/src/routes/adapters/openai.ts`. The "Your Session" card shows blank/zero for every user because of this one missing route.

### Decision

**Two fixes:**

1. Add missing route (30 min):
   ```
   GET /adapters/openai/v1/tracking/me 
   → proxy to tracker GET /usage/summary?userId={currentUser}
   ```

2. Enable CF AI Gateway (zero code — set secrets per Section 2). Once enabled, Cloudflare dashboard provides per-provider analytics on top of Studio's own tracking.

**Clean up ghost infrastructure (deferred):**
- `spans` table and routes: designed for LangGraph, never used by CF Agents. Either delete the routes (cleaner) or add manual span instrumentation to ChatAgent (more useful). Not urgent.

---

## 10. Composio & MCP Ecosystem

### Current State

**Composio**: Fully integrated, working. REST API + OAuth, not an MCP server. 500+ apps, D1-backed connections, 23 curated apps in KV (admin-updatable). Handles GitHub, Linear, Notion, Slack, Figma, Google Workspace, Calendar, Jira — all the major developer tools. Works correctly.

**Browser Automation**: Functional but NOT shipped in release build. `scripts/release.mjs` bundles only `studio-local` + `playwright`. Browser-automation excluded. User must install Chrome extension manually either way (can't auto-install extensions).

### Decision

**Don't touch Composio.**

**Browser automation bundling**: Add to release build so the MCP server is bundled even though the Chrome extension requires manual installation. Update `scripts/release.mjs` and `tauri.conf.json` bundle resources.

**`extention/` directory**: Keep as Chrome extension source. Consider adding a build step that produces a `STUDIO Browser Automation.zip` alongside the app installer — users load it as an unpacked extension or install from zip.

---

## 11. Infrastructure Decision — Final Verdict

*Written after: 10-agent codebase audit + full read of ChatAgent/ResearchSubAgent/runFiber() + devil's advocate agent arguing for VPS + rebuttal of each argument. This is not a preference — it is based on code facts.*

### The Decision

**Cloudflare + Daemon. No VPS. No hybrid.**

The four options evaluated:

| Option | Verdict | Reason |
|--------|---------|--------|
| Pure Cloudflare | ✅ Yes (with work) | Cloud agents work. Background local-tool relay needs wiring. |
| VPS | ❌ No | Doesn't reduce daemon latency (still internet hop to user's machine). Two infra systems. |
| CF + VPS hybrid | ❌ No | All VPS benefits already exist in the daemon. More complexity, no gain. |
| Agent loop on user's machine (from scratch) | ❌ No | The daemon IS this. Don't reinvent it. |

### Why the Daemon, Not a VPS

The daemon (port 11435) is already:
- Running on the user's machine (Tauri keeps it alive)
- Node.js process with full local access
- Has all 175+ tools registered
- Has job queue polling infrastructure
- OpenAI-compatible, can call CF gateway for LLM routing

A VPS is a remote machine. To reach the user's daemon from a VPS: **VPS → internet → user's machine → internet → VPS**. That's potentially worse latency than Cloudflare's edge, not better. The VPS latency argument assumed co-location. It isn't.

Expanding the daemon to run an agent loop = exact same compute proximity, zero new infrastructure.

### Platform Limits That Actually Matter

| Limit | Platform Value | Agent Impact |
|-------|---------------|-------------|
| CPU per invocation | 30 seconds | ❌ Irrelevant — agents are I/O-bound. 25-min session uses ~200ms CPU. |
| WebSocket duration | Unlimited (Paid) | ✅ No constraint on interactive sessions |
| Background task cap | 900s app-level, unlimited platform | ✅ Change one constant in SpawnAgentTool.ts |
| DO memory | 128MB per DO | ⚠️ Monitor if storing large message histories in state |
| D1 + R2 storage | 10GB included | ⚠️ Monitor document growth |

**The 30-second CPU limit is irrelevant.** LLM agents wait on network I/O, not CPU. The 25-minute session is empirical proof. The 8-minute interactive cap (`ABSOLUTE_TIMEOUT_MS = 480_000`) is application code — remove or raise it freely.

### What Genuinely Needs Building

Neither of these requires a VPS:

1. **Background agent → local tool relay**: Wire the existing job queue. Background DO writes `execution_target: 'local'` job → daemon claims → executes → returns result → fiber resumes. Infrastructure: 90% exists.

2. **Dispatcher cron for scheduled agents**: One fixed `*/1 * * * *` CF cron reads D1 `user_agents` table, spawns ResearchSubAgent DOs or writes local jobs per schedule. Same pattern as the existing stale-job reaper.

3. **Computer-use agent loop in daemon**: Daemon runs the tight screenshot→click→screenshot loop. LLM calls go to CF for routing/tracking. Tool calls are localhost. This is daemon expansion, not a VPS.

---

## 12. Implementation Roadmap

*Ordered by: quick wins first → infrastructure foundations → new agent system → full features.*

---

### Objective 1 — Quick fixes ✅ COMPLETE (verified 2026-06-12)

Audit findings and final status after code-verified pass:

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1.1 | Enable CF AI Gateway | ⏸ Deferred | Code is ready. Secrets deployment is an ops step, not tracked here. |
| 1.2 | Fix `/tracking/me` route | ✅ Done | Route existed but proxied to wrong tracker endpoint. Fixed: now → `/usage/summary` with userId injected. |
| 1.3 | Fix `/memories` routes (GET + DELETE) | ✅ Done | Routes at `/user/memories` — correct path, both implemented. Also fixed: `tauriConfig.ts` had wrong path `/memories` → corrected to `/user/memories`. |
| 1.4 | Remove dead packages | ✅ Done | `@pixiv/three-vrm` and `@xyflow/react` removed from `package.json`. |
| 1.5 | Delete `LiquidOrb3D.tsx` | ✅ Done | File deleted. |
| 1.6 | Remove stale flexAuth code | ✅ Done | `x-engine-key` header removed from `api.ts`; `GATEWAY_REFERENCE.md` updated to document removal. |
| 1.7 | Enable dynamic model routing | ⏸ Deferred by design | Dynamic tier classifier not yet validated. `AUTO_MODE` stays `"static"` until routing logic is confirmed working. |
| 1.8 | Wire ModelsPage into nav | ⏸ Deferred | ModelsPage needs redesign before exposing in nav. Wired in `NavPopup` already; `FloatingMenu` intentionally skipped pending redesign. |

**Additional bugs found and fixed during audit (2026-06-12):**

- **`/tracking/summary` wrong endpoint**: Was proxying to tracker `/summary` (span/infra stats) instead of `/usage/summary` (usage data). Fixed to `proxyToTracker(c, '/usage/summary', false)`.
- **`SummaryData` type mismatch**: Frontend type had `last_30_days` wrapper that no endpoint ever returned. Flattened to match actual tracker `/usage/summary` response shape. Updated `ActivityPage.tsx` accordingly.
- **`FloatingMenu` missing Activity item**: Activity view existed in `NavPopup` but not in the sidebar (`FloatingMenu`). Added to System section with `ChartLineUpIcon`. `"activity"` added to local View union.
- **`FloatingMenu` missing `"activity"` in View union**: Fixed alongside above.

---

### Objective 2 — Rename + Extract Gateway

**2a. Rename `ai/` → `chat/`** ✅ DONE

Changes made:
- Folder renamed: `ai/` → `chat/`
- `chat/wrangler.toml`: `name = "studio-chat"`
- `api/wrangler.toml`: `service = "ai"` → `service = "studio-chat"` (AI binding)
- `mcp/memory/wrangler.toml`: `name = "studio-mcp-memory"`, AI_WORKER binding → `studio-chat`
- `chat/wrangler.toml`: MEMORY binding → `service = "studio-mcp-memory"`
- `mcp/youtube-transcript/wrangler.toml`: comment updated

Note: `tracker` rename (`tracker` → `studio-tracker`) deferred — it is a live deployed service bound by 7 workers. Rename is a coordinated redeploy operation, not a code change. Do it as a standalone deploy step.

**2b. Extract `gateway/` as a standalone CF Worker — PHASE 1 ✅ PHASE 2 ✅ COMPLETE**

> **What shipped (2026-06-12):**
> - `gateway/` worker created (`studio-gateway`) — minimal LLM proxy at `POST /v1/chat/completions`
> - Accepts `"provider:model-id"` format; resolves provider, strips prefix, calls upstream API
> - `agents/` fully migrated: `GROQ_API_KEY`/`OPENROUTER_API_KEY` removed, `GATEWAY: Fetcher` added, both OmniAgent and CodingAgent use `env.GATEWAY.fetch()` via `callGateway()`
> - GATEWAY service binding wired in both `agents/wrangler.toml` and `chat/wrangler.toml`
> - `AgentMessage`/`ToolCall` moved to `chat/src/gateway/types.ts`; `orchestration/agent/state.ts` re-exports from there (Prereq 2 complete)
>
> **What remains (Phase 2 — full chat/ extraction):**
> The 80-file extraction of `chat/src/gateway/` (providers/, discovery/, services/router/, tts/) is blocked by two remaining prerequisites — see analysis below. Phase 1 unblocks agent-level telemetry and centralizes API key management. Phase 2 is the larger refactor that fully separates the LLM routing layer from chat.

**Phase 2 — ALL PREREQUISITES COMPLETE ✅**

- Prereq 1 (GatewayEnv/Env split): ✅ DONE — `chat/src/gatewayEnv.ts` is single source of truth; `chat/src/env.ts` extends it; all Layer A files updated to use `GatewayEnv`
- Prereq 2 (AgentMessage/ToolCall): ✅ DONE — live in `chat/src/gateway/types.ts`, re-exported from `orchestration/agent/state.ts`
- Prereq 3 (Pipeline folder separation): ✅ DONE — `chat/src/pipeline/` holds context/dispatch/preload/systemPrompt/userContext/stream/*; `gateway/pipeline/` contains only `parse.ts`
- Gateway index wired: ✅ DONE — `gateway/src/index.ts` cross-imports all Layer A routes from `chat/src/gateway/routes/`; KV + R2 bindings in `gateway/wrangler.toml`

**Phase 2 — COMPLETE ✅ (2026-06-14)**

> **What shipped:**
> - `GatewayAdapter` fully implemented in `chat/src/gateway/providers/gatewayAdapter.ts` — wraps `env.GATEWAY` as a `ProviderAdapter`, handles both streaming (SSE) and non-streaming paths
> - `createProvider()` in `chat/src/gateway/providers/index.ts` auto-routes through `GatewayAdapter` when `env.GATEWAY` is present (production) and falls back to direct adapters in local dev
> - `GATEWAY` service binding already in `chat/wrangler.toml` (binding = "GATEWAY", service = "studio-gateway")
> - `chat/src/env.ts` already had `GATEWAY?: Fetcher` at line 21
> - Unused Layer A duplicates removed from `chat/src/gateway/`: `discovery/` (13 files), `tts/` (3 files), `execution/` (1 file), `routes/{tts,models,internalStt,audio,updates}.ts`, `services/modelSync.ts` — all were re-export stubs or dead code with zero importers in chat
> - `pipeline/parse.ts` reconstructed to import directly from `gateway/src/` (modelSync, providers) rather than through now-deleted chat-side stubs
> - Both `chat/` and `gateway/` pass `tsc --noEmit` with zero errors ✅

**Analysis below preserved for historical context.**

### The Actual Problem

`chat/src/gateway/` contains 80+ files. On the surface it looks like routing infrastructure, but a dependency audit shows the folder has two completely separate layers stitched together with no boundary:

**Layer A — Pure LLM routing infrastructure** (extractable into `gateway/`):
Provider adapters, model discovery, dynamic routing classifier, CF AI Gateway integration, TTS, image generation, `MODELS_KV`-backed routes. These files have no orchestration imports.

**Layer B — Chat pipeline application logic** (must stay in `chat/`):
`pipeline/context.ts`, `pipeline/preload.ts`, `pipeline/systemPrompt.ts`, `pipeline/dispatch.ts`, `pipeline/stream/` — these import deeply from `chat/src/orchestration/`: `runAgentLoop`, `buildSystemPrompt`, `loadMcpTools`, `loadComposioTools`, `createRequestRegistry`, `setRequestRegistry`, `AgentMessage`, `ToolCall`, `ToolRegistry`, and more. They are the chat application coordinator, not routing infrastructure. They happen to live inside `chat/src/gateway/` but belong nowhere near a standalone gateway worker.

As long as Layer A and Layer B share the same folder and the same `Env` type, they cannot be separated.

### What the Audit Found

**Blocking entanglement #1 — `Env` is monolithic**

Every file in `chat/src/gateway/` imports `Env` from `chat/src/env.ts`. There is no `GatewayEnv` — the gateway uses the same `Env` type as the ChatAgent DO, which includes `CHAT_AGENT`, `RESEARCH_SUB_AGENT`, `MEMORY`, `VECTORIZE`, `AGENTS` — bindings that a standalone `gateway/` worker would never have. A standalone gateway worker needs its own `GatewayEnv` (API keys, `MODELS_KV`, `MCP_KV`, gateway credentials, `TRACKER`) split out of the monolith.

**Blocking entanglement #2 — `AgentMessage`/`ToolCall` live in orchestration, not gateway** ✅ RESOLVED

`AgentMessage` and `ToolCall` have been moved to `chat/src/gateway/types.ts`. `orchestration/agent/state.ts` now re-exports them from there. The dependency direction is now correct: orchestration imports gateway types, not vice versa.

**Blocking entanglement #3 — The pipeline is the chat application, not the gateway**

`pipeline/context.ts` is the structural glue holding everything together: it defines `ChatPipelineContext` which bundles `Env`, `AgentMessage`, `UserContext`, `ToolRegistry`, `DynamicMCPTool`, `ComposioTool`, `McpServerSummary` — a union of gateway infrastructure and chat app state. This file alone makes the pipeline unseparable from the chat application. `pipeline/preload.ts` calls memory injection, MCP tool loading, Composio tool loading. `pipeline/systemPrompt.ts` calls `buildSystemPrompt()` from orchestration. `pipeline/stream/phase2.ts` calls `runAgentLoop` and `runCodingSpecialistTurn`. None of these belong in a standalone routing worker.

**What is already clean (no orchestration coupling):**
`providers/adapters/` (except the `AgentMessage` import), `discovery/`, `services/router/`, `middleware/`, `config/`, `tts/`, `routes/models.ts`, `routes/modes.ts`, `routes/adminModes.ts`, `routes/audio.ts`, `routes/tts.ts`, `routes/images.ts`, `routes/health.ts`, `routes/updates.ts`, `routes/agentWorkflows.ts`, `routes/mcp.ts`, `routes/composio.ts`.

### Three Prerequisites Before Extraction Can Start

**Prerequisite 1 — Split `Env` into `GatewayEnv` + `ChatEnv`**

Create `chat/src/gatewayEnv.ts`:
```typescript
export interface GatewayEnv {
  // LLM provider keys
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GOOGLE_AI_API_KEY?: string;
  GROQ_API_KEY?: string;
  // ... all provider keys
  // CF AI Gateway
  CF_AI_GATEWAY_ACCOUNT_ID?: string;
  CF_AI_GATEWAY_NAME?: string;
  CF_AI_GATEWAY_TOKEN?: string;
  // Shared infra
  MODELS_KV: KVNamespace;
  MCP_KV: KVNamespace;
  TRACKER?: Fetcher;
  // ... other gateway-level bindings
}
```

`chat/src/env.ts` `Env` extends `GatewayEnv` and adds chat-specific bindings. All gateway-layer files switch their import from `Env` to `GatewayEnv`. This is a large but mechanical find-and-replace.

**Prerequisite 2 — Move `AgentMessage`/`ToolCall` to `gateway/types.ts`** ✅ DONE

Moved to `chat/src/gateway/types.ts`. `orchestration/agent/state.ts` re-exports them via `export type { AgentMessage, ToolCall } from "../../gateway/types"`.

**Prerequisite 3 — Separate the chat pipeline from the gateway folder** ✅ DONE

Moved OUT of `chat/src/gateway/pipeline/` into `chat/src/pipeline/`:
- `context.ts`, `preload.ts`, `systemPrompt.ts`, `dispatch.ts`, `userContext.ts`, `stream/` (all 5 files)

`gateway/pipeline/` now contains only `parse.ts` (request parsing + model routing decision). All callers updated: `gateway/routes/chat.ts`, `orchestration/agent/loop.ts`, `orchestration/agent/ChatAgent.ts`, `inputs/image/pipeline.ts`.

### After Prerequisites: The Actual Split

**Files that move to `gateway/src/`** (after prerequisites are met):

```
providers/           all adapters + factory (AgentMessage moved to gateway/types.ts)
discovery/           model discovery + taxonomy
services/router/     dynamic classifier, rate tracker, modes config
tts/                 TTS providers, voices, audio
middleware/          CORS, error handler, response formatter
config/              constants, CORS config
utils/               modelParser, providerUtils
pipeline/parse.ts    request parsing + model routing (only this file from pipeline/)
routes/
  models.ts          GET /v1/models
  modes.ts           GET/PUT /v1/modes
  adminModes.ts      admin modes config
  audio.ts           POST /v1/audio/transcriptions
  tts.ts             POST /v1/audio/speech
  images.ts          image serve/delete
  health.ts          GET /health
  updates.ts         GET /updates
  internalStt.ts     internal STT
logger.ts
telemetry.ts
types.ts             includes AgentMessage, ToolCall (moved from orchestration)
```

**Files that stay in `chat/src/`** (they depend on chat state, DO bindings, or orchestration):

```
gateway/routes/
  chat.ts            POST /v1/chat/completions (application coordinator — stays)
  kb.ts              knowledge base (VECTORIZE + AI_DB)
  docs.ts            docs indexing (VECTORIZE + AI_DB)
  agentWorkflows.ts  agent CRUD (AI_DB + AGENTS binding)
  composio.ts        Composio OAuth (COMPOSIO_API_KEY + AI_DB)
  mcp.ts             dynamic MCP (MCP_KV + AI_DB)
  localInference.ts  local inference callbacks
  pdf.ts             PDF extraction (R2)
pipeline/ (moved here from gateway/pipeline/ except parse.ts)
  context.ts
  preload.ts
  systemPrompt.ts
  dispatch.ts
  stream/
```

### Service Binding Changes (post-extraction)

`gateway/` is internal-only. Both `chat/` and `agents/` call it via Service Binding:

```toml
# chat/wrangler.toml and agents/wrangler.toml — add:
[[services]]
binding = "GATEWAY"
service = "studio-gateway"
```

`chat/src/orchestration/agent/nodes/llm.ts` — `runLlmStep` switches from `createProvider()` to `env.GATEWAY.fetch(...)`.

`agents/src/agents/OmniAgent.ts` and `CodingAgent.ts` — ✅ DONE. Direct API key usage replaced with `env.GATEWAY.fetch(...)`. Agent LLM calls now go through studio-gateway.

### Why This Was Skipped in Objective 4

When `agents/` was built, the path of least resistance was direct API keys. The real blocker wasn't noticed until a proper dependency audit was run: the pipeline is not separable from the chat application without the three prerequisites above. Doing the extraction without those prerequisites would have produced a broken worker or left the pipeline in `chat/` anyway, which defeats the point.

### Scope

Not mechanical. Three distinct prerequisite refactors (Env split, type relocation, pipeline move) before any folder move begins. Each prerequisite touches 15–30 files. The correct order: Prerequisite 2 → Prerequisite 3 → Prerequisite 1 → extraction.

### Objective 3 — MCP Hub (`studio-mcp`) + Memory Reorganization

Build this before building any agent. `studio-chat` and `studio-agents` both depend on it.

**Create `mcp/` hub Worker (`studio-mcp`):**
```
mcp/
  src/
    registry/        sub-worker registry + namespace routing table
    index.ts         MCP protocol entry point — receives all MCP requests, routes to sub-workers
    env.ts           bindings: MCP_MEMORY, MCP_YOUTUBE, TRACKER
  wrangler.toml      name = "studio-mcp", internal only
```

The hub exposes a single MCP endpoint. It routes requests by namespace prefix to the correct bound sub-worker.

**Rename `studio-memory` → `studio-mcp-memory`:**
- Update `mcp/memory/wrangler.toml`: `name = "studio-mcp-memory"`
- No code changes — implementation stays identical
- Update all service binding references from `studio-memory` → `studio-mcp-memory`

**Update service bindings:**

In `mcp/wrangler.toml` (the hub):
```toml
[[services]]
binding = "MCP_MEMORY"
service  = "studio-mcp-memory"

[[services]]
binding = "MCP_YOUTUBE"
service  = "studio-mcp-youtube"
```

In `chat/wrangler.toml` and `agents/wrangler.toml` (replace direct MEMORY binding with hub):
```toml
[[services]]
binding = "MCP"
service  = "studio-mcp"
```

**Remove from `chat/wrangler.toml`:** the direct `MEMORY` service binding — chat no longer calls memory directly, it goes through the hub.

**Cloud tools (web_search, image_generate, etc.):** These are implemented directly in `studio-mcp` hub (not in sub-workers). The hub runs them natively alongside routing. Chat/ still runs its own copies of these tools locally — the migration to call the hub via `MCP` service binding is Objective 3b (future, requires no tool-name breakage strategy).

---

### Objective 4 — `agents/` Worker (OmniAgent first) ✅ COMPLETE

**Built:**
```
agents/
  src/
    agents/
      OmniAgent.ts     General-purpose agent DO — ReAct loop, MCP tools, runFiber
    index.ts           routeAgentRequest + REST lifecycle (start/status/result/cancel/message)
    env.ts             Env interface: OMNI_AGENT, MCP_TOOLS, TRACKER, AI_DB, LLM keys
  wrangler.toml        name="studio-agents", D1 + MCP_TOOLS + TRACKER service bindings
  package.json / tsconfig.json
```

**Wired into `chat/wrangler.toml`:**
```toml
[[services]]
binding = "AGENTS"
service  = "studio-agents"
```

**OmniAgent DO — what was built:**
- `runFiber()` for hibernation-safe background execution
- Full ReAct loop: think → parallel tool calls → observe → synthesize (up to 15 steps)
- All tool calls via `env.MCP_TOOLS` Service Binding (MCP JSON-RPC)
- LLM calls direct to Groq/OpenRouter (agents/ carries own API keys, avoids chat/ circular dep)
- Model resolver: parses `"groq:llama-3.3-70b-versatile"` → provider + key + base URL
- Lifecycle: `start()`, `getStatus()`, `getResult()`, `cancel()`, `receiveMessage()`
- Strong system prompt: think first, fan out parallel, stop when enough, synthesize, no hallucination

**Updated `chat/` tools:**
- `spawnAgent.ts` — added `"omni"` type (preferred), `executeSpawnOmni()` routes to AGENTS binding
- `awaitAgents.ts` — dual-mode polling: `omni-*` → AGENTS binding, `research-*` → ChatAgent DO

**Still TODO (Objective 4 follow-up):**
- Delete `chat/src/orchestration/specialists/` folder when `research` type is retired
- Build CodingAgent DO (Objective 5, same `agents/` Worker)

---

### Objective 5 — CodingAgent ✅ COMPLETE

Same `agents/` Worker, new `CodingAgent` DO class.

**Built:**
- `agents/src/agents/CodingAgent.ts` — CodingAgent DO with 4-phase system prompt + `filesRead` state tracking
- `mcp/hub/src/tools/coding/readFilesBatch.ts` — fetches multiple files in parallel, auto-converts GitHub blob URLs to raw
- `mcp/hub/src/tools/coding/listProjectFiles.ts` — lists GitHub repo tree via API, filters binaries/lock files, returns structured output
- Both tools registered in `mcp/hub/src/tools/index.ts` (hub now has 11 tools)
- `agents/wrangler.toml` — added `CODING_AGENT` DO binding + `v2` migration
- `chat/src/orchestration/tools/cloud/agentic/spawnAgent.ts` — added "coding" type with `executeSpawnCoding()`
- `chat/src/orchestration/tools/cloud/agentic/awaitAgents.ts` — `coding-*` IDs routed to AGENTS binding, URL path resolves to `/coding-agent/{id}/status`
- `chat/src/orchestration/tools/mcp/builtin/hubTools.ts` — `readFilesBatchHubTool` + `listProjectFilesHubTool` added
- `chat/src/orchestration/tools/index.ts` — both hub-native tools registered

**4-phase protocol (prompt-driven, not code-enforced):**

| Phase | Steps | Actions |
|-------|-------|---------|
| 1. Orientation | 1-5 | `list_project_files` + batch-read key configs |
| 2. Targeted Read | 5-15 | `read_files_batch` on relevant files |
| 3. Cross-Reference | 15-25 | GitHub search API, trace imports |
| 4. Act | 25-40 | Generate diffs, PR plan, or full file output |

**Tools visible to CodingAgent** (via `CODING_TOOL_FILTER`): think, web_search, web_fetch, http_request, rag, read_files_batch, list_project_files.

**Config extras vs OmniAgent:** `repoUrl?`, `branch?`, `github_token?` — passed through to `github_token` arg on hub tools.

---

### Objective 6 — Artifact Panel ✅ COMPLETE

**Built:**
- `STUDIO/src/components/ui/ArtifactPanel.tsx` — panel shell mirroring `BrowserPanel` (resize handle, floating window, tab switcher, close dot)
- `STUDIO/src/components/ui/artifact/ActivityView.tsx` — real-time tool call list using `ToolCallCard`; handles running, pending_question, pending_approval, completed, error states
- `STUDIO/src/components/ui/artifact/CodeView.tsx` — syntax-highlighted code with copy button (reuses `react-syntax-highlighter`)
- `STUDIO/src/components/ui/artifact/DocumentView.tsx` — pre-formatted document with copy button
- `STUDIO/src/hooks/useArtifactPanel.ts` — manages tabs (Activity singleton + Code/Document accumulator), auto-open on tool start
- `STUDIO/src/contexts/ArtifactPanelContext.tsx` — `openCode()` / `openDocument()` for child components
- `STUDIO/src/pages/ChatPage.tsx` — ArtifactPanel wired in, `ActiveToolBar` removed from composer area, `ArtifactPanelContext.Provider` wraps chat

**Behavior:**
- Panel auto-opens and switches to Activity tab when any tool starts running
- Activity tab shows pending_question/pending_approval cards at top (interactive), running below, completed at bottom
- Code and Document tabs added programmatically via context (`useArtifactPanelContext()`)
- Activity tab cannot be closed; Code/Document tabs are closeable
- Panel slides in from right, same animation as BrowserPanel and TerminalPanel

---

### Objective 7 — WorkspacePage + Persistent KB ✅ COMPLETE

**Built:**
- `chat/schema.sql` — added `user_documents` table (`id, user_id, name, size, mime_type, r2_key, chunk_count, truncated, created_at`)
- `chat/src/gateway/routes/kb.ts` — three handlers: `handleKbList` (GET /v1/kb), `handleKbIndex` (POST /v1/kb/index), `handleKbDelete` (DELETE /v1/kb/:docId)
- `chat/src/index.ts` — KB routes wired into Hono app
- `STUDIO/src/services/files/kbService.ts` — `listKbDocs`, `indexKbDocument`, `deleteKbDoc`, `listMemoryFacts`, `deleteMemoryFact`
- `STUDIO/src/pages/WorkspacePage.tsx` — rebuilt with Knowledge Base / Memory / Agents tabs

**Key design decisions:**
- **Vectorize scope for persistent KB**: vectors are stored with `session_id = user_id` so the existing `rag` tool can query the user's KB in any conversation using `rag(action="query", session_id="{user_id}")`. No changes to the rag tool needed.
- **R2 key prefix**: `permanent/{userId}/{docId}` — no expiry metadata; excluded from the `temp/` cron cleanup.
- **Doc cap**: 100 documents per user (enforced in `handleKbIndex`).
- **Vectorize deletion**: reconstructed as `{docId}-{0..N-1}` from `chunk_count` stored in D1. Deletes atomically with `vectorize.deleteByIds()`.
- **Memory tab**: proxies the existing `GET /v1/user/memories` endpoint (→ studio-mcp-memory `/facts`). Grouped by category (identity / preference / project / event / knowledge) with per-fact delete.
- **Agents tab**: stub placeholder; activated in Objective 8.
- **Supported upload types**: .txt, .md, .json (text files the browser can `file.text()`). PDF indexing still happens from the chat composer; WorkspacePage KB is for permanent reference docs.
- **Storage usage UI**: shown in KB tab toolbar as "N documents · X KB".
- **`X-User-Id` header**: frontend sends user.id (JWT sub) as a custom header; chat worker trusts it because the request is already Bearer-authenticated.
- **Schema migration**: `wrangler d1 execute studio-ai --remote --file=./schema.sql` (idempotent; uses `CREATE TABLE IF NOT EXISTS`).

---

### Objective 8 — Workflow Page ✅ COMPLETE

**Built:**
- `chat/schema.sql` — `user_agents` + `agent_runs` tables (with `status`, `cron_expr`, `do_id` for live polling)
- `chat/src/gateway/routes/agentWorkflows.ts` — full CRUD + run + history API; `dispatchScheduledAgents()` for cron
- `chat/src/index.ts` — 6 new routes wired; `*/5 * * * *` cron dispatches scheduled agents
- `chat/wrangler.toml` — `*/5 * * * *` added to crons array
- `STUDIO/src/services/agents/agentWorkflowService.ts` — typed frontend service
- `STUDIO/src/pages/WorkspacePage.tsx` — Agents tab fully built (create form, agent list with expandable run history, run/delete actions)

**Key design decisions:**
- **Lazy status sync**: `GET /v1/agent-workflows/:id/runs` checks live DO status (via AGENTS binding) for `running` rows and updates D1 lazily. No push/callback needed — frontend polls by refreshing the runs list.
- **DO ID convention**: `{agentType}-wf-{runId[:8]}` — distinguishes workflow runs from interactive chat spawns (`omni-{nanoid}`).
- **Cron dispatch granularity**: `*/5 * * * *` fires every 5 minutes; dispatcher matches each active `cron` agent's expression against the current UTC time. Supports `*`, `N`, `*/N` field syntax.
- **Soft delete**: agents are marked `status = 'deleted'` not hard-deleted, preserving `agent_runs` history integrity.
- **Agents tab UX**: create form expands inline (no modal); agent cards are collapsible with run history; Play button triggers manual run and refreshes history inline.
- **Local agents**: `execution_target` column reserved in schema for future Tauri local dispatch (Obj 9); all cloud for now.

---

### Objective 9 — Computer Use Agent ✅ COMPLETE

**Design decisions:**
- Loop runs in renderer-process TypeScript (no new worker, no daemon expansion needed) — `invokeMcpTool("studio-desktop", ...)` does all local tool execution via existing Tauri IPC
- Vision calls go to cloud chat completions (`/adapters/openai/v1/chat/completions`) in OpenAI format — image data embedded as `image_url` with base64 data URLs
- `extractMcpImages()` from `mcpInvoker.ts` pulls base64 screenshots from MCP image content responses
- Architecture: async generator `runComputerUse()` yields `ComputerUseStep` events; `useComputerUse` hook drains generator and updates React state; `AbortController` for clean stop
- Screenshot steps yield twice: once as "action" immediately (so user sees something), then again with `screenshot` dataUrl populated once the image arrives
- Tools exposed to LLM: `screenshot_and_analyze`, `annotated_snapshot`, `click_at`, `double_click_at`, `type_text`, `press_hotkey`, `focus_window`, `get_active_window`, `launch_app`, `scroll_at`, `move_mouse`
- Uses `studio-desktop` server (not `studio-harness`) — the desktop server holds all UI automation tools
- Navigation: "computer" added to all View union types (`types/navigation.ts`, `NavigationContext.tsx`, `FloatingMenu.tsx`, `NavPopup.tsx`); added to Tools section in sidebar

**Files added:**
- `STUDIO/src/services/computerUse/computerUseService.ts` — async generator loop + tool definitions + `COMPUTER_USE_TOOLS`
- `STUDIO/src/hooks/useComputerUse.ts` — React hook with `{ isRunning, steps, error, start, stop, clearSteps }`
- `STUDIO/src/pages/ComputerUsePage.tsx` — full page: goal textarea, step log with screenshot thumbnails, start/stop, model override, server status indicator

**Files modified:**
- `STUDIO/src/types/navigation.ts` — added `"computer"`
- `STUDIO/src/contexts/NavigationContext.tsx` — added `"models"` + `"computer"` to local View
- `STUDIO/src/components/layout/FloatingMenu.tsx` — added Computer Use nav item + `MonitorIcon`; added `"models"` + `"computer"` to local View
- `STUDIO/src/components/layout/NavPopup.tsx` — added `"computer"` to local View
- `STUDIO/src/pages/HomePage.tsx` — import + `case "computer": return wrap("computer", <ComputerUsePage />)`
- `STUDIO/src/pages/WorkspacePage.tsx` — fixed unused `createAgent` import; fixed `fileInputRef` prop type

---

### Deferred (no deadline)

- Memory decay/eviction cron
- `mcp.studio.com` external MCP access (after mcp/tools/ is stable internally)
- Provider cleanup: remove Mistral/Cerebras/Cohere/Perplexity from discovery
- Browser automation bundling into release build
- Per-user billing/credits ledger
- `spans` table cleanup (LangGraph leftover)
- Multi-user workspace sharing

---

## 13. Centralized Connection Management System

### Current State (as of Rev 15 — 2026-06-11)

Studio had scattered, inline reliability handling across five different files with no shared state or observability:
- `wsPool.ts` — keepalive + reconnect logic (no events emitted)
- `useHarnessInit.ts` — MCP server health checks + auto-restart (no events emitted)
- `toolExecutor.ts` — approval/answer timeouts via Promise.race (no events emitted)
- `mcp.rs` — dead-process detection (Rust side, no frontend visibility)
- `run_process.ts` — stall detection (MCP server side, no frontend visibility)

**Problem:** Every subsystem handled failures in isolation. The UI had no unified view of "what is broken right now", could not show a Retry button that actually worked, and could not surface MCP server crashes in real time.

### Decision

Build a **centralized connection event bus** at `STUDIO/src/services/connection/` — a singleton (`connectionManager`) that:

1. **Receives events** from every connectivity subsystem via `connectionManager.emit(event)`
2. **Maintains authoritative state** — one Map for WS conversations, one for MCP servers
3. **Re-emits to React** via pub/sub — UI components never import wsPool or any backend module directly
4. **Coordinates manual retry** — wsPool registers `{ retry, canRetry }` callbacks; the UI calls `connectionManager.retry(convId)` without knowing about wsPool

### Two-Layer Architecture

| Layer | Who runs it | What it does |
|---|---|---|
| **Auto** | Workers, Durable Objects, wsPool | Retry/reconnect without UI interaction. CF fiber resumes on reconnect, tool results queued if socket drops, MCP auto-restart every 30s |
| **Manual** | UI software (ConnectionManager → React) | User clicks Retry/Continue. Always surface via `connectionManager.retry()` → wsPool. Frontend is the control panel |

### Files Built

| File | Purpose |
|---|---|
| `STUDIO/src/services/connection/types.ts` | Single source of truth: `CONNECTION_TIMEOUTS`, all event + state types |
| `STUDIO/src/services/connection/ConnectionManager.ts` | Event bus singleton: `emit()`, `on()`, state machines, `retry()` |
| `STUDIO/src/services/connection/index.ts` | Barrel export — only public surface |
| `STUDIO/src/hooks/useConnectionManager.ts` | React binding — subscribe components without knowing backend details |
| `STUDIO/src/components/ui/ConnectionStatusBar.tsx` | UI: reconnecting banner + MCP crash rows + Retry button |

### Files Modified

| File | What changed |
|---|---|
| `STUDIO/src/services/conversations/wsPool.ts` | Imports `connectionManager`; emits `ws:reconnecting/reconnected/failed/connect_timeout`, `task:error`, `task:completed_unread`; registers `{ retry, canRetry }` callbacks; exposes `retryLastTurn()` |
| `STUDIO/src/hooks/useHarnessInit.ts` | Imports `connectionManager`; emits `mcp:crashed/restarting/restored/restart_failed` from health check loop + Tauri event listener |

### Timeout Constants (single source of truth)

```
WS_KEEPALIVE_INTERVAL_MS:  25_000   // prevents CF 90s idle close
WS_CONNECT_TIMEOUT_MS:     10_000   // give up if stuck in CONNECTING
WS_MAX_RECONNECTS:              3   // before marking connection failed
TOOL_APPROVAL_TIMEOUT_MS: 300_000   // 5 min → auto-deny
TOOL_ANSWER_TIMEOUT_MS:   300_000   // 5 min → AI-readable fallback
MCP_HEALTH_CHECK_INTERVAL_MS: 30_000  // Tauri health check interval
MCP_MAX_AUTO_RESTARTS:          5   // give up after N session crashes
CLOUD_LLM_FETCH_TIMEOUT_MS: 20_000  // agents Worker AbortSignal
CLOUD_AGENT_MAX_STEPS:         15   // OmniAgent / CodingAgent loop cap
CLOUD_TOOL_CALL_TIMEOUT_MS: 60_000  // ServiceBindingMCPTool fetch
```

### How to Add a New Subsystem

Any future worker, DO, or service that wants to surface reliability state to the UI:

```ts
import { connectionManager } from "@/services/connection";

// From any subsystem — one line
connectionManager.emit({
  type: "ws:reconnecting",   // or any ConnectionEventType
  timestamp: Date.now(),
  convId,
});
```

The UI picks it up via `useConnectionManager(convId)`. No other wiring needed.

### Still TODO (planned)

- Wire `ConnectionStatusBar` into `ChatProvider` / main chat input area
- Toast system for `task:completed_unread` (background conversation finished)
- Cloud-side reliability: ChatAgent ToolRegistry persistence across DO hibernation (Bug 4), agents Worker LLM fetch timeout + message history persistence (Bugs 10–11)
- `toolExecutor.ts` emitting `tool:approval_timeout` and `tool:answer_timeout` events to ConnectionManager (timeouts exist, events not yet emitted)

---

*Rev 8: 2026-06-10. Objective 3 complete: `mcp/hub/` Worker built as `studio-mcp`. Tools: think, skill_read, web_search, web_fetch, rag, image_generate, video_generate, video_status, http_request. Sub-workers: MCP_MEMORY (studio-mcp-memory) and MCP_YOUTUBE (studio-mcp-youtube) forwarded via service binding. Skills static data copied from chat/ into hub. `MCP` service binding added to `chat/wrangler.toml` and `chat/src/env.ts` for future migration; chat/ still runs cloud tools locally (migration to hub proxy is Objective 3b). Image URLs use `PUBLIC_CHAT_BASE` env var (set to chat Worker public domain). Pending: wrangler deploy for studio-mcp.*

*Rev 12: 2026-06-11. Objective 7 complete: WorkspacePage rebuilt with KB/Memory/Agents tabs. `user_documents` D1 table added to `chat/schema.sql`. Three KB routes added to `chat/src/gateway/routes/kb.ts` and wired in `chat/src/index.ts`. Frontend KB service at `STUDIO/src/services/files/kbService.ts`. Persistent Vectorize scope: `session_id = user_id` so the rag tool can query KB docs cross-session. Memory tab proxies existing `/user/memories` endpoint. Agents tab is a stub for Objective 8.*

*Rev 13: 2026-06-11. Objective 8 complete: `user_agents` + `agent_runs` tables added to `chat/schema.sql`. `agentWorkflows.ts` route file with CRUD + run + lazy-sync history. `*/5 * * * *` dispatch cron in wrangler.toml + scheduled() handler. `agentWorkflowService.ts` frontend service. WorkspacePage Agents tab fully built: inline create form, expandable agent cards with run history, play/delete actions.*

*Rev 14: 2026-06-11. Objective 9 complete: Computer Use Agent. `computerUseService.ts` async generator loop (screenshot→LLM→action, OpenAI tool format, `studio-desktop` MCP server). `useComputerUse` hook. `ComputerUsePage` with step log + screenshot thumbnails. "computer" view added to all local View types + sidebar nav. Zero TypeScript errors after fixes to NavigationContext, NavPopup, WorkspacePage.*

*Rev 15: 2026-06-11. Settings redesign: 4-view → 6-view. New `ShortcutsView.tsx` pulls Recording Hotkey + Voice AI Hotkey + Voice Volume + Pulse overlay + Opacity out of InterfaceView. Harness (Local System Access) toggle moves from orphaned main-page section into LocalServicesView under "SYSTEM INTEGRATION" label. Main tiles renamed: Intelligence→AI Models, Audio→Voice & Audio, Interface & Behavior→Appearance, new Shortcuts & Pulse tile, Local Services→Local AI with Harness included. LocalServicesView now accepts `isTauri`/`harnessEnabled`/`harnessToggling`/`onHarnessToggle` props.*

*Rev 16: 2026-06-11. Section 13 added: Centralized Connection Management System. Foundation built: `services/connection/types.ts` (single source of truth for all timeout constants + event/state types), `ConnectionManager.ts` (event bus singleton with state machines + retry coordination), `index.ts` barrel, `useConnectionManager.ts` React hook, `ConnectionStatusBar.tsx` UI component. wsPool and useHarnessInit updated to emit events. Two-layer architecture: backend auto-retry stays in workers/wsPool/MCP; manual retry always from UI via connectionManager.retry(). Future additions: import from `@/services/connection` and emit one event — everything else is wired.*

---

## 14. Agent Architecture Cleanup + Pre-Deploy Audit Checklist

### 14a. ResearchSubAgent — Retired (Rev 22)

**What was removed:**

| Artifact | Action |
|----------|--------|
| `chat/src/orchestration/specialists/ResearchSubAgent.ts` | Deleted (278 lines) |
| `chat/src/orchestration/agent/SpawnAgentTool.ts` | Deleted (legacy duplicate, never imported) |
| `chat/src/orchestration/tools/cloud/agentic/reportToParent.ts` | Deleted (research-fiber-only) |
| `chat/src/orchestration/tools/cloud/agentic/reportProgress.ts` | Deleted (research-fiber-only) |
| `chat/src/orchestration/tools/cloud/agentic/checkAgentReports.ts` | Deleted (reads ResearchAgentState) |
| `chat/src/orchestration/tools/cloud/agentic/messageAgent.ts` | Deleted (research inbox RPC) |
| `chat/src/orchestration/tools/cloud/agentic/subAgentContext.ts` | Deleted (getActiveResearchAgent helper) |
| `RESEARCH_SUB_AGENT` DO binding in `chat/wrangler.toml` | Removed |
| v4 migration in `chat/wrangler.toml` | Updated: `["ChatAgent"]` only |
| `ChatAgent.getResearchAgent()` + `getResearchAgentStatus()` | Removed from ChatAgent.ts |
| `"research"` type in `AGENT_TYPES` + TypeBox schema | Removed from spawnAgent.ts |
| Research fallback path in `executeSpawn()` | Removed — omni/coding route directly to agents Worker |

**What's still alive:**
- `"omni"` type → routes to `studio-agents/agents/omni-agent/{id}` via AGENTS binding
- `"coding"` type → routes to `studio-agents/agents/coding-agent/{id}` via AGENTS binding
- `cancel_agent` — rewritten to cancel via AGENTS binding (needs `/cancel` endpoint in agents Worker)
- `await_agents` — simplified to agents-Worker-only polling (omni-* and coding-* prefixes)
- `write_to_blackboard` / `read_from_blackboard` — unaffected
- `chat/src/orchestration/specialists/coding/` — inline coding specialist still present, needs rewrite (future)
- `chat/src/orchestration/specialists/base/` — base graph/runtime, used by coding specialist, keep for now

**Why:** ResearchSubAgent was a Durable Object that replicated what OmniAgent already does better (parallel web research, synthesis). Running a research agent as a sub-DO of ChatAgent had isolation and lifecycle problems. OmniAgent in studio-agents Worker is cleaner, independently deployable, and already wired in. Nothing was ever deployed using ResearchSubAgent.

---

### 14b. Native Tools vs MCP Tools — Final Architecture

**The distinction (confirmed by user):**

| Layer | Where it lives | What it is |
|-------|---------------|------------|
| **Native tools** | `chat/src/orchestration/tools/cloud/` | Inline functions that execute inside studio-chat during the agent loop. No protocol overhead. Examples: `web_search`, `rag`, `image_generate`, `video_generate`, `http_request`, `read_files_batch`. |
| **Local MCP** | `extention/` (harness daemon) | Tools that require access to the user's local machine. Exposed via stdio MCP. Examples: file read/write, terminal exec, browser automation. These are NEVER cloud tools. |
| **Cloud MCP Native** | `studio-mcp` hub → sub-workers | True MCP-protocol services: Studio Memory (`studio-mcp-memory`), YouTube transcript (`studio-mcp-youtube`). The hub is a registry+router, not a tool host. |
| **External MCP** | `studio-mcp` hub → Composio / third-party | Composio app integrations (Gmail, Slack, GitHub, etc.) routed through the hub as MCP tool calls. External hosted MCP servers. |

**Objective 3b is CANCELLED.** The plan to move native tools (web_search, rag, image_generate, etc.) from studio-chat into the studio-mcp hub as MCP-protocol tools was the wrong direction. Native tools are NOT MCP tools and should NOT be wrapped in MCP protocol. They run inline because they are synchronous operations in the main agent loop. Moving them to the hub would add a network round-trip, protocol overhead, and lifecycle coupling with no benefit.

**The studio-mcp hub does:**
- Registry: knows which MCP servers are available
- Routing: forwards `mcp_studio_memory__*` calls to `studio-mcp-memory`, `mcp_studio_youtube__*` to `studio-mcp-youtube`, Composio calls via Composio API
- Auth: per-user OAuth tokens for Composio apps

**The studio-mcp hub does NOT:**
- Host native tools (web_search, rag, etc.)
- Replace inline tool execution in the agent loop
- Own the LLM call lifecycle

---

### 14c. Pre-Deploy Audit Checklist

This is the ordered list of what needs to be verified and fixed before first production deploy. Items are grouped by risk level.

#### Tier 1 — Must-fix before deploy

- [ ] **Tracker wiring audit** — verify every worker emits events to TRACKER binding correctly:
  - `studio-chat`: LLM request cost + token tracking per turn
  - `studio-gateway`: per-provider LLM request (worker: 'gateway')
  - `studio-agents`: OmniAgent LLM calls tracked?
  - `studio-mcp`: MCP tool calls tracked?
  - Missing events: tool execution, sub-agent spawn, WS session open/close

- [ ] **Error propagation audit** — no raw errors passed to frontend:
  - Gateway errors → should return structured `{ error: { message, code, type } }` JSON, not raw throws
  - ChatAgent tool errors → verify `ToolResult.error` is formatted, not a stack trace
  - WebSocket error events → `{ type: "error", code: string, message: string }` shape enforced?
  - MCP hub errors → forwarded cleanly or transformed?

- [ ] **Frontend ↔ backend contract verification**:
  - Every WS event type the frontend listens for exists in the backend's emission code
  - Every HTTP endpoint response shape matches what the frontend service expects
  - Check `STUDIO/src/types/` vs `chat/src/pipeline/stream/` event type definitions

- [ ] **Security checklist**:
  - CORS is locked down in all workers (not `*` in production)
  - JWT auth enforced on all routes that need it (`/v1/*` in chat, etc.)
  - No internal service binding routes exposed publicly via api Worker
  - No XSS via unsanitized user content in streaming responses
  - `PUBLIC_CHAT_BASE` set correctly (not empty) before deploy — affects image URLs in mcp/hub

- [ ] **TypeScript errors in agents/ and mcp/ workers**:
  - Run `tsc --noEmit` in `agents/`, `mcp/hub/`, `mcp/memory/`, `mcp/youtube/`, `tracker/`, `api/`, `auth/`
  - Fix all errors before deploy

- [ ] **cancel_agent endpoint** — `agents/` Worker needs `/agents/omni-agent/{id}/cancel` and `/agents/coding-agent/{id}/cancel` POST handlers wired in OmniAgent + CodingAgent DOs

#### Tier 2 — Fix before or shortly after deploy

- [ ] **Unused bindings audit** — check each worker's wrangler.toml for bindings that no code references:
  - Gateway: IMAGES_BUCKET, TEMP_IMAGES_BUCKET, RELEASES_BUCKET — does gateway actually use these or should they only be in chat?
  - Agents: AI_DB (D1) — is it used? By what queries?
  - Chat: ANALYTICS engine — `studio-errors` dataset wired in code?

- [ ] **Unused endpoints audit** — HTTP routes registered in `chat/src/index.ts` and `api/src/index.ts` with no corresponding frontend call

- [ ] **Unused imports** — `tsc` with `noUnusedLocals` and `noUnusedParameters` flags to find dead imports

- [ ] **Connection close behavior** — what happens when:
  - WebSocket closes mid-stream? (ChatAgent hibernation handles this, but verify)
  - Cloudflare 100s request timeout hits? (streaming keeps alive, but verify)
  - App is closed while an agent is running? (OmniAgent DO persists independently — ✓)
  - Queue mechanism for pending tool approvals when WS drops?

- [ ] **Studio Local harness ↔ frontend contract** — verify:
  - Harness stdio MCP tools exposed to chat (via MCP_TOOLS binding in chat wrangler.toml? Or direct WS bridge?)
  - Frontend `useHarnessInit` connects and the event flow to `ConnectionManager` is complete
  - Local MCP tools (file read, terminal) show up in tool registry correctly

#### Tier 3 — Post-deploy verification

- [ ] **D1 schema apply**: `wrangler d1 execute studio-ai --remote --file=./chat/schema.sql`
- [ ] **Set PUBLIC_CHAT_BASE** in `mcp/hub/wrangler.toml` after chat Worker domain is known
- [ ] **Option C**: delete LLM provider keys from studio-chat secrets (keep OPENROUTER_API_KEY, JWT_SECRET, MEMORY_AUTH_SECRET, R2_*, JINA_API_KEY, TAVILY_API_KEY, COMPOSIO_API_KEY)
- [ ] **Deploy order**: tracker → studio-mcp-memory → studio-mcp-youtube → studio-mcp → studio-gateway → studio-agents → studio-chat → Pages frontend
- [ ] **Validate 5-tier model classifier** before switching `AUTO_MODE` from `"static"` to `"dynamic"`
- [ ] **CF AI Gateway** (optional) — route supported providers through CF dashboard after initial deploy confirmed

---

### 14d. CodingAgent (studio-agents) — Rewrite Needed

The `agents/src/agents/CodingAgent.ts` is the Cloudflare DO version. Keep the type `"coding"` in AGENT_TYPES — the routing is wired correctly. But the agent implementation needs a proper rewrite before relying on it in production:

- Currently has a rigid 4-phase protocol that may not generalize well
- Tool set (`list_project_files`, `read_files_batch`) is GitHub-API only — no local file access
- No proper error recovery if GitHub API rate-limits
- Needs the same hibernation-safe fiber pattern as OmniAgent

**Decision:** Keep `"coding"` type in spawnAgent, keep the CodingAgent DO binding in `agents/wrangler.toml`. Rewrite the implementation before exposing it to end users.

*Rev 22: 2026-06-14. ResearchSubAgent retired across 11 files (7 deleted, 4 edited). spawnAgent simplified to omni/coding only. awaitAgents simplified to agents-Worker-only polling. cancelAgent rewritten to route cancel via AGENTS binding. Objective 3b cancelled — native tools stay in studio-chat. MCP hub is registry+router only. Pre-deploy audit checklist added. Both chat and gateway compile zero errors.*

*Rev 23: 2026-06-14. Section 15 added: Refactor-First Phase. Worker evolution history documented. Meta-plan and priority order captured. Desktop vs Web capability split clarified.*

---

## 15. Refactor-First Phase — The Next 1-2 Months

This section captures where the project stands and the plan for the next 1-2 months. The architecture is designed and structurally built across 8 workers. The next phase is: organize each worker's business logic cleanly, wire everything end-to-end, stabilize the critical paths, and only then add features.

---

### 15a. How We Got Here — Worker Evolution

The worker split wasn't planned upfront. It emerged as the right boundaries became clear during development. Each split was driven by a specific dependency or responsibility problem.

**Starting state (3 workers):**

| Worker | What it did |
|--------|------------|
| `ai` | Everything: orchestration + LLM gateway + agent logic + tool execution |
| `api` | Public entry point, auth, routing |
| `auth` | JWT issuing + Google OAuth |

**Current state (8 + 1 workers):**

| Worker | What happened |
|--------|--------------|
| `studio-chat` | Renamed from `ai`. Stripped of gateway layer and specialist agents. Now owns only: ChatAgent DO, WebSocket sessions, cron dispatcher. |
| `studio-gateway` | Extracted from `ai`. LLM routing, provider adapters, model discovery. Both `studio-chat` and `studio-agents` call this via Service Binding. |
| `studio-agents` | New. OmniAgent + CodingAgent Durable Objects. Long-running background agent execution isolated from chat sessions. |
| `studio-mcp` | New. Central MCP hub — registry and router. The only MCP endpoint that chat and agents ever call. |
| `studio-mcp-memory` | Renamed from `studio-memory`. Memory D1 + Vectorize. Memory now correctly lives under the MCP namespace. |
| `studio-mcp-youtube` | YouTube transcript extraction. Existed earlier, now correctly under MCP namespace. |
| `studio-tracker` | New. Telemetry, usage, cost tracking. Receives events from all other workers via Service Binding. |
| `api` | Unchanged. Public gateway. |
| `auth` | Unchanged. JWT + OAuth. |

Also moved from LangGraph → Cloudflare Agents SDK for conversation orchestration. `ChatAgent` is now a first-class Durable Object that owns the ReAct loop explicitly, not a graph compiled from a framework.

**Why each split happened:**
- `gateway` extracted: both `chat` and `agents` need to make LLM calls. If gateway stays inside `chat`, then `agents` depends on `chat` just to call an LLM — wrong dependency direction.
- `agents` extracted: long-running DO execution should be independent from the ChatAgent session lifecycle. Agents can run for hours; a chat session should not be coupled to that.
- `studio-mcp` extracted: MCP routing is a shared concern for both chat and agents. A hub pattern means neither needs to know which capability worker handles what.
- `studio-tracker` extracted: telemetry from all workers needs to go somewhere centralized.

**The design is now stable. No more worker splits planned.**

---

### 15b. Meta-Plan: Refactor → Wire → Stabilize → Features → Ship

**The order matters.** The architecture surface area is large: 8 workers + Tauri desktop app + 4 local MCP servers + 200+ tools. Adding features on top of an unwired system creates compounding debt. The plan: get everything that's been designed to actually work, in the right order.

**Phase 1 — Organize (each worker owns exactly its business logic)**

Each worker should contain only what belongs to it:
- `studio-chat` → conversation state, WebSocket session management, ChatAgent DO, cron dispatch
- `studio-gateway` → LLM routing, provider adapters, model discovery, CF AI Gateway integration
- `studio-agents` → OmniAgent DO, CodingAgent DO, agent lifecycle management
- `studio-mcp` → registry, routing, MCP protocol handling (no tool implementations)
- `studio-mcp-memory` → memory CRUD, extraction, vector search
- `studio-tracker` → events, spans, usage aggregation
- `api` → public auth, routing, job queue, updates

Remove anything in a worker that belongs elsewhere. No cross-contamination.

**Phase 2 — Wire end-to-end**

Work through Section 14c in order (Tier 1 → Tier 2 → Tier 3). Each item is a connection that exists in design but is unverified in running code. Tracker wiring, error propagation, frontend↔backend contracts, TypeScript clean compile — all of these need to be verified, not just assumed.

The local tool flow in particular: cloud AI → WebSocket → Tauri → harness subprocess → result → cloud AI. This is the critical path for the desktop app's value proposition. It needs to be verified end-to-end, not just designed.

**Phase 3 — Stabilize the critical capabilities**

Define "stable": works correctly >95% of the time in normal use, handles errors gracefully, surfaces meaningful feedback to the user when something goes wrong.

Capabilities to stabilize, in this order:
1. Studio-harness local tool execution (file/terminal/git — the core developer workflow)
2. Memory system (extraction + injection + UI management)
3. Local model inference (daemon + Ollama/LM Studio + job queue)
4. Computer use loop (screenshot → LLM → action, proper state management)
5. Cloud agent execution (OmniAgent reliable end-to-end, CodingAgent rewritten)

**Phase 4 — Features**

Only after Phase 3 is complete. New capabilities, new UI features, new providers — none of this starts until the existing capabilities are stable.

**Phase 5 — Ship**

First external release after Phase 4. Not before.

---

### 15c. Priority Order — Next 1-2 Months

Ordered by: foundation first, then critical paths, then reliability, then performance.

| # | Priority | What it means |
|---|----------|---------------|
| 1 | **Tier 1 audit items** | Section 14c checklist — tracker wiring, error propagation, frontend↔backend contracts, TypeScript clean compile, cancel_agent endpoint |
| 2 | **Studio-harness end-to-end** | Verify the local tool round-trip works reliably. This is the desktop app's core value. |
| 3 | **Memory system** | Extraction runs → facts appear in DB → injected into chat → UI shows and manages them. All four links verified. |
| 4 | **Local model inference** | Daemon stable, Ollama/LM Studio integration working, job queue reliable, errors surfaced cleanly |
| 5 | **Telemetry** | Tracker receiving events from all workers, ActivityPage showing real data from all sources |
| 6 | **Error surface** | No raw errors to frontend. Every failure state has a meaningful UI representation. No silent failures. |
| 7 | **Latency baseline** | First-token latency measured and acceptable. Tool round-trips not blocking unnecessarily. |
| 8 | **Computer use hardening** | Loop state management, failure recovery, better feedback when the agent is stuck |
| 9 | **CodingAgent rewrite** | Full rewrite before exposing to end users (see Section 14d) |
| 10 | **Queue system** | Proper job queue for local inference, pending tool approvals, background agent results |

**What does NOT happen before all of the above:**
- New AI providers
- New UI pages
- New MCP tools beyond what already exists
- New agent types
- External MCP access (`mcp.studio.com`)
- Self-hosted deployment option

---

### 15d. Desktop vs Web Capability Split

Two runtime contexts. The split is intentional and permanent. Do not try to close it — it is the right architectural boundary.

| Capability | Desktop (Tauri) | Web (Browser) |
|-----------|:---------------:|:-------------:|
| Chat with cloud AI | ✅ | ✅ |
| Memory (read/write) | ✅ | ✅ |
| MCP cloud tools (memory, YouTube) | ✅ | ✅ |
| Composio app integrations | ✅ | ✅ |
| Knowledge Base (cloud RAG) | ✅ | ✅ |
| **Studio-harness** (file/terminal/git/SSH) | ✅ | ❌ |
| **Computer use** (screenshot/click/type) | ✅ | ❌ |
| **Local model inference** (Ollama/LM Studio) | ✅ | ❌ |
| Voice (local FasterWhisper) | ✅ | ❌ |
| Auto-updates | ✅ | N/A |

**Web** is a useful subset for users who only need cloud AI chat, memory, and integrations.  
**Desktop** is the full product: everything above plus local machine access, local models, and automation.

The desktop app ships with the local MCP servers (studio-harness, computer-use) bundled in the installer. The AI knows which servers are running and what tools they expose.

---

### 15e. Future Vision (After Stable)

Captured here so it doesn't get lost, but none of this is in-scope for the next 1-2 months.

- **Agent marketplace / scheduled agent library** — user-defined agents that run on cron schedules, shareable templates
- **External MCP access** (`mcp.studio.com`) — expose the hub as a real public MCP server for Claude Desktop and other MCP clients
- **Self-hosted deployment** — the worker architecture is designed to run on Cloudflare; a future option where teams run their own Studio instance on their own CF account
- **Agent-to-agent communication improvements** — structured A2A protocol beyond the current spawn/poll pattern; agents that can request clarification from other agents before completing
- **Per-user billing and credits ledger** — real credit system on top of the tracker data
- **Multi-user workspace sharing** — shared KB, shared agent runs, collaborative conversation view

---

## 16. Database Reorganization + Agent Architecture Refactor

*Rev 25: 2026-06-16. Two decisions: (1) D1 database split — remove foreign concerns from `studio-ai`; (2) extract inline coding specialists from `studio-chat` and rebuild in `studio-agents` with proper type scope, system prompts, blackboard, and offline queue.*

---

### 16a. Database Reorganization

#### Problem

`studio-ai` D1 currently holds five table groups with three completely different ownership concerns:

| Tables | Concern | Should own it |
|---|---|---|
| `mcp_servers` | User-installed MCP server registry | MCP hub |
| `composio_config` + `composio_connections` | User OAuth integrations | MCP hub |
| `user_documents` | Persistent user knowledge base | Dedicated user data DB |
| `user_agents` + `agent_runs` | Scheduled agent workflows | Chat (cron dispatcher lives here) |

This mixing means: `studio-chat` touches composio auth, knowledge base docs, and agent scheduling all from one D1 — a worker that should only care about conversation sessions.

#### Decision

**Split into three D1 databases with clear ownership:**

---

**Database 1 — `studio-ai` (chat worker, kept but slimmed)**

Keep only what the chat cron dispatcher actively needs:

```sql
user_agents   — scheduled agent definitions (cron, manual, goal, type)
agent_runs    — execution log (DO id, status, result, error, timestamps)
```

Rationale: `studio-chat` runs the `*/5 * * * *` dispatcher cron. These tables must co-locate with the dispatcher. When agent execution eventually moves to `api/` (or a dedicated scheduler worker), these tables move with it.

---

**Database 2 — `studio-mcp` (MCP hub worker, new D1)**

Create a new D1 bound to `studio-mcp`:

```sql
-- User-installed MCP servers (local & remote)
CREATE TABLE IF NOT EXISTS mcp_servers (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  display_name TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  config       TEXT NOT NULL DEFAULT '{}',
  version      TEXT,
  type         TEXT NOT NULL DEFAULT 'local',   -- 'local' | 'remote'
  endpoint_url TEXT,
  installed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, name)
);

-- Composio API credentials per user
CREATE TABLE IF NOT EXISTS composio_config (
  user_id    TEXT PRIMARY KEY,
  api_key    TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Composio OAuth connections (per-user, per-app)
CREATE TABLE IF NOT EXISTS composio_connections (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  app_name     TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'INITIATED',
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, app_name)
);
```

Rationale: The MCP hub already routes Composio tool execution and MCP server manifests. It should also own the config and connection state that backs those routes. `studio-chat` should call the hub for composio auth state — not query D1 directly.

`studio-mcp` wrangler.toml adds:
```toml
[[d1_databases]]
binding = "MCP_DB"
database_name = "studio-mcp"
database_id   = "<to be created>"
```

---

**Database 3 — `studio-users` (shared user data, new D1)**

Create a new D1 for persistent user-level data. Bound to both `api/` and `studio-chat`:

```sql
-- Persistent knowledge base documents
CREATE TABLE IF NOT EXISTS user_documents (
  id          TEXT    PRIMARY KEY,
  user_id     TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  size        INTEGER NOT NULL DEFAULT 0,
  mime_type   TEXT    NOT NULL DEFAULT 'text/plain',
  r2_key      TEXT    NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  truncated   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_user_docs_user ON user_documents(user_id, created_at DESC);
```

Rationale: KB documents are user data — they have nothing to do with AI session state or agent scheduling. Binding `studio-users` to `api/` means the REST API for KB management no longer needs to proxy through `studio-chat`. `studio-chat` still gets a read binding for RAG-time document lookup.

`api/wrangler.toml` and `chat/wrangler.toml` both add:
```toml
[[d1_databases]]
binding = "USERS_DB"
database_name = "studio-users"
database_id   = "<to be created>"
```

---

#### Migration plan

1. Create `studio-mcp` D1: `wrangler d1 create studio-mcp`
2. Apply schema to `studio-mcp`
3. Migrate data: export from `studio-ai` (`mcp_servers`, `composio_*`), import to `studio-mcp`
4. Update all `studio-mcp` routes to use `MCP_DB` binding (currently using none — hub was stateless)
5. Update `studio-chat` composio routes to call hub instead of querying D1 directly
6. Create `studio-users` D1: `wrangler d1 create studio-users`
7. Apply schema to `studio-users`
8. Migrate data: export `user_documents` from `studio-ai`, import to `studio-users`
9. Update `studio-chat` KB routes to use `USERS_DB` binding
10. Remove `mcp_servers`, `composio_*`, `user_documents` tables from `studio-ai` schema
11. Drop tables from live `studio-ai` after migration verified

---

### 16b. Agent Architecture Refactor — Extract Specialists from Chat

#### Problem

`studio-chat` currently contains `orchestration/specialists/coding/` — an inline coding specialist that runs inside the ChatAgent DO, relaying local tool calls (file read/write, bash, git) to the Tauri client via the WebSocket. This was the original design before `studio-agents` existed. Now that `studio-agents` is built with proper DO lifecycle and GATEWAY routing, the specialists in chat are the last thing that doesn't belong there.

The issue is not just organization — it is architectural: the main chat agent loop should have ONE job (conversation orchestration), and agent execution should be a separate concern in `studio-agents`.

Additionally, the existing `CodingAgent` in `studio-agents` is GitHub-only (no local file access). It needs to be redesigned to handle the local file relay pattern properly.

#### Decision: Two Agent Classes, Properly Separated

---

**Class A — Cloud-only agents (studio-agents, no local machine dependency)**

These run 24/7 in the cloud regardless of whether the user's machine is online.

| Agent | DO class | Tool scope | Use case |
|---|---|---|---|
| `OmniAgent` | exists ✓ | think, web_search, web_fetch, rag, http_request, skill_read | Research, analysis, writing, multi-step web tasks |
| `CodingAgent` | exists, needs rewrite | think, list_project_files, read_files_batch, web_search, http_request | GitHub-repo analysis and code generation (cloud) |

Both agents: LLM via `env.GATEWAY`, tools via `env.MCP_TOOLS` (MCP hub), no local relay.

**CodingAgent rewrite scope** (per Section 14d):
- Replace 4-phase rigid step counter with goal-directed phase transitions
- Add proper error recovery for GitHub API rate limits
- Add hibernation-safe fiber for long tasks
- Keep CODING_TOOL_FILTER as the tool scope boundary

---

**Class B — Local relay agents (studio-chat, redesigned)**

These coordinate local tool execution via the Tauri WebSocket relay. They MUST stay in `studio-chat` because:
1. They need the active WebSocket connection to the Tauri client
2. They relay tool calls through ChatAgent DO state (stored `pendingMessages`)
3. They share the same DO context as the ChatAgent — no extra network hop

**What changes:** Remove `orchestration/specialists/` folder entirely. Replace with a single, clean `orchestration/localAgents/` module:

```
chat/src/orchestration/localAgents/
  index.ts          — LocalAgentConfig, LocalAgentResult types
  runner.ts         — runLocalAgent(config, send) — the relay loop
  agents/
    coder.ts        — system prompt + tool scope for coder
    explorer.ts     — system prompt + tool scope for explorer
    planner.ts      — system prompt + tool scope for planner
    tester.ts       — system prompt + tool scope for tester
    debugger.ts     — system prompt + tool scope for debugger
    reviewer.ts     — system prompt + tool scope for reviewer
```

Each agent file exports:
```typescript
export interface LocalAgentSpec {
  type:        string;
  systemPrompt: string;
  tools:       ReadonlyArray<string>;  // harness tool names allowed
}
```

The runner handles the relay loop — same logic as current `runner.ts` but without the messy inheritance chain. The tool scope for each agent remains the same as the current `CODING_AGENT_TOOL_SETS`.

**Result:** 3-file specialists (index/prompts/runner) becomes 1-file-per-agent + 1 runner. Much cleaner. Still in chat because that's architecturally correct.

---

#### Blackboard — Where It Lives

**Decision: THREE blackboard levels, one per scope.**

| Blackboard | Where | Backed by | Scope |
|---|---|---|---|
| **Conversation blackboard** | ChatAgent DO | DO SQLite (`this.sql`) | Shared within one conversation between main agent, local relay agents, and cloud agents that callback |
| **Agent-internal state** | OmniAgent/CodingAgent DO | DO state (`this.state`) | Private to one agent run |
| **MCP** | Does NOT have a blackboard | — | MCP hub is stateless; no blackboard here |

The conversation blackboard (already built in ChatAgent) is the shared coordination layer. Cloud agents write to it via a new `POST /agents/omni-agent/{id}/blackboard` endpoint that proxies back to ChatAgent through the AGENTS→CHAT service binding. This means any agent — cloud or local relay — can share findings with the main conversation.

---

#### Queue System — Offline Local Tool Relay

**Problem:** Cloud agents (in studio-agents) need local tools when the user's machine is online, but must queue gracefully when it's offline.

**Design:**

New D1 table in `studio-users`:
```sql
CREATE TABLE IF NOT EXISTS pending_local_tasks (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,         -- DO id of the requesting agent
  agent_type  TEXT NOT NULL,         -- 'omni' | 'coding' | 'local'
  conv_id     TEXT,                  -- conversation ID for local relay agents
  tool_name   TEXT NOT NULL,
  tool_args   TEXT NOT NULL,         -- JSON
  status      TEXT NOT NULL DEFAULT 'queued',   -- 'queued' | 'claimed' | 'done' | 'failed'
  result      TEXT,                  -- JSON tool result
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  claimed_at  INTEGER,
  completed_at INTEGER
);
```

Flow:
1. Cloud agent needs a local tool → writes to `pending_local_tasks` via service binding call
2. Tauri daemon polls `GET /v1/local-tasks/pending` when online (every 5s)
3. Daemon claims task (`status = 'claimed'`), executes it locally
4. Daemon posts result `PATCH /v1/local-tasks/{id}/result`
5. Cloud agent polls for its task result via `GET /v1/local-tasks/{id}`
6. Agent resumes with the result

When machine is offline: tasks queue. When machine reconnects, Tauri drains the queue. Long-running agent results still available via DO state when the user returns.

---

#### User-Defined Custom Agents (24/7 Cloud Agents)

The `user_agents` + `agent_runs` tables already support this (Objective 8). The missing pieces:

1. **Agent type enum expansion**: currently `'omni' | 'coding'`. Add future types as new DO classes are built.

2. **Proper tool scope per agent**: user-defined agents should specify which tools they can access. Column `tools_allowed` already exists (JSON string[] | null where null = all). The dispatcher should pass this to the DO's `toolFilter` config.

3. **Local vs cloud flag**: `execution_target` column already exists in schema. When `'local'`, the cron dispatcher writes to `pending_local_tasks` instead of spawning a DO. The daemon picks it up when online.

4. **Result delivery**: agent result lands in `agent_runs.result`. Frontend WorkspacePage Agents tab already polls this. No new frontend work needed.

---

#### Implementation Order

1. Create `studio-mcp` D1 + migrate composio/mcp_servers tables
2. Create `studio-users` D1 + migrate user_documents
3. Rewrite `chat/src/orchestration/specialists/` → `orchestration/localAgents/` (no behavior change, clean structure)
4. Rewrite `agents/src/agents/CodingAgent.ts` (proper rewrite per 14d)
5. Add `pending_local_tasks` table to `studio-users` schema
6. Wire daemon polling endpoint (`GET /v1/local-tasks/pending`) in `chat/` routes
7. Add blackboard callback endpoint to `agents/` worker (`POST /agents/{type}/{id}/blackboard`)

Steps 1-2 are database ops with no code changes to chat logic.
Step 3 is a refactor with no behavior change.
Steps 4-7 are new functionality.
