/**
 * Studio overlay — project context management.
 *
 * Covers:
 *   - .studio/ folder structure and purpose
 *   - Project detection decision tree (new / known / unknown)
 *   - When to read and write .studio/ files
 */

// ---------------------------------------------------------------------------
// .studio/ folder spec
// ---------------------------------------------------------------------------

export function studioDotFolderSection(): string {
  return `## The .studio/ Folder

\`.studio/\` is the project's persistent memory — it lives in the project root and survives across sessions, models, and users. Always check it before starting any task.

| File | What it contains | Managed by |
|---|---|---|
| \`CODEBASE.md\` | Architecture map: entry points, key files, dependency relationships | \`index_codebase\` — auto-generated |
| \`graph.json\` | Raw import/export graph (machine-readable) | \`index_codebase\` — auto-generated |
| \`PROJECT.md\` | Project intent, tech stack, conventions, key decisions, gotchas | You write on first task; append as the project evolves |
| \`PROGRESS.md\` | Append-only session log: date, task, files changed, outcome | You append after every completed task |

**PROJECT.md is the single source of truth for "how this project works."** It replaces scattered notes — if you learn something important about the project, write it here.

### .studio/ Rules

1. **After completing a task:** append an entry to \`.studio/PROGRESS.md\`:
   \`## [ISO-date] — [task description]\\nChanged: [file list]\\nResult: [outcome]\`
2. **First task in a new project:** create \`.studio/PROJECT.md\` with what you know about the intent, tech stack, and planned structure.
3. **Significant architectural decision made:** append it to PROJECT.md under a \`## Decisions\` header so future sessions know why.
4. **Never delete** \`CODEBASE.md\` or \`graph.json\` — they are managed by \`index_codebase\`.`;
}

// ---------------------------------------------------------------------------
// Project detection
// ---------------------------------------------------------------------------

export function projectDetectionSection(): string {
  return `## Project Detection

**Classify and branch:**

### A — Empty directory → New Project

\`\`\`
1. Call write_file to create .studio/PROJECT.md (intent + inferred stack)
2. Skip run_explorer_agent — empty dir, nothing to explore
3. Call run_coder_agent({ task, root_dir }) — always, even for "simple" static sites
4. Call run_reviewer_agent if output spans 3+ files
\`\`\`

**Note:** "Simple static site" (HTML/CSS/JS) is NOT a direct-tools task. It still goes through run_coder_agent.

### B — Has code AND .studio/ exists → Known Project

\`\`\`
1. Read .studio/PROJECT.md (already done in Step 3)
2. Read last 30 lines of .studio/PROGRESS.md
3. Check CODEBASE.md freshness via git_status():
     0–5 files changed  →  skip run_explorer_agent, use CODEBASE.md as planner context
     10+ files changed  →  call run_explorer_agent (refreshes CODEBASE.md)
4. Call run_planner_agent({ task, root_dir })
5. Call run_coder_agent({ task, root_dir, context: plannerOutput })
\`\`\`

### C — Has code BUT no .studio/ → Unknown Existing Project

\`\`\`
1. Check for CLAUDE.md — read if found
2. Call run_explorer_agent({ task, root_dir }) — creates .studio/CODEBASE.md
3. Call run_planner_agent({ task, root_dir, context: explorerOutput })
4. Call run_coder_agent({ task, root_dir, context: explorerOutput + plannerOutput })
5. Call run_tester_agent → run_debugger_agent (if fail) → run_reviewer_agent
\`\`\`

### After every task — always

Append to \`.studio/PROGRESS.md\`. If it does not exist, create it:

\`\`\`
read_file(".studio/PROGRESS.md")  ← get existing content (offset near end is fine)
write_file(".studio/PROGRESS.md", existingContent + newEntry)
\`\`\``;
}
