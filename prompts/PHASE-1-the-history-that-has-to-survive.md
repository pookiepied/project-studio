# Phase 1 - The history that has to survive

Flue 2.0 rejects our conversation database before any application code runs.
Schema 8 is what it wants; this machine has 4. There is no in-place migration
and there is no way back, so every transcript Studio has ever produced is gone
the moment the runtime is upgraded - unless something reads them out first.

This phase writes that something, runs it for real, and settles what
"deleting a conversation" was supposed to mean, because an export that
faithfully preserves the debris of deleted threads is not a feature.

It is the only irreversible step in the migration, which is why it is Phase 1
and not Phase 8. Nothing else in the plan is destructive; this one has a
deadline attached to it.

Read `documentation/work/flue-2-migration.md` first, all of it. Phase 0's
report is worth reading too - it is the shape of the evidence this phase is
also judged by.

---

## Part 0 - What is true on this machine, measured

Taken from the real databases on 2026-09-01, read-only. Re-measure rather
than trusting these; the numbers move every time the app runs.

1. **Two databases, and only one of them dies.**
   `~/.studio/data/flue.db` is Flue's durable journal and is what gets
   rejected. `~/.studio/data/studio.db` is ours - conversations, projects,
   permissions, settings, provider records - with our own migrations, and 2.0
   does not touch it. `platform/paths.ts` already keeps them as separate
   files, deliberately, and the docblock there says why.
2. **The on-disk schema version is `4`, not 5.** `flue_meta` holds
   `schema_version = 4`. Flue's own migration guide says the beta stored
   version 5. Both are below 8 and both are rejected, so the conclusion is
   unchanged - but an export tool that assumes v5 table shapes is assuming
   something this machine contradicts. Read the tables, do not assume them.
3. **What is actually in there.** 51 rows in `flue_conversation_streams`,
   1,862 in `flue_conversation_stream_batches`, 102 in
   `flue_agent_submissions`. The attachment, image, run and event-stream
   tables are all empty. Runs being empty is expected - we never adopted
   workflows.
4. **The transcript lives in the batches, addressed by stream.**
   `flue_conversation_streams` carries `path` (for example
   `agents/studio/cnv_c61u5vmo`), `identity_json`, and `next_offset`.
5. **Our side has 16 conversations**, of which 7 are test fixtures named
   `cnv49_*` - real history is 9.
6. **24 of the 51 streams are orphans.** 27 match a conversation we still
   have (a conversation produces more than one stream - the studio agent and
   the titler each get one), and 24 match nothing in the `conversation`
   table. They are not empty: offsets of 224, 145, 138, 125 mean real
   transcripts of conversations the user deleted. This is the deletion defect
   we have been carrying, now counted.

## Part 1 - The export

Write it as a harness command, against the **beta** runtime, while it can
still read its own database. This is the only phase where that is true.

What the export has to be, in order of importance:

- **Complete enough to reconstruct a conversation a person would recognise.**
  Not a table dump. The user's messages, the assistant's replies, tool calls
  and their results, and the ordering. If something cannot survive, the export
  says so per conversation rather than dropping it quietly.
- **Self-describing.** It will be read by a program that does not exist yet,
  possibly months from now, against a schema that will have moved twice. It
  carries its own version, the source schema version it was taken from, the
  export time, and enough of the conversation's identity to re-associate it
  with our `conversation` row.
- **Readable by a person.** Someone should be able to open one conversation
  and read it without our code. This is a hedge: if the re-seed is never
  written, the export is still the thing that made the loss survivable.
- **Its own file, outside the databases.** Written where the user asks, or to
  a stated default. It never writes into `~/.studio/data/`, and it never
  deletes or moves anything there - that directory is the user's.

Read the transcript through whatever seam gives the truest answer.
`harness-client.ts` has a `history(threadId)` already, which returns Flue's
own snapshot; reading the batches directly is the alternative. Pick one,
justify it, and say what the other would have cost. If the snapshot path
loses something the tables hold, that is a finding and it goes in the report.

## Part 2 - The 24 orphans, decided rather than inherited

