/**
 * Studio overlay — cloud coding agent usage rules.
 *
 * Covers:
 *   - Direct tools vs agents decision
 *   - Independent agent usage (any agent can run solo)
 *   - Full chain and skip conditions
 *   - Mandatory context passing between agents
 *   - Parallel execution patterns
 *   - Agent invocation examples
 */

// ---------------------------------------------------------------------------
// Direct tools vs agents
// ---------------------------------------------------------------------------

export function directVsAgentsSection(): string {
  return `## Direct Tools vs Cloud Coding Agents

### Use harness tools directly when:
- 1–2 targeted edits where you know the exact file and change
- Read-only lookups: "what does X do?", "find where Y is defined"
- The task is fully specified: "fix typo on line 42 of auth.ts"

### Use Cloud Coding Agents when (REQUIRED — do not call edit_file / write_file / bash in the main loop for these):
- The task touches 3+ files
- You need to explore before you know what to change
- The task is a goal ("add X", "fix Y bug", "implement Z"), not a specific line
- Any new feature, refactor, or multi-module change

**HARD RULE — Never stream file content as assistant text.**
If you are about to write HTML, CSS, JavaScript, Python, or any implementation code as chat text — stop. Call \`run_coder_agent\` instead. Streaming 300 lines of code before write_file wastes 3–5 minutes and adds zero value.

**Why this matters:** Each direct tool call in the main loop costs a full round-trip with the complete schema re-sent (20–60 s per call). A 5-file task done via direct calls takes 5 expensive round-trips. Delegating to \`run_coder_agent\` costs one round-trip total — the agent runs its own tight loop.

**Quick examples:**

| Request | What to do |
|---|---|
| "What does \`createUser\` do?" | \`mcp_studio_harness__search_symbol\` + \`mcp_studio_harness__read_file\` (direct) |
| "Fix the typo on line 42 of auth.ts" | \`mcp_studio_harness__read_file\` + \`mcp_studio_harness__edit_file\` (direct) |
| "What's the git status?" | \`mcp_studio_harness__git_status\` (direct) |
| "Add rate limiting to all auth endpoints" | Full agent chain |
| "Review my current changes" | \`run_reviewer_agent\` alone |
| "How does the payment flow work?" | \`run_explorer_agent\` alone |
| "Tests are failing after my changes" | \`run_tester_agent\` + \`run_debugger_agent\` |`;
}

// ---------------------------------------------------------------------------
// Independent agent usage
// ---------------------------------------------------------------------------

export function independentAgentSection(): string {
  return `## Independent Agent Usage

Any agent can run solo — you do not need the full chain. Call exactly what the task needs.

| Agent | Run independently when |
|---|---|
| \`run_explorer_agent\` | "How does X work?", "Map this codebase", "Trace this flow", "Find where Y is defined" |
| \`run_planner_agent\` | "Design a solution for X" — when you want a plan before committing to implementation |
| \`run_coder_agent\` | You have a clear plan (from context or a prior planner run) and just need implementation |
| \`run_tester_agent\` | "Run the tests", "Check if the build passes", "Did my changes break anything?" |
| \`run_debugger_agent\` | "Fix this error: [paste]", "This test is failing: [paste output]" |
| \`run_reviewer_agent\` | "Review my changes before I commit", "Is this implementation correct?" |

All agents write their output to the shared blackboard. Pass that output as \`context\` if you chain another agent after.`;
}

// ---------------------------------------------------------------------------
// Full chain + skip conditions
// ---------------------------------------------------------------------------

export function agentChainSection(_requestId?: string): string {
  return `## Full Agent Chain

For goal-described tasks, use the standard chain. Each agent writes to the blackboard; pass its output as \`context\` to the next.

These are cloud tool calls — call them directly, NOT via \`spawn_agent\`:

\`\`\`
run_explorer_agent   → maps codebase, traces relationships    → writes: explorer:latest
run_planner_agent    → designs solution with exact edit specs → writes: planner:latest
run_coder_agent      → implements changes, lints, diffs       → writes: coder:latest
run_tester_agent     → runs build + tests, reports pass/fail  → writes: tester:latest
run_debugger_agent   → (only if tester FAIL) diagnoses + fixes
run_reviewer_agent   → reviews diff, issues verdict
\`\`\`

**Pass prior output as \`context\` to each downstream agent:**
\`\`\`
run_explorer_agent({ task, root_dir })
run_planner_agent({ task, root_dir, context: explorerResult.output })
run_coder_agent({ task, root_dir, context: plannerResult.output })
\`\`\`

For coder: pass BOTH explorer and planner output combined:
\`\`\`
run_coder_agent({
  task, root_dir,
  context: explorerResult.output + "\\n\\n---\\n\\n" + plannerResult.output
})
\`\`\`

### Skip conditions

| Agent | Skip when |
|---|---|
| \`explorer\` | .studio/CODEBASE.md is fresh (≤5 files changed) AND task scope is clear |
| \`explorer\` | New empty project — nothing to explore |
| \`planner\` | Single targeted fix: one file, you can describe old→new exactly |
| \`planner\` | New project from scratch where the task description is self-contained (coder gets full context from the task alone) |
| \`tester\` | Pure static output with no build step: HTML/CSS landing pages, plain config files |
| \`tester\` | No build system or test suite exists |
| \`debugger\` | Tester reports PASS — only run when tester reports FAIL |
| \`reviewer\` | Trivial fix: typo, single-line config, simple rename |
| \`reviewer\` | **Never skip** for: new features, multi-file changes, security-adjacent code |`;
}

// ---------------------------------------------------------------------------
// Context passing mandate
// ---------------------------------------------------------------------------

export function contextPassingSection(): string {
  return `### Context passing — mandatory

**Never call a downstream agent without its upstream context.**

Agents have no memory of prior agents — \`context\` is the only channel information flows forward. Without it, every agent starts blind: the planner re-explores what explorer already mapped; the coder ignores the planner's specs and makes its own plan.

Rule: always pass the prior agent's \`output\` as the next agent's \`context\`. For coder: accumulate both explorer + planner output.`;
}

// ---------------------------------------------------------------------------
// Parallel execution
// ---------------------------------------------------------------------------

export function parallelAgentsSection(): string {
  return `### Parallel execution

Spawn independent agents in the same turn — they run simultaneously:

\`\`\`
// Cloud research + codebase exploration in parallel — neither depends on the other
spawn_agent({ agent_type: "research", task: "Find best practices for rate limiting" })
run_explorer_agent({ task, root_dir })

// Wait for both, then combine into planner context
run_planner_agent({ ..., context: researchFindings + "\\n\\n---\\n\\n" + explorerResult.output })
\`\`\``;
}
