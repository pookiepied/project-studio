# TASK 37 — A conversation that outlives the window

Brief: give conversations durable existence (index rows in `studio.db`), model
projects properly rather than stubbed, make archive-and-delete mean what the
copy says, give every projectless conversation a real folder of its own instead
of inheriting somebody's build directory, and point the webview at all of it
instead of demo seeds.

Everything measured was measured against the built harness process
(`dist/server.mjs`) driven over its real HTTP surface, plus one full restart
cycle. What still needs a person at the desktop is named plainly in section 8;
none of it is faked.

---

## 1. Part 0 — the boundary, verified, and it held

**The starting position survived: Flue owns the transcript, Studio owns the
index. Studio did not build a second message store.**

Evidence, from `@flue/runtime@1.0.0-beta.9` as shipped in this workspace:

- `docs/api/data-persistence-api.md:57` — "`AgentExecutionStore` contains
  submission lifecycle state only. Conversation transcripts are not session
  rows; they **live exclusively in `ConversationStreamStore`**."
- Same document, :89 — "This append-only, per-agent-instance stream is the
  **sole canonical transcript**... Adapters must not model a second
  authoritative transcript in session rows, snapshots, or event streams." And
  :93 — replay acceleration and compaction are deferred; adapters should not
  invent a second transcript or cache contract. That sentence is aimed exactly
  at what migration 14 might have become.
- Our own `src/storage/database.ts:12-15` already names the split: Flue owns
  `flue.db` "through an opaque persistence adapter with no exposed handle".

The two questions the schema depended on:

- **Can a stream be enumerated, or only addressed? Only addressed.** The
  `ConversationStreamStore` interface has no list method. `listAgents()`
  returns deployment-manifest entries (agent *names*), not conversations;
  `listRuns()` covers workflow runs, and "Agent prompts and dispatched agent
  input do not create workflow runs" (`data-persistence-api.md:121`). The HTTP
  surface is `GET /agents/:name/:id?view=history|updates`, keyed by an id we
  already hold, and Flue "ships no admin HTTP surface"
  (`docs/api/routing-api.md:87`). **Consequence, stronger than the brief
  allowed for:** the index is not merely the fast way to find a conversation —
  it is the *only* way. There is nothing to rebuild these rows from. They are
  load-bearing records of existence, and that is how migration 14 treats them.
- **What is the durable key? The stream path `agents/studio/<conversationId>`,
  where the id is ours** (ADR 0045 section 1). Flue persists the journal by
  that path (`~/.studio/data/flue.db`, `platform/paths.ts:110-112`), honours
  it after restart, and the webview already addresses it that way
  (`STUDIO/src/platform/harness/conversation.ts:313-316`). Since the agent
  name is fixed (`studio`), storing the conversation id alone is sufficient,
  and the schema documents the address it implies.

## 2. Migration 14, and the three conversation decisions

Migration 14 (`conversations_and_projects`) is appended to `MIGRATIONS`,
never edited afterwards. Three tables:

```
project(id, name, icon, description, created_at)
project_folder(id, project_id FK CASCADE, path, name, position, created_at,
               UNIQUE(project_id, path))
conversation(id PK, title NULL, title_manual 0, project_id NULL FK SET NULL,
             pinned 0, archived 0, model_id NULL, created_at, last_turn_at)
```

plus indexes `(archived, last_turn_at DESC)` and a partial
`(project_id, last_turn_at DESC)`. No text column anywhere — every message,
tool call and attachment lives in Flue's journal. `assertNoSecretColumns`
runs inside the transaction as always, and `tests/unit/storage.test.ts`
asserts one `schema_migration` row per migration by name, so a silent
migration would fail rather than hide.

