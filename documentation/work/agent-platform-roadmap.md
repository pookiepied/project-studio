# The Agent Platform — Execution Roadmap

**Status:** Active · Written 2026-10-03, after Stage 2 landed (`c9266055`)
**Parent:** `documentation/work/agent-platform-plan.md` — the plan owns scope and
decisions (D1–D11); this file owns **order, gates, and status**. When the two
disagree, the plan is right and this file gets fixed.
**Scope:** Everything the agent mechanism still needs, from the Explore delegate to
the register's open rows it depends on — one map, sequenced, so any session can pick
up the next unshipped row without re-deriving the order.

---

## How to read this

- **Stages S0–S6** are the plan's own stages, mirrored here with status. They are
  the vertical slices and must stay in order — each consumes the one before it.
- **Tracks A–F** are the surrounding work: register rows, doc debts, and
  consolidation that the stages depend on or leave behind. Tracks run *beside* the
  stages; a track row names the stage it must land before or after.
- Every row names its **gate** — what must be true, measurably, for the row to
  close. No gate, no closure; that is the register's culture applied to a schedule.
- **Nothing auto-commits.** Each row ships as one commit-able unit when the user
  says so, `pnpm check` green at both workspaces, mutations verified where a test
  claims to prove something.

## The gates that hold for every row

