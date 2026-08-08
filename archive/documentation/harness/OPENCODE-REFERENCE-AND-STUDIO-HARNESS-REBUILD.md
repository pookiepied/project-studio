# Studio Harness Rebuild — OpenCode Architectural Reference & Reconstruction Spec

> Purpose: transform the Studio Harness from a flat bag of ~100 primitive MCP tools
> into a layered coding-execution system where every capability has a defined
> altitude, scope, lifecycle, and place in the agent loop. Built by analyzing
> OpenCode (`temp/opencode/packages/opencode`) as the reference implementation and
> comparing it against the current harness (`STUDIO/library/mcp-servers/harness/studio-harness`).
>
> This document is written to be executed by another coding agent without needing to
> re-derive the architecture. Sections 1–3 are the reference analysis; sections 4–12
> are the plan.

---

## 0. TL;DR — the one insight that reorganizes everything

OpenCode does **not** treat its harness as "a set of tools." It treats it as **five
stacked layers**, and the tool list is only the bottom one:

```
 5. RUNTIME ORCHESTRATION   outer loop, inner processor, retry, snapshot, compaction, status
 4. CONTEXT / PROMPT        system-prompt builder, instructions, skills listing, reminders, truncation
 3. SPECIALIZED AGENTS      explore / general / plan / build — permission+prompt+model PROFILES, not code
 2. ORCHESTRATION PRIMITIVES  task (spawn subagent), skill (load skill), plan_exit (mode switch)
 1. PRIMITIVE TOOLS         read, write, edit, glob, grep, shell, lsp, todowrite, question, webfetch...
    ── cross-cutting ──     Permission (ruleset+approval+visibility), MCP integration, Plugin hooks, Config, Bus/DB
```

The critical distinction the current Studio Harness is missing:

- **A "specialized agent" in OpenCode is not a new program.** It is a *declarative
  record* — `{ name, prompt, permission-ruleset, model, mode }` — that runs the
  **same** inner loop over a **masked subset** of the same primitive tools. The
  Explore agent is literally the primitive `grep/glob/read/bash` tools + a
  search-specialist system prompt + a permission mask that denies everything else.
  It is invoked through **one** primitive (`task`).

- Therefore "don't expose raw search to the main agent, wrap it in an Explore agent"
  is achieved with **zero** extra tool code — you write a permission ruleset and a
  prompt, and the main agent reaches it via `task(subagent_type="explore")`.

The current harness has none of layers 2–5. It only has layer 1 (flat, and
over-populated) plus a few ad-hoc "composite" functions that try to fake layer 3 in
imperative code. That is the root cause of "fragmented and messy."

---

## 1. OpenCode capability inventory (complete)

Each entry: **what / why / where / depends-on / depended-by / kind / when-used /
called-directly-by-main-agent?**

### 1.1 Layer 1 — Primitive tools

All primitives share one contract (`src/tool/tool.ts`): `Tool.define(id, initEffect)`
returns `{ id, description, parameters (Effect Schema), jsonSchema, execute(args, ctx) }`.
The wrapper (`wrap()`) auto-applies: argument-schema validation → typed
`InvalidArgumentsError` (model-facing "rewrite the input" prose), output truncation
(per-agent), and tracing. `ExecuteResult = { title, metadata, output, attachments? }`.
`Context` carries `sessionID, messageID, agent, abort, messages, metadata(), ask()`.

| Tool | id | What / why | Where | Direct call by main agent? | Notes |
|---|---|---|---|---|---|
| Read | `read` | Read file slice; the canonical file-content primitive | `tool/read.ts` | Yes | truncates, records read for edit-staleness |
| Write | `write` | Create/overwrite file | `tool/write.ts` | Yes | gated by `edit` permission |
| Edit | `edit` | Exact-string replace | `tool/edit.ts` | Yes (non-GPT) | swapped for `apply_patch` on GPT models |
| Apply-patch | `apply_patch` | Unified-diff multi-file edit | `tool/apply_patch.ts` | Yes (GPT only) | registry picks edit XOR patch per model |
| Glob | `glob` | Filename pattern match | `tool/glob.ts` | Yes | ripgrep-backed |
| Grep | `grep` | Content regex search | `tool/grep.ts` | Yes | ripgrep-backed |
| Shell | `shell` (bash) | Run shell command; process-arity parsing for permission | `tool/shell.ts`, `tool/shell/` | Yes | tree-sitter parse to classify file-mutating commands |
| LSP | `lsp` | Language-server queries (experimental flag) | `tool/lsp.ts` | Flagged | hover/defs/refs |
| Webfetch | `webfetch` | Fetch URL → markdown | `tool/webfetch.ts` | Yes | |
| Websearch | `websearch` | Web search (provider/flag gated) | `tool/websearch.ts` | Conditional | only if provider supports it |
| Todowrite | `todowrite` | Write session task list | `tool/todo.ts` | Yes (primary agents) | denied for subagents by default |
| Question | `question` | Interactive `ask_user_question` | `tool/question.ts` | Client-dependent | only in app/cli/desktop |
| Invalid | `invalid` | Fallback for unknown tool call | `tool/invalid.ts` | n/a | error surface |

**Kind:** primitives. **When used:** throughout. **Depends on:** Permission, Truncate,
Agent, Ripgrep, LSP service, FS. **Depended-by:** registry, every agent.

