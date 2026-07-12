# Studio V2 — Completion Handoff

*Single-pass, autonomous execution brief. 2026-07-12.*

You are picking up **Project Studio Version 2** at a real checkpoint. The
architecture exists, the durable execution engine is built and good, and several
workers are done. What remains is the connective tissue that turns a scaffold
into a working product: the **context playmaker**, the **capability registries
that feed it**, and the **local system tooling** that lets users and the agent
register and run their own MCP servers and skills.

This document gives you (1) the vision so you understand *why* things are shaped
the way they are, (2) an honest map of what exists and its status, (3) the
decisions that have already been made so you do not re-litigate them, and (4) the
work that remains, folder by folder, with the decisions for each locked in
advance. At the end there is an execution protocol: **make a plan, then run it in
goal mode and do not stop until the checkpoint is reached and verified.**

> **Scope note.** This is not a from-scratch build and not a rewrite. Almost
> everything here is *completing and connecting* code that already exists in the
> right shape. When in doubt, extend the existing pattern; do not invent a new one.

---

## Part 1 — The vision (why V2 exists)

### 1.1 The problem V2 solves

Studio's original cloud brain is the **`chat/` worker**. Over time it absorbed
everything: the agent loop, conversation storage, streaming, tool calling,
research behavior, tool hosting, context assembly, skills, personality prompts,
tracking. That concentration made it impossible to maintain, extend, or reason
about. `chat/` is a *reference for good ideas, not a base to build on.* Read it
for inspiration (its prompt assembly, its tool contract, its skill routing), but
we are not extending it. V2 replaces it.

### 1.2 The V2 idea: focused workers with hard boundaries

V2 splits the monolith into workers that each own exactly one responsibility and
talk to each other only through the typed contracts in
[`V2/shared/contracts`](../V2/shared/contracts). The full rationale is in
[`V2/ARCHITECTURE.md`](../V2/ARCHITECTURE.md); the placement rules are in
[`V2/OWNERSHIP.md`](../V2/OWNERSHIP.md); the runtime requirements are in
[`V2/RUNTIME-CHECKLIST.md`](../V2/RUNTIME-CHECKLIST.md). **Read those three files
before writing code.** The one-paragraph version:

- **Execution executes, planning plans, the registry tracks what exists, context
  decides what is relevant, data stores user content.** Nothing reaches into
  another worker's storage. Everything is user-scoped.
- **The runtime is a factory.** You give it input, it gives you output. Policy
  lives above it (frontend/agent definition/context), provider logic lives below
  it (Gateway v2). The loop never swaps models, never scans registries, never
  decides permissions. It emits clean events and respects its neighbors'
  contracts.

### 1.3 The SDK decision (already made — do not reopen)

- **Vercel AI SDK** drives what happens *inside a model step*: streaming, tool
  calling, parallel tools, reasoning, structured output. This is the same SDK
  Gateway v2 already uses.
- **The state/session layer is custom, built directly on Durable Objects** —
  DO SQLite storage, alarms, WebSocket hibernation. **The Cloudflare Agents SDK
  is not used.** We own our durable state so a correctness fix lands once.
- Recovery model is **hybrid**: an append-only execution event log in DO SQLite
  is the source of truth; checkpoints are replay accelerators.

Both sides stay behind Studio-owned interfaces and plain contract types. This is
resolved and implemented. Don't reintroduce the Agents SDK.

### 1.4 Where the model access comes from

Every runtime calls models **only through Gateway v2** (`GATEWAY` service
binding), which exposes an OpenAI-compatible surface. No worker holds provider
credentials or implements provider logic. See
[`V2/shared/runtime/src/gateway/client.ts`](../V2/shared/runtime/src/gateway/client.ts).

---

## Part 2 — System map: what exists and its status

### 2.1 The shared engine (built, solid — treat as a dependency, not a target)

