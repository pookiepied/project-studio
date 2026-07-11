# Studio V2 — Ownership & Placement Doctrine

*(2026-07-11. Companion to [RUNTIME-CHECKLIST.md](RUNTIME-CHECKLIST.md) — the checklist
lists what a complete system needs SOMEWHERE; this doc says WHERE each thing lives.)*

## The factory model

Studio's runtime is a factory: you give it input, it gives you output. How it processes
things internally is its own business — but every capability must live in its **proper
place**. We add all the functionality, curated into the right layer, not piled into the
agent loop. The runtime is a runtime — it's in the name. Policy lives above it, provider
logic lives below it.

The checklist items are "what a regular system does." We understand the regular thing
first, then do our own version — properly placed.

## Placement rules (locked examples)

| Concern | Owner | The runtime's only involvement |
|---|---|---|
| Provider bugs out / model failure | **Gateway v2** — provider handling, failover, provider errors | Emit a proper, normalized error event downstream. The loop NEVER swaps models itself. |
| Context construction | **Studio Context** worker (built outside) | Consume the delivered context package. |
| Context window / token packing | **Studio Context** worker | Observe usage and enforce only explicit run limits; never decide what history/files/artifacts belong in context. |
| Runtime behavioral prompt | **Studio Context / runtime config / agent definition** | Keep only a minimal invariant runtime contract; execute the supplied prompt package. |
| Conversation/artifact storage | **Studio Data** | Hand off completed state; keep only live-run state. |
| Tool/agent/skill discovery | **Studio Registry** | Ask, never scan. |
| Reconnection policy (desktop/local) | **Parent / frontend** — the runtime only *respects* silence | Hold the run through a grace window when the local client goes quiet, then **pause — never drop**. Exact window TBD (order of ~60s; to be decided by the parent layer). |
| Reconnection (cloud/browser) | **Nobody needs to act** | Everything runs in the cloud; no browser, no user, no problem — the run continues headless and clients re-attach whenever. |
| Retry orchestration | **Mostly user-level requests** | Keep taxonomy + hooks; don't over-build automatic retry into the loop. |
| Concurrency/queueing of user input | **Frontend handles much of it**; runtime enforces the single-active-run invariant | Reject/queue at the door with clear errors; boundary design TBD. |
| Scheduled/background agent invocation | **Agent Runtime / parent/API scheduling layer** | Not the execution runtime's job. The runtime may execute a run it is handed, not decide calendar/cron timing. |
| Tool execution coordination inside one run | **Execution Runtime** | Apply tool policy metadata at the boundary: approval, idempotency, locality, optional concurrency keys, and safe serialization once designed. |

## Budget doctrine

"Budget" does **not** mean arbitrary product caps like "15 minutes" or "10 iterations."
The default execution path is open-ended: if the provider, gateway, CPU time, local
resources, and user policy all allow a task to keep making progress, the runtime should
not stop it just because a small fixed counter expired.

Runtime limits are optional safety rails supplied by a runtime config, agent profile,
or future user/org policy. Undefined means unlimited. The runtime can observe usage
and stop only when an explicit limit is crossed or a true pathological loop is detected
under an explicit loop policy.

Before run: Studio Context owns context-window construction and token efficiency.
During run: Execution Runtime owns progress observation, durable state, tool boundaries,
and optional safety enforcement.
After run: Studio Data owns durable conversation/artifact persistence.

## Transport doctrine

- **WebSocket first.** The primary surface is the WS event stream (Studio Runtime Protocol).
- **HTTP second.** Clean control endpoints (start/pause/resume/cancel/state) come after the
  WS story is solid. Proper, minimal, clean API endpoints — no sprawling REST surface.

## The test for any new feature

Before building anything, ask:
1. Is this the runtime's job, or a neighbor's (Gateway/Context/Data/Registry/parent)?
2. If it's the runtime's: does it belong in the loop, the state layer, or the surface?
3. Are we duplicating something the AI SDK or a sibling worker already does adequately?

If the answer places it elsewhere, the runtime's job is only to emit clean events and
respect the neighbor's contract.
