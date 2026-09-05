# TASK 56 - The list that survives the run

Brief: the run's plan as durable state - a `native/plan` tool that merges by
id, a `plan_item` table the conversation owns, a person's tick that cannot be
undone by the model's next call, a pill above the composer, and the plan
opened in the right-side rail, which becomes a rail that holds more than
artifacts. Nothing renders from a message.

---

## 1. Files changed, and what each change was

### Harness - new files

- `src/plan/plan.ts` - the shared vocabulary: `PlanStatus` (the artifact
  five: `pending | running | done | failed | cancelled`), `PLAN_STATUSES`,
  `PlanWriter` (`model | person`), `PlanItemWrite` (what a caller names),
  `StoredPlanItem` (what the store vouches for, position included),
  `PlanView` (one conversation's items plus the `damaged` flag), and
  `PlanItemReport` (the model-facing shape: no position, no clock).
- `src/plan/plan-items.ts` - `PlanItemStore`, the sole owner of `plan_item`.
  `merge` is an upsert per named item - a write changes only the items it
  names, and every other row keeps its state, including a tick the person
  gave it a moment earlier. The whole batch is validated before anything
  writes. `position` is assigned at first sight and never recomputed.
  `update` is the person's primitive: it sets one existing item's status and
  refuses to invent one. `list` reads in position order; a row whose status
  is not one of the five makes the whole plan `damaged` rather than crashing
  the reader or showing an empty list. `clearConversation` is what the purge
  calls.
- `src/tools/plan/plan.ts` - the `native/plan` capability and tool. Parse:
  one to twenty items, non-empty id and text, status in the five, no
  duplicate ids in one call. Execute: merge as the model, read the whole
  plan back, and return the full list with `updatedBy` on every item - the
  one channel by which the person's edits reach the model. A damaged read
  throws `execution_failed` rather than returning a partial list that claims
  to be whole. Effects are `["read"]`, for the same written-out reason the
  ask tool gives, and `idempotent: true` - a retried merge leaves the same
  rows. The description carries all four things Part 6 asks for, including
  "this records intention and runs nothing; to hand work to a subagent, use
  task".
- `src/tools/plan/index.ts` - the plan family: `PlanToolRegistration` (the
  merge-and-read the tool needs) and `registerPlanTools`, which registers
  the factory inline the way the architecture test requires.
- `src/transport/http/routes/plans.ts` - the plan's own prefix, behind the
  `project` admission scope (the plan is product state, not a question that
  speaks for the person). `GET /:conversationId` answers the snapshot with
  its damaged flag; `POST /:conversationId/items/:itemId` is the person's
  tick and accepts only `done` and `pending` - `failed` is a claim about
  what happened, not a thing to toggle; `DELETE /:conversationId` clears the
  plan, which is the remedy the damaged panel offers.
- `tests/unit/plans.test.ts` - 21 tests, named for the task's claims (see
  section 2).

### Harness - changed files

- `src/storage/migrations.ts` - migration 20, `plan_item`: STRICT, primary
  key `(conversation_id, id)`, columns exactly as the brief lists them, and
  deliberately no run id, no turn id, no expiry, no archived flag. The
  docblock says why each absence is the requirement.
- `src/tools/native/index.ts` - optional `plan` registration beside `ask`:
  a composition that omits the store offers no plan tool rather than one
  that writes nowhere.
- `src/application/studio-runtime.ts` - optional `plans` store option, held
  per runtime and wired into `registerNativeTools` as the plan family's
  merge, with the writer fixed to `"model"` (the person's writes come
  through the HTTP route, which names itself).
- `src/transport/http/create-app.ts` - optional `plans` option; mounts
  `/api/plans` the way `/api/questions` is conditionally mounted.
- `src/conversations/purge.ts` - `PlanItemStore` joins `PurgeDependencies`,
  and the plan rows are deleted beside the grants and extension-choice
  deletes. The comment beside the delete records that `pending_question` has
  no delete here yet and that it is a residue of the ask task, not a
  precedent.
- `src/transport/http/routes/conversations.ts` - builds the plan store over
  the same database and passes it to both `purgeConversations` call sites.
- `src/app.ts` - composes `PlanItemStore` over the one database and hands it
  to the runtime and the HTTP app.
- `tests/unit/purge.test.ts` - the fixture builds the plan store; one new
  test proves a purge removes the conversation's plan rows and only its own.

### STUDIO - new files

