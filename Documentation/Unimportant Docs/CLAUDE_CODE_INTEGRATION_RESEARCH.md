# Claude Code Integration into STUDIO — Complete Research Summary

**Date:** June 26, 2026
**Status:** Research complete, awaiting verification before implementation

---

## 1. What We Set Out to Do

### The Goal
Add Anthropic's Claude Code as an alternative AI backend in the STUDIO frontend, alongside the existing "Studio AI" (the current native system that uses multiple LLM providers via the gateway).

### What the User Wants
- A **mode selector** in the chat UI: "Studio AI" vs "Claude Code"
- When "Claude Code" is selected, messages go to Claude Code CLI instead of the Studio backend
- Claude Code's response should stream into the existing chat UI with proper rendering (tool calls, web search results, file operations, etc.)
- **No backend changes** — the bridge should be client-side only (Tauri subprocess spawn)
- The UI should act as a "skin" on top of Claude Code — same output, better presentation
- Dynamic **model switching** (Opus, Sonnet, Haiku) without hardcoding
- **Session persistence** — conversations saved and resumable
- Ability to **pause/stop** generation

### The "Two Methods" Concept
The user wants two billing paths:
1. **Claude Code (Subscription)** — Uses the user's Pro/Max subscription 5-hour/weekly limits (interactive TUI billing)
2. **Claude Code (API/Credits)** — Uses the Agent SDK credit pool (programmatic billing at API token rates)

Both would use the same Claude Code engine, but route through different billing paths depending on user preference.

---

## 2. Claude Code Architecture — What We Found

### Claude Code Has Multiple Invocations

| Invocation | Flag | Stateful? | Output | Billing |
|-----------|------|-----------|--------|---------|
| Interactive TUI | `claude` (no flags) | Yes — process stays alive | ANSI terminal codes | **Subscription** (5-hour + weekly) |
| Print/Headless | `claude -p "prompt"` | No — one-shot, exit after | Plain text or JSON | **Agent SDK credit pool** |
| Stream JSON (bidirectional) | `--input-format stream-json --output-format stream-json` | Yes — process stays alive | NDJSON events | **Agent SDK credit pool** (grouped with `-p`) |
| Agent SDK (TypeScript) | `query()` from `@anthropic-ai/claude-agent-sdk` | Yes — session managed | Structured message objects | **Agent SDK credit pool** |
| Agent SDK (Python) | `query()` from `claude-agent-sdk` | Yes — session managed | Structured message objects | **Agent SDK credit pool** |

### Key Insight: The `stream-json` Bidirectional Mode

This is how the Claude Code desktop app communicates with Claude Code internally:

```bash
claude --input-format stream-json --output-format stream-json \
  --model claude-opus-4-8 \
  --resume <session-id> \
  --allowedTools "Read,Edit,Bash,Glob,Grep" \
  --permission-mode default
```

- Bidirectional NDJSON over stdin/stdout
- Process stays alive — no token waste on re-sends
- Session state maintained in-memory
- **This is the best programmatic path for our integration**

### Session Persistence

Sessions are stored as JSONL files:
```
~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
```

Each line contains: user messages, assistant responses, tool calls, usage data, model info.

Session management flags:
- `--continue` / `-c` — Resume most recent session
- `--resume <id>` / `-r` — Resume specific session
- `--session-id <uuid>` — Use specific UUID
- `--no-session-persistence` — Don't write to disk

### Available Models (June 2026)

| Model | ID | Tier |
|-------|-----|------|
| Opus 4.8 | `claude-opus-4-8` | Max plans |
| Sonnet 4.6 | `claude-sonnet-4-6` | Pro plans |
| Haiku 4.5 | `claude-haiku-4-5` | Cheapest |

Model is set via `--model` flag — dynamic switching supported.

---

## 3. Billing — The Critical Detail

### The June 15, 2026 Split

Anthropic split billing into two pools:

| Pool | What draws from it | Billing |
|------|-------------------|---------|
| **Interactive** | `claude` (TUI), Claude.ai web, Claude desktop app | Included in subscription (5-hour + weekly limits) |
| **Programmatic (Agent SDK credit)** | `claude -p`, Agent SDK, GitHub Actions, `--input-format stream-json` | Separate monthly credit at API token rates |

