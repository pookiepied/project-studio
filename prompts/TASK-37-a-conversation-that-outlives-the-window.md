# TASK 37 — A conversation that outlives the window

You are working in `D:\Creative Library\Workspace\Project Studio`.

Read first, in this order:

1. `STUDIO HARNESS/src/storage/migrations.ts` — the whole file, and especially
   its header and `migrate()`. Migrations are append-only and never edited
   once released. The next version is 14.
2. `STUDIO HARNESS/src/providers/connection-store.ts` and
   `src/transport/http/routes/providers.ts` — the shape a store and its routes
   already take here. You are writing a sibling, not inventing a pattern.
3. `STUDIO HARNESS/src/application/studio-runtime.ts`, `createAgentSandbox`
   and the constructor, plus `src/agents/studio.ts` — all of it, it is thirty
   lines.
4. `STUDIO HARNESS/src/platform/paths.ts` — the accessors and
   `durableDirectories()`.
5. `STUDIO/src/stores/workspace/WorkspaceProvider.tsx` and
   `src/features/settings/panes/ArchivePane.tsx` — what the frontend already
   believes a conversation is.
6. `documentation/decisions/` ADR 0045 — conversation ids are caller-chosen.

## The state this task ends

Conversations and projects live in `useState` in `WorkspaceProvider`, seeded
from `DEMO_CONVERSATIONS` and `DEMO_PROJECTS`. A reload loses the sidebar.
Meanwhile the harness gives every conversation `STUDIO/src-tauri` as its
working directory and its sandbox workspace root, because
`studio-runtime.ts` resolves `options.projectRoot ?? process.cwd()` and the
Rust supervisor never sets `current_dir`.

Both halves are here because they are the same question — what is a
conversation, and what does it own — and answering one without the other
produces a persisted conversation that still inherits somebody's build
directory.

## Part 0 — establish the boundary before writing any schema

This is the decision the rest of the task hangs off, and it has a starting
position you must verify rather than accept.

**The finding to check.** Flue's own database already holds
`flue_conversation_streams`, `flue_conversation_stream_batches`,
`flue_attachments`, `flue_attachment_chunks`, `flue_runs` and
`flue_agent_submissions`. `studio.db` has thirteen migrations and not one
conversation, message, project or attachment table. So the claim is:

> Flue owns the transcript. Studio owns the index. Studio must not build a
> second message store.

Read enough of `@flue/runtime`'s conversation stream store and the harness's
own use of it to say whether that is true, and say so with evidence. If it is
true, the schema below is an index and stays small. If it is false — if Flue
cannot be relied on to keep a transcript we can re-read months later, or if
there is no way to address a stream from an id we hold — then the schema is a
different and much larger thing, and **that finding outranks the rest of this
brief**. Stop and report it rather than building the small version anyway.

Two facts to settle while you are in there, because the schema depends on
them:

- **Can a conversation stream be enumerated, or only addressed?** Our client
  reads `?view=history` and `?view=updates` for an id we already have.
  Whether Flue can list what it holds decides whether the index is the only
  way to find a conversation or merely the fast way.
- **What is the durable key?** The index row has to reference the stream by
  something Flue will still honour after a restart.

## Part 1 — the schema

Migration 14, appended, never edited afterwards. `assertNoSecretColumns` runs
inside the transaction and `tests/unit/storage.test.ts` asserts one
`schema_migration` row per migration in order, so a migration that forgets to
record itself fails.

What the index has to carry, at minimum: identity, a title, when it was
created and last had a turn, archive state, and the project it belongs to.

### Projects are modelled properly, not stubbed

The schema for projects is designed for what a project really is, now. Not a
placeholder to be widened later. The behaviour can come later; the tables
cannot, because applied migrations are never rewritten.

What a project is, from the user:

- **A project has many folders, not one root.** You can add a folder, remove
  a folder, and edit one. Removing a folder takes its access away.
- **A project has many conversations.**
- **Conversations can be renamed and deleted**, in a project or out of one.
- **Folders move and disappear.** A recorded folder that is no longer on disk
  is an ordinary state the product has to show and offer to relocate, not an
  error and not a silently dropped row.

`DEMO_PROJECTS` and `NewProjectDialog` describe what the product already
believes a project is. Read both before choosing columns.