### 1.2 Layer 2 — Orchestration primitives (tools that drive the harness itself)

| Tool | What / why | Where | Direct by main agent? | Key mechanics |
|---|---|---|---|---|
| **task** | Spawn a subagent as a **child session**; the ONLY way specialized agents are reached | `tool/task.ts` | Yes | Derives child permission from parent+subagent ruleset; runs child prompt loop; returns last text part; supports `background=true` (async + notify) and `task_id` (resume same child session). Description is **dynamic**: lists spawnable subagents filtered by the `task:<name>` permission. |
| **skill** | Load a SKILL.md's markdown + file list into context on demand | `tool/skill.ts` | Yes | Progressive disclosure. Gated by `skill:<name>` permission. Returns skill body + sampled file list rooted at the skill dir. |
| **plan_exit** | Switch from plan mode to build mode after user approval | `tool/plan.ts` | Flagged | Asks the user a question, writes a synthetic user message "execute the plan", flips agent to `build`. |

**Insight:** these are the joints. `task` is the recursion primitive (agent → agent).
`skill` is the instruction-injection primitive. `plan_exit` is a mode-transition
primitive. None of them are "capabilities" in the file-search sense — they steer the
loop.

### 1.3 Layer 3 — Specialized agents (declarative profiles)

Defined in `src/agent/agent.ts` as `Agent.Info` records. **No per-agent code.** Fields:
`name, description, mode (primary|subagent|all), permission (ruleset), model?, prompt?,
temperature?, hidden?, native?`. Users add/override via `config.agent`.

| Agent | mode | Permission shape | Prompt | Role |
|---|---|---|---|---|
| **build** | primary (default) | `*: allow` + user config; `question/plan_enter allow` | provider base prompt | The full-power coding agent |
| **plan** | primary | inherits build but `edit: deny` (except plan files), `task.general: deny`, `plan_exit: allow` | plan-mode prompt | Read+design only; cannot edit code |
| **general** | subagent | `*: allow`, `todowrite: deny` | (base) | Parallel multi-step worker for delegated units |
| **explore** | subagent | `*: deny` except `grep/glob/list/bash/read/webfetch/websearch: allow` + readonly external dirs | `agent/prompt/explore.txt` (search specialist) | **The read-only codebase-exploration agent** |
| **compaction** | primary, hidden | `*: deny` | `agent/prompt/compaction.txt` | Summarizes history on overflow |
| **title** | primary, hidden | `*: deny` | `title.txt` | Generates session title |
| **summary** | primary, hidden | `*: deny` | `summary.txt` | Generates running summary |

**Kind:** configuration over layer 1+2. **When used:** `build`/`plan` are the entry
agent; `explore`/`general` are spawned via `task`; `compaction`/`title`/`summary` are
driven by the runtime, not the model. **Called directly by main agent?** No — reached
via `task` (except the primary the user is talking to). This is exactly the
"primitive tools are not the first interface" pattern.

### 1.4 Layer 4 — Context & prompt systems

| Capability | What / why | Where | Kind |
|---|---|---|---|
| **System-prompt builder** | Assembles per-turn system: provider base prompt + env block + instructions + MCP instructions + skills list + references | `session/system.ts`, `session/prompt/*.txt` | infra |
| Provider prompt selection | Picks anthropic/gpt/gemini/kimi/… base prompt by model id | `session/system.ts::provider()` | infra |
| **Instruction** | Loads `AGENTS.md`/project instructions into system | `session/instruction.ts` | integration |
| **Skills listing** | Advertises available skills (verbose) in system prompt so the model knows what to load | `session/system.ts::skills` + `skill/index.ts::fmt` | integration |
| **MCP instructions** | Injects connected-server usage instructions, filtered by permission-visible tools | `session/system.ts::mcp` | integration |
| **Reminders** | Injects transient reminders into the message list (e.g. plan reminders) | `session/reminders.ts` | infra |
| **Truncate** | Caps tool output; overflow spilled to a whitelisted temp file the agent may read | `tool/truncate.ts` | infra |
| **Overflow / Compaction** | Detects token overflow → summarizes older turns via the hidden `compaction` agent | `session/overflow.ts`, `session/compaction.ts` | runtime |
| **Summary** | Background session summary/title generation | `session/summary.ts` | runtime |
| **Snapshot** | Git-like content snapshots per step → produces `patch` parts, enables revert/diff | `session/../snapshot`, used in `processor.ts` | runtime |

### 1.5 Layer 5 — Runtime orchestration (the loop)

| Capability | What / why | Where |
|---|---|---|
| **Outer loop** | `while` over steps: build system → resolve tools → `processor.process()` → branch on `continue`/`compact`/`stop`; enforces max steps | `session/prompt.ts` (~L1140–1339) |
| **Session processor (inner loop)** | Consumes one LLM stream: materializes text/reasoning/tool parts, runs tool executes, handles results/errors, snapshots, **doom-loop guard** (3 identical calls → ask), overflow→compact, abort/cleanup; returns `compact\|stop\|continue` | `session/processor.ts` |
| **Tool resolution** | Per-turn: registry tools + MCP tools + MCP-resource tools → AI-SDK tool objects, each wired to `permission.ask` + plugin before/after + truncation | `session/tools.ts` |
| **Tool registry** | The catalog: builtin ∪ plugin/file tools; `tools(model,agent,permission)` filters by model (edit vs patch, websearch), injects dynamic descriptions (task→agent list, code-mode→MCP catalog) | `tool/registry.ts` |
| **LLM streaming** | Provider-agnostic streaming, native/ai-sdk runtimes | `session/llm.ts`, `session/llm/*` |
| **Retry** | Backoff policy per provider on transient failures | `session/retry.ts` |
| **Status** | busy/idle/retry session state for UI | `session/status.ts` |
| **Background jobs** | Async subagent execution + promotion/notify | `background/job.ts` |
| **Revert** | Roll back to a snapshot | `session/revert.ts` |