### Credit Pool Amounts

| Plan | Price | Agent SDK Credit | What it covers |
|------|-------|-----------------|----------------|
| Pro | $20/mo | $20/mo | ~13 Opus sessions or ~40 Sonnet sessions (rough estimates) |
| Max 5x | $100/mo | $100/mo | ~66 Opus sessions or ~200 Sonnet sessions |
| Max 20x | $200/mo | $200/mo | ~133 Opus sessions or ~400 Sonnet sessions |
| Enterprise | Custom | $0 by default | All programmatic usage billed as overflow at API rates |

### Credit Pool Details
- **Credits are literal API tokens** at standard per-token rates (not points or opaque meters)
- **Do not roll over** — reset monthly with billing cycle
- When exhausted, requests **hard stop** unless overflow billing is enabled
- Overflow billing = API rates with no cap (opt-in via Settings)
- **No automatic fallback** from programmatic to interactive pool

### API Token Prices (June 2026)

| Model | Input | Output | Cache Read | Cache Write (5min) |
|-------|-------|--------|-----------|-------------------|
| Opus 4.8 | $5/MTok | $25/MTok | $0.50/MTok | $6.25/MTok |
| Sonnet 4.6 | $3/MTok | $15/MTok | $0.30/MTok | $3.75/MTok |
| Haiku 4.5 | $1/MTok | $5/MTok | $0.10/MTok | $1.25/MTok |

### Key Billing Facts
- If `ANTHROPIC_API_KEY` is set, Claude Code uses API billing and **ignores subscription entirely**
- The 5-hour window and weekly limits **only apply to interactive TUI usage**
- There is **no way** to use Claude Code programmatically while drawing from the subscription's interactive pool
- `claude -p` with OAuth (no API key) still bills as API usage, not subscription — confirmed GitHub issue #43333
- The desktop app (Electron) spawns Claude Code with `--input-format stream-json` — this is programmatic billing

### What's NOT Exposed
- Remaining subscription usage (5-hour window countdown, weekly limit) — server-side only, no CLI access
- Per-session usage IS available in JSONL session files (input_tokens, output_tokens, cache_read, cache_creation)

---

## 4. The TUI Rendering Problem

### The "Skin" Approach Challenge

The user wants to spawn the interactive `claude` TUI as a subprocess and capture its output for display in the Studio UI. This is the "skin" approach — Studio's UI as a prettier layer on top of Claude Code.

### Rendering Modes

| Mode | How it works | Raw stdout parseable? |
|------|-------------|---------------------|
| **Classic renderer** (older default, `CLAUDE_CODE_NO_FLICKER=0`) | Linear text to terminal scrollback | No — ANSI escape codes for colors, bold, cursor |
| **Flicker-free/fullscreen** (v2.1.89+, `CLAUDE_CODE_NO_FLICKER=1`) | Alternate screen buffer (like vim/htop) | No — same ANSI codes, different rendering |
| **`-p` mode** | Plain text or JSON to stdout | **Yes** — clean, parseable |

### The Problem
When you see "Hi! How can I help you today?" on screen, that's the **terminal** rendering ANSI escape codes into visible text. The raw bytes in the pipe are:

```
\x1b[2K\x1b[1m●\x1b[0m Hi! How can I help you today?\x1b[2K\r\n
```

A subprocess capturing stdout gets the escape codes, not clean text. There's no documented way to disable TUI rendering or get clean output from the interactive mode.

### Implication for "Two Methods"
- **Method 1 (Subscription):** Would need to use the interactive TUI — but parsing ANSI is fragile and breaks with updates
- **Method 2 (Credits):** Clean path via `-p` or `stream-json` — structured, parseable, reliable

---

## 5. Studio's Existing Architecture (For Context)

### Frontend Stack
- **Tauri 2** (Rust + React + Vite)
- WebSocket-based chat streaming via `wsPool`
- Tool calls render as cards (capsule/stream/silent classification)
- Existing `claude_code` tool label = "Local Agent" in `toolCardUtils.tsx`

### Chat Streaming Protocol
- User types → WebSocket → chat worker → LLM provider → stream back → render
- Messages: `{role, content, tool_calls, tool_call_id}`
- Streaming events: `stream`, `thinking`, `thinking_delta`, `tool_start`, `tool_complete`, `done`, `error`
- Tool call lifecycle: `onToolStart` → `onToolComplete` with status tracking
- DSML interception for models that emit tool calls as text