[`V2/shared/runtime`](../V2/shared/runtime) is `@studio/v2-runtime`: the durable
execution engine every runtime worker subclasses. It already implements the hard
parts and you should **not** rebuild them:

- 16-state run lifecycle + transition matrix ([`agent/lifecycle.ts`](../V2/shared/runtime/src/agent/lifecycle.ts))
- Append-only event log + run projection + checkpoints in DO SQLite ([`state/log.ts`](../V2/shared/runtime/src/state/log.ts))
- ReAct loop translating AI SDK stream parts into Studio Runtime Protocol events ([`agent/loop.ts`](../V2/shared/runtime/src/agent/loop.ts))
- Tool boundary: idempotency reservation, approval gate, timeout, result clamp, concurrency coordinator ([`agent/tools.ts`](../V2/shared/runtime/src/agent/tools.ts), [`agent/coordinator.ts`](../V2/shared/runtime/src/agent/coordinator.ts))
- WebSocket hibernation protocol, snapshot + replay, log-before-broadcast ([`streaming/events.ts`](../V2/shared/runtime/src/streaming/events.ts), [`session/RuntimeSession.ts`](../V2/shared/runtime/src/session/RuntimeSession.ts))
- Crash recovery via alarm watchdog; disconnect never cancels
- External-tool relay for local tools (emit `tool.external_requested` → wait → `/external-tools/:id/resolve`)

A runtime specializes the base at exactly three points: `gateTools()`,
`composeSystemPrompt()`, `finalize()` (plus optional `beforeExecute()`).

### 2.2 Worker status table

| Worker | Folder | Status | What's left |
|---|---|---|---|
| Execution Runtime | [`V2/execution-runtime`](../V2/execution-runtime) | 🟢 Working via shared engine | Observability, error taxonomy normalization, client-tool protocol, richer transcript persistence — **WS-2** |
| Planner Runtime | [`V2/planner-runtime`](../V2/planner-runtime) | 🟢 Working | Out of scope — do not deepen (see Non-Goals) |
| Agent Runtime | [`V2/agent-runtime`](../V2/agent-runtime) | 🟢 Loop works; needs Registry `/agents` | Unblocked once **WS-3** lands; deeper delegation is later |
| Registry | [`V2/registry`](../V2/registry) | 🟡 Connectors + MCP + sync built; **skills & agents are `501`** | Implement skills + agents domains — **WS-3** |
| Context | [`V2/context`](../V2/context) | 🔴 Only MCP + connectors builders wired; conversation/user/project/skills/agents throw `not_implemented` | The big one — **WS-1** |
| Data | [`V2/data`](../V2/data) | 🟡 Conversations/uploads/artifacts built | Add plans + execution transcript records — **WS-4** |
| Contracts | [`V2/shared/contracts`](../V2/shared/contracts) | 🟢 Complete | Extend only as needed by the work below |

### 2.3 Existing systems the new work integrates with (do not rewrite these)

- **MCP hub** — [`mcp/`](../mcp). Executes cloud tools. Native services (memory,
  youtube-transcript, studio-tools, studio-skills) via `/internal/native/execute`;
  Composio connectors via `/internal/tools/composio` + `/internal/composio/execute`;
  remote MCP via `/internal/remote/execute`; connection CRUD under
  `/registry/connections`. Context's `sync/platform` already pulls from here.
- **studio-skills worker** — [`skills/`](../skills). A cloud MCP server that
  already implements `skill_read / skill_list / skill_search / skill_validate /
  skill_register_local / skill_unregister_local / skill_install_plan`. This is the
  **cloud skill service** and the bulk of "skill execution/read" already exists.
- **Desktop local registry** — [`STUDIO/src-tauri/src/local_registry.rs`](../STUDIO/src-tauri/src/local_registry.rs).
  Tauri commands: `local_registry_register_stdio`, `local_registry_register_remote`
  (bearer token → OS keyring), `local_registry_list`, `local_registry_remove`,
  `local_registry_sync_payload` (builds the sanitized revisioned payload — bundles
  studio-harness + computer-use, plus user servers). Frontend client:
  [`STUDIO/src/core/mcpRegistry/localRegistry.ts`](../STUDIO/src/core/mcpRegistry/localRegistry.ts).
  Sync target: Registry `POST /sync/local` (already implemented).