1. `pnpm check` at the repository root — harness and STUDIO both, sequential,
   green (the #82 gate).
2. One task active at a time; no row starts while another is half-landed.
3. Every new store gets a migration; every new subsystem registers an error
   domain; every load-bearing test gets a negative control (mutation-verified).
4. Nothing rebuilds Flue's loop, transcript, or journal; no second tool-execution
   path; no model-supplied argument becomes authority.
5. Documentation follows the row, not a separate pass — a row is not closed while
   the record disagrees with the tree.

---

## Where we stand (2026-10-03)

| Stage | What it is | Status |
|---|---|---|
| S0 | Ground truth: delegation measurement, ADR 0058, doc reconciliation, dispositions | ✅ **Done** — findings in the plan §"Stage 0 findings"; dispositions executed early in Stage 1 |
| S1 | Prerequisites: #73 grants surface, #86/#50 snapshot restore, #88/#89 child lifecycle, #66 MCP timeout/cancellation | ✅ **Done** — all four closed, mutation-verified (`7693dbfe`, `068e8838`, `65f068c3`) |
| S2 | Definitions, registry, `dispatchBackgroundAgent()`, TaskStore migration | ✅ **Done 2026-10-03** — `c9266055`; zero behavior change held (2,272 + 1,357 tests green); register #90 records the proofs |
| S3 | **The Explore delegate** — the first real subagent | ✅ **Done 2026-10-03** — register row 96: definition, mount, the patch's one budgeted hunk, the gate's agent-aware policy, #49 closed end to end (store + scope + live run) |
| S4 | Background agent tasks (routes, projection, signals, rail) | ✅ **Done 2026-10-03** — register row 97: D10 decided (ADR 0058's amendment), the dispatcher's row, the projector, the third ping source, the routes and cancel port, the rail's Tasks section and the transcript's delegation chip, purge semantics |
| S5 | The broader roster (`general`, `plan`) + assignment | ✅ **Done 2026-10-07** — register row 98: the `general` and `plan` delegates live (the ask-based consent default consumed at the kernel; the MCP wildcard; the plan tool's `agent:<name>` writer dimension), skills assignment landed (definition ∩ selection chain, mounted through the delegate renders), `GET /api/agents` + the Settings roster pane, agent-attributed approval cards, and the two-delegate concurrency run |
| S6 | Consolidation and the deferred decisions | ⬜ Next |

Open register rows that touch this map: **#70** (load-dependent suite flake,
assigned Stage 4b), **#13** (gateway contract, mooted by cancellation — close it
as No Longer Relevant when convenient). **#49 closed 2026-10-03 at S3.3** —
grant isolation proven at every layer: store (S2), scope substitution and live
delegated run (S3, register row 96).

---

## S3 — The Explore delegate (the vertical slice)

*The first agent the model can delegate to. Read-only, because it is the easiest
permission story to prove three ways: allowlist ∩ effects ceiling ∩ kernel all
saying the same thing.*

| # | Row | Gate |
|---|---|---|
| S3.1 | `EXPLORE_PROMPT` + `agents/definitions/explore.ts` — the delegate definition, registered; `useSubagent` declaration wired in `studio.ts`'s render through a cached, prompt-safe mount | Definition validates at load; registry lists 5 agents; **existing suites untouched** (no roster text in any model-visible prompt except the new section below) |
| S3.2 | **Agent-aware tool policy at the gate (D4)** — the factory's `tools()` callback resolves the acting definition and filters to its allowlist; `discover` withheld from delegates; the Flue patch hunk that carries the delegate's name into the child session's execution context (ADR 0058's one-line mechanism) | A test asserting the delegate's tool array is *exactly* its allowlist, with withheld natives asserted absent; mutation-verified |
| S3.3 | Delegate scope: `agentId: "explore"` in the `ExecutionScope` at call time (the captured scope's agentId substituted by the acting definition) | Grant isolation **end-to-end**: a `studio` standing grant does not authorize `explore`, and an `explore` grant does not reach `studio` — the #49 property, asserted against a live run, not the store |
| S3.4 | System prompt: **replace** the "declares no subagents" paragraph with the delegation section (self-contained briefings; what `explore` is for; results return as the task's final message) | Prompt test asserting the old paragraph is gone and the new section names `explore`; the composed prompt is byte-stable for an unchanged roster (cached-prefix argument) |
| S3.5 | Observability: confirm `kind: "subagent"` with `parentOperationId` flows to the parent turn; `taskId` linked in the interceptor's frame | Integration test asserting the operation graph shape on a live delegated run |
| S3.6 | Integration proof, the stage's real deliverable | All six Stage 3 tests from the plan: delegated run end-to-end; final message returns; parent transcript contains the tool result and *nothing* of the child's intermediate reasoning; read-only refusal at the policy layer regardless of grants; recovery (kill harness mid-task, restart resumes the child); depth refusal (`delegates: []`) and the undeclared-agent error |

**Also closes:** #49 end-to-end; the roadmap's Phase 10 "nine of ten" note (the
`task` family completes the tool table — close it in the same commit).

**D10 was decided at S4.1 (2026-10-03)**, recorded as ADR 0058's amendment:
background task transcripts are the existing reader once the background routers
are mounted read-only; a delegate's transcript view waits for the UI feature
that needs it, tie-breaker recorded (no patch hunk unless the measurement
proves no seam exists).

---

## S4 — Background agent tasks

*The "forecast the background tasks / report settlements" half of what you asked
for: tasks the main agent starts, the UI watches, and the conversation hears
about when they settle — including "I am done", "I failed", and the states
between.*

| # | Row | Gate |
|---|---|---|
| S4.1 | Decide-and-record the D10 design point (task transcript addressability), then `GET /api/tasks`, `GET /api/tasks/:id`, `POST /api/tasks/:id/cancel` — the TaskStore routes, status projection via the observer seam (the titler's settlement subscription is the pattern) | Route auth (admission scope); a dispatch → run → settle → signal round-trip integration test; cancel mid-run settles `cancelled` |
| S4.2 | `studio.tasks.finished` through the JobPings hub — the third source beside shell and media jobs; the environment block names running tasks beside running jobs | Integration: the finished-task ping reaches the conversation's instance exactly once (the three-delivery-points discipline); environment-block test |
| S4.3 | The dispatcher becomes a product surface: `dispatchBackgroundAgent()` records its TaskStore row at dispatch, the projector settles it from events | Rows exist for every dispatched task; a restart with a running task recovers status `running` then settles (Flue's stream is the truth, the row is the projection) |
| S4.4 | Task rail section + task card in the transcript (the existing reader pointed at the task stream — **no new transport**, ADR 0045's offset mechanism) | STUDIO tests for the rail rows and the card projection; purge semantics (deleting a conversation deletes its task rows; the stream goes with Flue's purge) |
| S4.5 | Idempotency reopen condition recorded on the dispatcher (no auto-resend — ADR 0033's rule stays; the key rides any future scheduler that resends) | A comment on the dispatcher naming the condition, and a test proving a replayed settlement does not re-dispatch |

**Also closes:** register #70's Stage 4b assignment if a failure is captured by
then (its own definition of done: a captured startup report, or the #61 CI
matrix running the suite on a second platform).

**Deferred into S6 if they slip:** none of these rows is optional; what may slip
is the rail UI polish (S4.4's card projection shape), and only with the routes
and signals already proven.

---

## S5 — The broader roster and assignment

*Delivered 2026-10-07 — register row 98. What the gates became, in the
delivered order:*

| # | Row | Gate |
|---|---|---|
| S5.1 | `general` delegate — the `GeneralSubagent` equivalent, Studio-shaped: natives minus destructive, `write` allowed, `execute` asks; parent-adopted MCP ∩ its namespace allowlist | **Delivered.** Its asks render under its own agent id — proven live: an Auto conversation's delegated write parks, the pending approval names `general`, and the answer writes the grant keyed to the delegate, not the conversation. The `mode: "ask"` field is now consumed: the delegate's own consent default resolves its default asks at the kernel, so a delegated task asks even where the conversation runs Auto. The D11 shorthand's concrete allowlist, the wildcard, and the explore ceiling correction are recorded in the plan's D11 note |
| S5.2 | `plan` delegate — read-only + the plan tool; the PlanItemStore writer dimension gains `agent` | **Delivered.** `PlanWriter` gained `agent:<agentName>` — the merge closure resolves the acting agent from the same frame every other per-agent decision reads. Store tests assert the second writer beside the person's tick (merge-by-id, nothing clobbered); the live two-delegate run leaves rows recorded `agent:plan` |
| S5.3 | Skills assignment per definition: definition `skills.ids` ∩ the conversation's selection chain, mounted through the delegate's own render | **Delivered.** The runtime's `delegateSkills` walks the conversation's chain once, narrowed to the definition's named ids on the registry's record vocabulary (packaged reference ids carry a content hash and match nothing). All three delegates ship empty lists in v1 — the honest answer — so the semantics are proven with a definition naming a bundled skill against the real selection chain; the Settings roster pane (`GET /api/agents` + AgentsPane) shows the lists read-only |
| S5.4 | Roster section covers all three delegates; approval UX polish | **Delivered.** The static delegation section teaches matching the delegate to the work (reading / hands-on / planning) beside Flue's composed `## Available Agents` roster; approval cards carry the asking agent's name (`Permission — General agent`), the conversation agent's asks stay unattributed, and the waiting list groups by agent |
| S5.5 | Parallel tasks: one batch, two delegates, no interleaved grant writes or membership mutations | **Delivered.** One assistant message, two `task` calls (explorer + planner) in one batch against the live built harness: both answers return, the parent transcript holds the two task results and nothing of either child's work, the plan rows carry `agent:plan`, and the grant table ends the run empty |

---

## S6 — Consolidation and the deferred decisions

| # | Row | Gate |
|---|---|---|
| S6.1 | **Meta-task §5 decided once**: the RTK result-projection seam and the execution guard as the gate's fourth stage — now with real delegate consumers as evidence, per D8 | A decision record (ADR) with the chosen design; the seam implemented or explicitly declined with the reason |
| S6.2 | `ToolMembership` naming refactor if S3 did not already force it; `#turnSnapshots` / access-log lifetimes re-audited with task streams in the picture | An audit note in the register; no behavior change without its own tests |
| S6.3 | Docs folded: the plan's final-architecture section into `mental-model.md` / `directory-map.md`; roadmap Phase 13 closed with the ledger; ADR 0014's two stale sentences corrected (the S1 deletions it still describes) | The register's rows closed with dated notes; `documentation/rules.md`'s stale pointers gone |
| S6.4 | The C-19 note updated: the capability seam the relay needs now exists (D4/D9) | One paragraph in the plan's D9 + the roadmap's C-19 reference, both dated |

---

## Track A — Register rows owned by this map

| Row | What | Lands |
|---|---|---|
| #49 | Grants must not leak parent → child | **Closed at store level (S2)**; end-to-end proof is S3.3's gate — close the row there |
| #70 | Load-dependent suite flake | Stage 4b (S4 window): a captured failure or the #61 matrix; until then it stays open, honestly |
| #13 | Gateway contract decision | Close as No Longer Relevant whenever convenient — the gateway was cancelled; the row's recommendation ("harness-side only") was for a component that no longer exists |
| #90 | Stage 2's delivery record | Already closed (2026-10-03); cited here so the map and the register agree |

## Track B — Documentation debts

| Debt | What | Lands |
|---|---|---|
| ADR 0014 | Two sentences still describe `settingsPath()` / `durableDirectories()`, deleted in Stage 1 | S6.3 (the plan named this landing spot) |
| `rules.md` | Node version + any `tasks/`-era pointers that survived the S0 pass | S6.3 |
| `phases/roadmap.md` | Phase 10 "nine of ten" closes with the `task` family | S3 (same commit as S3.4) |

## Track C — Reserved seams (deliberately unbuilt; not debt)

The `"gateway"` provider source; the `hook` extension kind; the
`PassthroughContextOptimizer` port; `EXPLORE_AGENT_ID` until S3.1. Each has its
decision record and its reopen condition. **Do not "clean" these without reopening
the decision** — they are named seams, not dead code.

## Track D — The desktop surface

The plan's D10: no new transport. The rail's Tasks section (S4.4), task cards,
agent-attributed approval cards (S5.4), and Settings' read-only agent roster
(S5.3) are the whole client footprint. STUDIO's own check (142 files) runs in
every gate.

## Track E — The Flue patch budget

The patch touches exactly four things today (prompt-composition trim, compaction
door, transient-model retry policy, and — after S3.2 — the delegate-name hunk).
**Rule: one new hunk per stage, maximum, and only when the measurement proves
the runtime cannot answer without it.** S3.2's hunk is the only one currently
budgeted; S4's abort/cancel needs nothing new (the stop control's seam exists).

## Track F — Explicitly out of scope (so the map is complete)

User-authored hooks (the reserved kind stays unbuilt); any cloud runtime work
(D9 records the seams, nothing schedules work); per-delegate grant inheritance
(declined — the child asks; revisit with usage data as its own decision); a
settings UI that edits definitions (Phase 18 product work at the earliest);
`Backend/` (operator direction 2026-10-03: ignore that folder).

---

## The one-line order

**S3 (Explore, the slice that proves delegation works at all) → S4 (background
tasks, the surface you watch settle) → S5 (the roster fills out) → S6 (fold the
decisions and the docs).** Tracks land inside the stage windows named above; the
map's next unshipped row at any moment is S6.1.

*Status of this file:* maintained beside the plan until S6.3 folds the surviving
content into the durable docs — then it is archived, banner-marked, per the
documentation system's own rule.
