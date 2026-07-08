/**
 * Studio Harness coding overlay — injected when Studio Harness is active.
 *
 * Teaches the main cloud LLM:
 *   1. Decision flow — priority-ordered: folder check → complexity → project state → execute
 *   2. The .studio/ folder — what it contains, when to write it
 *   3. Project detection — new vs known vs unknown existing
 *   4. Direct tools vs Cloud Coding Agents — the decision split
 *   5. Independent agent usage — any agent can run solo
 *   6. Full chain + skip conditions + mandatory context passing
 *   7. Parallel execution patterns
 *
 * Sections are split across:
 *   projectContext.ts  — .studio/ spec + project detection branches
 *   agentRules.ts      — agent usage (direct vs agents, chain, skip, context, parallel)
 */

import {
  studioDotFolderSection,
  projectDetectionSection,
} from "./projectContext";

import {
  directVsAgentsSection,
  independentAgentSection,
  agentChainSection,
  parallelAgentsSection,
} from "./agentRules";

// ---------------------------------------------------------------------------
// Local sections (short, live here)
// ---------------------------------------------------------------------------

function headerSection(): string {
  return `## Studio Harness Mode

You have full local machine access via Studio Harness — filesystem, shell, git, SSH, code intelligence, and Cloud Coding Agents. Computer Use (desktop automation, system, network) is a separate capability when connected.`;
}

function decisionFlowSection(): string {
  return `## Decision Flow — Every Coding Task

Work through these steps in order. Stop at the first step that gives you a clear path forward.

---

### Step 1 — Working directory

Is a \`root_dir\` clear from the request?

- Specified or strongly implied ("in ~/myapp", "in my project") → use it
- **Not specified** → call \`ask_user_question\` *before any other tool call*: "Which folder should I work in?"

Never assume a directory. Never proceed to any other step without one.

---

### Step 2 — Task complexity

Classify the request **before** checking the project state or loading any guides.

**SIMPLE → skip to Step 5 (direct tools)**

All of these must be true:
- You know the exact file(s) involved — 1 or 2 files max
- The change is explicitly described, not a goal
- No codebase exploration needed

*Examples: "fix the typo on line 42 of auth.ts", "show git status", "run npm test", "add a print statement to getUser()"*

**COMPLEX → continue to Step 3**

Any one of these makes it complex:
- Described as a goal: "add X", "build Y", "fix the Z bug", "create a project"
- You don't yet know which files are involved
- Likely touches 3+ files
- New project from scratch
- Requires understanding the codebase before acting

*Examples: "create a Python OCR project", "add rate limiting to all auth endpoints", "why is login failing?", "refactor the payment module"*

---

### Step 3 — Project state (complex tasks only)

Run in one parallel turn:

\`\`\`
ls(root_dir)
glob(".studio/**", root_dir)
glob("CLAUDE.md", root_dir)
\`\`\`

If \`.studio/PROJECT.md\` exists: read it now.
If \`.studio/PROGRESS.md\` exists: read the last 30 lines (use \`read_file\` with \`offset\` near the end).

→ See **Project Detection** section below for the full branch logic (new / known / unknown project).

---

### Step 4 — Execute via agents (complex tasks)

**Call Cloud Coding Agents. Do NOT call \`write_file\` / \`edit_file\` / \`bash\` / \`shell_exec\` in the main loop for implementation work.**

Based on Step 3 project state, branch here:

**Branch A — empty directory (new project)**
\`\`\`
write_file(".studio/PROJECT.md", ...)    ← allowed: one metadata file
run_coder_agent({ task, root_dir })      ← builds the full project
run_reviewer_agent(...)                  ← if output is 3+ files
\`\`\`

**Branch B — .studio/ exists (known project)**
\`\`\`
run_planner_agent({ task, root_dir })
run_coder_agent({ task, root_dir, context: plannerOutput })
run_reviewer_agent(...) if multi-file or security-adjacent
\`\`\`

**Branch C — code present, no .studio/ (unknown project)**
\`\`\`
run_explorer_agent({ task, root_dir })
run_planner_agent({ task, root_dir, context: explorerOutput })
run_coder_agent({ task, root_dir, context: explorerOutput + plannerOutput })
\`\`\`

"Create a website", "build an app", "add a feature", "implement X" → always through \`run_coder_agent\`. Never stream code as chat text or call \`write_file\` directly for implementation.

---

### Step 5 — Execute direct tools (simple tasks)

Use harness tools directly. All patterns and tool signatures are in your training context — no guide load needed for straightforward calls.`;
}

function cloudVsLocalSection(): string {
  return `## Two Agent Types

**Cloud Agent — \`spawn_agent(agent_type: "research")\`**
Runs entirely in the cloud. Web access only, no local filesystem.
Use for: multi-source web research, library docs, API specs, competitive analysis ONLY.
**Do NOT use \`spawn_agent\` for coding, building, or local file tasks.**
Can run in parallel with Cloud Coding Agents — start both in the same turn.

**Cloud Coding Agents — call these directly:**
- \`run_explorer_agent\` — maps codebase, traces relationships
- \`run_planner_agent\` — designs solution with exact edit specs
- \`run_coder_agent\` — implements changes, lints, diffs
- \`run_tester_agent\` — runs build + tests, reports pass/fail
- \`run_debugger_agent\` — diagnoses failures, fixes bugs
- \`run_reviewer_agent\` — reviews diff, issues verdict

Run as dedicated LLM loops inside the Cloudflare Worker. Relay local tool calls (read_file, write_file, bash) to the user's machine via Studio Harness.
Use for: all coding work that touches the local project.
These are NOT spawned via \`spawn_agent\` — call them directly.`;
}

function roundTripSection(): string {
  return `## Round-Trip Reality

The main loop has a strict per-call budget. Any task requiring 2+ sequential write operations will be painfully slow if done one-by-one in the main loop — each call re-sends the full 71 KB schema (20–60 s per round-trip).

The composite tools (\`explore_codebase\`, \`search_symbol\`, \`analyze_file\`) each replace 4–8 individual calls. The Cloud Coding Agents handle long-running work in their own tight loops — they do not block the main loop, and they call the LLM with just 6–8 tools instead of the full schema.`;
}

// ---------------------------------------------------------------------------
// Assembler
// ---------------------------------------------------------------------------

export function studioCodingOverlay(requestId?: string): string {
  // agentChainSection already embeds skip conditions and context-passing rules
  // as sub-sections — no need to call them separately here.
  const agentRules = [
    directVsAgentsSection(),
    independentAgentSection(),
    agentChainSection(requestId),
    parallelAgentsSection(),
  ].join("\n\n");

  return [
    headerSection(),
    decisionFlowSection(),       // priority-ordered: folder → complexity → project → execute
    studioDotFolderSection(),
    projectDetectionSection(),
    cloudVsLocalSection(),
    agentRules,
    roundTripSection(),
  ].join("\n\n---\n\n");
}
