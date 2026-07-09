# 02 — Naming & Decisions

Every settled decision, with reasoning, so a later agent does not re-open a
closed question. If you believe a decision is wrong, add a new dated entry at the
bottom rather than silently editing an existing one.

---

## D-1 — The subsystem is named **Local Runtime** (module: `runtime/`)

**Decision.** The nameless cloud-drives-local subsystem is called the **Local
Runtime**. Its front-end home is `STUDIO/src/runtime/`. Public imports are
`@/runtime`.

**Why "Runtime" and not the alternatives considered:**

- **Not "MCP Runtime."** MCP is only *today's* payload. The same machinery
  (spawn → transport → permission-gated execution → resume) is intended to later
  drive **agents and sub-agents**, not just MCP tool calls. Naming it after MCP
  would shackle a general mechanism to one of its uses.
- **Not "Local Execution."** "Execution" names only the *act* of running one call.
  This subsystem does far more than execute: it **spawns** subprocesses, runs a
  **health/restart** loop, **gates permissions**, **syncs manifests**, and owns the
  **WebSocket transport**. "Runtime" is the correct term for *the managed
  environment in which local work runs and whose lifecycle is owned* — and it
  extends cleanly to hosting agents later.
- **Not "Bridge" / "Relay" / "Conduit."** "Bridge" collides with the existing,
  shipping **CLI Bridge** feature (`cliBridges/`), which is a different thing. Reusing
  the word guarantees confusion. "Relay" is what the code already calls one hop of
  the flow, so it's too narrow. "Conduit" is fine but less descriptive than
  "Runtime."

**Rename cost is trivial** (a folder name + a barrel export + a path alias), so this
is not a lock-in. If the team later prefers "Local Engine" or another term, it is a
single find-replace. Note that the code *already* uses `localEngineConnected` as the
connectivity flag — "engine" is therefore an available synonym, but it is overloaded
(there is also a chat-"engine" selector for CLI vs cloud), so we avoid it.

---

## D-2 — The CLI Bridge is untouched

`STUDIO/src/cliBridges/` is a real, shipping feature (local Claude Code CLI account
status / command bridge; Codex / OpenCode / KiloCode planned). It is **out of
scope**. Do not move, rename, refactor, or "consolidate" it. Because we are naming
the new subsystem "Local Runtime" (not "Bridge"), the two never collide.

> Optional, non-blocking: if we ever want the word "bridge" freed up entirely,
> `cliBridges/` could later become `features/integrations/cli/`. **Not part of this
> task.** Do not do it here.

---

## D-3 — One cloud agent loop; the runtime is local-only

There is a single agent loop and it runs in the cloud (`chat/`). The Local Runtime
is purely the **local side**: process lifecycle, capability reporting, transport,
permission-gated execution, and tool-card UI. It does **not** contain an agent loop
and we are **not** building a portable/in-process loop. Do not add loop logic to
`runtime/`.

---

## D-4 — The daemon stays

`STUDIO/daemon/` (local Ollama / LM Studio proxy) is real and stays. It is a
separate concern from the Local Runtime (different transport: HTTP, different
purpose: local LLM serving). Its front-end client is `services/local/daemonClient.ts`
+ `hooks/useDaemon.ts` — these go to `core/` (doc 04), **not** into `runtime/`. Do
not conflate the daemon with the runtime.

---

## D-5 — Target top-level layering of `src/`

`src/` gets these top-level homes (full detail in doc 03):

```
app/  runtime/  features/  ui/  core/  lib/  design/  types/
```

- `app/` — bootstrap only (entry, providers, router, shell, global contexts).
- `runtime/` — the Local Runtime (D-1).
- `features/` — one folder per product feature (mostly already correct).
- `ui/` — shared **presentational** primitives only.
- `core/` — cross-cutting infra services (storage, network, errors, logging,
  platform, notifications, connection, daemon client).
- `lib/` — pure helpers (formerly `utils/`).
- `design/` — styles, tokens, fonts.
- `types/` — global shared types only.

**Reasoning:** the split is by *stability and dependency direction*. `ui/`, `lib/`,
`design/`, `types/` are leaf dependencies (imported by everything, import nothing
feature-specific). `core/` and `runtime/` are infrastructure. `features/` compose
them. `app/` wires it all. Imports should flow **downward only**
(`app → features → {runtime, core} → {ui, lib, design, types}`); a lint rule can
enforce this later (non-blocking, see D-8).

