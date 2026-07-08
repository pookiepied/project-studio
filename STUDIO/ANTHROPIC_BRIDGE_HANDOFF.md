# STUDIO ↔ Anthropic Claude Code — Bridge & Continuity Handoff

> **Purpose of this document.** This is a self-contained handoff so a fresh agent
> (OpenAI Codex or otherwise) can pick up the work cold. It covers: what STUDIO's
> Claude integration is, what we already shipped, every file we touched, the
> investigation into making STUDIO conversations visible across the Anthropic
> ecosystem, and the agreed plan going forward. Read this top-to-bottom once, then
> use the file map to jump into code.

---

## 1. The big picture — what STUDIO is and how Claude fits in

STUDIO is a Tauri desktop app (React + TypeScript front end, Rust back end) with a
companion web version. It has its own chat system whose history is stored in
**Cloudflare** (our own cloud DB). Inside that chat, the user can pick an **engine**:

- **`studio`** — our own AI provider stack (API-based).
- **`claude`** — **NOT an API provider.** It is a **CLI bridge**: STUDIO spawns the
  locally-installed `claude` CLI (`claude -p --output-format stream-json …`) as a
  child process and streams its JSON events into the chat UI.

The type that toggles this is `ChatEngine = "studio" | "claude"`.

**Key architectural fact:** When the user talks to "Claude" in STUDIO, they are
really driving the Claude Code CLI under the hood. That CLI writes its own session
history to `~/.claude/` exactly like it does for Claude Code desktop / the VS Code
extension / terminal. This detail is the foundation of the continuity work in §6–8.

### How the bridge runs (current, working)

- **Rust spawn:** `STUDIO/src-tauri/src/commands.rs` → `claude_bridge_start(...)`.
  Spawns `claude -p --verbose --output-format stream-json --include-partial-messages`,
  optionally `--resume <id>`, `--model`, `--permission-mode`, sets
  `MAX_THINKING_TOKENS` env. stdout/stderr lines are emitted to the front end as
  `claude-bridge-output` / `claude-bridge-exit` Tauri events.
- **TS service:** `STUDIO/src/services/ai/claudeBridgeService.ts` wraps invoke +
  event subscription, exposes `runTurn(...)`.
- **State / lifecycle:** `STUDIO/src/contexts/chat/ChatProvider.tsx` owns
  `runClaudeTurn`, parses stream-json events, accumulates `ClaudeSessionMetadata`.
- **Config:** `STUDIO/src/cliBridges/claude/config.ts` (models, effort levels,
  glyphs, `effortToThinkingBudget`). Barrel: `STUDIO/src/cliBridges/index.ts`.

### Multi-turn continuity (already works locally)

Each conversation has a Claude **`sessionId`** (returned by the CLI in the `result`
event). STUDIO stores it in `ClaudeSessionMetadata.sessionId` and passes it back as
`--resume <sessionId>` on the next turn. So within STUDIO, multi-turn already works.
The CLI appends each turn to a local JSONL file (see §6).

---

## 2. What we already shipped this round (committed)

Commit `e78dfac` on branch `master`:
**"Claude bridge: fix thinking bubble, wire effort→thinking budget, remove cost chip"**

Five behaviour changes, all complete and committed:

1. **Studio engine icon.** Added `STUDIO/src/components/ui/StudioIcon.tsx` (renders
   `/logo.png`). `EngineSelector.tsx` now shows it instead of a placeholder circle.
2. **Model speed/capability glyphs.** `ClaudeModelSelector.tsx` shows a per-model
   glyph (lightning / star / sparkle) instead of a repeated robot icon. Glyph
   vocabulary `ClaudeModelGlyph = "leaf" | "lightning" | "star" | "sparkle"` lives in
   `cliBridges/claude/config.ts`, with an `icon` field per model.
3. **Effort → real thinking budget.** `effortToThinkingBudget(low|medium|high|max)`
   → `4096 | 8192 | 16384 | 31999` tokens. Threaded:
   `ChatProvider` → `claudeBridgeService.runTurn({ thinkingBudget })` →
   Rust `claude_bridge_start(thinking_budget)` → `MAX_THINKING_TOKENS` env var.
   (Previously effort was metadata-only and did nothing.)
4. **Fixed lingering "Thinking…" bubble.** Root cause: `isLoading` stayed `true`
   after a successful Claude turn because only the error branches called
   `setIsLoading(false)`. Fix: call it after `handleStreamDone` in the success path
   of `runClaudeTurn` (`ChatProvider.tsx`).