- `src/features/plans/usePlan.ts` - the per-conversation poll hook, the same
  shape as `usePendingQuestions`: 1s while a run is live, 10s otherwise, a
  failed read keeps the last known plan (down is not empty), an accepted
  tick is written into the local snapshot at once and reconciled by the next
  poll, and a conversation switch drops the previous conversation's plan
  rather than showing it for a beat. Items are sorted by position at the
  read boundary, so the panel cannot jump.
- `src/features/plans/PlanPill.tsx` - the disclosure control. `N of M`; the
  running item's text beside the count when something is running; `All done`
  when finished; and for a damaged plan, "Plan could not be read" - a count
  over rows nobody can read would be an invention. One button, `aria-expanded`,
  no menu and no hover card.
- `src/features/plans/PlanPanel.tsx` - the panel: a count at the top, then
  the items in position order, each with a static status mark, its text, and
  a tick control (role checkbox). Damaged renders the sentence and the
  clear. No timings, no percentages, no filters, no sort, no collapsing
  sections.
- `src/features/plans/usePlan.test.ts`, `src/features/plans/PlanPanel.test.tsx` -
  5 and 10 tests.
- `src/stores/rail/RailProvider.test.tsx` - 3 tests for the plan entry's
  rules: idempotent open, cap exemption, and close.

### STUDIO - changed files

- `src/platform/harness/contracts.ts` - `PlanItemRecord`, `PlanSnapshot`,
  and their parsers. `PlanItemRecord.status` is `ArtifactStatus` imported
  from `domain/artifacts/types` - the same five the artifact vocabulary
  chose, so the question "is this still going" has one answer everywhere.
  `damaged` parses as data, never as an error.
- `src/platform/harness/client.ts` - `getPlan`, `tickPlanItem`, `clearPlan`
  and the `/api/plans` paths. The tick's body names the status rather than a
  boolean, so the vocabulary reads true at the seam.
- `src/platform/harness/index.ts` - re-exports.
- `src/stores/workspace/WorkspaceProvider.tsx` - a `plans` surface beside
  `questions`, bound to the store's client for the same restart reason.
- `src/stores/rail/RailProvider.tsx` - `RailEntry` is now a discriminated
  union of artifact and plan entries. `openPlan` keys the entry
  `plan:<conversation id>`, so one plan per conversation and a second open
  focuses rather than duplicates - the existing keying does the work. The
  cap now drops the oldest *artifact* rather than whatever sits at the
  front, because evicting a conversation's plan to make room for a search
  result is the bug that only shows up in long sessions. Every other
  behaviour - keyed entries, grouping, width bounds, collapse versus close,
  the one placement - is untouched.
- `src/stores/rail/index.ts` - exports `planEntryId`.
- `src/features/rail/RailTabs.tsx` - per-kind mark and title: an artifact
  keeps its icon and title, a plan entry shows `Icons.plan` and "Plan".
- `src/features/rail/SideRail.tsx` - the header names the entry per kind,
  and the body renders `PlanPanel` for a plan entry. The animation fixes are
  here; see section 5.
- `src/features/chat/ChatPage.tsx` - `usePlan` beside the two blocking
  channels, and the pill mounted below the question card: approvals first,
  then questions, then the pill, because the two that block the run outrank
  the one that describes it. Clicking the pill opens the plan entry;
  clicking again closes it; a plan entry that exists but is not on screen
  comes forward instead of being opened twice.
- `src/features/chat/running-mark.test.tsx` - the render tree gained
  `RailProvider`, because ChatPage reads the rail store since the pill
  arrived. No assertion changed; see section 6.

---

## 2. Tests

Before:

- STUDIO HARNESS: `pnpm build`, then the suite: **1603 passed, 25 skipped
  (1628 total)**.
- STUDIO: **569 passed (569 total)**.

After:

- STUDIO HARNESS: `pnpm build` clean, `tsc --noEmit` clean, then the full
  suite: **1625 passed, 25 skipped, 0 failed (1650 total)**. The +22 are the
  21 tests in `tests/unit/plans.test.ts` and the 1 new purge test.
- STUDIO: `tsc --noEmit` clean, then the full suite: **587 passed, 0 failed
  (587 total)**. The +18 are 5 hook tests, 10 pill/panel tests, and 3 rail
  store tests.

The specific claims, and the tests that hold them:

1. The lost update does not happen - `plans.test.ts`, "does not lose the
   person's tick when the model writes other items".
2. The model is told - "tells the model what the person changed, in the
   write's own result" (store) and "returns the whole current list,
   including the person's edits" (tool).
3. It survives a restart - "survives a restart: a second store over the same
   database reads it whole", over a file database with the first connection
   closed.
