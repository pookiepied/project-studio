# TASK 56 - The list that survives the run

A run that does five things should be able to say so, and the person should be
able to see which of the five is happening now. Every product does some version
of this and most of them get it wrong in the same way: the list is a decoration
the model draws, so it drifts from what the run is actually doing, it vanishes
when the window reloads, and a person who ticks something off watches the model
untick it on the next turn.

This task builds the list as durable state. The store is the truth, the model
writes into it, the person writes into it, and the panel reads it. Nothing
renders from a message, so nothing is lost when the message scrolls away or the
process dies.

Read all of it before you write anything. Part 0 is what already exists; you
will otherwise rebuild three things that are sitting there working.

---

## Part 0 - What is already built, and what you must not rebuild

**Task 55 shipped last night and is the pattern for this whole task.** It added
`native/ask_user_question` and it is the nearest possible neighbour to what you
are building: a durable table, a store that owns it, a broker over the store,
routes under their own prefix, a polling hook in the frontend, and a card that
reads the store rather than the transcript. Read these before you design
anything:

- `src/questions/pending-questions.ts` - a store that owns exactly one table,
  validates the JSON it reads, and refuses a row it cannot parse.
- `src/application/question-broker.ts` - durable row first, then the live half.
- `src/transport/http/routes/questions.ts` - its own prefix, behind an
  admission scope.
- `STUDIO/src/features/chat/questions/usePendingQuestions.ts` - the poll, at
  1s active and 10s idle, which keeps its last known rows when a read fails.

You are building the same shape for a different noun. Where you find yourself
inventing a mechanism, check whether that file already has one.

**The Rail already exists** at `STUDIO/src/stores/rail/RailProvider.tsx` and
`STUDIO/src/features/rail/`. It is the right-side panel: keyed entries so
opening the same thing twice focuses rather than duplicates, grouped by
conversation, capped at twelve, resizable between 320 and 760, and it animates
width only. It currently holds artifacts and nothing else. You are generalizing
it, not writing a new panel.

**The artifact status vocabulary already exists** at
`STUDIO/src/domain/artifacts/types.ts`: `pending | running | done | failed |
cancelled`, with `isWorking()` over it. Eleven synonyms were folded into those
five on purpose. Use them. Do not introduce `in_progress`, `completed`,
`todo`, or `blocked`.

**Migration 19 is the highest.** Yours is 20. Migrations 1-19 are frozen.

**Conversation purge** is at `src/conversations/purge.ts`. It deletes a
conversation's grants and extension choices by name. It does not know about
`pending_question` and that was left as a known residue. Do not repeat it: your
table gets purged, and you add that call.

### The documentation check, which is now standing process

Before building anything we check what the installed version already provides.
This was done for this task and the finding matters, so it is recorded here
rather than left for you to redo:

Flue 2.0.3 has `useDataWriter(name, { schema })` - a named, schema-validated
data part that streams to the client and **updates in place**, keeping its
position. On its face that is exactly a live task list, and it was the reason
this task was reopened after an earlier decision said the stream could not
carry one.

**It is the wrong mechanism here, and the reasons are specific.** Do not use it
for the plan:

1. **It is response-scoped.** The part lives on the reply message
   (`reply.data`, keyed by part name). A person opening the conversation seven
   days later is not inside a response, so there is no writer and no part. The
   requirement is that the list survives a restart and a week of silence; a
   response-scoped channel cannot satisfy it.
2. **It would be a second source of truth.** With a durable table *and* a live
   part, the panel has two things to believe, and they disagree exactly when a
   turn fails midway. Drift between the model's state and the UI is the defect
   this task exists to prevent, and adding a second writer is how it gets
   introduced.
3. **The writer is not reachable from where our tools run.** `useDataWriter` is
   declared in the agent render (`src/agents/studio.ts`), and our tools do not
   run in that closure - they are registered on the `CallGate` and reach Flue
   through the runtime's wrapper. Getting the writer to a tool's `execute`
   means threading per-run state the way `ClosingTurns` is threaded, for a
   channel we established above cannot hold the state anyway.
4. **The frontend cannot read it yet.** `STUDIO/src/platform/harness/conversation-chunks.ts`
   narrows message parts and has no `data-*` case. That is real work, and it
   buys the wrong thing.

The polling store is not a workaround for a missing native feature. It is the
mechanism the requirement actually names, and Task 55 proved it works.

