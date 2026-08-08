# Project Studio V2 — Frontend/Backend Contract

The mental model for how `STUDIO V2/STUDIO` (Tauri + React) and `Project Studio V2`
(Node harness on Flue) talk to each other.

Read this before writing code on either side. Every rule here exists to prevent one
specific class of failure, and the reason is written next to the rule. If a reason
stops being true, the rule is open for renegotiation — not before.

Status: decided. Last verified against `@flue/sdk@1.0.0-beta.9` on 2026-08-03.

---

## 0. The failure this architecture exists to prevent

The reference bug, observed in OpenCode: you send a message, the UI shows nothing,
but the agent is already working — writing files, running tools. You restart the
window to find out what happened.

That bug is **structural**, not sloppy. It follows from one design choice:

> **The frontend holds the truth in memory, and the backend pushes events at it.**

Under that design, a missed event is permanent. There is no way to notice the gap
and no way to repair it, because nothing outside the frontend's memory knows what
the frontend currently believes. Restarting is the only resync, and users learn to
distrust the window.

Project Studio inverts it:

> **The backend's durable conversation stream is the truth. The frontend is a
> projection of it that can always be rebuilt from an offset.**

Divergence is then self-healing by construction. Every reconnect, reload, crash, or
missed frame is repaired by replaying from the last checkpoint. The frontend is
never the only witness to anything.

**This is the sentence the whole architecture serves. Any change that makes the
frontend the sole owner of a piece of conversation state is a regression, no matter
how much simpler it looks.**

---

## 1. Two processes, peers, one shell

| | Backend — `Project Studio V2` | Frontend — `STUDIO V2/STUDIO` |
|---|---|---|
| What it is | Node/TS Flue harness, long-lived local process | Tauri: Rust shell + React UI |
| Owns | Tools, permissions, sandbox, storage, credentials, model routing, all business logic | Window, tray, OS integration, process lifecycle, rendering |
| Runs headless? | Yes — tests run with no Tauri involved | No |

Rust's job is to **spawn and supervise**, never to reimplement or to proxy. Application
traffic does not pass through `invoke`. Keeping Rust out of the request path is what
keeps the backend independently testable and the seam honest.

---

## 2. Transport: settled facts, not preferences

### 2.1 HTTP + SSE. Not WebSocket.

`grep -r "WebSocket|ws://"` across every `@flue/*` package returns zero hits. The
live-mode type is closed:

```ts
type ConversationLiveMode = 'long-poll' | 'sse'
```

WebSocket is not a road not taken — it does not exist in this framework. Adopting it
means building a second transport beside Flue's durable stream and **forfeiting
offset recovery**, which is the exact mechanism that prevents §0. A WebSocket would
be strictly worse at the failure we care most about.

Offsets are opaque resume-after tokens. Pass them back unchanged; never parse or
increment them.

### 2.2 Plain HTTP on `127.0.0.1`. No TLS.

Local HTTPS is the decision teams undo later:

- A self-signed cert makes WebView2 refuse the connection, and the usual "fix" is
  disabling certificate validation — strictly worse than no TLS.
- A real cert means shipping its **private key on every user's disk**.
- Loopback traffic never reaches a network. TLS defends a path that does not exist.

The real threat is another local process reaching the port. TLS does not stop that.
The token does.

### 2.3 Bearer token, generated per launch.

The SDK supports this first-class:

```ts
interface HttpClientOptions {
  baseUrl: string
  fetch?: typeof fetch                    // custom transport
  headers?: Record<string,string> | (() => ...)
  token?: string                          // Bearer, applied to every request
}
```

Worth knowing because it is the usual trap: browser-native `EventSource` **cannot
set headers**, so token-authenticated SSE normally breaks. Flue's SSE is built on the
injectable `fetch`, so the bearer reaches the stream too. This works.

- Rust generates a random token at spawn, passes it to the backend by env.
- New token every launch. Never written to disk.
- The backend still needs admission middleware on the agent route — its README
  already flags this as open. The bearer currently in the codebase is *outbound* to
  the Studio Gateway; it is **not** admission control.

### 2.4 Dynamic port.

The README's `PORT=3000` is for manual runs. The app must not hardcode it — 3000 is
the most contested port on a developer machine. Backend binds `:0`, reports the real
port, Rust passes port and token to the webview together.

---

## 3. The frontend does not hand-write a client

**Use `@flue/react`.** This is the highest-leverage reliability decision in the
document.