4. It survives a failed turn - "leaves written items standing when a later
   call fails"; there is no rollback path in the plan's write path to break.
5. Position is stable - "keeps position stable: merging item three moves
   nothing else".
6. An unknown status is refused at the store - "refuses a status outside the
   five, on the way in and on the way out" (write side) and, for values that
   reached the database before the vocabulary existed, the read-side refusal
   in the same test.
7. A corrupt row reads as damaged, not as an empty plan - "reads a corrupt
   row as damaged, and an empty plan as empty, and never one for the other".
8. Purge removes the rows - `purge.test.ts`, "removes the conversation's
   plan rows with the rest of it".
9. The plan entry is not evicted - `RailProvider.test.tsx`, "is exempt from
   the twelve-entry cap: thirteen artifacts do not evict it".
10. The negative control on the merge itself - NC-1 below.

The suite was run with vitest's default reporter (the `basic` reporter the
rules name does not exist in vitest 4); one suite at a time, never
concurrently.

---

## 3. Negative controls (break, watch that test fail, restore)

Every control: the code was broken by hand, the named test was run and
failed, and the code was restored and its suite re-run green.

- **NC-1 (the brief's own control, proof 10).** Broken:
  `PlanItemStore.merge` cleared the conversation's rows first, so every call
  replaced the list wholesale. Fired: `plans.test.ts` "does not lose the
  person's tick when the model writes other items" (and five neighbouring
  tests, all of which the break also invalidates). Restored.
- **NC-2.** Broken: the merge's UPDATE branch set `position = position + 1`,
  recomputing first-seen order. Fired: "keeps position stable: merging item
  three moves nothing else". Restored.
- **NC-3.** Broken: `readRow` defaulted an unknown status to `pending`
  instead of refusing the row. Fired: "reads a corrupt row as damaged, and
  an empty plan as empty, and never one for the other" (and "refuses a
  status outside the five"). Restored.
- **NC-4.** Broken: `routes/plans.ts` `personStatus` also accepted
  `"failed"`. Fired: "takes the person's tick as done, and untick as
  pending, and no other status". Restored.
- **NC-5.** Broken: `purge.ts` no longer called `plans.clearConversation`.
  Fired: `purge.test.ts` "removes the conversation's plan rows with the rest
  of it". Restored.
- **NC-6.** Broken: `RailProvider`'s cap reverted to the blind
  `grown.slice(...)` that drops whatever sits at the front. Fired:
  `RailProvider.test.tsx` "is exempt from the twelve-entry cap: thirteen
  artifacts do not evict it". Restored.
- **NC-7.** Broken: the plan tool returned only the items the call wrote,
  with `updatedBy: "model"` hardcoded. Fired: "returns the whole current
  list, including the person's edits". Restored.
- **NC-8.** Broken: `usePlan`'s read set the snapshot to `null` on a failed
  read. Fired: `usePlan.test.ts` "keeps the last known plan when a read
  fails, because down is not empty". Restored.
- **NC-9.** Broken: `PlanPill` skipped its damaged branch, so an unreadable
  plan rendered as `0 of 0`. Fired: `PlanPanel.test.tsx` "says a damaged
  plan could not be read, rather than inventing a count". Restored.

---

## 4. Rules added that the brief did not ask for

- **The merge validates the whole batch before writing any of it**
  (`plan-items.ts`). The brief says the store refuses an unknown status;
  this adds *when* the refusal happens - before the first row is written, so
  a call with one bad item cannot become a half-applied merge. Its test is
  "leaves written items standing when a later call fails".
- **The pill's damaged label.** The brief specifies the pill's content for
  running / not-finished / all-done but not for damaged; rendering `0 of 0`
  would have been exactly the "silently show an empty plan" the brief
  forbids, so the pill says "Plan could not be read" and the panel carries
  the remedy. Its test is the NC-9 one.

---

## 5. The rail animation: what was actually wrong

The brief says the transition "has been noted as unclean" and names two
checks. What I found:

- **The content handover was not a crossfade.** The keyed content `div` had
  `initial`/`animate` and no `exit` inside no `AnimatePresence`: the outgoing
  view vanished in one frame and the incoming one faded in - a dip through
  empty that the docblock called a crossfade. Fixed with
  `AnimatePresence mode="popLayout"` and the house `FADE` preset: the
  outgoing view fades while the incoming one arrives, neither pushing the
  other, no vertical motion. The scroll body is `relative` so the popped-out
  view overlays the body rather than the whole rail.
