# Task: Implement the Agent Platform Plan — Stage 0, then continue

You are continuing work in the Project Studio repository at
`C:\pookiepied\Dev Workspace\Project Studio`. The architecture plan is written;
your job is to begin implementation at Stage 0 and proceed stage-by-stage as
far as you can with `pnpm check` green at every checkpoint.

## Orientation — read these first, in order

1. `documentation/work/agent-platform-plan.md` — the approved plan. It is the
   source of truth: Part I maps the current architecture, Part II holds the
   design decisions (D1–D11), Part III is the keep/refactor/remove/consolidate
   list, Part IV is the staged path. Read all of it before touching code.
2. `documentation/architecture/mental-model.md` — the project's rules (cache
   economics, append-only tool membership, tool visibility). Its Flue version
   line is stale (says 1.0.0-beta.9; actual is 2.0.3, patched) — fixing that
   is part of your Stage 0 docs work.
3. `documentation/decisions/` — ADRs 0001–0057. The ones that bind this work:
   **0012** (the kernel decides; its consequences leave the subagent-policy
   question to Phase 13 — you are answering it), **0029** (append-only MCP
   tool membership), **0030** (§5: subagent authority derivation requires the
   trusted-context extension), **0033** (the identity vocabulary:
   instanceId / submissionId / agentName — do not invent new ids),
   **0038** (a grant belongs to an agent), **0039** (a child inherits nothing
   it was not given), **0045** (a run is addressed, not held — background
   tasks reuse this mechanism), **0048** (capabilities announced before
   loaded), **0057** (the gate is the boundary; two modes: Ask, Auto).
4. `documentation/work/phases-1-11-remediation.md` — the open-defect register.
   Stage 1 fixes #73 (grants invisible/irrevocable), #86 (no snapshot
   restore), #88/#89 (child lifecycle), #66 (missing MCP timeout/cancel
   tests). Verify each in the register and in code before fixing.

## Repo shape (verified)

- `STUDIO HARNESS/` — the agent runtime. TypeScript, Node 24.19, pnpm 11.
  `@flue/runtime` 2.0.3 and `@earendil-works/pi-ai` 0.84.4, both patched under
  `patches/`. Build: `pnpm build` (vite) → `dist/server.mjs`. Check:
  `pnpm check` (typecheck + lint + test; the full suite takes minutes — the
  restart test waits for lease expiry).
- `STUDIO/` — the Tauri desktop client. Not needed until the task-rail work.
- **No cloud runtime exists.** The Studio Gateway was deleted; `Backend/` is
  an undeployed scaffold. Build nothing cloud-shaped.

## Current state

- The plan document exists. Nothing else has been implemented: no code
  changed, no ADR 0058 written, no docs reconciled, no measurement run.
- Four agents exist: `studio` (mounted, `src/agents/studio.ts`) and three
  dispatch-only one-shot agents (`title`, `improve`, `describe` in
  `src/agents/`). Flue's delegation primitives (`useSubagent`,
  `defineSubagent`, `GeneralSubagent`, the always-registered `task` tool) are
  unused; the system prompt explicitly disarms the task tool
  ("This harness declares no subagents…", `src/context/system-prompt.ts`
  around line 355).

## Your task: Stage 0 (then Stage 1 if it lands green)

### 1. The delegation measurement (measure before deciding — this is the culture)

Against a live built harness: `pnpm build`, then spawn `dist/server.mjs` the
way `tests/integration/skills-flue.test.ts` does (random port, admission
credential in the environment, `PROJECT_STUDIO_MODEL_SOURCE=test`, temp
`PROJECT_STUDIO_HOME`). The scripted test model
(`src/gateway/language/adapters/test-adapter.ts`) is keyword-driven per user
text — its scenarios live around lines 380–520; read the file.

Measure, with a delegate actually declared:

- Does the parent's sandbox factory (`createAgentSandbox`'s `createSandbox`
  and `tools` callbacks in `src/application/studio-runtime.ts`) run per
  delegate session? With what arguments? Is the acting agent's identity
  visible in the callback options, or readable via
  `currentExecutionContext()` from `src/execution/context.ts`?
- What do `agent_start` / `tool` events carry for child sessions — `taskId`?
  `agentName`? Does the interceptor in `src/observability/flue.ts` already
  project `kind: "subagent"` with a parent link?
- Practical route: the throwaway delegate likely needs a test-only agent
  module with `useSubagent` compiled into the build. Check how the vite build
  scans `'use agent'` modules (`flue.config.ts`, `vite.config.ts`) and pick
  the least invasive way to get one into a measurement build. Record the
  findings in a "Stage 0 findings" section of the plan document, then either
  revert or keep the throwaway — say which, deliberately.