### 1.6 Cross-cutting infrastructure & integrations

| System | What / why | Where | Kind |
|---|---|---|---|
| **Permission** | Ruleset = ordered `{permission, pattern, action: allow\|ask\|deny}`. `evaluate()` = last-match-wins wildcard. `ask()` → deny throws `DeniedError`, ask raises `Asked` event + waits (reply `once/always/reject`, approvals accumulate). `disabled()`/`visibleTools()` compute per-agent tool visibility. Every agent carries a merged ruleset (defaults+user+agent). | `permission/index.ts`, `permission/evaluate.ts`, `permission/arity.ts` | infra (the spine) |
| **MCP integration** | Connect local (stdio) / remote (http+SSE+OAuth) servers; list tools/resources/prompts; fold into tool map with `mcp:<server>:*` permission; inject instructions | `mcp/index.ts`, `mcp/catalog.ts` | integration |
| **Plugin / hooks** | Hooks are `(input,output)=>Promise<void>` objects; `trigger(name,…)` runs all. Points: `tool.execute.before/after`, `tool.definition`, `experimental.chat.system.transform`, `…messages.transform`, `experimental.text.complete`, `event`, `config`, `auth`. Plugins may also add custom tools + workspace adapters. | `plugin/index.ts`, `plugin/loader.ts` | extension |
| **Config** | Layered config (global/project/`.opencode`), agent/skill/mcp/permission blocks | `config/*` | infra |
| **Provider / Auth** | Model catalog + credential/OAuth flows | `provider/*`, `auth/*` | integration |
| **Bus / Events / DB / Storage** | Event bus, message/part persistence (Effect+SQLite) | `bus/*`, `storage/*`, `session/message-v2.ts` | infra |

### 1.7 OpenCode data flow (one user turn)

```
user msg → prompt.ts outer loop:
  build system prompt (system.ts: base+env+instructions+mcp+skills)
  SessionTools.resolve → registry.tools(model,agent,perm) ∪ mcp.tools()
     each tool.execute wraps: plugin.before → permission.ask → run → truncate → plugin.after
  processor.create() → processor.process(stream):
     LLM streams events → materialize parts
        tool-call → ensure part → doom-loop check → execute (permission may pause) → result/err
        step-finish → snapshot patch, overflow? → needsCompaction
     returns continue | compact | stop
  continue → next step   |   compact → compaction.create   |   stop → break
```

Subagent branch: main agent calls `task` → child session created with derived
permission → child runs its **own** `prompt.ts` loop with its agent profile → returns
last text to parent as a tool result.

---

## 2. OpenCode capability map — categorized

```
PRIMITIVE TOOLS (main agent calls directly, permission-masked)
  file:    read, write, edit|apply_patch, glob, grep, (list via bash/ls)
  exec:    shell(bash)
  code:    lsp
  web:     webfetch, websearch
  state:   todowrite, question

ORCHESTRATION PRIMITIVES (steer the loop)
  task (spawn/resume/background subagent), skill (load instructions), plan_exit (mode switch)

SPECIALIZED AGENTS (declarative: prompt + permission mask + model, run via task)
  explore (read-only search)   general (parallel worker)
  plan / build (primary modes)   compaction/title/summary (runtime-driven, hidden)

WORKFLOWS (emergent from mode + permission + prompt, not classes)
  plan→build handoff   auto-compaction   doom-loop guard   background delegation

RUNTIME ORCHESTRATION
  outer loop (prompt.ts)   inner processor (processor.ts)   tool resolution (tools.ts)
  registry (catalog+filter)   llm streaming   retry   status   snapshot/revert   background jobs

CONTEXT / PROMPT
  system builder   instructions(AGENTS.md)   skills listing   mcp instructions
  reminders   truncate   overflow/compaction   summary

INTEGRATIONS            CROSS-CUTTING INFRA
  MCP   Plugin/hooks      Permission (spine)   Config   Provider/Auth   Bus/Events/DB
```

---

## 3. Current Studio Harness — what it actually is

**Shape:** one stdio MCP server (`studio-harness/src/index.ts` → `server.ts`) exposing
a **flat list of ~108 tools** (`registry.ts`: `TOOL_DEFINITIONS` + `HANDLERS`,
name→function dispatch). There is a genuinely good **tool contract**
(`tools/tool-contract.ts`: `TOOL_TIMEOUTS`, uniform `{error}` shape, `wrapTool`
safety net). Everything above layer 1 lives **outside** the harness.

### 3.1 Current tool inventory by folder (count)

