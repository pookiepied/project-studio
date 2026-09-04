# Task 53 - Delete that means deleted

Studio has an archive and it works. What it does not have is deletion.

Emptying the archive removes the index row and the conversation's folder, and
leaves the entire transcript in `flue.db` - every prompt, every reply, every
tool call and its output. The person who chose "Clear archive" believes their
conversations are gone. They are on disk, in full, and nothing in the product
can reach them any more.

This task makes deletion true, and makes the words match it.

---

## Part 0 - What is actually true, measured

Read on 2026-09-04 against the live `~/.studio` on this machine, with a
read-only connection. Do not take these on trust - re-measure before changing
anything, because the numbers move as the app is used.

**`studio.db` - the index. `conversation` held 0 rows.** The archive is
empty. The user has already deleted everything they could.

**`flue.db` - the journal. 24 conversation streams, 479 batches, 32
submissions, 1 fold checkpoint.** All of them orphaned: no index row addresses
any of them. This is what "delete" left behind.

The eight tables in `flue.db` and how each is keyed:

| Table | Key | Holds |
|---|---|---|
| `flue_conversation_streams` | `path` | one row per agent stream |
| `flue_conversation_stream_batches` | `(path, seq)` | **the transcript** |
| `flue_conversation_stream_batch_chunks` | `(path, seq, chunk_index)` | oversized batch bodies |
| `flue_conversation_fold_checkpoints` | `path` | summarization state |
| `flue_conversation_fold_checkpoint_chunks` | `(path, chunk_index)` | its overflow |
| `flue_attachments` | `(stream_path, attachment_id)` | also carries `conversation_id` |
| `flue_attachment_chunks` | `(stream_path, attachment_id, ...)` | `ON DELETE CASCADE` from the above |
| `flue_agent_submissions` | `submission_id`, plus `session_key` | the queued input |
| `flue_submission_chunks` | `(submission_id, item_id, ...)` | its overflow |

**Two shapes matter more than the rest, and both were measured, not assumed:**

A stream path is `agents/<agentName>/<conversationId>`, and **one conversation
has more than one stream**. Every conversation here has `agents/studio/<id>`,
and most also have `agents/title/<id>` from the titling agent. Deleting only
the `studio` stream leaves the title agent's copy. Match on the id, across
every agent name - never on a single constructed path.

A submission's `session_key` is a JSON string:
`agent-session:["studio","cnv_4swkkfjx","default","default"]`. The
conversation id is the second element. It is not a column, and there is no
index on it.

**`studio.db` has two more tables that outlive a purge**, neither of which
`purge.ts` mentions:

- `permission_grant.conversation_id` - the conversation-scoped consents. A
  deleted conversation's grants stay live and keep matching on
  `IFNULL(conversation_id, '')`.
- `extension_scope` where `scope_kind = 'conversation'` and `scope_id` is the
  id - which extensions that conversation had on.

**`data/snapshots/` is project-keyed, not conversation-keyed** - 39 entries,
all `project-<hash>`. It is out of scope here. Say so if you find otherwise.

**Four orphaned trees exist on disk right now**: `data/conversations/agent`,
`alpha`, `beta`, and `cnv_1j04nco6`. Their index rows are gone, so
`purgeConversations` can never target them - it only removes trees for ids
`removeMany` actually deleted a row for. They are unreachable by design of the
current code.

**There is already one sanctioned direct reader of `flue.db`**:
`src/storage/flue-journal.ts`, opened with SQLite's read-only flag, written
against the tables above rather than against a migration guide. It is the
precedent for this work and the file whose docblock explains why the
precedent was set carefully. Read it before you write anything.

**`purge.ts` is honest about the gap.** Its docblock states the transcript is
deliberately untouched because Flue exposes no supported deletion surface. I
re-checked `@flue/runtime` and `@flue/sdk` on 2026-09-04: still none. So this
task is a decision to reach into `flue.db` anyway, deliberately and narrowly,
and that decision has to be implemented like it was made on purpose.

---

## Part 1 - What the two words mean

Settle this first; everything else follows from it.

**Archive is recoverable and destroys nothing.** It already behaves this way.
Nothing in this task changes it.

**Delete is permanent and destroys everything belonging to that
conversation.** The index row, the folder tree, the transcript, the
submissions, the attachments, the scoped grants, the scoped extension
choices. After it, no query anywhere in the product or in either database
returns anything keyed to that id.

**Therefore Delete stops meaning archive.** Today `remove()` in the frontend
store is one line - `setArchived(id, true)` - so a sidebar row's "Delete" and
its "Archive" run the same code, two rows apart in the same menu. That was a
reasonable interim when there was no real deletion to offer. It is not
reasonable once there is.

---

## Part 2 - The journal writer

A new module beside the reader: `src/storage/flue-journal-delete.ts`, or a
write half of the existing one. It is the only place in the codebase that may
write to `flue.db`, and its docblock must say so and say why.

**What it deletes, given a conversation id:** every row in all eight tables
above that belongs to that conversation. Streams and everything pathed under
them, matched by id across all agent names. Attachments by `conversation_id`
and by `stream_path`. Submissions whose `session_key` carries the id, and
their chunks. One transaction, all of it, or none of it.

**Three hazards, each of which must be handled rather than hoped past:**