Two more native facts you need:

- **`task` is a framework-owned tool name.** Flue's delegation tool is always
  present in every agent's tool set (`docs/guide/subagents.md`). Your tool
  cannot be called `task` and must not be described in words that invite the
  model to confuse the two.
- **Subagents are native** (`useSubagent`, `defineSubagent`, `GeneralSubagent`
  under the reserved name `flue-general`, delegation depth capped at 4). They
  are not in this task. They matter because the panel you build is where they
  will be shown later, which is why Part 5 asks for a surface rather than a
  plan-shaped widget.

---

## Part 1 - The tool

`native/plan`, registered in a new `src/tools/plan/` family and wired through
`registerNativeTools` the way `ask` was - optional dependency, and a
composition without a store offers no tool rather than a tool that writes
nowhere.

### Why it is not called `todo`

`task` is taken by the framework. `todo` reads as a scratchpad the model keeps
for itself, and the whole point here is that the person can see it and change
it. `plan` says what it is: the run's stated intention, which the person is
allowed to disagree with.

### Shape

```
plan({
  items: [
    { id: "read-schema", text: "Read the existing schema", status: "done" },
    { id: "write-migration", text: "Write migration 20", status: "running" },
  ],
})
```

Rules, each of which is load-bearing:

- **Items are merged by id, never replaced wholesale.** A call that names two
  items changes those two and leaves every other item exactly as it is. This
  is the single most important decision in the task and Part 3 explains why.
- `id` is the model's own stable slug for the item. An id it has used before
  addresses the same item.
- `status` is the artifact vocabulary: `pending | running | done | failed |
  cancelled`. Nothing else parses.
- `text` may be updated on an existing item, because a plan legitimately gets
  more specific as it is worked.
- Between 1 and 20 items in one call. A plan longer than about a dozen items
  is a plan nobody reads; the cap is a wall, not a target, and the description
  should say the useful size is three to seven.
- No delete. An item the run abandoned is `cancelled`, which is a fact worth
  keeping; a delete would let the model quietly rewrite what it said it would
  do.

`effects: ["read"]` - and read the reasoning in
`src/tools/ask/questions.ts` before you argue with it. The kernel throws on an
empty effects list, and `read` is the honest answer for a tool whose whole
action is recording an intention: it is permitted in an untrusted folder and
auto-allowed by default, and both are right. A plan tool that raises an
approval means the person approves the run's note-taking, which is absurd.

### What the tool returns

**The full current list, after the merge, including changes the person made.**

Not an acknowledgement. Not the items that were written. The whole list, every
time. This is how the model learns that the person ticked something off, and it
is the only channel by which it can learn: there is no other point in a turn
where the person's edits reach the model.

Each item in the result says who last touched it, `model` or `person`. An item
the person marked `done` comes back saying so, so the model can read "they did
that one already" instead of "I must have done that and forgotten".

---

## Part 2 - The durable half

Migration 20, table `plan_item`. Columns, and no more than these:

```
conversation_id  TEXT NOT NULL
id               TEXT NOT NULL     -- the model's slug, unique per conversation
text             TEXT NOT NULL
status           TEXT NOT NULL
position         INTEGER NOT NULL  -- first-seen order, so the list is stable
updated_by       TEXT NOT NULL     -- 'model' | 'person'
updated_at       INTEGER NOT NULL
PRIMARY KEY (conversation_id, id)
```

STRICT, like the others. Note what is absent: no run id, no turn id, no
expiry, no `archived` flag. The plan belongs to the conversation, not to the
run that happened to write it - that is the whole requirement. A second run in
the same conversation continues the same list.

`position` is assigned when an item is first seen and never recomputed, so a
merge that touches item three does not move items one and two. Ordering the
panel by anything derived - status, update time - makes the list jump under the
reader's eyes every time something completes, which is the exact behaviour that
makes these panels unpleasant to watch.

The store owns the table and nothing else touches it, following
`PendingQuestionStore`. It validates what it reads and refuses a row whose
status is not one of the five, rather than trusting a value that reached the
database before the vocabulary was enforced.

**Corruption is a state the panel renders, not a crash.** If a conversation's
rows cannot be read, the panel says the plan could not be read and offers to
clear it. It does not throw into the page, and it does not silently show an
empty plan - an empty plan and an unreadable plan are different facts and a
person acting on the wrong one loses work.

