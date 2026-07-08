# 01 — Architecture (the context that drives the structure)

This is the system model the frontend must reflect. It is owner-decided; captured
here so any session reorganizes the code the same way.

## Two domains, not two modes

There is **no user-facing "coding mode."** The user picks **cloud vs local per
conversation** — matching where the capability physically lives.

| | **Cloud domain** | **Local domain** |
|---|---|---|
| Runs in | Cloudflare (Worker / Durable Object) | Bundled process inside the Tauri desktop app |
| Owns | Composio apps (Gmail, Drive, Discord, Slack…), cloud MCP servers, memory, native tools (image/video gen, web search/fetch, HTTP, RAG) | Harness (filesystem, git, code execution), local MCP servers, agents/sub-agents, skills |
| Reachable | Always, anywhere | Only when the host PC is on and connected |

The asymmetry is the honest rule: **cloud things live in the cloud, machine things
live on the machine.** Not a bug to hide.

## The main agent loop — same package, two runtimes

The current chat loop is refactored into a module (**`ai/studio`**). The **same
package** is deployed two ways:

- **Cloud loop** — a CF Worker/DO. Handles cloud-domain conversations end to end.
- **Local loop** — bundled and run **in-process inside the desktop app**. Handles
  local-domain conversations, executing harness tools **directly in-process** —
  no daemon, no subprocess, **no network hop for tool calls**. This is the fix
  for the original latency complaint: brain remote, hands local.

**There is no "mini" version — two exact same versions.** For that to be literally
true, the loop core must be runtime-agnostic (no DOM/React deps); a thin React
driver sits on top in the desktop build. → deferred design note, see `00-INDEX.md`.

**The daemon is retired.** The old `harness → daemon → subprocess` path is removed.

### What the loop talks to (outward only)

The loop calls **the API**, which fronts the **gateway** and the **registries**;
from there the available MCP servers / agents / skills are folded into the system
prompt automatically. The frontend implements none of that logic — it just calls.

## Two selectable engines in the UI

The user selects an engine per conversation. Both stay first-class:

- **Studio AI** → our `ai/studio` loop → our gateway + MCP/agents/skills
  registries. The thing we're building.
- **Claude Code** → the existing CLI bridge (`ai/claude-code`). Uses the user's
  **own** Claude Code subscription; requires Claude Code installed + logged in on
  the PC. We are just a nicer **wrapper over the raw CLI** — no auth of ours, no
  gateway involvement. **Keep intact, zero logic changes** (relocation only).

## Conversations / state — no sync, by design

- **Cloud conversations** — stored server-side (DO), single source of truth. Web
  and desktop read/write the same copy. No sync logic because there's one copy.
- **Local conversations** — stored on the machine (local DB, e.g. SQLite),
  durable and resumable across restarts. **Never synced to cloud** (matches
  Claude Code / Codex precedent — no reason to host project files/session state).
- **No mid-conversation domain switch.** A conversation is cloud- or local-owned
  for its lifetime. If a cloud chat later needs local capability, it's an
  **explicit one-tap handoff**: opens a *new* local conversation seeded with a
  short summary (summary only, not full transcript). One-directional, no ongoing
  sync relationship.

## Registries — all cloud-hosted

MCP, skills, and agent registries are all Cloudflare workers regardless of where
execution happens. They are phonebooks — they hold no conversation state and
execute nothing.

- **MCP registry** tracks cloud MCP servers (URL + token, usable anywhere) and
  local MCP servers (advertised by the local loop when the host is online).
- **Skill registry** — only local skills exist. Cloud skills **rejected** (no
  sandbox to contain side effects).
- **Agent registry** — only local agents exist. Cloud agents **rejected** (same
  sandboxing concern). Sub-agent/swarm orchestration runs locally via a bundled
  MCP the loop calls into.

## Gateway — stays its own worker

The gateway is a separate CF worker (built on the AI SDK). It centralizes provider
credentials (OpenAI, Anthropic, Google AI Studio, fal.ai, ElevenLabs,
OpenRouter-routed models…) as **aliases**, not raw env vars in the client.
**The frontend has zero gateway logic — it only calls the gateway.**

## Remote access to local work — pairing (adapted from OpenClaw)

Solves "I'm away and my task is running on my PC" without making local
conversations cloud-owned.

- **Pairing** — device-identity trust between the host PC and a secondary device,
  bootstrapped via QR/code, backed by platform secure storage (Keychain/TPM), not
  just a login session.
- **Relay** — the secondary device runs no loop. It's a dumb, **end-to-end
  encrypted pipe** forwarding messages to the host PC and streaming responses
  back. It still transits a CF worker/DO for NAT traversal, but that worker sees
  **only ciphertext** — never a conversation store.
- From a paired device the user browses local conversations (metadata only) and
  picks one up; the host PC executes exactly as if the user were local. You lose
  local capability only if the host PC is off — same constraint as local MCP.

## Frontend responsibilities (thin surface)

The client (web or desktop) implements **no** gateway logic, provider selection,
or auth-to-providers. It is UI + client seams:

- **Web client** → talks to the cloud loop only.
- **Desktop client** → talks to the local loop (in-process) for local-domain
  conversations, and to the cloud loop (over the network) for cloud-domain ones.
  Both domains visible in one app; user picks per-conversation, not per-app-mode.

## Explicitly rejected (and why)

| Rejected | Reason |
|---|---|
| Routing local tool-calls through the cloud DO | Network hop per tool call = the original latency complaint |
| A user-facing "coding mode" | Local loop also runs local MCPs, agents, skills — mislabeling recreates "why can't I use my local MCP here" confusion |
| Cloud-hosted skills | No cloud sandbox to contain side effects |
| Cloud-hosted custom agents | Same sandboxing concern; no benefit over local |
| Syncing local conversations to cloud | No reason to host project files/session state; solved by local durability instead |
| Automatic mid-conversation domain migration | Creates dual-ownership/sync problems; replaced by explicit one-directional handoff |
