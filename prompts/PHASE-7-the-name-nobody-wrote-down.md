# Phase 7 - The name nobody wrote down

Automatic titling has been silently broken since the migration, and nobody
noticed because the fallback is convincing.

Every conversation created since Flue 2.0 landed carries a title that
`deriveTitle` produced - the first eight words of the person's message, cut
mid-phrase. The titler ran, or was supposed to, and its name never arrived.
Measured on the real index on 2026-09-03:

```
"Say hello in exactly five words, then name"              <- post-migration
"Create a file named manual-ok.txt containing the single" <- post-migration
"Create a file named phase45.txt containing the single"   <- post-migration
"Create light-demo.md file"                               <- before
"Build a static Steep tea shop website"                   <- before
"Greeting User"                                           <- before
```

The first three are exactly eight words each. The last three are what a model
writes. That is the phase, and it is the reason the event work matters: the
titling orchestrator routes on events that no live trace has ever confirmed.

Read `documentation/work/flue-2-migration.md` (Phase 7 and both amendments)
and `report/PHASE-6-the-message-the-user-can-finally-send.md` in full - Phase
6 measured a lot of wire shapes and quoted them, which saves you the probe.

---

## Part 0 - Measured, so you do not have to re-derive it

1. **Titling produces no model title today.** Evidence above. Whether the
   dispatch never happens, the run fails, the reply is never captured, or the
   parse rejects it - that is the first thing to find out, and the answer
   shapes everything else in this phase.
2. **The routing was written from the type surface, never from a live
   trace.** `conversations/titling.ts` says so in its own docblock, and hands
   the verification here by name. It assumes: `submission_settled` with
   outcome `completed` on the studio agent is the trigger; the title reply
   rides the title run's `agent_end` in `observation.messages`; and
   **`agent_end` fires before `submission_settled`**. That ordering is an
   assumption. If it is wrong, the reply is taken from an empty stash and the
   derived title stands - which is exactly the symptom.
3. **We do not own a Flue store.** The plan says to adopt
   `@flue/runtime/test-utils` contract suites against "our SQLite stream
   store". There is no such store: `src/db.ts` exports Flue's own
   `sqlite(path)` adapter and that is the whole persistence layer. The three
   contract suites exist in the package but they test an implementation we do
   not have. Part 5 says what to do instead.
4. **The chunk shapes, measured on a live 2.0 wire** (Phase 6, quoted in its
   report): `message-started` carries `messageId`, `submissionId`, `turnId`,
   `timestamp`, `position` - and **no model**; `message-completed` carries no
   `usage`; history assistant messages carry no `metadata` at all. So the
   `title_model` log fact cannot be recovered from those channels. The
   candidates are the telemetry events and the settled settings row.
5. **The suite floor is ten**, all in `harness`, all the Phase 8 retry
   regression. **`mcp-flue` is a known intermittent above it** - it failed in
   three of five recent full runs with "No approval arrived" then an `EBUSY`
   on teardown, and passed in the other two, on the same tree. Report per
   failure, never as a total. Do not raise a deadline to make it pass.

## Part 1 - Make the titler work

This is the phase's exit and it comes first, because everything else in the
plan is a rename that can hide behind green tests.

Find out where the title dies. The instrumentation to answer it already
exists - the orchestrator logs a warning when a settlement arrives with no
captured reply, and that log line is either firing or it is not, which
already splits the search in half.

Then fix it, and say what it was. Note that the titler runs on the model
layer's ladder now (Phase 4/5), so "the cheap model is not reachable" is a
candidate answer too, and a different one from "the event never arrived".

**The exit: a conversation in the real app gets a title a model wrote.**
Start a fresh conversation, send one message, let the first exchange settle,
and watch the name change in the sidebar. Say what the title was and what the
message was.

## Part 2 - Verify the envelope against real events

With titling working, a live trace exists for the first time. Use it.

- Which fields the runtime actually stamps on a **direct** submission's
  observations, and on a **dispatched** title run's - quoted, not summarised.
- The `agent_end` / `submission_settled` ordering, observed rather than
  assumed. If Part 1's bug was this, say so here.
- `titling.test.ts` pins the routing with hand-built 2.0-shaped events. Check
  those fixtures against the real envelopes and correct any that were guessed
  wrong. A fixture that disagrees with the wire is a test that passes while
  the product fails, which is the shape this phase exists to close.

## Part 3 - The renames

