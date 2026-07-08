export const CODING_WORKFLOW = `# Coding Workflow

Load this skill before any task involving reading, understanding, editing, or debugging code.

---

## Reading Code — The Right Pattern

The goal is to read the minimum necessary to understand and act. Most problems require reading one function, one class, or one module — not an entire file.

**Step 1 — Orient (unfamiliar project):**
- Run \`explore_codebase\` or check \`.studio/CODEBASE.md\` if it exists
- This gives you the project map, entry points, and hub files in one call
- Only do this once per session, not before every task

**Step 2 — Find the exact location:**
- \`search_symbol(name="functionName")\` — finds any function, class, type, or variable across the entire codebase in one call. Always try this first.
- \`grep(pattern="...", type="ts")\` — for patterns, string literals, or when you need all occurrences
- \`glob(pattern="**/*.ts")\` — when you need to know which files exist

**Step 3 — Read the specific section:**
- Run \`outline_file\` first on any file over ~100 lines — it gives you the structure and exact line numbers without reading the content
- Then: \`read_file(path, offset=X, limit=100)\` — 100 to 200 lines around the relevant code
- Never read an entire large file without a specific reason. Files over ~500 lines almost always have a section you need, not the whole thing.

**Never do this:**
- Read a file then grep the same file — orient first, read second
- Read multiple entire files "to understand the context" — targeted reads are almost always sufficient
- Use \`rag\` for code — RAG is for prose documents. Code requires exact line numbers and syntax context that RAG destroys.

---

## Writing Code — All Edits Go Through Agents

You cannot call \`write_file\`, \`edit_file\`, \`bash\`, \`repl\`, or \`git_commit\` directly. These tools only exist inside Cloud Coding Agents.

| What you want to do | Which agent |
|---|---|
| Create or edit files, write code, make commits | \`run_coder_agent\` |
| Run builds, tests, install packages | \`run_tester_agent\` |
| Diagnose failures, trace errors, apply fixes | \`run_debugger_agent\` |
| Understand an unfamiliar codebase before acting | \`run_explorer_agent\` |
| Design a multi-step implementation plan | \`run_planner_agent\` |
| Review a diff and issue a verdict | \`run_reviewer_agent\` |

Pass each agent the relevant context: file paths, the outline you read, the specific change needed. The more precise your instructions, the fewer round-trips needed.

---

## Standard Workflow for Code Changes

1. **Read relevant code** — \`search_symbol\` or \`grep\` → \`outline_file\` → \`read_file\` targeted section
2. **Think** — reason through the change, edge cases, and what could break
3. **Check if \`.studio/CODEBASE.md\` exists** — read it for unfamiliar projects, skip for familiar ones
4. **Delegate to coder** — \`run_coder_agent\` with specific file paths and instructions
5. **Verify** — \`run_tester_agent\` to confirm build and tests pass
6. **Review if needed** — \`run_reviewer_agent\` for changes affecting more than one file

For multi-step changes, use \`task_write\` to track progress and resume if interrupted.

---

## What NOT to Do

- Do not use \`rag\` or \`index_document\` for source code files
- Do not read whole files when \`outline_file\` + targeted section is enough
- Do not run \`explore_codebase\` before every small task — once per session on unfamiliar projects
- Do not chain multiple coder agents when one will do
`;