---

## D-6 — `rightWorkspace` functionality is NOT dead

The right-side workspace (browser panel, side chat, project launcher, placeholder,
etc.) is real, wanted functionality living in `features/workspace/rightWorkspace/`.
**Keep all of it.** The only action is to move the one stray file
`components/rightWorkspace/ResizeHandle.tsx` into the feature and delete the
resulting empty `components/rightWorkspace/` folder. This is consolidation, not
removal.

---

## D-7 — Dead-code deletions are VERIFY-FIRST, never assumed

Any file proposed for deletion (doc 04 §Dead Code) must first be proven unreferenced:
grep the whole `src/` (and `index.html` / router) for every import path and symbol.
Only delete when the grep returns nothing but the file's own definition. Show the
grep evidence in the commit/PR. Never delete because a file "looks" unused.

---

## D-9 — Shared wire/tool types own the dependency direction (circular-dep fix)

**Verified problem.** `services/ai/types.ts` is a shared type hub. It holds runtime
types (`LocalToolCall`, `ToolResultItem`, `AutoRoutedInfo`) **and** chat API types
(`APIChatMessage`, `ChatRequest`, `ChatResponse`, `TranscribeResponse`), and it is
imported by both runtime-bound files (`wsPool`, `wsMessages`, `toolExecutor`) and chat
files. Separately, `ChatRequestBody` / `AgentChatHandlers` are declared in
`hooks/useAgentChat.ts` but imported **by** `wsPool.ts`. If moved naively, `runtime/`
would import from `features/` — the wrong direction.

**Decision.** Types are placed by who must be able to import them without going
"upward":

- `LocalToolCall`, `ToolResultItem`, `AutoRoutedInfo`, `APIChatMessage` → **`src/types/`**
  (the neutral leaf both `runtime/` and `features/chat/` may import).
- `ChatRequestBody`, `AgentChatHandlers`, the WS envelope messages, and
  `PoolConnectionStatus` → **`runtime/protocol.ts`** (the runtime's public contract;
  chat imports them from `@/runtime`).
- `ChatRequest`, `ChatResponse`, `TranscribeResponse`, `VisionChatMessage` (pure HTTP
  chat shapes) → **`features/chat/services/types.ts`**.

**Consequence.** `hooks/useAgentChat.ts` is **runtime transport glue** (a React driver
over `wsPool`), not chat logic. It moves to **`runtime/transport/useAgentChat.ts`**,
not `features/chat/`. This removes the cross-layer dependency entirely. Final import
flow: `features/chat → @/runtime → @/core → @/types` (downward only).

---

## D-10 — The daemon is HTTP + SSE, not WebSocket

**Verified.** `STUDIO/daemon/` is a plain Express server (`app.listen`) exposing an
OpenAI-compatible REST surface (`/health`, `/v1/models`, `/v1/chat/completions`).
Streaming is **Server-Sent Events** (`text/event-stream`, `data: …\n\n`), not
WebSocket. The front-end client (`daemonClient.ts`) talks to it via `fetch` to
`http://localhost:<port>`. **There is no WebSocket in the local-model path.**

The **only** WebSocket in the system is the **Local Runtime → cloud** transport
(`wsPool` ↔ `chat/` DO). Do not conflate the two: local models = HTTP/SSE (daemon);
cloud agent = WebSocket (runtime). If bidirectional/WS local-model streaming is
wanted later, that is a **new feature on the daemon**, out of scope here.

> Known limitation found while verifying (see doc 06 audit): the daemon's streaming
> branch has a comment "tool calls not supported in streaming mode yet." Flagged, not
> fixed in this task.

---

## D-8 — Deferred / non-blocking (do NOT do in this task)

These are explicitly out of scope so the migration stays focused and reviewable:

- Import-direction **lint enforcement** (dependency-cruiser / eslint boundaries).
  Nice later; not now.
- Rewriting the two local MCP servers or the Rust host beyond an **optional** file
  rename (`mcp.rs` → `runtime.rs`) for symmetry (doc 04 marks it optional).
- Rewriting buggy UI / adding animations. This task is **structure only** — moves,
  renames, splits, and dead-code removal. Behavior must be **unchanged** at every
  step. (Cosmetic/UX rewrites are a separate task after the structure lands.)
- Touching `gateway/` vs `gateway-v2/`, `workers/`, or any non-`STUDIO/` code.
