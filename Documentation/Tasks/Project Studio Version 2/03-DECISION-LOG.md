# 03 — Decision Log

> Every settled decision with its reasoning. Statuses: **FINAL** (do not re-litigate
> while building), **REVERSED** (a proposal that was considered and rejected — kept so
> it isn't re-proposed), **DEFERRED** (revisit at a named point).
> New decisions get the next D-number and are recorded here before implementation.

---

### D1 — Work on branches in this repository; no codebase duplication. FINAL
The migration is a strangler pattern: new workers are built alongside old ones in the
same tree (gateway-v2 proved this), so a folder copy protects nothing. Folder-copy
backups ("Backup 04") produced divergent, un-diffable snapshots. The real backup is a
private git remote. Mechanics: baseline committed to `master` (`799f015`), tag
`pre-phase2`, work on branch `phase2`, merge to `master` per completed phase,
short-lived sub-branches for risky cutovers. **Outstanding: add the remote** (P0.2).

### D2 — Strangler migration per worker. FINAL
For each worker: write guide doc → build new alongside old → old stays deployed →
cut callers over binding-by-binding → delete old only after the new one runs clean.
No big-bang rewrite; production stays online throughout.

### D3 — `studio-data` worker with three R2 buckets. FINAL
Merge `workers/ChatsStorage/` + `workers/Studio/` (421 lines combined) into one
`studio-data` worker owning all user data. Three buckets (`user-uploads`,
`conversations`, `generated-content`) rather than one-with-prefixes: different
lifecycle rules (temp expiry vs permanent encrypted), different access patterns, and
a bucket-level encryption boundary for conversations. Also absorbs the upload routes
and blob crons currently in `chat/`.

### D4 — `agents/` worker is removed, not converted to a registry. FINAL
There is nothing for an agent registry to hold: local agents are managed by the local
agent MCPs (D6) and the MCP registry catalogs servers. This amends
`ai-v2/AI_GUIDE.md §0` decision 7 ("studio-agents stays"), which predates the
local-first agent commitment. `agents/` stays deployed untouched until the local agent
system covers its use cases, then is decommissioned. Cloud-resident long-running
agents: DEFERRED — re-evaluate after Phase 4 only if a real need survives.

### D5 — Cloud Skills and MCP workers become registry-only. FINAL
`skills/` keeps registration + discovery metadata; skill bodies, instructions, and
execution move to the local skill store. `mcp/` keeps registration + Composio.
Everything that speaks MCP in our ecosystem registers in the MCP registry.

### D6 — Three local agent MCP servers: Spawn, Communication, Management. FINAL
Owner decision. Spawn (create/start/cancel), Communication (structured inter-agent
messaging replacing the blackboard), Management (create/remove/delete/manage).
*A two-server merge of Spawn+Management was proposed and REVERSED by the owner* —
the categories are intentionally kept distinct, matching how tools and runtime
concerns are managed separately. **Binding constraint accepted with this decision:**
Spawn and Management share agent lifecycle state, so both consume one shared
agent-state module (single SQLite store, single ID namespace) defined before either
server is built. Neither server owns private lifecycle state.

### D7 — Two local skill MCP servers: Skill Management and Skill Runtime. FINAL
Owner decision. Management: install/remove/add, from folders and URLs, location
management. Runtime: read/run/interact. *A single-server merge was proposed and
REVERSED by the owner.* **Same binding constraint as D6:** both servers consume one
skill-store contract (directory layout, metadata format) defined once in the local
runtime, not two private views of the disk.

### D8 — Vendor lock-in is defined by replaceability, not by vendor name. FINAL
This resolves the earlier inconsistency (full AI-SDK usage vs "never import it").

Two different things were being called "lock-in":

| Kind | Example | Swap cost | Verdict |
|---|---|---|---|
| **Library abstraction** | Vercel AI SDK | Rewrite one in-process layer; architecture unchanged | Acceptable |
| **Infrastructure coupling** | Durable Objects, Cloudflare Agents SDK, WS hibernation | Architecture is *shaped* by the platform; cannot run elsewhere at all | Forbidden in the core loop |

The Cloudflare Agents SDK is the second kind — it is why the loop cannot run locally
today. The Vercel AI SDK is the first kind — it runs on Workers *and* Node, which is
exactly the dual-runtime requirement. **Forbidden inside `packages/agent-loop` and
`studio-ai`:** `agents` (Cloudflare SDK), Durable Object classes/bindings, DO-attached
storage, any API that exists only on one runtime. Platform differences live in named
adapter interfaces (`SessionBackend`, gateway transport) only.

### D9 — Vercel AI SDK is the loop engine; provider packages live only in the gateway. FINAL
Full resolution of "use the AI SDK properly":

1. **`studio-gateway`** keeps using AI SDK **provider packages** (`@ai-sdk/openai`,
   etc.) — that is its job as the provider boundary.
2. **`packages/agent-loop`** (shared cloud/local loop) uses AI SDK **core**
   (`streamText`, tool-loop control, typed tools, streaming primitives) as its engine —
   this is the "take full advantage" requirement — but reaches models exclusively
   through **one custom provider adapter that speaks to `studio-gateway`**
   (service binding in cloud, HTTPS locally, local daemon for local models).
3. No `@ai-sdk/<vendor>` package is ever imported outside `gateway-v2/`.

This amends `ai-v2/AI_GUIDE.md §0` decision 3 from "studio-ai never imports
`@ai-sdk/*`" to "studio-ai imports AI SDK core only, via the gateway adapter."
Why this is safe under D8: replacing the AI SDK later means rewriting one loop engine
and one adapter; nothing about worker topology, protocols, or state changes.

### D10 — Registration terminology. FINAL
Local conversations register through **`api`** (auth, conversation registration,
usage, telemetry relay) — not "through Gateway". Gateway is an internal provider
router with no public URL. Inference from local loops using cloud models flows
`api → gateway → provider`; local-model inference goes to the local daemon but the
turn is still registered via `api`. (Earlier wording said "Gateway"; that was a
communication slip, corrected by the owner.)

### D11 — Naming. FINAL (names provisional where noted)
`chat/` → **`studio-ai`**. Merged storage worker → **`studio-data`**. Cloud tools MCP
→ **`studio-tools`** (provisional; rename cost is one wrangler service name — decide
at registration time). `workers/mcp/youtube-transcript/` is third-party and ignored.

### D13 — Cloud/local capability parity is a hard constraint. FINAL
Every capability available locally must have a defined cloud equivalent and vice
versa; no environment may depend on functionality the other cannot support. Each
capability's dual implementation is documented in `06-AGENT-RUNTIME-DESIGN.md`
(§3 adapters, §4 inventory, §7 failure-mode audit) before it is built. Accepted
asymmetries must be explicit and surfaced in UI (currently one: local-daemon models
work offline, cloud models don't). Storage embodiment: one SQL schema on
SQLite-locally / D1-in-cloud — chosen precisely because D1 *is* SQLite, so a single
schema and query layer runs on both with only the driver swapped.

### D14 — The Cloudflare Agents SDK and Durable Objects are fully removed from the agent runtime. FINAL
Confirmed by implementation analysis (not assumption): the SDK appears in only three
hosting shells; both ReAct loops are already SDK-free; the code contains active
workarounds for SDK behavior (post-hibernation registry rebuild, forced-await memory
distillation); and the resilience pattern in `agents/src/runtime/agentDO.ts`
(heartbeat + generation token + bounded resume) is portable logic that needs a
transactional store, not an actor platform. The six SDK capabilities in use and
their replacements are enumerated in `06-AGENT-RUNTIME-DESIGN.md §1–§3`. Two costs
accepted with mitigations: hibernation economics → turn-scoped WebSockets with the
existing catch-up path; single-actor serialization → generation-token optimistic
concurrency (already implemented in agentDO.ts, promoted to shared code).

### D12 — Auth/JWT architecture unchanged. FINAL
`STUDIO_MASTER_PLAN.md §0` stands: auth issues, api verifies, mcp hub verifies;
`packages/jwt` imported nowhere else. Public surfaces remain exactly `auth`, `api`,
`mcp` hub. New workers get no public domains; revisit only if one must be
internet-reachable.

### D15 — `studio-ai` is a research-led rebuild, not a port. The old code is inspiration only. FINAL
Owner methodology decision, governing how Phase 3 is executed.

1. **The current `chat/` (and `agents/`) code is a reference, not a source to lift.**
   Where docs 04/05/06 say "port X" or "ported unchanged," read it as *"re-derive X
   with fresh research, using the old implementation as inspiration"* — **not** copy
   the file across. The old ReAct loop and `expand_tools`/tiering exist for real
   reasons (tool tiering is deliberate), so they inform the rebuild; they do not
   dictate it.
2. **One decision at a time, decided at the moment it is reached — not now.** Each
   building block (starting with the main agent loop) is settled with the research in
   front of us, not pre-committed in these docs. Explicitly *undecided until then*:
   transport (**WebSocket vs HTTP**), and any other mechanism the docs currently state
   as if fixed.
3. **The per-decision procedure** (apply to every block):
   a. Study how today's main agent loop / the relevant `chat` code does it (inspiration).
   b. Look across the whole codebase for related pieces; reorganize/clean the project
      structure as we go (this is also a restructuring pass, not just a copy).
   c. Research what the **current SDK/library documentation** actually says (not memory).
   d. Debate whether it is the best approach — routing, shape, trade-offs.
   e. **Dual-target gate (hard):** confirm the choice deploys to *both* Cloudflare and
      local before adopting it. If it can't run in both, it doesn't go in (this is D8
      applied per-decision).
   f. Decide, record it, build that one thing, then move to the next.
4. **Relationship to D8/D9 and doc 07:** this is the *process* that produces the
   ADOPT/EVALUATE/AVOID calls of doc 07 — those buckets are filled at build time by
   step (e), not assumed up front. The starting sequence stays doc 04's order
   (`studio-ai` after gateway + data), but *within* Phase 3 the internal build order is
   discovered, block by block, not prescribed.

Why: a mechanical port would carry over the very coupling and accreted decisions V2
exists to shed, and would pre-commit choices (like transport) the owner wants made with
research at the right moment. Inspiration + per-block research keeps the rebuild
deliberate.