**Decision 1 — the row appears on admission receipt, written by the webview
at the moment the harness says yes.** Task 33 established that a send the
harness refuses creates nothing — no id in use, no sidebar entry, no
navigation. That invariant becomes structural if and only if the row and the
admission are the same event, so `POST /api/conversations` is called from
`beginConversation`, which `StartConversation.tsx` invokes only inside the
success branch of `startConversation`. What the other choice would have cost:

- *A row before admission*: every refused first send leaves a zombie the
  sidebar shows and no stream ever answers to. Recovery from that would need
  a sweep — which this product must never have.
- *A row written inside the harness at admission*: there is no hook there.
  Admission happens inside Flue's generated app; reaching past the runtime
  facade is forbidden by our own architecture test, and the initializer runs
  per-turn, not per-admission.

Writes are idempotent by id (`record()` upserts recency, touches nothing
else): StrictMode remounts, double clicks, and two windows replaying one
receipt all converge on one row. A conversation therefore cannot exist
without a turn having been admitted — which is exactly right; "decided to
start" is not something worth persisting.

**Decision 2 — the harness owns the title.** `deriveTitle` moved verbatim
into `STUDIO HARNESS/src/conversations/title.ts`; the webview copy is
deleted. The rule is byte-identical to what `deriveTitle.ts` applied
(including its little honesty quirk: it strips trailing `. , ; :` but leaves a
`?` — covered with a test, because two spellings of one title is the failure
this decision exists to prevent, and tests encode spellings). The webview
sends `firstMessage`; the response record's title fills the sidebar. Deriving
in both places is how "What measure should the transcript use?" and "What
measure should the transcript use" end up meaning one thing yesterday and two
tomorrow.

**Decision 3 — `model_id` exists now, NULL, written by nobody.** Applied
migrations are never rewritten, the next task sends a model with every
submission, and a conversation that cannot remember which model it talked to
would demand this column the day it could. An empty nullable TEXT column now
versus a migration-on-release-day later is not a close call. The wire type
carries `modelId: null` today so the shape never needs another field.

## 3. The project model

A project is what `DEMO_PROJECTS` and `NewProjectDialog` show it to be: a
name, a mark, a description, **many folders**, many conversations. Schema
above. Branch and branches are deliberately not columns — a checked-out
branch is git's fact to report, and storing which commit we think is current
would be a second source of truth against git's own (the same reasoning that
keeps shadow repositories out of the project folder). `IdentityLine` renders
exactly zero branch controls for such projects today, which is the honest
state until some surface reports them.