- **Opacity rode the width spring.** One `transition={SPRING_PANEL}` paced
  both the resize and the fade, and the spring's long settle dragged the
  fade past where it should have ended. Per the motion vocabulary's own
  rules (things that move because you moved them take a spring; things that
  appear or vanish take a duration), width keeps `SPRING_PANEL` and opacity
  now takes `FADE.transition`. The same two transitions serve enter and
  exit, so collapse and expand are one motion in reverse.
- **The two named checks hold by construction.** An entry arriving into an
  open rail does not remount the `motion.aside` (it is rendered
  conditionally on `open`, which does not change), so the panel's entry
  animation cannot replay - only the content handover plays, which is the
  crossfade. And the collapse/expand pair share one transition set, so they
  are the same motion reversed. Width-only remains: no translate was added.
- `initial={false}` on the outer `AnimatePresence` was left as-is: it is
  first-render-only config in framer-motion, the aside is never present at
  first render, and touching it risks changing the open animation that is
  not part of what is wrong.

---

## 6. Anything found but not fixed

- **`pending_question` is still not purged.** The brief flags it as a known
  residue and says not to repeat it for `plan_item` - which I did not - but
  the residue itself is one call in the same block I edited, and it survives
  this task because the brief did not ask for it. It is now marked in a
  comment in `purge.ts` beside the plan delete so the next person cannot
  miss it.
- **`useProviders.test.ts` needed no stub additions this time.** Task 55's
  report lists four stub methods added there; the client methods this task
  adds are read from the `plans` surface, which that test's stub never
  touches. I record this only because the previous report implied the stub
  grows with every client method - it does not.

---

## 7. Where the brief was ambiguous, and the decision made

- **"A broker over the store."** Part 0 describes Task 55's shape and says
  to build the same one. Nothing about a plan parks, so a broker would be a
  class with no live half, no state, and one rule. The tool takes a merge
  dependency through `registerNativeTools` exactly as `ask` takes its
  channel, and the person's vocabulary restriction lives in the route's
  parse exactly as `QuestionReply`'s does. The rule the broker would have
  held still exists; it is just in the two seams the codebase already uses
  for it.
- **Cap exemption arithmetic.** "Exempt from the twelve-entry cap" is read
  as: the plan is never the entry dropped, but the strip still holds at most
  twelve entries, so a plan present means eleven artifact slots. The
  alternative - counting only artifacts against the cap - would let the
  strip grow past twelve, which is the scannability problem the cap exists
  for. Its test pins the eleven.
- **The person's tick against a `running` item.** The brief gives the person
  tick/untick - `done` and back to `pending` - without saying what happens
  to an item a dead run left `running`. The tick writes one of the two
  statuses regardless of what the row currently holds, so a stuck `running`
  item can be ticked done or unticked to pending; `failed` and `cancelled`
  remain model-only. The route test covers tick and untick from a running
  start.
- **Damaged reads hide all items.** A plan with one unreadable row returns
  `items: []` and `damaged: true` - the panel shows the damaged state and
  the clear, not partial rows beside a warning, because a plan the reader
  cannot vouch for is not half-showable.
- **Route admission scope.** The brief does not say which scope `/api/plans`
  takes. The questions routes take `approval` because answering speaks for
  the person; ticking a plan does not, so the plan routes take `project`
  beside the conversation index. The scope test pins it.
- **The pill does not auto-open the panel** when a run writes a plan. The
  brief defines the pill as a disclosure control and nothing else; opening
  the rail under a typing person would be a second, unbriefed behaviour.
- **The plan tool's dependency is a merge-and-read returning the whole
  `PlanView`.** This keeps the damaged check in the tool (which owns its own
  error phrasing) and the writer attribution in the runtime closure (which
  knows the caller is the model).
- **`getPlan` is per conversation**, not a harness-wide list filtered
  client-side like the questions poll. Plans are per-conversation state and
  the damaged flag is per-conversation, so the read is per conversation; the
  pill and the panel each poll the conversation they show.
- **Vitest reporter.** The rules say run suites one at a time; nothing
  specifies a reporter. `basic` no longer exists in vitest 4, so the runs
  used the default reporter.

---

## 8. Git

No branch was created and no commit was made, on `main` or anywhere else -
the task overrode section 11, and the work is left in the working tree. No
file outside the task's scope was touched except `purge.test.ts` and
`conversations-store.test.ts`, whose fixtures needed the new (required)
`PurgeDependencies` field, and `running-mark.test.tsx`, whose render tree
needed `RailProvider` - neither test's assertions were changed.