| Folder | # | Tools | OpenCode analog |
|---|---|---|---|
| `execution` | 9 | bash, powershell, repl, start/read/write/stop/list_process, command_exists | `shell` (1) + process-mgmt (none) |
| `network` | 4 | ssh_exec, ssh_session (+2) | none (out of harness scope) |
| `filesystem` | 14 | read/read_many/edit/multi_edit/write/delete/move, glob, grep, ls, file_metadata, detect_binary, content_hash, watch_files | read/write/edit/glob/grep (5) |
| `notebook` | 1 | read_notebook | none |
| `archive` | 1 | read_archive_manifest | none |
| `search` | 6 | search_text/files/identifiers/imports/config/todos | grep/glob (2) |
| `context` | 8 | semantic_code/document_search, find_similar/feature_impl, retrieve_context_bundle, explain_retrieval, index_status, reindex_paths | none (this is RAG) |
| `syntax` | 9 | parse_file, query_syntax_tree, find/structural_replace, extract_symbol_body, find_dead_exports/duplicate, complexity, detect_syntax_errors | (lsp, partially) |
| `codeintel` | 6 | outline_file, index_codebase, **explore_codebase**, **search_symbol**, **analyze_file**, find_related_files | explore *agent* (not tools) |
| `graph` | 5 | graph_build/status/neighbors/path/impact | none |
| `git` | 32 | full git surface | (bash) |
| `lsp`+`ide` | 9 | lsp + navigate/inspect/diagnostics/rename/code_actions/format… | `lsp` (1) |
| `interaction` | 1 | ask_user_question | `question` (1) |
| `utils` | 1 | sleep | none |

### 3.2 What exists vs. what's missing (vs OpenCode)

**Exists and is good (keep):**
- Uniform tool contract, timeout discipline, error-formatting → *better* than OpenCode's
  ad-hoc per-tool errors. Keep as the layer-1 standard.
- Real primitive coverage: filesystem, shell, git, lsp, search.

**Exists elsewhere in the platform (do NOT rebuild in the harness — adapt):**
- **Permissions**: `STUDIO/src/core/permissions/*` (`model.ts`, `scope.ts`,
  `toolRisk.ts`, engine) — the cloud/local boundary + risk classification already live
  here. The harness needs to *emit permission metadata*, not own an approval engine.
- **MCP registry / lifecycle**: `STUDIO/src/runtime/servers/*` + `Backend/Cloud`
  MCP libraries. Harness is *one server among many*.
- **Skills**: platform skill-library / skill-management workers exist. Harness needs a
  *skill-discovery adapter*, not a second skill platform.
- **Agent spawning**: `spawn_agent` is handled **server-side by the AI Worker**
  (`builtinTools.ts` has only a client stub). `task_write` is handled in the frontend.
- **System prompt / agent routing**: moved to the cloud Worker
  (`chat/src/prompts/system.ts` harnessSection), per `studio-harness/src/prompt.ts`.

**Missing entirely (the layers to build):**
- Layer 2 orchestration primitives inside the coding flow: no `task`/subagent contract
  the harness participates in, no `skill`-load path exposed as a coding capability, no
  mode switch.
- Layer 3 specialized agents as **profiles**: instead there are imperative "composite"
  functions (`explore_codebase`, `search_symbol`, `analyze_file`) that hardcode a
  chain of calls. These are a *symptom* — they fake an Explore agent in code.
- Layer 4 harness-owned context management (truncation exists per-tool via contract;
  no compaction/summary/snapshot ownership — lives in Worker).
- Layer 5 loop — **entirely** in the Worker + frontend runtime; the harness has no
  concept of a session, step, or execution state.

### 3.3 The concrete problems (named)

1. **Altitude collapse.** 108 tools sit at one level. The model is offered
   `search_text`, `search_identifiers`, `grep`, `semantic_code_search`,
   `find_similar_implementation`, `explore_codebase`, `search_symbol`,
   `graph_neighbors`, `query_syntax_tree` — **nine ways to "find code"** — with no
   guidance on which to use when. This is the fragmentation.
2. **Duplicated responsibility across 6 subsystems.** `search/`, `filesystem`(grep/glob),
   `codeintel/`, `context/`, `graph/`, `syntax/`, `lsp/ide` all answer "where is X / what
   relates to X." No single owner of "code discovery."
3. **Composite tools are mis-scoped.** `explore_codebase`/`search_symbol`/`analyze_file`
   are orchestration (layer 3) implemented as tools (layer 1). They belong as an
   **Explore agent profile**, not hand-chained functions with regex-parsed LSP output.
4. **No permission surface from the harness.** Every tool is equally exposed; there is
   no per-tool "read vs mutate" tag the platform permission engine can consume to build
   agent masks. (`toolRisk.ts` classifies externally by guesswork.)
5. **Primitive overuse is unavoidable** because there is no wrapping agent — the main
   agent must call raw primitives for everything.
6. **Process/SSH/notebook/archive** live in the coding harness but are arguably a
   different capability domain (runtime/ops), inflating the surface.

---

## 4. Target architecture for the Studio Harness

Adopt OpenCode's **five layers**, but respect the Studio boundary: the harness is a
**capability provider + coding-execution kernel**, while the **platform** (Worker +
frontend runtime) owns the outer session, the approval UI, the MCP registry, the skill
library, and cross-server agent spawning. The harness must *expose the seams* the
platform needs, not duplicate the platform.

