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

## Writing Code — Direct Tools

You write, edit, run, and commit directly. Use the right tool for each job:

| What you want to do | Tool |
|---|---|
| Create a new file or fully rewrite one | \`write_file\` |
| Change part of an existing file | \`edit_file\` (exact string replace) |
| Make several coordinated edits at once | \`multi_edit\` |
| Run builds, tests, installs, scripts, git | \`bash\` |
| Quick throwaway computation | \`repl\` |
| Commit changes | \`git_commit\` |

**Author file content only with \`write_file\` / \`edit_file\` / \`multi_edit\`** — they write exactly what you give them, with no shell escaping to fight. Never pipe multi-line file bodies through \`bash\` (\`echo\`/heredoc): quoting and special characters like \`&\`, \`()\`, and quotes get mangled. Use \`bash\` for *running* things, not for writing files.

---

## Standard Workflow for Code Changes

1. **Read relevant code** — \`search_symbol\` or \`grep\` → \`outline_file\` → \`read_file\` targeted section
2. **Think** — reason through the change, edge cases, and what could break
3. **Make the change** — \`edit_file\` / \`multi_edit\` for edits, \`write_file\` for new files
4. **Verify** — run the build or tests with \`bash\` when the project has them
5. **Commit if asked** — \`git_commit\` with a clear message

For multi-step changes, use \`task_write\` to track progress and resume if interrupted.

---

## What NOT to Do

- Do not write file content through the shell — use \`write_file\` / \`edit_file\`
- Do not use \`rag\` or \`index_document\` for source code files
- Do not read whole files when \`outline_file\` + targeted section is enough
- Do not run \`explore_codebase\` before every small task — once per session on unfamiliar projects
`;
