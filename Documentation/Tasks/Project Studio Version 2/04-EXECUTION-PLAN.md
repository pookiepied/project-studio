# 04 — Execution Plan (Implementation Layer)

> Exact migration order. Architecture reasoning lives in 02/03; this document is only
> *what to do, in what order, and how to know it's done*.
>
> The order is derived from two measured facts (see `01-CURRENT-SYSTEM.md §3`):
> `gateway` is a **leaf** in the binding graph (safe to swap first — already nearly
> done), and `chat/` is the **hub** bound to six workers (must be swapped last among
> cloud services, after its dependencies are stable). Small, low-risk extractions
> (`studio-data`) happen early to shrink `chat/`'s surface before it is replaced.

## Ground rules (every phase)

- Work happens on branch `phase2`; each phase gets a sub-branch (`phase2/p1-gateway`
  etc.) merged into `phase2` when its exit criteria pass; `phase2` merges to `master`
  per completed phase. Production (deployed workers) stays on the old code until each
  phase's cutover step.
- One worker/folder at a time. A phase does not start until the previous phase's
  cutover has run clean for several days of normal use.
- New workers get a guide doc *before* code (the gateway-v2/ai-v2 pattern).
- Cutover = changing a service binding or route; always revertible in one deploy.
- Users must notice nothing (frozen WS protocol; API surface changes only where D12 allows).

---

## Phase 0 — Safety baseline (immediate, on `master`)

| Step | Action | Status |
|---|---|---|
| P0.1 | Commit all pending work to `master` | ✅ done — `799f015` |
| P0.2 | Create private GitHub repo, `git remote add origin …`, push `master` | ☐ owner action (needs account choice) |
| P0.3 | `git tag pre-phase2 && git push --tags` | ☐ after P0.2 |
| P0.4 | Create branch `phase2` | ☐ |
| P0.5 | Commit this Documentation/ structure | ☐ this session |

**Exit:** repo has an off-machine backup; tag and branch exist.

## Phase 1 — Gateway cutover (`gateway-v2/` → deletes `gateway/`)

Why first: leaf worker; v2 already at ~parity (192 files, 9.5k lines, tests); every
later phase calls the gateway, so it must be settled first.