```
                          ┌─────────────────────────────────────────────┐
 PLATFORM (exists)        │ AI Worker: outer session loop, spawn_agent,   │
 — reuse via adapters     │ system-prompt builder, compaction, summary    │
                          │ Frontend runtime: MCP registry, permission    │
                          │ engine + approval UI, task_write, skills UI    │
                          └───────────────┬─────────────────────────────┘
                                          │ MCP (tools/list, tools/call) + capability metadata
                          ┌───────────────▼─────────────────────────────┐
 STUDIO HARNESS (rebuild) │ L5 Kernel: coding-session state, step guard,  │
                          │     doom-loop guard, snapshot/revert (local)  │
                          │ L4 Context: output truncation (have), local   │
                          │     retrieval index ownership, file-read ledger│
                          │ L3 Agent profiles (data): explore, implement, │
                          │     review, test, debug — masks+prompts        │
                          │ L2 Orchestration prims: run_subagent, load_skill│
                          │ L1 Primitives (curated, tagged read|mutate):   │
                          │     fs, exec, git, search, lsp                 │
                          │ Contract: TOOL_TIMEOUTS + {error} + risk tag   │
                          └───────────────────────────────────────────────┘
```

Two viable delivery models — **decide this first** (see §11 Open Decisions):

- **(A) Harness stays a pure MCP tool server.** Layers 2–5 are implemented as *agent
  profiles + prompt fragments + permission metadata* that the **Worker** consumes; the
  harness's only new code is (i) curating/tagging L1, (ii) emitting a machine-readable
  **capability manifest** (tool → {altitude, risk, domain, when-to-use}), and (iii)
  a couple of orchestration tools that call back into the Worker's agent spawner.
- **(B) Harness gains a thin kernel.** The harness itself runs a local coding-session
  object (step counter, file-read ledger, snapshot, doom-loop guard) and exposes
  higher-level entry tools, while still delegating model calls to the Worker.

Recommendation: **(A) for agents/loop, (B) only for the strictly-local concerns**
(snapshot/revert, file-read ledger, output truncation) that the Worker cannot do
because it isn't on the machine. This keeps a single loop (the Worker's) and avoids two
competing orchestrators — see §10 "what NOT to copy."

### 4.1 The capability hierarchy (target)

**L1 — Primitive tools (curated set, each tagged).** Every tool declares in its
definition: `domain` (fs|exec|vcs|search|code-intel|net|notebook), `risk`
(`read` | `mutate` | `exec` | `network`), and `altitude: "primitive"`. This is the
single source the permission engine and agent masks consume.

Curated L1 (target ≈ 30, down from 108):
- **fs.read**: `read_file`, `read_many_files`, `ls`, `glob`, `file_metadata`,
  `detect_binary`, `content_hash`
- **fs.mutate**: `write_file`, `edit_file`, `multi_edit`, `delete_file`, `move_file`
- **search**: `grep` (content), `search_files` (name), `search_symbol` (declarations —
  demoted to primitive), `search_git_history`. *Collapse* `search_text`/`identifiers`/
  `imports`/`config`/`todos` into `grep` presets or drop.
- **exec**: `bash`, `powershell`, `repl`, `command_exists` (+ process-mgmt as a
  separate *ops* domain, see §7)
- **vcs**: keep git but **group** (see §7) — most git verbs become one `git` tool with a
  subcommand arg, or stay individual but tagged `vcs.read`/`vcs.mutate`.
- **code-intel primitives**: `outline_file`, `lsp` (+ ide navigate/inspect/diagnostics),
  `parse_file`/`query_syntax_tree` (kept as low-level, rarely main-agent-facing)
- **interaction**: `ask_user_question`; **utils**: `sleep`

**L2 — Orchestration primitives.**
- `run_subagent(profile, prompt, background?, resume_id?)` — the `task` analog. In model
  (A) this is a thin tool that hands off to the Worker's `spawn_agent`; its description
  is **dynamic** (lists profiles the current agent may spawn, from permission).
- `load_skill(name)` — the `skill` analog; calls the skill-discovery adapter (§8) and
  returns the SKILL.md body + file list. Gated by `skill:<name>`.
- (optional) `enter_plan` / `exit_plan` — mode transition, if Studio has plan mode.

**L3 — Specialized agent profiles (data, in a registry).** Each is
`{ name, description, prompt, permissionMask, model?, mode }`. Ship:
- **explore** — read-only. Mask: allow `fs.read`, `search`, `lsp(read)`, `bash(read-only)`;
  deny everything mutate/exec-write. Prompt = codebase-navigation specialist. **Replaces
  the `explore_codebase`/`search_symbol`/`analyze_file` composites.**
- **implement** — full mask (fs.mutate + exec + vcs) with the build prompt.
- **review** — read-only + git diff; prompt = change-review specialist.
- **test** — exec + fs.read + limited mutate; prompt = run/author tests.
- **debug** — exec + fs.read + fs.mutate; prompt = reproduce/instrument/fix.
- (runtime-driven, hidden) **plan**, **summarize/compact** if owned here.

**L4 — Context/prompt (harness-owned parts only).** Output truncation (exists), the
**file-read ledger** (track what the agent has read so edits can detect staleness — a
local concern), and **local retrieval index** ownership (the `context/` embeddings +
`graph/` — see §7 decision on whether these survive). Compaction/summary stay in Worker.