`run_start`/`run_end` to `agent_start`/`agent_end`; `runId` to `instanceId`
plus `submissionId`; `dispatchId` to `submissionId` across receipts, events
and telemetry; envelope `v: 3`.

`src/execution/context.ts`, `src/execution/outcomes.ts`,
`src/observability/flue.ts` and `src/observability/logger.ts` are where the
old identity vocabulary lives. ADR 0033 is the map for what each identifier
means and it was just reopened in Phase 6 - keep it accurate.

The rule that makes this safe: **a rename that changes what a field MEANS is
not a rename.** 2.0 split one identity into two. Where the old `runId` became
`instanceId`, say so; where it became `submissionId`, say so; where a call
site was reading the wrong one of the two all along, that is a finding.

## Part 4 - `title_model`, and the observability sweep

The `title_model` log fact was lost when the run-side model identity
disappeared from the projection. Part 0.4 says it cannot come from the
message channels. Restore it from telemetry if an event carries the model, or
re-derive it from the settled settings row, or - if neither is honest - say
plainly that it is gone and what a person loses without it.

**The exit for this part: telemetry shows a complete turn.** One real turn,
traced end to end, with the spans and the identity fields that carry it. Say
what you looked at and what it showed.

## Part 5 - The contract suites, redirected

The plan's premise is wrong (Part 0.3). Do not adopt suites for a store we do
not implement, and do not write a store so the suites have something to test.

What the plan actually wanted was coverage on the component this migration
most threatens - persistence. So answer the real question instead: **what
does this harness rely on Flue's `sqlite()` adapter to do, and what proves it
still does it?** If the honest answer is that the integration suites already
cover it end to end, say that and close the item. If there is a gap, name it.
Either way this is a paragraph and a decision, not a subsystem.

## Verification

- `pnpm typecheck` (harness) and `tsc -b` (frontend), both clean.
- Frontend suite green (47 files, 456 tests at the start of this phase).
- `pnpm test` (harness, builds first), suites one at a time. **Ten failures
  are the floor**, all in `harness`, all the Phase 8 retry regression. Run
  the suite whole at least twice, report BOTH numbers, and attribute anything
  above ten per failure - `mcp-flue` is a known intermittent, anything else
  is yours.
- `cargo clippy --all-targets` zero warnings; Rust suite 65/65.
- **The exit, and it is not a test:** a fresh conversation in the real app
  whose title a model wrote, and one turn visible end to end in telemetry.

Live model turns spend the user's money - and titling spends a second call
per exchange, so be deliberate. A handful of turns, never looped, never
benchmarked; the key never in a log, an error, a fixture, a screenshot, a
test or the report.

## Not this phase

- **Do not re-derive the runtime patch hunks.** Phase 8, the last one. Ten
  tests stay red; that is the floor, not something you broke.
- Do not implement delete or archive, parallel tool calls, or remote MCP.
- Do not touch the composer, the stream path or the abort scope - Phase 6
  settled those and its decisions are recorded in ADR 0033 and the client.
- Do not delete the exports in the user's home folder, the `*.beta9-journal`
  files, or anything else under `~/.studio/`.

## Report

`report/PHASE-7-the-name-nobody-wrote-down.md`: what was actually wrong with
titling and how you found it, the real envelopes quoted, which fixtures were
guessed wrong, the rename map with any meaning-changes called out,
`title_model`'s fate, the contract-suite decision, both suite runs with
per-failure attribution, and the real conversation whose name a model wrote.
And every place this brief was wrong.

Update `documentation/work/flue-2-migration.md`: mark Phase 7 done with what
actually happened, and amend Phase 8 with anything this changes.

## Rules

`Backend/`, `docs/`, `prompts/` and `report/` are read-only context, except
the one report file you write. Never `git checkout`, `switch`, `stash`,
`reset`, `clean`, `commit` or `rebase`.

No `any`, no non-const `as`, no non-null `!`. UTF-8, no BOM, LF. No en-dashes,
smart quotes, curly apostrophes, ellipsis characters or emoji in source. Edit
by hand, never with a script.

No green placeholder tests, and never a test that stopped checking anything.
A fixture that no longer matches the wire it stands for is exactly that, and
this phase is where three of them get checked.

Applied migrations are never rewritten. Secrets never enter a log, a fixture,
a report, or an error.

Verify against real code and real runs. Not this brief, not the plan, not the
Phase 6 report - all three are secondhand, and briefs in this series have been
wrong in every phase so far.