`useFlueAgent({ name, id })` implements the §0 guarantee correctly:

- loads the complete canonical snapshot and publishes it **atomically in durable
  order**, so there is no window where half the transcript is visible;
- continues from that exact checkpoint through reconnects and canonical resets;
- reconciles the optimistic local message with its durable copy **without changing
  its transcript position** (no jumping messages);
- exposes `status` and `historyReady` so connecting / submitting / streaming / error
  are distinguishable states rather than one boolean;
- **can attach before, during, or after execution** — the property that makes the
  OpenCode bug impossible. A UI that opens mid-turn sees the whole turn.

Writing this by hand means reimplementing offset checkpointing, atomic snapshot
publication, optimistic reconciliation, canonical-reset handling, and reconnect
resume. That is precisely the code that would carry the bugs we are trying to avoid,
and it is code that already exists, tested, from the same authors as the server.

**Version alignment is a hard rule.** `@flue/react` peer-depends on a matching
`@flue/sdk`:

| Package | Pin |
|---|---|
| `@flue/sdk` (backend) | `1.0.0-beta.9` |
| `@flue/react` (frontend) | `1.0.0-beta.9` — peers `>=1.0.0-beta.3 <1.0.0` ✓ |

Flue 2.0.1 now exists (`@flue/react@2.0.1` peers `@flue/sdk: 2.0.1`, exact). Upgrading
is a **both-sides-together** change, never one side alone. A mismatched pair is a
wire-protocol mismatch, and wire-protocol mismatches present as exactly the
symptom in §0.

Messages are Flue-owned `FlueConversationMessage` values with a parts shape:
`text`, `reasoning`, `dynamic-tool`, `file`. These are Flue's types, not AI SDK
types. Partial text and reasoning are best-effort while streaming; **the completed
canonical assistant message is authoritative** — render partials, trust the final.

---

## 4. Types are mirrored, never re-derived

Re-deriving event types guarantees regret: a second copy of a streaming state
machine that drifts silently, discovered as a rendering bug at 2am.

The conversation event shapes are **not** in `src/contracts/` (that holds errors,
models, capabilities). They live in Flue's `AgentConversationObservation` /
`FlueConversationSnapshot`, surfaced through `src/application/harness-client.ts` —
the file the README already calls "UI-facing send/wait/observe/cancel/history
boundary."

Render Flue's unions directly. If a state exists in Flue and not in our types, it
becomes an unhandled case at runtime:

```ts
phase: 'loading' | 'connecting' | 'live' | 'absent' | 'error' | 'closed'
```

All six must be rendered. `absent` and `closed` are not theoretical.

---

## 5. Durability rules (backend)

`src/db.ts` is correct today and must not regress:

```ts
export default sqlite(process.env.PROJECT_STUDIO_DB_PATH ?? "./data/flue.db")
```

**Node without a durable `db.ts` uses process-local in-memory SQLite — restarting
loses conversations, accepted submissions, and workflow records.** File-backed SQLite
is what makes recovery real. Never swap this for the in-memory default "just for
tests" in a path that production can reach.

**One live process per agent instance.** Node requires a single owner; a shared
database supports *replacement*, not active-active. Two live backends over one DB is
undefined behavior.

This is a **Rust supervision requirement**, not a backend one:
- single-instance guard on the Tauri app;
- never spawn a second backend on reload — the webview reloading must not restart the
  process, because the whole point is that the conversation survives a reload;
- on quit, shut down gracefully — active submissions stop at a turn boundary and
  remain reclaimable;
- detect and adopt-or-kill an orphaned backend from a previous crashed run before
  spawning.

Recovery is deliberately conservative, and the UI must respect it: completed tool
results are reused, and **a tool call with no durable result is reported as
interrupted with unknown outcome rather than silently re-run**. Render that state
honestly — do not collapse "unknown" into "failed" or hide it.

Cancellation is `client.agents.abort(name, id)`. Abort is a **distinct terminal
outcome, not a failure**: it settles queued work before its provider runs, and an
abort that loses the race to a finished response settles as *completed*. The UI must
have a visual state for aborted that is not the error state.

`?wait=result` is best-effort and process-scoped. **Never make the UI depend on
`wait()`** — if that process disappears, settlement arrives through `observe()`.
`wait()` is a convenience for scripts and tests, not the UI's source of truth.

---

## 6. Why new backend capabilities need no new frontend plumbing

This is the organizing property of the whole design, and the reason it stays clean as
MCP, subagents, skills, tools, and sandboxes land.