Also measure the disarmed path on the unmodified build: the `task` tool is
present with no delegates declared — confirm the refusal shape and that the
empty-roster paragraph is what the model reads.

### 2. ADR 0058 — Agent definitions and delegation

Write it from the plan's Part II (D1–D11), in the house ADR style (context →
decision → consequences; claims marked measured vs. designed). It must record:

- The answer to ADR 0012's open question: **policy declared per agent type;
  containment inherited from the parent conversation; approvals never
  inherited.**
- The ADR 0030 §5 trusted-context answer: the runtime derives the child scope
  from the parent conversation's settled row plus the definition; no
  caller-supplied or model-supplied identity ever becomes authority.
- The tool-visibility rule extension (the plan's D4): the list comes from the
  rule that decides the call, now including the definition's allowlist — and
  the mechanism (execution-context frame vs. patch extension) cites the
  Stage 0 findings.
- Task instance ids `<conversationId>-task-<n>`, dispatch semantics, no
  automatic resend (ADR 0033's conservative rule; the idempotency-key reopen
  condition noted on the dispatcher).

While in the decisions folder: ADR 0030 §2 carries a stale sentence about
deriving the conversation key "with a distinct prefix" — Flue 2 dropped the
prefix (the instance id IS the conversation id). Verify in the file, then add
a dated amendment note in the ADR's own style. Do not silently rewrite
settled text.

### 3. Docs reconciliation (verify each line in the file before editing)

Verified stale, fix directly:

- `documentation/architecture/mental-model.md` lines ~87–89: the
  `1.0.0-beta.9` version and the "Only 9 files import @flue" count.
- `documentation/architecture/directory-map.md` line 16: the `tasks/` root
  line (no such directory exists); plus the build-order table (Phase 11 is
  not "in progress"; Phase 12 skills landed 2026-09-15).
- `documentation/rules.md` ~line 234: "Node is 22.18.0" → the 24.19 floor;
  ~line 255: the `tasks/` mention in the do-not-edit bullet.

Stale at the structural level — do NOT rewrite wholesale; either add a dated
banner naming what lagged (Flue-2 migration, ADR 0057) or fix only the
specific wrong claims you can verify:

- `documentation/architecture/api-inventory.md` (1.0 vocabulary, `runId`,
  workflows routes, missing half the current routes).
- `documentation/architecture/domain-ownership.md` (AppContainer-era sandbox
  section; a "current violations" list that predates the remediation).

Dead pointers — replace with the surviving `documentation/archive/` paths or
drop: every `tasks/...` reference in `documentation/phases/roadmap.md` and
`documentation/phases/phase-11-mcp-overview.md`, and the implementation-record
pointer in `documentation/decisions/0028-harness-client-admission-and-local-access.md`.

### 4. Dispositions (decide and record; wiring/deleting happens later stages)

For `createRetryExecutionContext` (declared-not-wired, has a test) and
`durableDirectories()` / `settingsPath()`: pick wire-or-delete per the plan's
rule (no third state), record the decision in the plan document, and schedule
the actual change for Stage 4/6 where the plan puts it.

## Working rules (the project enforces these)

- `pnpm check` green at every checkpoint; one task active at a time.
- Measure before deciding; never build on an unverified claim about Flue's
  behavior — the patch exists precisely because upstream differed from its
  own documentation.
- New subsystem ⇒ `StudioError` domain + error reporter; durable state ⇒
  migration; secrets ⇒ OS keychain, never a database column.
- Never rebuild Flue's loop, transcript, or journal. Never add a second
  tool-execution path — the CallGate is the only door.
- Never let a model-supplied argument become authority (ids, scopes, paths).
- Comments match the codebase's voice: long, reasoned, about constraints.

## Verification notes (honest caveats)

- The plan's architecture-level claims were written from a full read of the
  harness and ADRs and are solid. A few specifics rest on single-source reads
  and must be re-verified when you touch them: the exact Flue patch hunks
  (read `patches/@flue__runtime@2.0.3.patch` directly), the open-item list in
  the remediation register, and the test-adapter's scripting seams.
- If a file read returns content that contradicts the plan, the ADRs, or the
  code inventory — stop and re-verify the path before acting. Mistyped paths
  in this workspace have produced plausible-looking fabricated content
  before. Trust mutually-corroborating reads; distrust any single read that
  disagrees with everything else.

## Definition of done for Stage 0

- "Stage 0 findings" section in the plan document: measured delegation
  behavior, the chosen mechanism for the agent-aware tool filter, and the
  dispositions.
- ADR 0058 exists, consistent with the plan and the findings.
- Stale docs fixed or bannered; suite green.
- Report what changed and why, plainly — including anything you measured that
  contradicts the plan.

Then continue to Stage 1 (the four prerequisite fixes), starting with #73
(grants list/revoke routes + Settings surface), only if Stage 0 is complete
and green.