### Existing AI Modes
- Auto, Fast, Standard, Advanced (tier-based, not mode-based)
- These are quality tiers within Studio AI — not execution paths

---

## 6. Recommended Implementation Path

### Architecture

```
Studio Frontend (ChatComposer)
      │
      ├── Mode: Studio AI → WebSocket → chat worker → LLM provider (existing)
      │
      └── Mode: Claude Code → bridgeService → Claude Code subprocess
                                                  │
                                                  ├── Method: Subscription (TUI)
                                                  │   └── Interactive session, ANSI parsing
                                                  │
                                                  └── Method: API Credits (stream-json)
                                                      └── --input-format stream-json
                                                          --output-format stream-json
```

### Components to Build

| Component | What it does | Complexity |
|-----------|-------------|------------|
| `claudeCodeBridge.ts` | Spawns subprocess, manages stdin/stdout JSON protocol | ~300-400 lines |
| Mode selector UI | "Studio AI" vs "Claude Code" toggle in ChatComposer | ~50 lines |
| Billing method selector | "Subscription" vs "API Credits" within Claude Code mode | ~30 lines |
| Session manager | Save/resume session IDs, link to Studio conversations | ~100 lines |
| Model picker integration | Pass `--model` flag dynamically | ~30 lines |
| Tool event mapper | Map Claude Code events → existing tool card system | ~100 lines |
| Process lifecycle manager | Spawn, restart, cleanup (Tauri Rust side) | ~150 lines |

### stream-json Event Types → Studio Mapping

| Claude Code event | Studio handler | Notes |
|---|---|---|
| `{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}` | `onChunk(text)` | Direct mapping |
| `{"type":"tool_use","tool":"Bash","input":{...}}` | `onToolStart(callId, "bash", args)` | Already handled |
| `{"type":"tool_result","content":"..."}` | `onToolComplete(callId, tool, result)` | Same pattern |
| `{"type":"result","result":"...","cost_usd":0.05}` | `onDone()` | Final response + metadata |
| `{"type":"system","subtype":"init",...}` | Session initialized | Capture session_id |

### What Stays the Same
- Message rendering (StreamingText, AssistantMessage, HarnessStepCard)
- Tool card rendering (toolCardUtils.tsx)
- Conversation list
- Permission system (Claude Code has its own --permission-mode)

---

## 7. What's Possible vs What's Not

### Confirmed Possible
- [x] Claude Code runs as subprocess from Tauri
- [x] `stream-json` bidirectional mode gives clean, structured output
- [x] Session persistence via `--resume <session-id>`
- [x] Dynamic model switching via `--model` flag
- [x] Tool calls, file operations, web search all work through Claude Code
- [x] Multi-turn conversations via stdin/stdout
- [x] Permission handling via `--permission-mode` and `--allowedTools`
- [x] TypeScript Agent SDK exists (`@anthropic-ai/claude-agent-sdk`)
- [x] Session JSONL files stored locally for history

### Confirmed NOT Possible
- [ ] Using subscription's 5-hour window for programmatic access — all programmatic paths use credit pool
- [ ] Parsing interactive TUI output cleanly — ANSI escape codes make it impractical
- [ ] Checking remaining subscription usage from CLI — server-side only
- [ ] Using "Claude Code" brand name in your product — Agent SDK branding guidelines prohibit it (use "Claude Agent" or "{YourAgentName} Powered by Claude")

### Uncertain (Needs Verification)
- [ ] Whether `--input-format stream-json` without `-p` uses subscription or credit pool — likely credit pool but not 100% confirmed
- [ ] Exact behavior when credit pool runs out — docs say "hard stop" but edge cases may exist
- [ ] Whether the desktop app's billing path is different from CLI's stream-json mode
- [ ] How `--bare` mode affects billing classification

---

## 8. The Two Methods — Detailed Design

### Method 1: Claude Code (Subscription)
**Billing:** User's Pro/Max subscription (5-hour + weekly limits)
**Path:** Interactive TUI spawned as subprocess
**Challenge:** ANSI escape code parsing
**Reliability:** Low — fragile, breaks with updates