*The harness holds this file open.* Flue owns `flue.db` for the life of the
process. A second write connection to a WAL database from inside the same
process is not automatically safe. Decide deliberately how the write is
serialized against Flue's own, write down what you decided, and prove it with
a test that deletes while the runtime is live - not only against a fixture.

*A conversation may be running.* Deleting the transcript of a turn in flight
is the worst case in this task. Refuse it: a conversation with an active run
cannot be deleted, and the refusal is a real error with a code, not a silent
no-op. `running` already exists in the frontend store; find the harness-side
truth rather than trusting the client's.

*Path matching must be exact.* `cnv_abc` must never match `cnv_abcd`. A
`LIKE` with an unescaped pattern is how this becomes a data-loss bug. Prefer
reading the candidate paths and comparing parsed segments over pattern
matching in SQL; if you do use SQL matching, prove the near-miss case in a
test.

There is no undo. The tests for this module are the ones to write first and
the ones to break on purpose.

---

## Part 3 - Purge becomes complete

`purgeConversations` in `src/conversations/purge.ts` gains the journal and the
two scoped tables. Its docblock currently argues for leaving the transcript;
rewrite that argument rather than deleting it, so the file records that the
position changed and why.

`PurgeOutcome` must stop being able to claim success it did not achieve. It
reports, per id, what was destroyed and what was not - the index row, the
tree, the journal, the scoped rows - so a partial failure is legible instead
of being flattened into "removed".

Order matters: the index row is what makes a conversation addressable, so
destroy the content first and the row last. A crash between steps must leave a
conversation that can be deleted again, never one that is unreachable. That is
exactly the bug that produced the four orphans on disk today.

**Also give the harness a way to sweep those orphans.** A tree under
`data/conversations/` whose id has no index row and no journal stream is
garbage from a previous partial delete. It must be reachable by something -
whether that is a startup sweep or a control in the Archived pane is your
call, but "unreachable forever" is not an acceptable end state, and the four
trees named in Part 0 are the acceptance test.

---

## Part 4 - The interface

Prescriptive, because the traps here are ones already hit on this surface.

**In the sidebar row menu**, Delete performs a real delete. It asks first -
this is the one confirm in this task, and it must name what is being
destroyed and say that it cannot be undone. Archive stays exactly as it is.
Two items, two meanings, no overlap.

**In Settings - Archived**, "Clear archive" and the per-selection delete
already call `removeMany`, so they inherit real deletion. Their copy must
stop implying anything softer.

**The copy states the consequence.** A menu note earns its second line when
it names something the reader cannot see and would be wrong about - the rule
is in `src/design/RULES.md` and it was written for exactly this kind of item.
Delete qualifies. Say what goes, plainly, in the app's voice: no "poof", no
"gone forever!", no reassurance that is not true.

**Every failure surface follows Task 52's rules** if that task has landed by
the time you start; if it has not, follow the rules as written there anyway.
All buttons `size="sm"`. At most one `secondary`, no `primary`. Reuse an
existing label rather than inventing a second name for one action. Check both
themes.

---

## Not this task

Parallel tool calling. The MCP project pane. Anything about projects or their
snapshots. Changing what Archive means. Adding retention, expiry, or any
sweep that deletes without a person choosing it - **nothing in Studio ever
deletes on its own**, and this task must not be the thing that starts.

---

## Verification

- `pnpm typecheck` clean, both packages.
- Harness suites **one at a time**. `STUDIO` vitest green: 542 tests across
  55 files today, and none may be weakened to pass.
- `cargo clippy --all-targets`, zero warnings.
- **Measured proof, against a real database, in the report.** Create a
  conversation, send a turn so it has a real transcript, count the rows it
  produced in all eight `flue.db` tables, delete it, count again. Both
  numbers in the report. A green unit test is not the evidence here; the row
  counts are.
- **A negative control, reported.** Break the path match so it targets only
  `agents/studio/<id>`, confirm a test fails on the surviving `agents/title`
  stream, restore it. Say what you broke and what you saw.
- **The near-miss test.** Two conversations whose ids share a prefix. Delete
  the shorter. Prove the longer is untouched, in every table.
- **The refusal test.** Delete a conversation with a run in flight. Prove it
  refuses and that nothing was destroyed.
- Screenshots of the confirm and of the Archived pane, light and dark, into
  `report/shots/`.

The proof this worked: after deleting one conversation, no row keyed to its
id exists in either database, no tree exists on disk, and the four orphans
named in Part 0 are reachable. Show the queries.

---

## Rules

**`~/.studio/` is the user's real data.** Do not delete, move, or rewrite
anything under it except through the code you are writing, exercised
deliberately on conversations you created for the test. Do not touch
`*.beta9-journal`, the exports in the user's home folder, or `opencode/`.
Back up `flue.db` before the first write test and say in the report where you
put the copy.

Applied migrations are never rewritten; append only. Migration 18 is frozen -
it has been applied to the user's real database. Anything schema-side needs
migration 19.

`Backend/`, `docs/`, `prompts/` and `report/` are read-only context. Never
`git checkout`, `switch`, `stash`, `reset`, `clean`, `commit` or `rebase`.
No `any`, no non-const `as`, no non-null `!`. UTF-8, no BOM, LF. No
en-dashes, smart quotes, curly apostrophes, ellipsis characters or emoji in
source. Edit by hand, never with a script. No green placeholder tests, and no
test whose assertion was loosened to make a rename pass.

Report to `report/TASK-53-delete-that-means-deleted.md`, including every
place this brief turned out to be wrong.