Deletion in Studio removes the conversation row and the folder. It has never
removed the Flue stream, so every conversation the user has ever deleted is
still on disk, in full, and would be exported by anything that walks the
streams.

Decide, and say why:

- **Export everything and mark provenance** - each conversation carries
  whether our index still knows about it. Honest, and the user chooses later.
- **Export only what our index knows** - the orphans are, by the user's own
  action, deleted. Faithful to intent, and irreversible a second time.
- **Export both, in two files.**

This is a product decision about the user's data, so it belongs to the user,
not to the agent writing this. **State the recommendation with its reasoning
and ask before implementing it.** Do not decide it silently in either
direction.

What is not open: **do not delete the orphans in this phase.** The real
delete-and-archive mechanism is its own task, after Phase 8, and is better
built against the v8 schema. This phase reads.

## Part 3 - Prove it on the real data

An export that has only ever run on fixtures is a plan, not a safety net.

- Run it against this machine's real `~/.studio/data/flue.db`, read-only, and
  report the counts: conversations exported, messages, tool calls, orphans,
  and anything skipped with the reason.
- **Read one real conversation end to end, in the export, and confirm it
  matches what the app shows** for the same conversation. Name which one.
  A count that matches proves the walk; only reading proves the content.
- State the export's size and how long it took, because a person will run
  this once under time pressure with the app about to be upgraded.

Take a copy of `flue.db` first and work against the copy if that is safer -
say which you did.

## Part 4 - The re-seed, or an honest refusal

The plan says "export and re-seed". Re-seeding into a v8 database that does
not exist yet, through APIs this tree has not adopted, may not be writable
today.

So: **decide whether the re-seed can be written now, and say so plainly.**
If it can, write it. If it cannot, do not fake it - write down exactly what
the export guarantees, which Phase would own the import, and what would have
to be true for it to work. A stub that pretends to re-seed is worse than a
paragraph saying it comes later.

Either way, the export format has to be designed as though the importer is
being written by someone else, later, who cannot ask questions.

## Not this phase

- **Do not upgrade anything.** No `@flue/*` version change, no lockfile edit,
  no `pnpm add`. Phase 2 owns the pins, and this phase must run against the
  beta runtime by definition.
- **Do not port an agent, touch `patches/`, or write `app.ts`.** Later phases.
- **Do not implement delete or archive.** After Phase 8.
- **Do not touch `STUDIO/`.** No frontend work: the export is a harness
  command, and giving it a button is a separate decision.
- Do not delete, move, or rewrite anything under `~/.studio/`.

## Verification

- `pnpm typecheck` clean.
- `pnpm test` (which builds first - the integration tests spawn `dist/`, and
  running `vitest` against a stale build has mis-attributed failures in two
  earlier reports). The suites run one at a time.
- Real tests for the export's walk and its format, against a fixture database
  you build - not against the user's data, which changes under you.
- The real run from Part 3, with its counts and the one conversation read end
  to end.

Everything green, and the tree in a state that ships: this phase lands on
`main` on its own, before Phase 2 begins.

## Report

`report/PHASE-1-the-history-that-has-to-survive.md`: the format and why it is
shaped that way, the orphan recommendation and what the user chose, the real
run's numbers, the re-seed decision, and every place this brief was wrong -
including the measured facts in Part 0, which were true on 2026-09-01 and may
not be true when you read them.

## Rules

`Backend/`, `docs/`, `prompts/` and `report/` are read-only context, except
the one report file you write. Never `git checkout`, `switch`, `stash`,
`reset`, `clean`, `commit` or `rebase`.

No `any`, no non-const `as`, no non-null `!`. UTF-8, no BOM, LF. No en-dashes,
smart quotes, curly apostrophes, ellipsis characters or emoji in source. Edit
by hand, never with a script. No green placeholder tests, and never a test
that stopped checking anything.

Live model turns spend the user's money and are not needed here at all; this
phase reads a database.

Verify against real code and real data. Not this brief, not the plan, not the
migration report - all three are secondhand and two have already been wrong.