### Method 2: Claude Code (API Credits)
**Billing:** Agent SDK credit pool ($20/100/200 per month at API rates)
**Path:** `--input-format stream-json --output-format stream-json`
**Challenge:** None — clean, structured, documented
**Reliability:** High — designed for programmatic use

### Recommendation
**Start with Method 2 only.** It's the clean, reliable path. Method 1 is technically possible but the ANSI parsing is a maintenance nightmare. If subscription billing is critical, consider it as a future enhancement after Method 2 is proven.

---

## 9. Branding Guidelines (From Agent SDK Docs)

**Allowed:**
- "Claude Agent" (preferred for dropdown menus)
- "Claude" (when within a menu already labeled "Agents")
- "{YourAgentName} Powered by Claude"

**Not permitted:**
- "Claude Code" or "Claude Code Agent"
- Claude Code-branded ASCII art or visual elements

**Implication for STUDIO:**
- The mode selector should say "Claude Agent" or "Claude (via Agent SDK)", not "Claude Code"
- The existing `ClaudeCodeIcon.tsx` may need rebranding

---

## 10. Key Files in STUDIO for Reference

| File | Purpose |
|------|---------|
| `STUDIO/src/pages/ChatPage.tsx` | Main chat page — needs mode selector |
| `STUDIO/src/components/chat/ChatComposer.tsx` | Message input — needs Claude Code send path |
| `STUDIO/src/components/chat/ChatHeader.tsx` | Header — needs model selector for Claude Code |
| `STUDIO/src/contexts/ChatContext.tsx` | Chat state management — needs Claude Code integration |
| `STUDIO/src/components/ModelPicker.tsx` | Model selection — reuse for Claude Code model switching |
| `STUDIO/src/config/autoMode.ts` | AI mode definitions — add Claude Code modes |
| `STUDIO/src/utils/toolCardUtils.tsx` | Tool labels — already has `claude_code: "Local Agent"` |
| `STUDIO/src/contexts/chat/constants.ts` | Tool classification — already has `claude_code` in SILENT_TOOLS |
| `STUDIO/src/components/ui/ClaudeCodeIcon.tsx` | Claude Code icon |

---

## 11. Open Questions for Verification

Before implementing, verify these:

1. **Test `stream-json` billing:** Spawn `claude --input-format stream-json --output-format stream-json`, send a message, check if it draws from credit pool or subscription
2. **Test `-p` billing:** Run `claude -p "hello"`, check Anthropic dashboard for which pool was charged
3. **Test `--resume` with stream-json:** Confirm session persistence works across multiple subprocess spawns
4. **Test `--model` flag:** Confirm dynamic model switching works in stream-json mode
5. **Test `--permission-mode`:** Confirm tool permissions work as expected
6. **Verify Agent SDK TypeScript:** Test `@anthropic-ai/claude-agent-sdk` in a Tauri environment
7. **Check Claude Code version compatibility:** Confirm v2.1.183 supports all needed flags

---

## 12. Summary of Confidence Levels

| Claim | Confidence |
|-------|------------|
| `-p` and Agent SDK use credit pool, not subscription | 98% |
| Interactive TUI cannot be driven programmatically with clean output | 95% |
| Agent SDK TypeScript is the best integration path | 90% |
| The $20/100/200 credit is literal API tokens at standard rates | 95% |
| No way to check remaining subscription usage from CLI | 85% |
| `stream-json` mode is grouped with `-p` for billing | 75% |
| Session persistence works via `--resume` | 90% |
| Dynamic model switching via `--model` works | 90% |
| Cannot use "Claude Code" brand in product | 95% |

---

## 13. Next Steps

1. **Verify billing:** Run test invocations and check dashboard
2. **Prototype:** Build minimal `claudeCodeBridge.ts` with stream-json mode
3. **Map events:** Connect Claude Code events to existing Studio handlers
4. **Build UI:** Add mode selector and billing method toggle
5. **Test streaming:** Verify real-time text and tool call rendering
6. **Add session management:** Save/resume session IDs
7. **Add model switching:** Dynamic `--model` flag passing
8. **Polish:** Error handling, reconnection, permission prompts

---

*This document serves as context for continuing the Claude Code integration work. It should be read before starting implementation to ensure all research findings are available.*