**L5 — Kernel (strictly-local orchestration state).** A per-coding-session object:
step counter + max-step ceiling, **doom-loop guard** (N identical calls → force
`ask_user_question` / stop), **snapshot/revert** (local git-content snapshots to enable
"undo this change set"). Everything model-facing (the LLM stream, retry, the actual
loop) stays in the Worker.

### 4.2 Responsibility & scope table (every proposed component)

| Component | Layer | Owns | Must NOT do | Consumes | Consumed by |
|---|---|---|---|---|---|
| Primitive tool | 1 | one atomic op + its error/timeout/risk tag | orchestration, multi-step chains | fs/os/git/lsp | agents, run_subagent children |
| Capability manifest | 1 | tool→{domain,risk,altitude,when} | approval decisions | tool defs | permission engine, prompt builder, masks |
| `run_subagent` | 2 | hand a prompt to a profile-masked child | run the model itself | agent registry, Worker spawner | main agent |
| `load_skill` | 2 | fetch+return skill body | store/execute skills | skill adapter | any agent |
| Agent profile | 3 | prompt + permission mask + model | contain imperative logic | manifest, prompts | run_subagent, Worker |
| Agent registry | 3 | list/get profiles, filter by permission | | profiles | run_subagent (dynamic desc), prompt builder |
| Output truncation | 4 | cap tool output, spill to temp | | contract | every tool |
| File-read ledger | 4 | record reads for edit-staleness | | fs.read tools | edit tools |
| Retrieval index (if kept) | 4 | local embeddings/graph store | be a 2nd search UX | fs | explore agent only |
| Session kernel | 5 | step/doom-loop/snapshot state | LLM streaming, retry | tool calls | Worker via events |
| Permission adapter | infra | translate manifest risk → platform masks | own approval UI | manifest, platform perms | Worker |
| Skill adapter | infra | discover SKILL.md across platform sources | be a skill store | skill-library | load_skill, prompt builder |
| MCP adapter | infra | register harness as a server | be a registry | platform registry | platform |

---

## 5. Recommended implementation order (and why)

The order is chosen so each phase produces a working, testable improvement and never
leaves the harness in a broken state. Rationale after each.

**Phase 0 — Freeze the contract & decide the delivery model.**
Confirm §11 decisions (A vs B; fate of `context`/`graph`; git grouping; process/ssh
domain split). *Why first:* every later phase depends on whether layers 2–5 live in the
harness or the Worker.

**Phase 1 — Tag & curate L1 (no behavior change to survivors).**
Add `domain`/`risk`/`altitude` to every kept tool definition; mark the deletions;
collapse the 9 search variants into `grep` + a small set. *Why:* the capability manifest
is the input to permissions and agent masks — nothing above can be built correctly until
each primitive is tagged. Low risk, immediately useful to `toolRisk.ts`.

**Phase 2 — Emit the capability manifest.**
`tools/list` (or a sidecar resource) advertises the tags + a one-line "when to use."
Wire `STUDIO/src/core/permissions/toolRisk.ts` to consume real tags instead of guessing.
*Why:* turns tags into a platform contract; removes external guesswork; enables masks.

**Phase 3 — Agent profiles + `run_subagent`, and delete the composites.**
Add the L3 registry (data) and the L2 `run_subagent` tool that delegates to the Worker's
`spawn_agent` with a profile mask. Ship the **explore** profile first, then delete
`explore_codebase`/`search_symbol`/`analyze_file`, redirecting their intent into the
explore agent. *Why:* this is the single highest-leverage change — it fixes altitude
collapse and primitive overuse, and it removes the mis-scoped composites. Do it right
after masks exist (needs Phase 1–2).

**Phase 4 — `load_skill` + skill-discovery adapter.**
Expose skills as a coding capability, discovered from the existing platform skill
library (adapter, not a new store). Advertise available skills in the (Worker) system
prompt. *Why:* independent of Phase 3; unlocks progressive-disclosure instructions.

**Phase 5 — Local kernel concerns (model B slice only).**
File-read ledger → edit-staleness guard; snapshot/revert; doom-loop guard surfaced to
the Worker. *Why:* these need on-machine state the Worker can't hold; they harden
correctness once the agent layer is driving real edits.

**Phase 6 — Domain split & retrieval decision.**
Move process-mgmt/ssh/notebook/archive into a separate *ops* capability (or a second
MCP module); resolve the `context`/`graph` retrieval subsystems (keep behind the explore
agent, or retire). *Why last:* it's cleanup that's only safe once agents (Phase 3) define
who actually calls these.