- **Bundled local MCP servers** — [`STUDIO/library/mcp-servers/studio-harness`](../STUDIO/mcp-servers/studio-harness)
  (filesystem, git, execution, code intel, LSP, search) and
  [`STUDIO/library/mcp-servers/computer-use`](../STUDIO/mcp-servers/computer-use). These are
  the pattern to copy for new local MCP servers: `TOOL_DEFINITIONS` + `HANDLERS` +
  `dispatch` + `module-info.ts`, spoken over MCP Streamable HTTP (JSON-RPC 2.0).
- **Existing skills** — [`STUDIO/skills/`](../STUDIO/skills) holds `skill_create`,
  `skill_install`, `skill_remove`, `studio-computer-use` as `SKILL.md` + `skill.json`
  folders. These are *skills*, not MCP servers; they define the desired
  create/install/remove behavior in prose.
- **API worker** — [`api/`](../api). WebSocket-friendly entry point; forwards
  `POST /studio/runs` → `EXECUTION_RUNTIME`. **Do not modify API internals** (owner's
  rule). You *may* read it to understand the entry contract, and you may note
  missing forwards (ws/pause/resume/cancel/approval) as a hand-back item.
- **Gateway v2** — [`gateway-v2/`](../gateway-v2). Model access. Do not modify.

---

## Part 3 — Locked decisions (made now, not during execution)

The owner insisted every meaningful decision be made *before* execution. These
are binding for this pass. Where a decision is a judgment call, the rationale is
given so you can defend it, not so you can reopen it.

1. **Context is the playmaker; the runtime stays dumb.** All selection, packing,
   ordering, and the capability-status preamble happen in Studio Context. The
   Execution Runtime consumes a finished `ContextPackage` and never scans.