**Folders are their own record that binds sandbox roots; they are not
grants, and there is only one authorization system.** `permission_grant`
already carries `capability_key`, `agent_id`, `conversation_id`,
`project_id`, `resource_pattern` (migration 3) and project scoping in the
uniqueness rule (migration 5). A folder-as-grant would have meant "remove
folder" silently rewriting recorded user decisions, and "grant scoped to a
folder" already exists — it is called a resource pattern. So: folders decide
what a project *offers* when a turn constructs its sandbox
(`createSandboxPolicy` takes `readRoots`/`writeRoots` beyond the primary root;
that is containment, not permission), and everything that authorizes a call
still flows through `PermissionKernel` alone — the docblock's sentence
("the moment a second place can authorize execution, 'what is this agent
allowed to do' stops being knowable") stays true by construction. Nothing in
migration 14 or the stores wires that binding yet; the tables are final, the
behaviour arrives later, per the brief.

The six cases, one line each:

1. **Folder gone from disk**: the row stays (it is ordinary product state),
   relocation is `PATCH /api/projects/:id/folders/:folderId {path}` rewriting
   one row; pattern-grants that named the old path are deliberately left
   alone to be asked about again — pointing an existing approval at a new
   directory without asking is how approvals start meaning more than they
   showed.
2. **Same folder, two projects**: each project owns its own `project_folder`
   row; removing one cannot touch the other (store test proves it), and the
   FK cascade removes a project's copies with the project.
3. **Nested `/a` then `/a/b`**: both rows are legal and independent — access
   is the union; removing `/a` removes only `/a`'s row and `/a/b` remains,
   which is the only semantics consistent with folders being independent
   offers rather than a filesystem mandate. Redundancy is not an error.
4. **Folder removed mid-turn**: a running turn's sandbox was constructed from
   the old root list and finishes against it; removal simply means the next
   turn binds narrower roots. Nothing revokes grants behind anyone's back —
   grants were always separable from offers.
5. **Conversation renamed**: `title_manual` flips to 1 permanently; derivation
   ran once at creation and never runs again for that id (store test: a
   repeated admission after a rename updates recency and no words).
6. **Conversations move between projects / project deleted**: moving is
   `PATCH ... {projectId}` with an FK refusing ghosts; deleting a project is
   `ON DELETE SET NULL`, so its conversations detach to "no project", the
   same thing removing a project has meant in the product all along. Not
   orphans by accident — detached by decision.

## 4. Part 2 — what permanent destruction actually destroys

Emptying the archive (selection or all of it; `DELETE /api/conversations/:id`
or `POST /api/conversations/purge`) destroys, in order:

1. **The index row(s)** — committed first, so there is never a half-deleted
   sidebar even when a later step reports trouble.
2. **The conversation's own tree** under
   `~/.studio/data/conversations/<id>/` — the workspace its projectless turns
   stood on, and its attachments and artifacts directories. This data is
   unambiguously ours; removal is best-effort with named failures (a file
   locked by a turn being cleared mid-stream comes back in
   `cleanupFailures` as data, not as a hidden partial success).
3. **Not the Flue transcript — because it cannot be.** Flue "exposes no
   per-session deletion" and its adapter contract "does not promise a public
   retention or deletion workflow" around the whole-instance primitives it
   ships (`data-persistence-api.md:67,91,107`). Reaching into `flue.db`
   ourselves would be one system editing another system's journal behind its
   back, in a schema we do not own. Those bytes remain: inert, unreferenced,
   unreachable (see section 7's reachability line) — the report names that
   instead of pretending otherwise. Deleting a normal conversation archives
   it; only the person in Settings can make anything permanent, and the one
   destructive path is theirs alone. No sweep, no retention window, no
   migrating deletion, anywhere in the diff.

So the code now does what the copy claims *for everything the product can
reach*, and the docblock above `purgeConversations` says precisely what it
does not, because an unstated survivor is the only version of this feature
worse than a slow one.

## 5. Part 3 — a normal conversation has no project

**Verified reading first, and the brief's claim held.**
`defaultVerdict` (`src/permissions/policy.ts:176-192`) returns `allow`,
source `"default"`, for any capability that is read-only and authored by
`studio` — `native/read`, `native/glob`, `native/grep` all declare
`effects: ["read"]` and carry `NATIVE_PROVENANCE`. In a conversation with
zero grants, nothing asks; the sandbox root decides what those allowed reads
can see. Which is why today's bug is a bug at all.

**The fix is arguments an API already took.** `agents/studio.ts` now creates
each conversation's tree at first-run initialization — admission of the first
prompt *is* creation; a refused send reaches nothing —

```
~/.studio/data/conversations/<conversationId>/
    workspace/      <- sandbox root; starts empty
    attachments/
    artifacts/
```

then passes `cwd: workspace` (Flue's `AgentRuntimeConfig.cwd`, optional, used
to inherit `runtime.projectRoot`) and
`sandbox: createAgentSandbox({ ..., projectRoot: workspace })`. Per
conversation, never shared: with reads allowed by default, a shared scratch
root is a cross-conversation leak through a default-allow path — one file the
model wrote readable from every other conversation unprompted. Attachments
and artifacts are siblings, not children of `workspace/`, so the sandbox root
never contains things the model was not granted. The tree lives under
`data/`, which `durableDirectories()` covers — a file the model wrote is the
user's. Folder accessors refuse an id that is not a plain segment
(`conversationSegment`, paths.ts), because ids are caller-chosen and a
traversal must not be a directory change. Project conversations will resolve
their roots from the project store here instead; the shape accepts it and
nothing builds it.

Measured follow-ups:

- **The shadow repository is lazy already.** `SnapshotStore`'s constructor
  only `ensureDirectory`s the parent snapshots root; the per-project
  `gitDir` is created inside `ShadowRepository.ensure()`, reached on the
  first capture/list/restore — i.e. first write, or full-auto mode's
  `required` gate, whichever fires. Empty conversations leave no repository
  behind. Nothing to change.
- **One honest growth**: `StudioRuntime.#turnSnapshots` is keyed by workspace
  root, so each conversation adds an entry in a long-lived harness process.
  #72's comment says growth is "bounded by the workspace roots a process
  serves" — now that bound is conversations-served-this-process. Harmless in
  fact (an entry is counters and closures; `prepareModelTurn` loops it doing
  arithmetic), corrected in understanding, left unevicted as designed.
- **Reads of the empty/missing root answer honestly.** With the tree created
  at admission, `glob`/`grep` meet an existing, empty directory: ripgrep
  exits 1 and `runRipgrep` maps that to `"No files matched."`
  (`tools/search/ripgrep.ts:210`), never a rejection. A direct read of a
  nonexistent file returns a plain classified tool error — legible, not
  broken-looking. The one ugly case (ripgrep pointed straight at a
  *nonexistent* directory exits 2) cannot arise for the conversation root
  unless someone deletes the tree mid-session; accepted and stated rather
  than patched speculatively.

Nothing stopped, nothing half-built: the design never acquired a "workspace
the model is told about" or a project by another name — the empty directory
is load-bearing because default-allow reads see it and only it.

## 6. Part 4 — the frontend reads the store

`WorkspaceProvider` seeds itself from the harness: `load()` resolves the
address, reads `GET /api/conversations` + `/api/projects`, and maps records
onto the domain types. Four load phases — `loading`, `ready`, `no-harness`,
`failed(error)` — mirroring `useConversation`'s phase machine, and
`ensureStore()` (Task 34's remedy, wired to `restart_harness`) exposed for
any surface that can see the absence. On `harness-starting/-started` events
it drops its cached client and re-reads; what is on screen while the harness
is down stays.

Mutations go through the store client (`client.ts` grew the conversation and
project methods, parsed by hand-mirrored contracts —
`parseConversationRecord(s)`, `parseProjectRecord(s)`, `parsePurgeOutcome` —
in the house style: parsers return null, fresh objects out of named fields).
Writes apply locally then fire; a refusal triggers a reload of truth rather
than a local revert. `ChatPage` stamps recency through `touch(conversation.id)`
on every successful submit receipt. `GALLERY_CONVERSATION_ID` stays local —
it is not a row, not indexed, not sent to the harness, exactly as the brief
preferred. The demo turn path survives scoped to the gallery in
`demo-turns.ts` (it refuses demo turns for real ids now), `useDemoTurn` keeps
its callers, `DEMO_CONVERSATIONS`/`DEMO_PROJECTS` lost their last seeding
call, and `deriveTitle.ts` is deleted. Composer's dead `projectId` prop went
with its dead caller-line; more of the demo path is now unreachable than
before — enumerated here rather than deleted piecemeal.

## 7. Part 5 — the wipe, and one reachability line

**An orphaned stream (transcript in `flue.db`, no index row) is not reachable
through any supported surface** — the client only ever asks for ids it holds,
and nothing enumerates. The wipe is therefore *required* to make the bytes
actually gone, not merely tidy; leaving them costs disk space and nothing
else.

With the app fully closed (no Studio window, no studio.exe):

```powershell
# Destroys the transcript journal and the application database - everything
# Project Studio knows or ever knew about the conversations it has tested.
Remove-Item "$env:USERPROFILE\.studio\data\flue.db","$env:USERPROFILE\.studio\data\flue.db-*" -Force
Remove-Item "$env:USERPROFILE\.studio\data\studio.db","$env:USERPROFILE\.studio\data\studio.db-*" -Force

# Destroys the per-conversation trees (workspaces, attachments, artifacts).
Remove-Item "$env:USERPROFILE\.studio\data\conversations" -Recurse -Force
```

Optional, only if wanted, and named for what they are:

```powershell
# Undo history the shadow repositories recorded for your projects. Real
# recovery points - removing them makes agent actions in watched projects
# unrestorable. Not part of the conversation wipe.
Remove-Item "$env:USERPROFILE\.studio\data\snapshots" -Recurse -Force

# Diagnostics and derived caches; safe to lose.
Remove-Item "$env:USERPROFILE\.studio\logs","$env:USERPROFILE\.studio\cache" -Recurse -Force
```

**Disclosed leftovers from my own runs**: before I added `PROJECT_STUDIO_HOME`
to the four integration launchers (section 9), my test sweeps let agent
initializers create ~32 empty trees named after test scenarios (`cancel`,
`openrouter`, `mcp`, ...) under your real
`~/.studio/data/conversations/`. They are empty, I am forbidden from touching
anything under `~/.studio`, and the `conversations` command above clears them
with everything else.

**Which tables are actually dead: none.** The brief guessed migrations 11-12's
provider tables survived as dead originals beside `_v13` replacements; it is
backwards. Migration 13 rebuilt them under temporary `_v13` names and then
renamed them back onto the original names (`migrations.ts:430-435`), so
`provider_model_override`, `provider_model_manual` and `provider_default`
are the live FK-bearing tables — ModelCatalog reads and writes all three
(`providers/model-catalog.ts:461-693`). Nothing is collapsible for free; the
one genuine overlap is `provider_connection` (migration 2, still read and
written by `models/local/settings-store.ts:133-172`) versus
`provider_connection_record` (migration 11), whose merge the migration-11
comment already promises someday. That is its own change, rightly not folded
into this one.

## 8. Verification — what ran, what remains for you

Automated (all green or baseline-explained):

- `STUDIO && pnpm test && pnpm typecheck` — **27 files / 307 tests pass**
  (baseline 26/293; +14 parser/mutation contracts tests), typecheck clean.
- `STUDIO/src-tauri && cargo test` — **64 passed / 1 failed**, the failure
  being the documented `a_deliberate_stop_reports_stopped_and_leaves_no_hot_wal`,
  which fails while the desktop app is running and holds `studio.db`. Rust
  untouched by this task. `cargo clippy --all-targets` — **0 warnings**.
- `STUDIO HARNESS && pnpm test && pnpm typecheck` — three full runs
  (`pnpm build && vitest`, per the anti-drift warning in the brief):
  **1306 passed / 30 failed / 25 skipped across 90 files, identically all
  three times**. Every one of the 30 is the known environmental
  `SandboxError: The sandbox needs one-time setup ... pnpm sandbox:prepare`
  corridor failure, in the sandbox-shaped files (`sandbox-appcontainer`,
  `shell`, `mcp-launcher`, `mcp-runtime`, `mcp-flue`) — the class the brief
  says not to chase, whose count it documents drifting 23→31. Typecheck
  clean. My storage/store/route/architecture tests all pass inside the same
  runs. After the last run I recounted
  `~/.studio/data/conversations`: unchanged from before it — once the
  launchers below carry `PROJECT_STUDIO_HOME`, the suite writes nothing into
  your real home.
- New unit coverage: migration 14's foreign keys (folder cascade, SET NULL on
  project delete, duplicate-path refusal), the stores' idempotent-record /
  manual-title-stop-once / archive-lists-separately / purge semantics,
  conversation-id traversal refusal, purge over locked-tree-free paths, the
  webview parsers' transcript-smuggling refusal, and the index routes sitting
  behind admission.

End-to-end, driven against the real built server with the test model source
(no money, two full restart cycles), eleven assertions:

```
PASS index row created          PASS index survives restart
PASS first turn admitted        PASS transcript survives restart
PASS history readable           PASS recency stamp accepted
PASS conversation tree created  PASS archive flag stored
PASS restore flag stored        PASS purge removes the row and the tree
PASS purged row no longer listed
```

That is claims 1-3's mechanics (persistence, restore semantics, permanent
removal) proven at the transport level against a real restart cycle.

**Still yours to click through** — needs the desktop app and a real provider;
performed nowhere and invented nowhere:

1. Restart-in-the-middle-of-a-turn visible in the sidebar/transcript
   projection; duplicate-free transcript after restart (Flue's idempotent
   append covers it mechanically; the UI half is unobserved by me).
2. Claim 4's exact words — ask a fresh conversation "what files can you see?"
   Against `STUDIO/src-tauri`'s old inheritance the model could list the
   checkout; with this build it sees only its empty `workspace/` (structurally
   guaranteed: the root is empty at creation and every default-allow read is
   contained by it), but I will not paraphrase an answer the model has not
   given me.
3. Claim 5's write-note walkthrough, including cross-conversation read
   isolation — same guarantee class (per-conversation roots), unverified
   interactively.
4. One short live OpenRouter turn to confirm the persistence path did not
   break the live one. No loops, no benchmarks.

If a newer-build database refuses (`user_version > LATEST`), `migrate()`
throws before composition completes, boot dies loudly with the boot log
naming it, and the supervisor surfaces `harness-failed` to the phase machine
— the app says so rather than dying silently; the message path inherits from
Task 34's notice.

## 9. Every place this brief was wrong

1. **The dead tables are not dead.** Section 7's finding reverses the
   premise: migration 13 renamed its rebuilds back onto the original names;
   collapsing the "_v13 originals" would delete three living tables. Had I
   taken the task's word and shipped a collapse inside this task, the failure
   you predicted for mixing concerns would have been self-inflicted.
2. **Enumeration is not merely unlikely - it is absent everywhere.** The
   brief asked "whether Flue can list what it holds"; no interface, no
   primitive, no admin surface. That upgrades the index from fast-path to
   sole-path and shaped `record()`'s write-once-idempotent semantics.
3. **Part 2 offered a false pair.** "Destroy the transcript, or lie." The
   truthful third option exists: destroy everything Studio owns, keep the
   user's copy explicit, and state (docblock + here) that Flue ships no
   per-session deletion workflow, quoting its own adapter contract. The purge
   keeps its narrow word instead of pretending a broader one.
4. **My own change polluted the test homes I inherited.** Creating
   conversation trees from the agent initializer meant four integration
   launchers that redirect DB paths but never redirected the Studio home
   started writing trees under your real `~/.studio/data`. Fixed by giving
   them `PROJECT_STUDIO_HOME`; the disclosure is in section 7.
5. **The brief's "if it is eager, make it lazy" guard measured unnecessary.**
   Shadow repositories were already lazy (first write), `required()` already
   conditional. The real subtlety hiding nearby was different: #72's
   "bounded by workspace roots" stopped being literally true once roots became
   per-conversation - cheap, but the old comment's justification no longer
   describes today's map.
6. **The default-allow bug needed two overrides, not one.** Beyond
   `createAgentSandbox({ projectRoot }`, Flue's own `AgentRuntimeConfig.cwd`
   silently equalled `runtime.projectRoot` too; fixing only the sandbox root
   would have left relative-path resolution anchored in someone else's build
   directory. Both are now passed.
7. **deriveTitle's spelling includes a wart I chose to keep** (strips `. , ;`
   but not `?`), rather than "improving" it during a move. Titles that exist
   keep their spelling; the move lands byte-compatible and tested.