**Purge.** Add the delete to `src/conversations/purge.ts` beside the grants and
extension-choice deletes. A deleted conversation leaves no plan rows behind.

---

## Part 3 - The person's tick, and why merge-by-id is not negotiable

The person can tick an item off. That was asked for directly, and it is the
requirement that decides the data model.

Consider the alternative that every other implementation picks: the model sends
the whole list and it replaces what was there. Now the person ticks item four
at 10:00:01. The model's next call, composed before it could possibly know
that, sends all five items with item four still `running`. The tick is gone.
The person watches the software undo them. There is no amount of care in the
model that fixes this, because the model's message was written before the tick
existed - it is a lost-update race, and the only real fix is to stop sending
state the writer did not intend to change.

So: **a write changes only the items it names.** The model's call carries the
items it is changing. Item four is not in it, so item four keeps the person's
`done`. The next tool result tells the model item four is done and was done by
the person.

The same rule protects the other direction. The person ticking item four writes
only item four, so it cannot clobber a status the model set on item two a
moment earlier.

Two smaller decisions that follow:

- The person can tick and untick - `done` and back to `pending`. Nothing else.
  They are not given the model's full status vocabulary; `failed` is a claim
  about what happened, not a thing to toggle.
- The person's edit is not a message and does not start a turn. It writes the
  row and that is all. The model finds out the next time it writes, which is
  the honest cadence: the person did not ask a question, they made a note.

---

## Part 4 - The pill

A compact control above the composer, reading `3 of 5`. It appears only when
the conversation has a plan, and it says the two numbers a person actually
wants: how many are done, and how many there are.

When something is `running`, it says so - the running item's text is the useful
thing at that moment, truncated to one line. When nothing is running and the
plan is not finished, the count alone is right. When everything is done, the
pill says so plainly and stops competing for attention.

Clicking it opens the panel. Clicking it again closes it. It is a disclosure
control and nothing else - no menu, no hover card, no progress ring that
animates on every poll.

It sits above the composer, beside where the approval and question cards
already mount in `ChatPage.tsx`. Order when several are present: approvals
first, then questions, then the pill - the two that block the run outrank the
one that describes it.

---

## Part 5 - The panel, and generalizing the Rail

The plan opens in the right-side rail. Not a modal, not a drawer, not a third
column of its own.

### What has to change in the Rail

`RailEntry` currently is an artifact. Make it a discriminated union - an
artifact entry and a plan entry - and let the tab strip render both. Keep every
existing behaviour: keyed entries, idempotent open, grouping by conversation,
the cap, the width bounds, the collapse-versus-close distinction. Read the
docblocks in `RailProvider.tsx` before touching it; several of them record
decisions that were made once and should not be relitigated, including why
there is exactly one placement.

Two rules specific to the plan entry:

- **There is at most one per conversation**, and it is addressed by the
  conversation, so opening it twice focuses it. This falls out of the existing
  keying if you choose the key correctly.
- **It is exempt from the twelve-entry cap.** The cap exists because artifacts
  accumulate; a conversation has one plan and evicting it to make room for a
  search result would be a bug that only shows up in long sessions.

### What the panel shows

The items, in `position` order, each with its status and its text. That is the
whole panel. A count at the top. The tick control on each row.

It must stay minimal. It is explicitly not a dashboard: no timings, no
durations, no percentages, no charts, no filters, no sort control, no
collapsing sections. If you find yourself adding a control, the question to ask
is whether a person mid-conversation would stop to use it.

### The animation

The rail animates width and opacity on a spring, and switching entries
cross-fades. Fix what is wrong there rather than adding to it: the current
transition has been noted as unclean. Specifically, check that an entry
arriving into a rail that is already open does not replay the panel's entry
animation, and that collapse and expand are the same motion in reverse rather
than two different ones. Width-only was a deliberate choice - a rail that
slides in horizontally reads as a fault - so do not replace it with a
translate.

### On the name

The name "Rail" is internal. It appears in no user-facing string, so renaming
it costs a large diff and buys nothing a person will ever see. Leave it. If
that turns out to be wrong it is a rename, and a rename is cheap later and
expensive now.

---

## Part 6 - The tool's description

The description is the part of this task most likely to decide whether the
feature works, and it is the part most likely to be written last and badly.
Budget real attention for it.