**Phase 7 — Prompt & routing polish.**
Update the Worker `harnessSection` to describe the new altitudes ("to explore, spawn the
explore agent; to edit, use fs.mutate; …"). *Why:* the prompt should describe the system
only after the system exists.

---

## 6. Migration plan (current → target), file-level

| Current | Action | Target |
|---|---|---|
| `registry.ts` flat `TOOL_DEFINITIONS`/`HANDLERS` | **Keep** dispatch; add manifest emission; remove deleted tools | L1 registry + manifest |
| `tools/tool-contract.ts` | **Keep**; extend with `domain/risk/altitude` fields | L1 contract (source of truth) |
| `tools/codeintel/composite_tools.ts` (`explore_codebase`,`search_symbol`,`analyze_file`) | **Delete**; migrate intent to `explore` agent profile; keep `outline_file`,`find_related_files` as primitives | L3 explore agent |
| `tools/search/*` (6 tools) | **Merge** into `grep` presets; drop redundant | L1 `grep` |
| `tools/context/*` (8, RAG) | **Gate** behind explore agent or **retire** (see §11) | L4 retrieval (agent-only) or removed |
| `tools/graph/*` (5) | Same decision as context | L4 or removed |
| `tools/syntax/*` (9) | **Demote**: keep `parse_file`/`query_syntax_tree`/`detect_syntax_errors`; the analysis ones (`find_dead_exports`,`duplicate`,`complexity`) → explore/review agent-only or drop | L1 low-level + L3 |
| `tools/git/*` (32) | **Group** by subcommand or tag `vcs.read`/`vcs.mutate`; no capability loss | L1 vcs (tagged) |
| `tools/execution/*` process-mgmt + `tools/network/ssh` + `notebook` + `archive` | **Split** into an *ops* domain/module | separate capability |
| `tools/interaction/ask_user_question` | **Keep** | L1 |
| Worker `spawn_agent` (server-side) | **Wire** as the backend for `run_subagent`; add profile masks | L2/L3 bridge |
| Frontend `builtinTools.ts` `task_write` | **Keep** as-is (task UI state) | platform |
| `STUDIO/src/core/permissions/toolRisk.ts` | **Rewire** to read harness manifest tags | permission adapter |
| Worker `chat/src/prompts/system.ts` harnessSection | **Rewrite** for new altitudes (Phase 7) | prompt |

### 6.1 Components to RETAIN as-is
- Tool contract (`tool-contract.ts`), timeouts, `{error}` shape, `wrapTool`.
- Core primitives: `read_file`, `read_many_files`, `write_file`, `edit_file`,
  `multi_edit`, `delete_file`, `move_file`, `glob`, `grep`, `ls`, `bash`, `powershell`,
  `repl`, `outline_file`, `lsp` + ide nav/inspect/diagnostics/rename/format,
  `ask_user_question`, `sleep`, `file_metadata`, `detect_binary`, `content_hash`,
  `watch_files`, `find_related_files`, `search_git_history`, git surface (tagged).
- Platform permission engine, MCP registry/lifecycle, skill library, `spawn_agent`,
  `task_write` — **reuse via adapters, never rebuild.**

### 6.2 Components to REFACTOR / MERGE / REMOVE
- **Merge:** `search/{text,identifiers,imports,config,todos}` → `grep`.
- **Remove (fold into explore agent):** `explore_codebase`, `search_symbol`,
  `analyze_file` (composite chains).
- **Refactor (tag + possibly group):** all 32 git tools; process-mgmt; ssh.
- **Decide/quarantine:** `context/*` (RAG) and `graph/*` — retire or make
  explore-agent-only (they duplicate discovery and add heavy index state).
- **Demote:** heavier `syntax/*` analyzers to agent-only.

---

## 7. Domain boundaries (avoid re-inflating the surface)

Split the current monolith into **coding-core** vs **ops** so the coding agent isn't
offered infra it rarely needs:

- **coding-core (the harness):** fs, search, code-intel, git, exec(bash/powershell/repl).
- **ops (separate module or clearly-tagged domain):** process manager
  (start/read/write/stop/list_process), SSH, notebook, archive, watch_files. These are
  runtime/operations capabilities; keep them available but out of the default coding
  agent's tool list (offer via a profile that needs them).

**Git grouping:** 32 individual verbs is a lot of altitude-1 surface. Two acceptable
options — (a) keep individual but tag `vcs.read`/`vcs.mutate` so masks hide mutating
verbs from read-only agents; (b) collapse to a smaller set (`git_status/diff/log/show/
blame` read; `git` mutate-with-subcommand). Prefer (a) for least churn.

---

## 8. Integration adapters (reuse, don't rebuild)

- **Permission adapter.** Harness emits `risk`/`domain` per tool; the platform engine
  (`core/permissions`) builds agent masks and runs the approval UI. Harness never
  prompts the user itself (except via the `ask_user_question` primitive, which is a
  content request, not a permission gate).
- **Skill adapter.** `load_skill` and the system-prompt skills list read from the
  existing skill library/worker. The harness discovers SKILL.md the way OpenCode does
  (project/global/config paths) **only if** the platform doesn't already provide a
  discovery API — prefer calling the platform.
- **Agent-spawn adapter.** `run_subagent` marshals `{profile, prompt, mask}` to the
  Worker's `spawn_agent`; the Worker runs the child loop. This preserves **one** loop.
- **MCP adapter.** Unchanged: the harness is registered as one local MCP server; the
  runtime already treats it as machine-bound (`permissions/scope.ts`).

---

## 9. Data flow in the rebuilt system (one coding turn)

```
Worker outer loop (existing) builds system prompt:
   base + env + AGENTS.md + [available skills from adapter] + [harness capability hints]
   tool list = harness manifest filtered by current agent's permission mask
main agent turn:
   • wants to understand code → run_subagent("explore", "...")  ← not raw grep×9
        Worker spawns explore child (read-only mask) → child loops over fs.read/search/lsp
        → returns a summary text part
   • wants a workflow doc → load_skill("...") → SKILL.md injected
   • wants to edit → fs.mutate primitives (permission engine may pause for approval)
        harness records reads in ledger; snapshot taken; doom-loop guard watches
   • wants to validate → run_subagent("test", "...")
Worker: step-finish → overflow? compact (Worker-owned) ; continue|stop
```

Key property: the **main agent's default tool list is small and high-altitude** —
`run_subagent`, `load_skill`, the fs/exec/vcs primitives it needs — while the *breadth*
(all the search/graph/syntax machinery) is reachable **through** the explore/review/test
agents, exactly the OpenCode pattern.

---

## 10. OpenCode capabilities we should NOT copy (and why)

- **Effect + LayerNode DI everywhere.** OpenCode's entire architecture is Effect
  services. Studio's harness is a plain TS MCP server with a clean `{error}` contract.
  Copy the *layering concepts*, not the Effect runtime — it would be a massive,
  low-value rewrite.
- **A second full session/message/DB store (`message-v2`, storage, bus).** The platform
  already persists conversations. The harness kernel should hold only *ephemeral local*
  state (ledger/snapshot/step), not a durable message store.
- **In-harness LLM streaming, retry, compaction, provider/auth.** These belong to the
  Worker. Duplicating them creates two loops fighting for control (the exact "two
  orchestrators" trap). Keep the Worker as the single loop.
- **OAuth/remote-MCP client stack** inside the harness — the platform MCP registry owns
  connections.
- **Per-provider prompt files (anthropic/gpt/gemini/…).** The Worker already has a
  conditional system-prompt builder; don't fork it into the harness.
- **`code-mode` (execute-tool-as-code) experiment.** Interesting but experimental and
  orthogonal to fixing altitude; defer.
- **Background-subagent machinery** — only adopt if Studio genuinely needs async
  delegation; otherwise the synchronous `run_subagent` is enough and simpler.

What we DO copy (concepts, re-implemented in Studio's idiom): the five-layer split;
agents-as-declarative-profiles; the `task`/`skill` orchestration primitives; permission
rulesets driving tool *visibility* (not just approval); the read-only Explore agent;
dynamic tool descriptions (task lists spawnable agents); output truncation; doom-loop
guard; snapshot-for-revert.

---

## 11. Open decisions (need a human answer before Phase 0 closes)

1. **Delivery model A vs B** (§4): pure-MCP + Worker-owned agents (A), or add a thin
   local kernel (B, recommended only for ledger/snapshot/doom-loop). → Recommend
   **A for agents/loop + B-slice for local-only state.**
2. **Fate of `context/` (RAG embeddings) and `graph/`.** Retire, or keep as
   **explore-agent-only** retrieval? They add heavy index state and duplicate discovery.
   → Recommend quarantine behind the explore agent; retire if underused.
3. **Git surface:** tag-in-place (recommended) vs collapse to subcommands.
4. **Ops split:** move process-mgmt/ssh/notebook/archive to a separate module, or keep
   in-harness but domain-tagged and hidden from the default coding agent?
5. **Does Studio want plan mode** (plan→build handoff), or is a single build agent + the
   explore/review/test subagents enough?

---

## 12. Definition of done

- Every surviving primitive carries `{domain, risk, altitude, whenToUse}`; the manifest
  is emitted and consumed by `core/permissions/toolRisk.ts` (no more external guessing).
- The three composite tools are deleted; the **explore** agent profile answers all
  "understand the code" needs via `run_subagent`.
- The default coding agent's advertised tool list is high-altitude and ≤ ~20 entries;
  breadth is reachable only through agent profiles.
- `run_subagent` and `load_skill` exist and delegate to the platform (spawner + skill
  library) — no duplicated loop, no duplicated skill store.
- Local-only correctness guards (read-ledger/edit-staleness, snapshot/revert, doom-loop)
  are enforced on the machine.
- One loop (the Worker's) drives everything; the harness never runs its own LLM loop.
```

---

### Appendix A — OpenCode file index (for the implementing agent)

Tool contract `src/tool/tool.ts` · Registry `src/tool/registry.ts` · Per-turn tool
binding `src/session/tools.ts` · Agents `src/agent/agent.ts` · Explore prompt
`src/agent/prompt/explore.txt` · Task/subagent `src/tool/task.ts` · Skill tool
`src/tool/skill.ts` + service `src/skill/index.ts` · Plan `src/tool/plan.ts` · Todo
`src/tool/todo.ts` · Permission `src/permission/index.ts` · Inner loop
`src/session/processor.ts` · Outer loop `src/session/prompt.ts` (~L1140–1339) · System
prompt `src/session/system.ts` + `src/session/prompt/*.txt` · MCP `src/mcp/index.ts` ·
Plugin/hooks `src/plugin/index.ts` · Shell `src/tool/shell.ts`.

### Appendix B — Studio Harness file index

Entry `studio-harness/src/index.ts` → `server.ts` · Registry/dispatch `src/registry.ts`
· Contract `src/tools/tool-contract.ts` · Composites to delete
`src/tools/codeintel/composite_tools.ts` · Marker prompt `src/prompt.ts` · Platform
seams: permissions `STUDIO/src/core/permissions/{scope,model,toolRisk}.ts`, builtin
tools `STUDIO/src/runtime/execution/builtinTools.ts`, MCP runtime
`STUDIO/src/runtime/servers/*`, Worker prompt `Backend/Cloud/.../chat/src/prompts/system.ts`.