Every capability is **backend-side agent configuration**, and every one of them
surfaces to the UI through **the same canonical conversation stream**, as parts:

| Capability | How it is added | How the UI sees it |
|---|---|---|
| Custom tools | `tools: [...]` on the agent | `dynamic-tool` part |
| MCP servers | `connectMcpServer(name, {url, headers})` → ordinary tool defs | `dynamic-tool` part, named `mcp__<server>__<tool>` |
| Subagents | `subagents: [defineAgentProfile(...)]` | `dynamic-tool` part for the `task` call |
| Skills | `skills: [...]`, imported `with { type: 'skill' }` | no new surface — guidance, not capability |
| Sandboxes | sandbox config on the agent | tool activity, same stream |

So: **the frontend never grows a new transport, channel, or event type when the
backend grows a new capability.** It grows *renderers* for tool parts. Validated
structured tool output is preserved on the `dynamic-tool` part's `output`, which is
explicitly there so applications can render custom tool interfaces **without a
separate data-event channel**. Do not invent one.

Consequences to hold onto:

- A subagent is **not** a separately addressable endpoint — no `/agents/issue_classifier/:id`.
  Do not model subagents as separate conversations in the UI.
- Subagents write their own durable records inside the parent operation and share the
  parent's timeout/retry budget. A mid-flight subagent resumes in-process on recovery.
- MCP tool names are prefixed by connection: `mcp__inventory__lookup_item`. Namespacing
  is handled; do not re-prefix.
- MCP credentials come from trusted application code, and connections are closed on
  shutdown. Credentials never transit the frontend.
- Skills guide work; they do **not** add executable capability. If something needs to
  *act*, it is a tool or a sandbox, never a skill.
- Sandbox files are **not** covered by conversation persistence. Workspace durability
  and conversation durability are chosen independently. The default virtual sandbox is
  in-memory.

---

## 7. Frontend file layout and the demo-deletion rule

```
src/platform/backend/
  client.ts    # createFlueClient({ baseUrl, token }) — the only place the URL/token are read
  provider.tsx # <FlueProvider client={...}> wiring
  mock.ts      # DELETED at ship — a custom `fetch`, not a fake UI
  index.ts     # the only module that names mock.ts
```

Mock **at the transport seam**, by passing a custom `fetch` into `createFlueClient`.
Never mock at the UI layer. Consequences:

- the real `useFlueAgent` runs in development — its reconnect, reconciliation and
  ordering logic are exercised, not bypassed, so the demo path proves the real path;
- deleting the demo is `rm mock.ts` plus one line in `index.ts`, then `tsc`. Not a
  boolean, not dead code left behind;
- the UI cannot develop a shape-dependency on fake data, because fake data has already
  been through the real projection.

Enforce with an ESLint/oxlint `no-restricted-imports` rule on `mock.ts` so any direct
import fails loudly. Mock responses stay short and obviously synthetic — a leftover
should be *visible*, not plausible. No lorem ipsum.

`src/platform/tauri/window.ts` is the precedent for this shape: one file, one
boundary, no-ops off-Tauri so the same UI runs in a browser. Match it.

---

## 8. Rust seam

Stub now so the seam exists before it is needed:

```rust
fn spawn_backend() -> Result<BackendHandle, Error>   // spawn, capture port+token
#[tauri::command] fn backend_connection() -> {port, token}
```

The webview fetches `{port, token}` via `invoke` on mount, builds the client once,
and passes it to `FlueProvider`. `invoke` is preferred over window-creation injection:
it keeps the seam in one file, and the startup round-trip is not observable next to
process spawn.

Log domains stay separate, and this is deliberate: UI crashes and window state go to
`tauri-plugin-log`; harness failures go to the backend's `StudioError` contract.
Do not funnel UI logs into the harness error taxonomy — that contract's `domain` union
is closed on purpose so an unregistered subsystem is a typecheck failure.

---

## 9. Checklist for any change to this seam

1. Can the frontend still rebuild its entire view from a durable offset? If no, stop.
2. Are `@flue/sdk` and `@flue/react` still the same version on both sides?
3. Does the new capability render through `dynamic-tool`, or did we invent a channel?
4. Is there exactly one live backend process per agent instance?
5. Is any conversation state living **only** in React memory?
6. Are all six `phase` values, plus aborted and interrupted-unknown, rendered?
7. Can the demo still be deleted with `rm` and a typecheck?