It has to establish four things:

1. **When to use it.** Work with several distinct steps that the person
   benefits from seeing. Not every turn. A one-step answer with a plan attached
   is noise, and a model that writes a plan for everything trains the person to
   stop reading the panel.
2. **That statuses are honest.** `running` means it is happening now, and
   exactly one item should be `running` at a time in the normal case. `done`
   means finished, not started. `failed` is available and should be used - a
   plan where nothing ever fails is a plan nobody believes.
3. **That the person may have changed it.** The result is the current list and
   it may contain their edits. An item they marked done is done; do not redo it
   and do not mark it back.
4. **That it is not the delegation tool.** Flue's `task` tool is always present
   and hands work to a subagent. This records intention and runs nothing. The
   two are close enough in the abstract that the description should say the
   difference rather than hope.

---

## Part 7 - Verification

The rules in `documentation/rules.md` hold. In particular: `pnpm build` before
the suite, run vitest suites one at a time and never concurrently, and every
load-bearing test gets a negative control - break the code, watch the named
test fail, restore it, watch it pass. Report each control and which test it
fired.

Beyond the ordinary coverage, these specific things must be proven, because
each is a claim this task is making:

1. **The lost update does not happen.** The person marks item four done; the
   model then writes items one, two and three; item four is still done. This is
   the test the whole data model exists for.
2. **The model is told.** After that write, the tool's result contains item
   four as `done`, attributed to the person.
3. **It survives a restart.** Write a plan through one store, open a second
   store over the same database, read the plan back whole and in order.
4. **It survives a failed turn.** A run that writes three items and then errors
   leaves those three items standing. Nothing about a plan is rolled back with
   a turn.
5. **Position is stable.** Merging a change into item three does not reorder
   items one and two, and does not move item three.
6. **An unknown status is refused**, at the store, rather than reaching the
   panel.
7. **A corrupt row reads as damaged**, not as an empty plan.
8. **Purge removes the rows.** Delete the conversation, and no plan rows for it
   remain.
9. **The plan entry is not evicted** by opening thirteen artifacts.
10. **A negative control on the merge itself**: make the store replace the list
    wholesale, and confirm test 1 fails. If it still passes, test 1 is not
    testing what it claims.

The frontend suite must stay green, and the existing rail tests must pass
unchanged - if you find yourself editing a rail test to accommodate the union,
say so explicitly in the report and explain why the old assertion was wrong
rather than inconvenient.

---

## Part 8 - Out of scope, deliberately

Do not build these, and do not leave hooks for them:

- Subagents in the panel. It is coming, which is why Part 5 asks for a surface
  that can hold more than one kind of thing, but no subagent code belongs in
  this task.
- Any use of `useDataWriter`. Part 0 says why.
- A planning agent, a planner mode, or anything that decides when a plan should
  be written. The model decides, from the description.
- Cross-conversation or project-level plans. Per conversation, full stop.
- Nested items, dependencies, assignees, due dates, priorities.

---

## Rules for this session

You do not commit and you do not switch branches. No `git checkout`, `switch`,
`stash`, `reset`, `clean`, `commit`, or `rebase`. This overrides section 11 of
`documentation/rules.md`. Leave your work in the working tree.

`Backend/`, `docs/`, `prompts/`, `opencode/` are read-only. Your one writable
file outside the source is your report at
`report/TASK-56-the-list-that-survives-the-run.md`.

Never delete or move anything under `~/.studio/` - that is the user's real
data. Read-only access to it is fine. For any destructive test, point
`PROJECT_STUDIO_HOME` at a throwaway directory. Never touch `*.beta9-journal`
files. Do not write to the D: drive at all.

No `any`, no non-const `as`, no non-null `!`. UTF-8 with no BOM. Preserve each
file's existing line endings. No scripted search-and-replace across files -
hand edits, one at a time. Em dashes are allowed in comment prose only; no en
dashes, smart quotes, curly apostrophes, ellipsis characters, or emoji in
source.

Applied migrations are frozen. Yours is 20 and it is append-only.

Kill processes by PID only, never by name.

Your report covers: the files you changed and what each change was; test counts
before and after; every negative control and which test it fired; any rule you
added that the task did not ask for; anything you found but did not fix; and
every place the brief was ambiguous, with the decision you made, so it can be
argued with.