2. **Context assembles category-by-category, in a fixed order, and injects a
   hard-coded capability-status preamble.** Order: runtime prompt → user (prefs,
   memory, permissions) → project/workspace → conversation history → connectors →
   MCP → skills → agents. The preamble is a single non-looping system line stating
   what is online (e.g. "Studio Harness: online · Computer Use: online ·
   Connectors: 3 authenticated · Cloud MCP: available"). It is appended to
   `RuntimeContext.instructions`, never fabricated by the loop.

3. **Conversation history that Context sends = what the frontend shows in the
   chat page.** For now, send the visible transcript for the branch (from Studio
   Data), lightly trimmed, not a re-derived semantic history. Smarter selection is
   a later iteration; do not build it now.

4. **Skills reach the model through progressive disclosure.** Context sends each
   relevant skill's *summary + activation hint* only. Full `SKILL.md` instructions
   load on demand via the skill-read tool (studio-skills `skill_read`). Never
   inline every skill into every request.

5. **The three new local MCP servers live under a `system/` category and are
   bundled desktop servers** that follow the studio-harness pattern. Names:
   `mcp-management`, `skill-management`, `skill-execution`. They are registered as
   built-in bundles (like studio-harness/computer-use) and their tools route
   through the local relay.

6. **The management MCP servers mutate the local registry through the desktop, not
   by racing its SQLite.** The desktop (Tauri) owns `studio-registry.sqlite3` and
   the OS keyring. The management servers call a **thin local control endpoint
   exposed by the desktop app** (loopback HTTP or the existing Tauri command
   bridge) that wraps the already-verified flows (`local_registry_register_stdio`,
   `local_registry_register_remote`, `local_registry_remove`, and the skill
   register/unregister). Do **not** have a node MCP server open the Tauri SQLite or
   touch the keyring directly — the owner of secrets stays the desktop. After any
   mutation, the server triggers `syncLocalRegistry(...)` so the cloud registry
   converges.

7. **Cloud MCP servers with auth (PAT/bearer) store the secret in the OS keyring
   via the desktop**, exactly as `local_registry_register_remote` already does.
   The registry stores only a `configRef`/`localRegistrationId`, never the token.
   This rule is absolute — no credential ever leaves the desktop into cloud D1.

8. **MCP-server folders get organized by category/subcategory.** Reorganize
   `STUDIO/library/mcp-servers/` into `STUDIO/library/mcp-servers/<category>/<server>` (e.g.
   `harness/studio-harness`, `desktop/computer-use`, `system/mcp-management`,
   `system/skill-management`, `system/skill-execution`). Update every build script,
   `wrangler`/packaging path, and the bundle metadata in `local_registry.rs`
   accordingly. Verify the desktop still launches all bundled servers after the
   move before moving on.

9. **Registry is the source of truth for "what exists"; skills and agents get real
   D1-backed domains** mirroring the connector/MCP domains already there. Repos +
   routes + user scoping on every query.

10. **Planner internals and deep agent delegation are out of scope** for this pass
    (see Non-Goals). Agent Runtime only needs Registry `/agents` to stop being
    blocked; that's WS-3, not new delegation features.

11. **No arbitrary product caps.** Execution stays open-ended (limits undefined =
    unlimited). Any limits are opt-in via context/agent profile. Keep it that way.

12. **Every worker must actually run and pass typecheck/build before the pass is
    "done."** Replace placeholder `database_id`s locally, apply schemas, and prove
    an end-to-end run. Organization and best-practice folder structure are part of
    the deliverable, not a nicety.

---

## Part 4 — The work (folder by folder)

Each work-stream below states **where**, **what to do**, **the decisions already
made**, and **done-when**. Do them roughly in dependency order:
**WS-3 → WS-4 → WS-1 → WS-2 → WS-5 → WS-6 → WS-7.** (Registry and Data feed
Context; Context feeds the runtime; the runtime is polished; then the local system
tooling; then sync; then the whole-system verification pass.)

---

### WS-1 — Studio Context: the playmaker

**Where:** [`V2/context`](../V2/context) — `src/assembly/assemble.ts` and every
builder in `src/builders/`.

**Today:** `assemble.ts` refreshes platform metadata from the MCP hub and wires
only `buildMcpContext` + `buildConnectorContext`. The other five builders
(`conversation`, `user`, `project`, `skills`, `agents`) throw `not_implemented`
and are not called. The package it returns has empty history, no user prefs, no
project files, no skills, no agents, no capability preamble.

**What to do:** Make Context the real playmaker. Implement each builder against the
worker that owns the data (never scan raw storage yourself), wire them all into
`assemble.ts`, run independent builders in parallel, and assemble one compact,
permission-aware, **category-ordered** `ContextPackage`.

- **`conversation.ts`** — pull the branch's visible transcript from **Studio Data**
  (`GET /conversations/:id/messages`), map to `ContextMessage[]`, set
  `currentMessage` to the task. Decision #3: this is the visible transcript, lightly
  trimmed (cap count/length with a generous default), not a semantic re-derivation.
  Prior tool results and attachment refs come from Data too when present.
- **`user.ts`** — preferences, relevant long-term memory, permissions. Memory comes
  from the **memory native service** through the MCP hub
  (`/internal/native/execute`, `serviceId: "memory"`, `memory_recall`/`memory_profile`).
  Keep it to the relevant slice, not a dump.
- **`project.ts`** — relevant files, docs, and `workspace.{location,available}`.
  Availability is derived from the registry snapshot (is a local bundle/harness
  present and available?). File *contents* are never inlined here — only refs and
  optional summaries. When no workspace is connected, return an empty-but-valid
  `ProjectContext` with `workspace.available: false`.
- **`skills.ts`** — call Registry `GET /skills` (WS-3). For each relevant skill emit
  `{ ref, summary, activationHint }` **without** `instructions` (Decision #4). Do a
  cheap task-relevance filter (token/keyword match on name/description/category is
  acceptable for this pass; Decision: no embedding ranking yet).
- **`agents.ts`** — call Registry `GET /agents` (WS-3). Emit `AgentContext` with
  description, location, and `delegatable`. Include the agent **only as delegation
  metadata**, plus (later) a delegation tool descriptor; do not expand agent tools
  into the parent here.
- **`assemble.ts`** — call all builders (parallel where independent), then:
  - Build `tools` from connectors + MCP (already done) and keep the naming/route
    logic in `builders/mcp.ts` and `builders/connectors.ts`.
  - Compose `runtime.systemPrompt` per consumer (keep existing per-consumer text)
    and **append the capability-status preamble** (Decision #2) to
    `runtime.instructions`.
  - Assemble the package in the fixed category order (Decision #2). Keep it
    compact: summaries not bodies, refs not blobs.
  - Fail soft: if a non-critical builder (memory, project) fails, log and continue
    with an empty section; if Registry itself is down, that is a hard error (the
    runtime already treats 501/404 from Context as "no context" and falls back).

**Contracts:** you may add a small `activationHint?: string` to `SkillContext` in
[`context-package.ts`](../V2/shared/contracts/src/context/context-package.ts) if
needed. Keep additions minimal and typed.

**Done when:** For a user with ≥1 connector, ≥1 MCP server, ≥1 skill, and an
existing conversation, `POST /context` returns a package whose `conversation`,
`user`, `project`, `skills`, `agents`, `connectors`, `mcp`, and `tools` are all
populated appropriately, ordered by category, with the capability preamble present
in `runtime.instructions` — and the Execution Runtime consumes it without error.

---

### WS-2 — Execution Runtime: finish the main loop to production

**Where:** [`V2/execution-runtime`](../V2/execution-runtime) and, where a fix is
generic, the shared engine [`V2/shared/runtime`](../V2/shared/runtime).

**Today:** Works through the shared engine. `ExecutionSession.finalize()` writes a
minimal transcript to Data. The genuine gaps are the ones flagged in
[`RUNTIME-CHECKLIST.md`](../V2/RUNTIME-CHECKLIST.md) as ❌/🟡.

**What to do (only these; resist scope creep):**

- **Error taxonomy normalization (§13).** Add the taxonomy
  (`validation, authentication, authorization, rate_limit, provider_transient,
  provider_terminal, tool_transient, tool_terminal, timeout, cancelled,
  runtime_restart, protocol_error`) to contracts, and normalize AI SDK / gateway /
  tool errors into it at the loop and session boundary. Retry only the transient
  classes (backoff already exists); never auto-retry permission denials,
  non-idempotent destructive effects, or unknown tools. Keep it a taxonomy +
  hooks — do **not** over-build automatic retry (owner's explicit caveat).
- **Observability (§1.10).** Emit structured run telemetry (run start/finish,
  per-step usage, tool outcomes, failure summaries) to the existing tracking path.
  A thin, typed emitter is enough; no new dashboards.
- **Client-tool protocol (§7 / tools.ts `client` route).** The `client` route
  currently throws. Define the frontend round-trip (emit a client-action request
  event, park like the external-tool relay, resolve via an HTTP endpoint). Reuse
  the external-tool waiter pattern in `RuntimeSession` — do not invent a second
  mechanism.
- **Transcript fidelity.** `finalize()` persists only user + final assistant text.
  Persist enough for faithful conversation resume (assistant reasoning/text
  channels and tool-call records) into Studio Data via WS-4's records. Keep large
  blobs in object storage; keep structured records in D1.

**Explicitly leave alone:** the state machine, checkpoints, idempotency, approvals,
WebSocket protocol, recovery. They are correct.

**Done when:** A multi-step run with at least one tool call streams events, survives
a simulated DO eviction (resumes from checkpoint), records a faithful transcript in
Data, normalizes an induced provider error into the taxonomy, and emits telemetry.

---

### WS-3 — Registry: implement the skills and agents domains

**Where:** [`V2/registry`](../V2/registry) — `src/domains/skills/repository.ts`,
`src/domains/agents/repository.ts`, `src/server/routes/skills.ts`,
`src/server/routes/agents.ts`.

**Today:** Routes return `501`; repos throw `not_implemented`. The D1 schema for
`skills` and `agents` tables **already exists** in
[`schema.sql`](../V2/registry/schema.sql).

**What to do:** Mirror the connector/MCP domains exactly (they are the template).

- **skills repo + route:** `listSkills`, `getSkill`, `upsertSkill`, `deleteSkill`,
  plus availability/enable toggles. Return `CapabilityRecord`-shaped skill records
  (id, ref{kind:"skill"}, origin, version, enabled, description, `instructions_ref`,
  required tools/permissions, environments, activation rules, resources). **Never
  inline instructions** — `instructions_ref` points at content loaded on demand.
  Every query filters on `user_id` via `requireUser`.
- **agents repo + route:** `listAgents`, `getAgent`, `upsertAgent`, `deleteAgent`.
  Store the `AgentDefinition` JSON (schema already in contracts). `GET /agents/:id`
  must return the shape `agent-runtime`'s `resolveDefinition()` expects
  (`{ agent } | AgentDefinition`) — this **unblocks Agent Runtime** (WS-3 dependency
  for delegation), so match it.
- User scoping and origin (`studio` vs `user`) enforced on write.

**Done when:** Full CRUD works for both, every query is user-scoped, Context's
skills/agents builders (WS-1) read real data, and `agent-runtime` resolves a stored
definition without an inline fallback.

---

### WS-4 — Data: plans and execution transcripts

**Where:** [`V2/data`](../V2/data) — `schema.sql`, `src/index.ts`, new route files.

**Today:** Conversations, messages, uploads, artifacts work. **Planner posts
`/plans` and there is no such route** (it currently fails silently into a progress
event). There is no execution-event/tool-record persistence for faithful resume.

**What to do:**

- **Plans:** add a `plans` table (planId, user_id, conversation_id?, goal, JSON
  body, created_at) and a `plans` route (`POST /plans`, `GET /plans/:id`,
  `GET /plans?conversationId=`). This makes PlannerSession's `finalize()` handoff
  real without touching planner internals.
- **Execution transcript records:** add the structured records WS-2 needs — a
  `message_parts` or `tool_calls` table keyed by conversation/turn/run so the
  assistant's reasoning/text channels and tool-call summaries persist. Large payloads
  → object storage (existing `objects.ts`), references → D1. Keep it minimal and
  queryable; do not duplicate the DO event log — this is the *canonical* post-run
  record, not the live log.

**Done when:** Planner's plan persists and is retrievable; a completed execution run
leaves a transcript that could rebuild the visible conversation.

---

### WS-5 — System MCP servers + folder reorganization

**Where:** [`STUDIO/library/mcp-servers`](../STUDIO/mcp-servers), the desktop
([`STUDIO/src-tauri/src`](../STUDIO/src-tauri/src)), and bundle metadata in
[`local_registry.rs`](../STUDIO/src-tauri/src/local_registry.rs).

This is the largest *new* build. Three bundled local MCP servers under a `system/`
category, plus the folder reorg (Decision #8). Copy the studio-harness pattern
verbatim: `src/index.ts` (Streamable HTTP JSON-RPC), `src/registry.ts`
(`TOOL_DEFINITIONS` + `HANDLERS` + `dispatch`), `src/module-info.ts`,
`src/server.ts`, `tool-schema.ts`. Each tool folder owns its own definitions.

**Decision #6 governs all three:** they mutate the local registry / skills through a
**thin desktop control surface** (loopback HTTP endpoint or Tauri command bridge)
that wraps the already-verified flows. They never touch SQLite or the keyring
directly. After any mutation they trigger a local→cloud sync.

#### 5a. `system/mcp-management` — manage MCP servers

Tools the agent (and UI) can call to curate the user's MCP registry:

- `mcp_add_stdio` — register a local stdio MCP server (command/args/env) →
  wraps `local_registry_register_stdio` (which starts it and discovers tools).
- `mcp_add_remote` — connect a remote/cloud MCP server (endpoint, transport,
  optional bearer/PAT) → wraps `local_registry_register_remote` (token → keyring,
  Decision #7).
- `mcp_add_from_github` — clone/install an MCP server from a GitHub repo. Return a
  **reviewable install plan first** (never auto-run install scripts in one shot;
  mirror `skill_install_plan`'s safety posture), then register on confirmation.
- `mcp_list` — list registered servers + availability (wraps `local_registry_list`).
- `mcp_remove` — deregister (wraps `local_registry_remove`).
- `mcp_enable` / `mcp_disable` — toggle `enabled`.
- `mcp_reverify` — re-run tool discovery / health check.
- Every mutation → trigger `syncLocalRegistry(...)` so cloud D1 converges.

#### 5b. `system/skill-management` — manage skills

- `skill_add` / `skill_create` — create a skill from a folder, an instruction blob,
  or a repo (build on existing `STUDIO/skills/skill_create` + `skill_install`).
- `skill_update` — change an existing skill's content/metadata.
- `skill_remove` — remove a skill (build on `STUDIO/skills/skill_remove`).
- `skill_register` / `skill_unregister` — register/unregister local skill metadata
  into the registry (wraps the desktop path that ultimately calls studio-skills
  `skill_register_local` / `skill_unregister_local`).
- Every mutation → trigger a skills sync so Registry `/skills` (WS-3) converges.

#### 5c. `system/skill-execution` — read and run skills

- `skill_read` — load a skill's full instructions on demand (the progressive-
  disclosure endpoint from Decision #4). For local skills, read `local_path/SKILL.md`;
  for cloud/bundled, proxy studio-skills `skill_read`.
- `skill_list` / `skill_search` — discovery (proxy studio-skills or read local).
- `skill_run` — execute a skill's declared entry behavior where a skill defines one.
  Keep execution constrained to what the skill's manifest allows; no arbitrary code
  execution beyond the skill's declared tools.

> **Note on overlap:** the cloud **studio-skills** worker already implements
> read/list/search/validate/register/unregister/install_plan. `skill-execution` and
> `skill-management` should **delegate to it** for cloud/bundled skills and only add
> the *local desktop* paths (real filesystem create/remove, local registry writes).
> Do not duplicate studio-skills' logic — bridge to it.

#### 5d. Folder reorganization (Decision #8)

Move `STUDIO/library/mcp-servers/*` into `STUDIO/library/mcp-servers/<category>/<server>`. Update
build scripts, packaging/wrangler paths, the desktop launcher that spawns bundled
servers, and the bundle list in `local_registry_sync_payload` (currently hard-codes
`studio-harness` + `computer-use`; add the three `system/*` servers as built-in
bundles). **Verify the desktop launches every bundled server after the move.**

**Done when:** The desktop launches all five bundled servers from their new category
folders; the agent can add a stdio MCP server, a remote MCP server (token in
keyring), and a skill, then list/disable/remove them; every change syncs to cloud
Registry; `skill_read` returns full instructions on demand.

---

### WS-6 — Local → cloud registry convergence for skills

**Where:** desktop `local_registry.rs` + `localRegistry.ts`, Registry `/sync/*`,
studio-skills local registry, Registry `/skills` (WS-3).

**Today:** MCP servers + bundles sync desktop → cloud (`sync_payload` →
`POST /sync/local`). **Skills do not flow through the same revisioned sync** — they
live in studio-skills' own local-registry path.

**What to do:** Extend the sanitized sync so **registered local skills** also
converge into Registry `/skills`, using the same revisioned, credential-free
contract (Decision #7 posture: metadata + refs only, never content or secrets).
Reuse `LocalRegistrySyncRequest` — add a `skills` array to the contract if needed —
and have Registry upsert skills user-scoped. Availability (skill present locally)
mirrors the MCP availability pattern.

**Done when:** A skill registered on the desktop appears in Registry `/skills`,
flows into Context's skill layer (WS-1), and surfaces to the model as a summary with
its full body available via `skill_read` — end to end.

---

### WS-7 — Wire, run, verify, organize

**Where:** every V2 worker `wrangler.toml`, schemas, and the repo at large.

- Replace placeholder `database_id`s locally (`registry`, `data`), apply
  `schema.sql` for each D1-backed worker, confirm service bindings resolve.
- Typecheck + build **every** V2 worker and every touched desktop package. Zero
  type errors is a gate, not a goal.
- **Organization pass (Decision #12):** enforce category/subcategory folder
  structure across `V2/*` and `STUDIO/library/mcp-servers/*`; keep each file single-purpose;
  match the existing comment density and naming. No dead code left from stubs you
  replaced.
- End-to-end smoke: start Registry → Context → Data → Execution Runtime locally
  (miniflare/wrangler dev), issue a run through the API entry contract, watch the
  event stream, confirm tools resolve (cloud via hub, local via relay), confirm the
  transcript and any plan persist.

**Done when:** Everything builds and runs, a real run completes cloud+local tool
calls, and the folder structure is clean.

---

## Part 5 — Non-goals (do not do these in this pass)

- **Do not modify API worker internals** or Gateway v2 (owner's rule). You may note
  that the API's V2 run surface only forwards `POST /runs` and is missing
  ws/pause/resume/cancel/approval/external-tool forwards — record this as a
  hand-back item, do not fix it here.
- **Do not deepen the Planner Runtime.** It works; WS-4 only gives it a `/plans`
  landing spot.
- **Do not build agent delegation features** beyond unblocking Agent Runtime with
  Registry `/agents` (WS-3). Parent→child delegation orchestration is a later phase.
- **Do not reintroduce the Cloudflare Agents SDK** or re-architect the state layer.
- **Do not add product-plan caps** to execution.
- **Do not embed credentials in cloud D1** under any circumstance (Decision #7).
- **Do not port `chat/` code wholesale.** Borrow ideas; keep the boundaries.

---

## Part 6 — Execution protocol (how to run this)

1. **Read first:** [`V2/ARCHITECTURE.md`](../V2/ARCHITECTURE.md),
   [`V2/OWNERSHIP.md`](../V2/OWNERSHIP.md),
   [`V2/RUNTIME-CHECKLIST.md`](../V2/RUNTIME-CHECKLIST.md), and this document.
2. **Write a concrete plan** from Part 4 — break each WS into ordered, checkable
   steps with the done-when as the acceptance test. Follow the dependency order
   (WS-3 → WS-4 → WS-1 → WS-2 → WS-5 → WS-6 → WS-7).
3. **All decisions are already made** (Part 3). If you hit a genuinely new fork not
   covered here, choose the option most consistent with the boundary doctrine
   (Context selects, runtime stays dumb, secrets stay on desktop, registry is the
   source of truth), record it inline, and keep going.
4. **Run in goal mode. Do not stop** at each work-stream to ask permission — stop
   only when the full checkpoint is reached, or when you hit something that
   contradicts a locked decision (surface that, don't guess around it).
5. **Verify every done-when** with a real run, not a claim. A work-stream is not
   complete until its acceptance test passes and the worker builds.
6. **This is a checkpoint, not the whole product.** The target end-state: Context is
   a real playmaker, the registries feed it, the Execution Runtime is production-
   grade, the three system MCP servers exist and are organized, and local skills +
   MCP servers converge to the cloud registry — all building, all running, all
   clean.

---

*End of handoff. The scaffold is good. Complete it in one disciplined pass.*