**The question that decides this schema, and it must be answered
explicitly:** a project's folders and the permission system are both about
what may be reached, and there must not be two answers to that. `permission_grant`
already carries `capability_key`, `agent_id`, `conversation_id`, `project_id`,
a resource pattern (migration 3) and project scoping (migration 5).
`workspace_trust` is keyed by `root`. So: is a project folder **expressed as
a grant**, or is it its own record that the kernel consults? Both are
defensible. What is not defensible is a second table that independently
decides access, because the moment two places can authorize a read, "what is
this agent allowed to reach" stops being knowable — which is the sentence
`PermissionKernel`'s own docblock opens with.

Cases the schema has to survive, each of which should have an answer you can
state in one line:

- A folder recorded by a project no longer exists on disk. The project still
  opens. The folder is visibly missing. The user can point it at a new path,
  and the grants that referred to it are still meaningful afterwards — or
  deliberately are not, if you decide relocation should re-ask.
- The same folder belongs to two projects. Removing it from one must not
  remove it from the other.
- A project holds `/a` and later adds `/a/b`, or the reverse. Say what that
  means and what removing the parent does to the child.
- A folder is removed from a project while a conversation in it is mid-turn,
  whose sandbox was already built from the old list.
- A conversation is renamed. Whatever derives titles automatically must stop
  doing so for that conversation, permanently.
- A conversation moves between projects, or a project with conversations in
  it is deleted. Say what happens to them — they are not orphans by accident.

Sandbox note, so this is not read as harder than it is:
`createSandboxPolicy` already takes `readRoots` and `writeRoots` beyond the
primary `workspaceRoot`, so a many-folder project fits the existing policy
shape. That is a fact to build on, not a feature to add.

**Still not this task:** project behaviour. No project sandbox wiring, no
project context, no folder-picker UI, no relocation UI. Tables, and the store
that owns them, and nothing that acts on them.

Three decisions to make and defend in the report:

1. **When does the index row appear?** Task 33 established that a first send
   the harness refuses creates nothing at all — no id in use, no row in the
   sidebar, no navigation. A row written before admission would break that.
   A row written only on admission means a conversation cannot exist without
   a turn, which may be exactly right. Decide, and say what the other choice
   would have cost.
2. **Where does the title come from?** `stores/workspace/deriveTitle.ts`
   derives it in the webview today. Deriving it in two places is how two
   spellings of one thing start. Pick an owner.
3. **What does the row remember about the model?** Nothing in this task sends
   a model with a submission — that is the next task — but a conversation
   that cannot record which model it was talking to will need a migration the
   moment it can. Decide whether that column exists now, empty, or later.

## Part 2 — archive is the failsafe, and delete goes through it

This is settled product behaviour, not an open question:

- **Archiving keeps a conversation indefinitely.** Nothing expires, nothing
  sweeps. `ArchivePane.tsx` already says so in its own copy and its docblock,
  and that copy is a promise the storage now has to keep.
- **Deleting a conversation archives it.** The archive is the recovery
  window, and it is the reason an accidental delete is not a loss.
- **Emptying the archive is the only permanent destruction**, it is explicit,
  and it happens from the Archive pane in Settings, over a selection or all
  at once.

`ArchivePane` already implements the interaction against the demo store —
`conversations.filter(c => c.archived)`, `setArchived`, `removeMany`,
selection for bulk clear. It needs a real store behind it, not a redesign.
Read it before you write the store so the store's vocabulary matches the pane
that has to call it.

**The question you must answer explicitly: what does permanent deletion
actually destroy?** The index row, certainly. The Flue conversation stream
and its attachments? The conversation's scratch root from Part 3? A delete
that leaves the transcript on disk is a delete that lied; a delete that
removes data Flue believes it owns may be reaching into another system's
storage. Decide, defend it, and make the code do exactly what the copy in
front of the user claims.

**Do not write an automatic cleanup, a sweep, a retention window, or a
migration that deletes anything.** The one destructive path is a person
choosing to empty their archive.

## Part 3 — a normal conversation has no project

Settled: a normal conversation has no project directory, no attached
workspace, no files, no assumed project context. Tools are not prohibited;
there is simply no default project for them to operate on.

**Every conversation gets a real folder of its own.** This is a feature, not
a workaround for a parameter that will not take null. The layout:

```
~/.studio/data/conversations/<conversationId>/
    workspace/      <- the sandbox root. Empty. The model may work here.
    attachments/
    artifacts/
```

`workspace/` is the sandbox root for a normal conversation, and it is granted
by default, because it belongs to that conversation and nothing else is in
it. Empty at the start. If the model writes a file there, that file stays
with the conversation — a note, a scratch `.md`, whatever the work needed.
Nothing outside that folder is reachable, so "no project" is true in the only
sense that matters: there is no source tree, no repository, nothing of the
user's.

`attachments/` and `artifacts/` are siblings, not children of `workspace/`.
An artifact the app produced and a file the model wrote are different things
with different lifetimes, and nesting one inside the other would make the
sandbox root contain them.

**A project conversation does not get a `workspace/`.** For a project, the
project's own source folder is the root, and that is the whole point of a
project. Only conversations with no project need somewhere to stand. Build
the normal case now; leave a shape the project case can slot into without a
rewrite, and do not build the project case.

Exact directory names are yours to choose if these read badly next to the
existing `paths.ts` accessors, but say what you changed and why.

The seam is already there and this is the part to notice before you start:
`createAgentSandbox(options)` already accepts `projectRoot` and `projectId`
per call and falls back to `this.#projectRoot` only because
`agents/studio.ts` passes neither. `AgentRuntimeConfig.cwd` is optional in
Flue. `defineAgent` receives `{ id }`, and that id is the conversation. So
this is passing arguments an API already takes, not restructuring one.

**Why this root is load-bearing and not a placeholder.** It would be easy to
read the empty directory as a value invented to satisfy a non-optional
parameter. It is not, and the reason is `defaultVerdict` in
`src/permissions/policy.ts:177`: a capability that is read-only and authored
by `studio` is **allowed by default, with no grant and no prompt**. `read`
declares `effects: ["read"]` and `NATIVE_PROVENANCE` declares
`author: "studio"`, so in a conversation with zero grants the model can read
files and nobody is asked. The workspace root is therefore the only thing
deciding what it can see — which is exactly why today's bug is that it can
read this repository. Verify that reading before you build on it.

One consequence follows and it is decided, not open: **a folder per
conversation, never one shared folder.** With reads allowed by default, a
shared root means a file written in one conversation is readable from every
other one with no prompt at all. That is a cross-conversation leak through a
default-allow path.

Create the folder when the conversation is created, not at startup for every
conversation that exists. `paths.ts`'s own docblock has the house rule:
"Callers create what they need when they need it."

The conversation tree lives under `~/.studio/data/`, which
`durableDirectories()` already covers, so it is backed up. That is correct:
a file the model wrote in `workspace/` is the user's, and losing it because
we filed it under `tmp` would be a bug.

What is left for you to settle, with the measurement to settle it:

- **The shadow repository.** `TurnSnapshots` keys by `projectId` and
  `SnapshotStore` derives its git directory from the workspace root, so a
  per-conversation root implies a git repository per conversation. Find out
  whether that is created eagerly or on first write — `TurnSnapshots` already
  takes `required: () => mode === "full-auto"`, which suggests it may already
  be conditional. If it is eager, make it lazy or say why you could not.
- **What a read of a directory that does not exist yet does.** `glob`,
  `grep` and `workspace_summary` will be pointed at a path with nothing
  behind it. Confirm they answer emptily and honestly rather than erroring in
  a way that reads to the model as a broken tool.

**Where this could go wrong, and the instruction if it does.** If working
through this produces a design where a normal conversation quietly acquires a
project by another name, or where the scratch root turns into a workspace the
model is told about, stop. The user's words: do not build something half
implemented. Report the shape you found and what it would take to do properly
rather than landing a partial one. A brief that has to be refused is a better
outcome than a conversation that pretends to have no project while having one.

Permissions and sandbox modes attached to a conversation — the flow where
somebody grants a folder, or turns a sandbox on for a piece of real work —
are the intended direction and are **not** this task. Nothing here may
foreclose them; nothing here may start them.

## Part 4 — the frontend reads the store

`WorkspaceProvider` stops being seeded from `DEMO_CONVERSATIONS` and
`DEMO_PROJECTS` and reads the harness instead. The sidebar, the archive pane
and the project pages follow from that.

Constraints:

- **The gallery stays.** `GALLERY_CONVERSATION_ID` is a display of artifacts,
  not a conversation, and `ChatPage` withholds `onSend`/`busy`/`onStop` for
  it deliberately. It is not a row in this store, and if that turns out to be
  awkward, say so rather than making it one.
- **A harness that is not running is a state, not a crash.** The store has to
  say "not loaded yet" and "could not be loaded" differently, the way
  `useConversation`'s phase machine does, and the app has to be usable enough
  to start the harness from the notice that Task 34 built.
- **Task 33's first-turn path must keep working exactly as it does.** A
  refused first send still creates nothing. Read `first-turn.ts` before you
  touch the creation path; it is the one flow where a conversation is minted,
  admitted and navigated to in that order.
- `useDemoTurn` has no callers left and `Composer`'s `onSent` prop is dead
  (TASK-33 section 7). If this task makes more of the demo path unreachable,
  report what — do not delete it piecemeal.

## Part 5 — the existing data is test data and goes

`~/.studio/data/` currently holds about 17MB of conversations from this
month's testing. The user has been asked and has answered plainly: throw it
all away. Nothing is migrated, nothing is backfilled, nothing is merged. The
software has no users yet and a clean start now costs nothing.

**Do not write code that deletes it.** No backfill, no orphan sweep, no
migration that touches Flue's tables, no "clean up on first run". The
application must never clear the user's data directory on their behalf,
because the day that logic is wrong is the day it is wrong about real data.

Instead: the report ends with the exact commands the user runs by hand, with
the app closed, and says precisely what each one destroys. Write it so it can
be pasted. That is the whole deliverable for this part.

One line in the report on whether an orphaned stream is reachable at all
after this lands, because that decides whether the wipe is required or merely
tidy.

**Not in this task, but noticed and named:** migrations 11 and 12 created
`provider_model_override`, `provider_model_manual` and `provider_default`,
which migration 13 replaced with `_v13` versions. The originals look dead.
Collapsing the schema is genuinely available while there are no users, and it
is genuinely a different change from adding conversations — it would put a
rewrite of the working provider tables inside the task that introduces the
conversation tables, and double what a failure could mean. Report which
tables are actually dead and leave them.

## Part 6 — verify it as a person

The claim this whole task exists for, in one sentence: **a conversation you
had yesterday is still there today.**

1. Start a conversation, send one turn on the test source, close the app
   completely, reopen it. The conversation is in the sidebar, opening it
   shows the turn, and sending a second turn continues the same conversation.
2. Archive it. It leaves the sidebar and appears in Settings > Archived
   chats. Restore it; it comes back.
3. Archive it again and empty the archive. It is gone, and it is still gone
   after a restart.
4. In a fresh conversation, ask the model what files it can see. It must not
   be able to see this repository. Say exactly what it answered.
5. Ask it to write a short note to a file, approve the write, and confirm the
   file lands in that conversation's `workspace/` and nowhere else. Restart
   the app and confirm it is still there. Then open a different conversation
   and confirm the model cannot read it.

Then **one** short turn on the real OpenRouter connection to confirm nothing
in the persistence path broke the live one. One turn. It spends the user's
money: no loops, no benchmarks, and the key never appears in a log, an error,
a fixture, a screenshot, a test or the report.

## Explicitly not this task

- **Wiring the model picker**, and carrying model or reasoning with a
  submission. Next task, and it depends on this one.
- **The provider library flow**, custom models, protocols, capability
  configuration.
- **Images and attachments in the composer.**
- **Project behaviour**: project working directories, project context,
  project sandbox wiring, the folder-picker and the relocate-a-missing-folder
  UI. The project schema is designed in full per Part 1; nothing acts on it
  yet beyond create, rename, delete and the folder list.
- **Permissions UI, sandbox modes, interaction modes.** Named as the
  direction in Part 3; started in none of it.
- **The sandbox corridor on this machine**, which needs an elevated
  `sandbox:prepare` nobody in a session can run. See Verification.
- The supervisor's startup honesty (TASK-34 section 3), the stale bundled
  model registry (TASK-35 section 4), Flue's coalescing window.

## Constraints

- No `any`, no non-const `as`, no non-null `!`. Hard.
- Applied migrations are never rewritten. Append only.
- Secrets live in the OS credential store; `assertNoSecretColumns` guards
  column names and the valibot parse on the write path is load-bearing.