5. **Removed cost/duration chip.** `ChatComposer.tsx` no longer renders the per-turn
   `$x.xxxx / Ns` chip. Reason: Anthropic **paused** the June 15 billing change, so
   `claude -p` still draws from the **subscription** 5-hour window, not separate API
   credits — the dollar figure was misleading noise. We still **accumulate**
   `totalCostUsd` in metadata (ready to re-surface if/when Anthropic ships the
   separate Agent-SDK credit model), just don't display it.

### Other untracked work present in the tree (artifact system)

`STUDIO/src/components/ui/renderers/artifacts/` (new: `WebSearchArtifact.tsx`,
`index.ts`) plus edits to `ArtifactRenderer.tsx` and `TemporaryPage.tsx`. These were
bundled into the same commit but are a **separate workstream** (rich artifact
rendering) — not part of the Anthropic-continuity feature. Mentioned only so you
know why they're in the diff.

---

## 3. Files touched (exact map)

| File | What changed | Workstream |
|---|---|---|
| `STUDIO/src/components/ui/StudioIcon.tsx` | **NEW** — `/logo.png` engine icon | UI polish |
| `STUDIO/src/components/chat/EngineSelector.tsx` | Use `StudioIcon` for Studio option | UI polish |
| `STUDIO/src/components/chat/ClaudeModelSelector.tsx` | Per-model glyph component | UI polish |
| `STUDIO/src/cliBridges/claude/config.ts` | `ClaudeModelGlyph`, per-model `icon`, `effortToThinkingBudget()` | Bridge config |
| `STUDIO/src/cliBridges/index.ts` | Export `effortToThinkingBudget`, `ClaudeModelGlyph` | Bridge config |
| `STUDIO/src/services/ai/claudeBridgeService.ts` | `thinkingBudget?` on turn options, threaded to invoke | Bridge |
| `STUDIO/src-tauri/src/commands.rs` | `thinking_budget: Option<u32>` → `MAX_THINKING_TOKENS` env | Bridge (Rust) |
| `STUDIO/src/contexts/chat/ChatProvider.tsx` | Wire thinking budget; `totalCostUsd` accumulation; **fix `isLoading`** | Bridge |
| `STUDIO/src/types/index.ts` | `totalCostUsd?` on `ClaudeSessionMetadata` | Types |
| `STUDIO/src/components/chat/ChatComposer.tsx` | Remove cost/duration chip | Bridge UI |
| `STUDIO/src/components/ui/renderers/ArtifactRenderer.tsx` | Artifact wiring | Artifacts (separate) |
| `STUDIO/src/components/ui/renderers/artifacts/*` | **NEW** web-search artifact | Artifacts (separate) |
| `STUDIO/src/pages/TemporaryPage.tsx` | Artifact demo | Artifacts (separate) |

`ClaudeSessionMetadata` (current shape, `types/index.ts`):

```ts
export interface ClaudeSessionMetadata {
  sessionId?: string;
  model?: string;
  permissionMode?: string;
  effortLevel?: string;
  cwd?: string;
  lastCostUsd?: number;      // most recent turn
  lastDurationMs?: number;
  totalCostUsd?: number;     // running sum for THIS conversation (not displayed yet)
  lastTurnAt?: number;
  rateLimit?: ClaudeRateLimitInfo;  // real subscription meter (utilization%, resetsAt, isUsingOverage)
}
```

---

## 4. The actual goal we're now solving — ecosystem continuity

The user wants STUDIO to feel like part of the Anthropic ecosystem the way
VS Code makes you feel: **"whatever tool you used, your project, conversations, and
progress are all still there — nothing is left behind."**

Concretely, two directions (the user wants **BOTH** — full bidirectional):

- **Direction A — STUDIO → Claude Code.** A conversation started in STUDIO also
  appears in Claude Code desktop, the VS Code extension, and `claude --resume` in the
  terminal. Start in STUDIO, continue anywhere.
- **Direction B — Claude Code → STUDIO.** Conversations started in Claude Code
  (terminal / desktop / extension) appear in STUDIO's conversation list and can be
  resumed there. STUDIO becomes the hub where everything is visible.

> **Decision (user, this session):** Build **both** A and B (bidirectional). Personal
> lean was A→B first but they explicitly want the full loop. Recommended sequencing
> below in §8.

Note STUDIO additionally mirrors conversations to its **own Cloudflare store** (for
the web version). That stays. The ecosystem-continuity feature is *in addition* to
the Cloudflare store, bridging to Anthropic's **local** session store.

---

## 5. What we investigated and ruled out

We spent real effort confirming the right mechanism instead of guessing:

- **Anthropic cloud / claude.ai sync — NOT possible.** There is no public API to
  register a local `claude -p` session into Anthropic's cloud so it shows on
  claude.ai. Interactive cloud-synced sessions use a separate OAuth-backed store we
  cannot write to. **Dropped.**
- **Claude Code daemon IPC — NOT viable.** `~/.claude/daemon/` uses Windows named
  pipes (`roster.json` shows `\\.\pipe\cc-daemon-…`), an undocumented internal
  protocol. Not a stable integration surface. **Dropped.**
- **Shared storage with GitHub Copilot — does NOT exist.** We checked. Copilot Chat
  stores sessions in `%APPDATA%\Code\User\workspaceStorage\<hash>\chatSessions\*.jsonl`
  (VS Code's own proprietary format, keyed by workspace-folder hash). Claude Code
  uses `~/.claude/projects/…`. They are **completely separate** systems; VS Code just
  shows two independent panels side by side. There is **no cross-vendor protocol** to
  copy. So "be like VS Code" = "write Claude's own native format," not "find a shared
  bus."

**Conclusion:** The Claude-native local store at `~/.claude/projects/` IS the
ecosystem's source of truth. Every Claude surface reads it. Integrating with it is
the correct, non-hacky path — it's literally the same thing Claude Code itself does.

---

## 6. The mechanism — how `~/.claude` storage actually works (verified)

Per-project session files live at:

```
~/.claude/projects/<SANITIZED_CWD>/<sessionId>.jsonl
```

`<SANITIZED_CWD>` is the absolute working-dir path with separators/colons/spaces
replaced by `-`. Verified real example for this project:

```
cwd:  C:\pookiepied\Backup\Project Studio Backup 04
dir:  C--pookiepied-Backup-Project-Studio-Backup-04
```

So the sanitization rule (confirmed against on-disk folders) is roughly:
`cwd.replace(/[:\\/\s]/g, '-')` → collapse the drive colon + backslashes + spaces to
single dashes. **Validate this exactly against existing folder names before writing.**

Each `.jsonl` is append-only, one JSON object per line. Relevant line types we
observed in a real STUDIO-spawned session (`1419f7f8-…`):

- `{"type":"user","message":{...},"entrypoint":"sdk-cli","cwd":"…","sessionId":"…","gitBranch":"master", …}`
- `{"type":"assistant","message":{... usage ...}, "entrypoint":"sdk-cli", …}`
- `{"type":"ai-title","aiTitle":"Say hello","sessionId":"…"}`  ← **the list title**
- `{"type":"last-prompt","lastPrompt":"…","leafUuid":"…"}`     ← **list subtitle**
- `{"type":"queue-operation", …}` and `{"type":"mode", …}`

Some sessions also have a sibling **folder** `~/.claude/projects/<dir>/<sessionId>/`
containing `subagents/` and `tool-results/`. Interactive desktop sessions tend to
have this folder; simple `-p` runs may not. Not required for listing.

### The ONE field that hides STUDIO sessions

| Source | `entrypoint` value |
|---|---|
| STUDIO via `claude -p` | `"sdk-cli"` |
| Claude Code desktop | `"claude-desktop"` |

**Empirical test result (this session):** A STUDIO-spawned test conversation
(`aiTitle:"Say hello"`, id `1419f7f8-…`) did **NOT** appear in Claude Code desktop's
history list. Conclusion: **Claude Code desktop filters its list to
`entrypoint:"claude-desktop"`** (and likely the presence of the session folder /
specific line types). The file is otherwise correctly placed and well-formed.

> This single field is the lever for **Direction A**. Everything else is already
> correct on disk.

There is also a global `~/.claude/history.jsonl`, but it is a **command/prompt
history** (`display`, `project`, `sessionId`, `timestamp`) — NOT the conversation
list. The list is derived from the per-project `.jsonl` files.

---

## 7. Proposed implementation

### Direction B — Claude Code → STUDIO (READ; recommended first, lowest risk)

STUDIO reads the local store and surfaces those sessions in its conversation list.

1. **New Rust command** `list_claude_sessions(cwd: String) -> Vec<ClaudeSessionSummary>`:
   - Sanitize `cwd` → project dir under `~/.claude/projects/`.
   - Enumerate `*.jsonl`. For each, cheaply extract: `sessionId` (filename),
     `aiTitle` (last `ai-title` line), `lastPrompt` (last `last-prompt` line),
     latest `timestamp`, `gitBranch`, message count, and `entrypoint` (to badge
     origin: "CLI" vs "Desktop" vs "STUDIO").
   - Return sorted by recency. (Tail-read / reverse-scan for speed; files can be big.)
2. **New Rust command** `read_claude_session(cwd, sessionId)` to hydrate full
   transcript on click (map Claude message lines → STUDIO message shape).
3. **Front end:** in the conversation list, merge these alongside STUDIO/Cloudflare
   chats with a small **origin badge**. Selecting one loads the transcript and sets
   `ClaudeSessionMetadata.sessionId` so the next message resumes via the existing
   `--resume` path. **No new turn mechanism needed — resume already works.**
4. **Optional:** lightweight file-watcher (notify crate) on the project dir to live-
   refresh the list while Claude Code runs elsewhere.

**Why first:** purely additive, read-only against Anthropic's files; zero risk of
corrupting their store; immediately delivers the "everything is here" feeling.

### Direction A — STUDIO → Claude Code (WRITE; do after B)

Make STUDIO conversations appear in Claude Code desktop/extension.

- **Approach:** after each STUDIO Claude turn completes (we have `sessionId` + `cwd`),
  **patch the session JSONL** so it qualifies for Claude Code's list — at minimum
  rewrite `"entrypoint":"sdk-cli"` → `"entrypoint":"claude-desktop"` for that file.
  Idempotent; re-run after each appended turn.
- **Open question to verify before shipping:** is `entrypoint` *sufficient*, or does
  Claude Code desktop also require the sibling `<sessionId>/` folder or specific line
  types? **Test empirically:** patch the `1419f7f8` file, reopen Claude Code desktop,
  see if "Say hello" appears. Adjust until it does. Do **not** ship A until this is
  confirmed end-to-end.
- **Safety:** only ever touch files whose `sessionId` STUDIO created. Never rewrite
  sessions authored by Claude Code itself. Consider writing via a Rust command with a
  guard that the file's lines carry STUDIO's own marker.

**Risk note:** Direction A mutates files inside Anthropic's store. Keep it minimal,
reversible, and gated behind verification. Direction B touches nothing, so it's the
safe anchor.

---

## 8. Recommended sequencing & open questions

1. **Ship Direction B first** (read-only list + resume). High value, no risk.
2. **Verify the Direction A hypothesis** with the manual patch test on `1419f7f8`.
3. **Ship Direction A** only once the field/folder requirements are empirically
   pinned down.
4. **Then** bidirectional is complete: start anywhere, continue anywhere, see
   everything in STUDIO.

**Open questions to resolve in code:**

- Exact sanitization for drive letters / UNC paths / non-ASCII (verify against the
  real folder list in `~/.claude/projects/`).
- Does Claude Code desktop's list filter on `entrypoint` only, or also require the
  session folder / `ai-title` / `last-prompt` lines? (Empirical.)
- Performance: large `.jsonl` files — implement reverse/tail scanning for summaries.
- De-dup: a conversation may exist in BOTH the Cloudflare store and the local store;
  reconcile by `sessionId` so it shows once with the richer source.

---

## 9. Cross-cutting context the next agent needs

- **Billing reality:** `claude -p` consumes the user's **subscription** 5-hour window
  (Anthropic paused the June 15 separate-credit change). Don't reintroduce dollar
  displays as if they were API credits. The real meter is the `rate_limit_event`
  stream (utilization %, resetsAt, isUsingOverage) captured in
  `ClaudeRateLimitInfo` — surfacing a subscription-utilization panel is a separate
  TODO.
- **The bridge is a CLI bridge, not a provider.** Any "Claude" feature must go through
  the spawned `claude` process, not a direct Anthropic API call.
- **Deferred TODOs (not started):** subscription utilization panel; optional per-turn
  cost on hover (only if billing model changes); re-enable `totalCostUsd` display.
- **Branch:** `master`. Last relevant commit `e78dfac`. Main branch is `main`.
- **Memory:** project context lives in
  `C:\Users\pooki\.claude\projects\C--pookiepied-Backup-Project-Studio-Backup-04\memory\`
  — see `project_cli_bridge.md` for the bridge's running history.

---

## 10. TL;DR for Codex

We built STUDIO's "Claude" engine as a **CLI bridge** to the local `claude` binary,
and just finished a round of fixes (thinking-budget wiring, thinking-bubble bug,
icons/glyphs, removed misleading cost chip — commit `e78dfac`). The **next feature**
is **bidirectional conversation continuity** with the Anthropic ecosystem via the
local store at `~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl`. We proved there
is no cloud API and no shared-with-Copilot bus — the local Claude JSONL store IS the
integration surface. **Direction B (read CLI sessions into STUDIO)** is safe and
should ship first; **Direction A (make STUDIO sessions show in Claude Code by patching
the `entrypoint` field)** ships after an empirical verification test. Implement both
behind Rust commands; resume already works via `--resume <sessionId>`.