1. **P1.1 Gap audit:** diff old `gateway/src` route surface + provider list against
   gateway-v2; list every capability callers (`chat`, `agents`, `api`) actually invoke
   (grep their `GATEWAY` binding call sites — this is the real contract, not the old
   gateway's full surface).
2. **P1.2 Close the gaps** in gateway-v2 (providers/modalities still missing), with
   tests, per `GATEWAY_GUIDE.md`.
3. **P1.3 Shadow deploy** gateway-v2 as a separately-named service; smoke-test each
   modality through it.
4. **P1.4 Cutover:** switch the `GATEWAY` service binding in `chat`, `agents`, `api`
   to the v2 service (one worker at a time, `api` last). Watch tracker + CF AI Gateway
   analytics for regressions.
5. **P1.5 Delete `gateway/`** after a clean soak. Rename service if desired.

**Exit:** all traffic on gateway-v2; old folder gone; usage counting verified single
(no T14 regression).

## Phase 2 — Data worker (`workers/data/` — merges `chats` + `studio`, shrinks `chat/`)

Why second: tiny (421 lines inherited), zero coupling to the loop, and it must exist
before `studio-ai` (which persists turns via it, per AI_GUIDE) — building it now also
strips ~12 non-AI routes out of `chat/` so Phase 3 replaces a smaller target.

1. **P2.1 Guide doc** `workers/data/DATA_GUIDE.md`: routes, three-bucket layout
   (D3), D1 preferences schema, encryption for the conversations bucket, lifecycle
   rules for uploads.
2. **P2.2 Build `studio-data`**: port ChatsStorage R2 logic + Studio preferences D1
   logic; add the upload/serve/delete routes currently in `chat/` (PDF, image,
   document) and the image/temp cleanup crons.
3. **P2.3 Cutover `api`:** point `CHATS_SERVICE` and `STUDIO` bindings (collapse to
   one `DATA` binding) at `studio-data`; move upload endpoints from `api→chat` to
   `api→studio-data`.
4. **P2.4 Remove** the migrated routes/crons from `chat/` once traffic confirms.
5. **P2.5 Delete** `workers/ChatsStorage/` and `workers/Studio/` after soak.

**Exit:** all user data flows through `studio-data`; `chat/` no longer owns any blob
routes or crons; old storage workers deleted.

## Phase 3 — The shared loop + `studio-ai` cloud (replaces `chat/`)

The core of the refactor. Prereqs: Phases 1–2 done (gateway stable, storage extracted).

1. **P3.1 Amend `ai-v2/AI_GUIDE.md`** per D4, D8, D9 (Agents-worker fate; AI SDK core
   as loop engine via gateway adapter).
2. **P3.2 `packages/agent-loop`:** the shared implementation — ReAct loop on AI SDK
   core, typed tool registry, streaming emitter speaking the frozen WS protocol,
   `SessionBackend` interface, gateway custom-provider adapter (binding + HTTP
   transports). No Workers-only or Node-only APIs outside adapters (D8). Unit-tested
   against a mock gateway.
3. **P3.3 Build `studio-ai` worker:** thin host around the package — WS handling, D1
   `SessionBackend`, service-binding transport, model tier router, per-turn persistence
   to `studio-data`, memory distillation call. No DO, no Agents SDK.
4. **P3.4 Shadow test:** run real conversation transcripts through `studio-ai` in a
   dev deployment; verify frozen-protocol byte-compatibility with the Tauri client
   (the client must not need changes — that is the test).
5. **P3.5 Cutover:** switch `api`'s `AI` binding from `studio-chat` to `studio-ai`.
   Revert path: flip the binding back.
6. **P3.6 Delete `chat/`** after soak. (Its `tools/`, `skills/`, `prompts/` content is
   ported or retired during P3.2–P3.3, tracked in the gap audit.)

**Exit:** cloud conversations run on `studio-ai` with zero client changes; `chat/` gone.

## Phase 4 — TRIAL PHASE: local execution in Studio

Local mode ships behind a Studio setting ("Local execution — experimental") while
cloud mode remains the stable default. This is the trial phase: real usage, opt-in,
instantly revertible per user.

1. **P4.1 Sidecar host:** run `packages/agent-loop` in a Node sidecar bundled with
   Tauri (`127.0.0.1` only): SQLite `SessionBackend`, HTTPS gateway transport via
   `api`, local-daemon provider for Ollama/LM Studio.
2. **P4.2 Registration flow (D10):** every local conversation registers via `api`
   before execution; usage/telemetry/history reported back (`api` → tracker /
   `studio-data`).
3. **P4.3 Local agent state layer:** the shared SQLite agent-state module + skill-store
   contract required by D6/D7 — built *before* the MCP servers that consume it.
4. **P4.4 Local MCP servers**, in order: Agent Spawn MCP → Agent Management MCP (both
   on the P4.3 state layer) → Agent Communication MCP (blackboard replacement) →
   Skill Management MCP → Skill Runtime MCP (both on the skill-store contract) →
   MCP Management tools in studio-harness.
5. **P4.5 Sub-agent parity:** research/coding/exploration/debugging agents running
   locally with resumable state; covers what `agents/` (OmniAgent/CodingAgent) does
   today.

**Exit:** a user can run full conversations and long-running agent tasks locally,
opt-in; every local turn is registered and tracked; sub-agent parity reached.

## Phase 5 — Registry-ification (cloud `skills/`, `mcp/`, `studio-tools`)

Safe to do only after Phase 4: skills must have a local home before the cloud stops
hosting them.

1. **P5.1** Migrate `skills/src/bundled/` content into the local skill store
   (installable via Skill Management MCP); strip `skills/` to registry-only (D5).
2. **P5.2** Finalize `studio-tools` (from `workers/mcp/tools/`): confirm scope (image/
   video gen+edit, RAG, web search/fetch, HTTP), route media generation through
   gateway, settle the name (D11).
3. **P5.3** Register `studio-tools` and `studio-mcp-memory` in the MCP registry; move
   the docs/KB/Vectorize routes from wherever they landed post-Phase 2 into the memory
   worker (per AI_GUIDE out-of-scope table).

**Exit:** cloud skills/MCP workers are pure registries; native tools + memory are
registered MCP servers.

## Phase 6 — Decommission + polish

1. **P6.1** Delete `agents/` (D4 — after P4.5 parity confirmed).
2. **P6.2** Tracker restructure: split `src/lib` into ingest/query/routes; wire
   local-execution telemetry path end-to-end.
3. **P6.3** API/auth endpoint tidy-up accumulated during cutovers (D12 rules).
4. **P6.4** Doc sweep: mark `CHAT_REFACTOR_*.md`, `STUDIO_AGENT_TOOL_PLAN.md`,
   `MCP_PUBLIC_PLAN.md`, `PHASE2_REFACTOR_GUIDE.md` superseded (pointer header or
   move to an archive folder); regenerate `SYSTEM_ARCHITECTURE.md` from the new code.

**Exit:** repo contains only V2 workers + this documentation; `SYSTEM_ARCHITECTURE.md`
matches reality.

---

## Order-of-work summary

| Phase | Folder(s) touched | Deleted at end | Risk | Gate to next |
|---|---|---|---|---|
| 0 | — (git only) | — | none | remote + tag exist |
| 1 | `gateway-v2/` | `gateway/` | low (leaf, tested) | clean soak on v2 |
| 2 | `workers/data/` (new) | `workers/ChatsStorage/`, `workers/Studio/` | low (421 lines) | data flows verified |
| 3 | `packages/agent-loop/`, `ai-v2/` | `chat/` | **high** (hub) | protocol-identical client behavior |
| 4 (trial) | `STUDIO/` sidecar + local MCPs | — | medium (opt-in) | local parity, registration complete |
| 5 | `skills/`, `mcp/`, `workers/mcp/tools/` | bundled skill hosting | low | registries pure |
| 6 | `agents/`, `tracker/`, docs | `agents/` | low | docs match reality |