- The admission credential never appears in webview code, a log, an error or
  a fixture. API keys never appear in a response body or a connection record.
- Contracts parse, they do not assert. A new HTTP surface gets a parser on
  the webview side like `parseProviderConnections`, not a type argument.
- UTF-8, no BOM, LF. ASCII in source, with the one exception `rules.md` §10
  names: the em dash in comment prose, which §7 requires. No en dashes, no
  smart quotes, no curly apostrophes, no ellipsis characters, no emoji.
- Modular. If a file passes ~400 lines it is probably two files.
- Never leave a green placeholder test.
- `cargo clippy --all-targets` at zero warnings if you touch Rust.

**Do not edit files with a script.** `rules.md` §10 forbids it. Edit by hand,
including the report's own headings.

**Test the adversarial input.** A conversation deleted in one window while
another window has it open. An archive emptied while a turn is streaming in
one of the conversations being destroyed. A restart in the middle of a turn,
where the conversation must come back and its transcript must not duplicate.
Two windows creating conversations at the same moment. A first send refused
after the id was minted. A database written by a newer build, which `migrate`
already refuses — make sure the app says so rather than dying silently.

## Forbidden

Do not run `git checkout`, `git switch`, `git stash`, `git reset`,
`git clean`, `git commit`, or `git rebase`. Reading git state is fine.
`Backend/`, `docs/`, `prompts/`, and `report/` are the user's — read for
context, never modify, never `git add`.

Do not delete or move anything under `~/.studio/`. Part 5 says why, and it is
the one rule in this task with no exception.

## Verification — run each suite alone

```
cd "STUDIO" && pnpm test && pnpm typecheck
cd "STUDIO/src-tauri" && cargo test && cargo clippy --all-targets
cd "STUDIO HARNESS" && pnpm test && pnpm typecheck
```

Running the two vitest suites concurrently makes Vite's SSR temp directory
vanish under one of them and produces ~80 bogus `ENOENT` failures.

Baselines, measured independently on 2026-08-27 at `0f3e885`:

- `STUDIO`: 26 files / 293 tests, typecheck clean.
- `STUDIO/src-tauri`: 65 tests, clippy 0 warnings — **but**
  `a_deliberate_stop_reports_stopped_and_leaves_no_hot_wal` fails while the
  desktop app is running, because the app holds `~/.studio/data/studio.db`.
  Close the app before you judge that number.
- `STUDIO HARNESS`: 1287 passed / 29 failed / 25 skipped across 4 files, and
  typecheck clean. **Every one of the 29 is the same environmental failure** —
  `SandboxError: The sandbox needs one-time setup ... run: pnpm
  sandbox:prepare "C:\Users\pooki"` — in the sandbox-shaped files. The
  corridor's ACL grants on the home root were revoked and restoring them
  needs an elevated terminal no session here can run. The count has drifted
  23, 29, 30, 31 across runs, so do not read a difference as a regression of
  yours. **Do not chase it.** Say what your runs reported and move on.

This task touches the database, so also: delete nothing to make a test pass.
If a test needs a fresh database it gets a temporary one, the way the
existing storage tests do.

Run the full HARNESS suite more than once; Task 31's startup wedge is
episodic on a tens-of-minutes timescale and its boot log names it clearly.

## Report

Write `report/TASK-37-a-conversation-that-outlives-the-window.md`.

Lead with **Part 0**: the boundary, with the evidence that settled it, and
whether the starting position survived. Then the schema: the three
conversation decisions, and then the project model — where folders live,
whether they are grants or their own record, and your one-line answer to each
of the six cases the schema has to survive. Then
Part 2's answer to what permanent deletion destroys. Then **Part 3**, which
is the part most likely to have gone somewhere the brief did not expect:
whether `defaultVerdict` really allows an ungranted read, where you put the
root, the shadow-repo cost you measured, and — if it came to it — why you
stopped instead of landing a half implementation. Then Part 4
briefly. Then Part 6 in plain words, against the four numbered claims,
including what the model answered when asked what files it could see.

Finish with every place this brief was wrong. It has been the most useful
section of the last eleven reports. This one asserts that Flue owns the
transcript and Studio owns only an index. If that is wrong, everything above
is the wrong size, and saying so early is worth more than finishing.
