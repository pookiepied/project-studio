# TASK 48 - The question Studio has to ask

Brief: the permission system's last half - the picker's mode reaching the
harness, the question a person sees and answers in the conversation, the
cases that are not the happy path, and one real Full Auto build that proves
the whole thing works. This task built all four in STUDIO, and verified them
with real turns in the running desktop app against the real harness: a Full
Auto run that built a three-file website with zero questions, a Manual run
that stopped, was allowed once, and wrote its file; a denial the model
reported in words; a question cancelled by the stop control; a question that
survived a killed harness process and was answered by the new one; and a
reload in which every picker showed the mode its conversation is actually
held with. Screenshots of the prompt in both themes are in
`report/shots/TASK-48/`.

---

## 1. Part 0 - what existed, confirmed before anything changed

1. `src/domain/permissions/modes.ts` - the three modes as data, wording
   settled. Its docblock still said "the harness can own the real set later";
   that day had come, so the docblock now records the split: these ids are
   the webview's vocabulary, the harness names the same three
   `manual` / `auto-edit` / `full-auto`, the wire refuses the webview's
   spellings on purpose, and the translation lives exactly once at the wire
   boundary.
2. `src/features/chat/composer/PermissionControl.tsx` - read and wrote
   `settings.permission` only. Confirmed.
3. `src/stores/workspace/WorkspaceProvider.tsx` - where the chosen mode
   lived, as React state only. Confirmed.
4. `src/platform/harness/` - `client.ts` had no permission routes;
   `conversation.ts`'s `TurnSettingsWire` carried model and reasoning only.
   Confirmed.
5. **No approval surface anywhere.** A grep across `src/` for "permissions"
   and "pending" found only the two pickers (composer and Settings General),
   both writing `settings.permission` into memory. Nothing anywhere read
   `GET /api/permissions/pending` or answered a row. Confirmed before
   planning, as the brief demanded.

## 2. Part 1 - the mode reaches the harness

**One translation, at one boundary.** `platform/harness/contracts.ts` gains
`EXECUTION_MODES` (the harness's own list, mirrored from
`src/permissions/mode.ts`) and two translators built on two exhaustively
keyed `Record`s, `MODE_TO_WIRE` and `WIRE_TO_MODE` - a missing key on either
side is a compile error, so the two vocabularies cannot drift and no cast
was needed. `domain/` stays clean of `platform/` imports; the translation
runs at the store (wire record in, domain mode out) and at the wire builder
(domain mode in, wire value out), and nowhere else.

**The submission.** `TurnSettingsWire` gains `permissionMode` (optional:
absent means the conversation's stored mode stands, which is what a body
without it has always meant). `submitTurn` appends it beside `modelId` and
`reasoningLevel`, spelled as the harness names it. Every send path builds
the body through one new builder, `turnSettingsToWire(effective)`, so the
three places that send a turn - `ChatPage.sendTurn`, `StartConversation`'s
first turn, and `fork.ts`'s fork seed - cannot disagree about the
translation. `effectiveTurnSettings` now answers the mode too, under the
same rule as the model: the conversation's stored mode outranks the
window's.

**The index.** `ConversationRecord` carries `permissionMode` in the harness
vocabulary, and the hand-mirrored parser requires it - Task 47 made the
record schema non-null ("the store never hands back a null mode"), so a
record without the field is drift, and the mirror's stated doctrine is that
a visible refusal beats a silent misread. `conversationCreateSchema`'s
`permissionMode` rides along in `createConversation` (a repeat receipt is
the same write the admission path already made), and `ConversationPatch`
carries it - never null, because a mode is a consent with no "unset" state
to clear back to; the bottom of the ladder is Manual, a real answer.

**The store.** `mapRecord` translates the wire mode once, into the
`Conversation` type's new `permissionMode`. `beginConversation` carries the
first turn's mode into both the local record and the create draft.
`setConversationPermission` is its own method beside
`setConversationSettings` - the mode is a consent with its own control and
its own rate of change - and it writes through immediately: window settings
follow, the index is PATCHed, and the local row updates. That last point is
load-bearing and was proven live: the harness reads the stored mode at
every permission decision, so a picker change mid-run takes effect on the
very next ask.

**The picker.** `PermissionControl` now takes the conversation id from the
composer (null on home, the project page, and the gallery) and shows the
conversation's stored mode when one exists, falling back to the window's
otherwise. A choice with a conversation open goes to the index; a choice on
home stays a window setting that the first turn then carries.

## 3. Part 2 - the prompt

**The channel is the one Task 47 settled: poll `GET /api/permissions/pending`.**
`usePendingApprovals` (`features/chat/permissions/`) owns the poll. It reads
once immediately, then on two cadences: every second while a run is live or
a question is already on screen, every ten seconds while the conversation
merely sits open. The slow cadence is the reason the third case in Part 3
works at all - a question that outlived the harness process that raised it
must be visible without any run anywhere. A failed read keeps the last
known rows: "the harness is down" is not the same fact as "nothing is
asked", and the durable queue does not stop existing because the process
holding it did. The hook filters rows by
`request.scope.conversationId === "conversation:<id>"`, the same scope Task
47 pinned in its integration test, so a question renders in the conversation
that raised it and nowhere else.

**The client.** `listPendingApprovals`, `answerApproval`,
`cancelApproval` live on the administration client (`client.ts`) beside the
other `/api` routes - the list is harness-wide, each row naming its
conversation - and the workspace store exposes them bound to its own
client, so a harness restart, which replaces the client, is survived by the
next call rather than by a captured object.

**The wire parser.** `parsePendingApprovals` mirrors one row of what
`broker.list()` answers, reading only what the prompt renders: the
capability's namespace, name and title; the resource (absent reads as null,
because `JSON.stringify` drops an `undefined` resource key entirely); the
scope ladder as offered; the decision's source and reason. Everything else
stays on the wire side - a parser that rebuilt the full descriptor would
refuse rows it could have shown, and a parked run is the one state this
mirror must not make harder to see.

**The sentence.** `domain/permissions/question.ts` is the one place the
kernel's vocabulary becomes a sentence. It derives the kind of thing touched
from the scope ladder the kernel itself offered (`this-command` means a
command line, `this-file` a path), then says what is asked in the product's
register:

- `native/write` on a path: **Write `index.html` in this conversation's
  workspace.**
- `native/shell` on `shell:npm`: **Run `npm`.** - the program approved by
  name, never the path it was resolved to.
- `native/git` on `git:push`: **Run `git push`.**
- anything the table has not met: the harness's own capability title, with
  the resource in parentheses when it has one.

The capability id is never shown. The kernel's `reason` is shown verbatim
only when the ask came from `source: "policy"` - third-party code and git
reaching the network survive every mode, and that is the one explanation a
person in Full Auto cannot derive from the sentence. A default ask's reason
("has not been approved yet") is the question restated and is left off.

**The card.** `ApprovalPrompt` renders in the conversation, between the
transcript and the composer - in the flow, at the point the turn stopped,
not a dialog floating over the app and not the ask-a-question tool. It
carries the sentence, the three durations as a segmented control -
`Just once`, `This conversation`, `Always`, with the narrowest selected
first so a hurried Enter grants the smallest thing on offer - and Deny
(ghost) beside Allow (primary). `always` earns its weight in copy:
"Studio keeps allowing this without asking, in this conversation and in
later ones." The card takes the composer's own multiline radius and shadow
step, so it and the field read as one family of objects resting on the same
surface; inline code wears the same mono face the transcript's code wears.
While an answer is in flight both buttons disable, the clicked one shows
its busy state, and a refusal from the harness leaves the row for the next
poll to reconcile - which is also what catches the race where another
window answered first.

**The parked state is legible.** The composer keeps its stop control (the
turn is still running, parked), and its placeholder changes to "Waiting for
your answer above" for exactly as long as a question is open for this
conversation - a field that invites a new message while the run waits on
you is the lie the brief named, and it does not happen. When the queue
clears, both revert, on the poll's own cadence (at most a second while
busy).

**Deny is not styled as an error.** It is a ghost button at the calm weight
every secondary control carries, and answering it closes the card like any
other answer; the refusal the model receives is the conversation's ordinary
content, shown by the transcript the way every tool run is shown.

## 4. Part 3 - the cases that are not the happy path

- **Denied.** Measured twice. The model received the refusal ("You declined
  this action." on the wire), kept going, and said what happened in words:
  "The attempt to write the file `denied-demo.md` was refused because the
  action was declined." - and, on the second conversation, "The request to
  write the file `light-demo.md` was declined." No file appeared on disk,
  the queue emptied, the run settled completed. The transcript renders the
  refused call as an ordinary `Wrote 1` run, not an error state.
- **Cancelled.** The stop control aborts the run, and `ChatPage`'s stop
  handler also withdraws every question the conversation has pending
  (`DELETE /api/permissions/pending/:id`, the route that exists for exactly
  this; a cancel on an already-cleared row is an honest 404). Measured: the
  durable row was gone within a second of the stop, the run aborted
  ("The turn was aborted before it finished." in the transcript), nothing
  was left waiting, and the workspace held only the file the user had
  allowed. The belt-and-braces DELETE exists because the abort signal the
  kernel hands the approver usually clears the row first - but the UI does
  not depend on having heard that signal.
- **Inherited.** Measured harder than the brief asked, by killing the
  harness process (pid 13020, `taskkill /F`) while a question was open. The
  supervisor spawned a replacement within two seconds; the durable row was
  still in the queue; the same card kept showing it, read through the
  rebuilt client, with no run anywhere. Answering it cleared the queue via
  the broker's inherited-row path (`#settle` with no live waiter) - and
  said nothing about a run resuming, because none had. What happened next
  was the harness's own doing, recorded because it is the truth of this
  machine: Flue's workflow recovery RESUMED the interrupted run in the new
  process, which re-raised the ask under a new id; the same prompt served
  it, and the deny refused the resumed run, which settled with the model's
  own account ("The request to write `inherited-demo.md` was also
  declined."). Two answers, two rows cleared, no file written, nothing
  pretended.
- **Several at once.** Measured in the harness code before designing: the
  gate (`tools/gate.ts`) awaits `kernel.authorize` for each resource a call
  names, in the order the command line names them, so a live run parks on
  ONE question at a time - `npm run build && node check.js` asks for
  `shell:npm`, and only after an answer asks for `shell:node`. Queues of
  several are therefore real but arise from inherited rows or parallel
  calls, not from one command line. The UI answers in the order the
  harness expects anyway: rows render oldest first (the order the harness
  raised them, `createdAt` then id for ties), the oldest is the active card
  with the controls, and the rest are named beneath it in a single quiet
  line ("Also waiting, one at a time: ..."), with no controls of their own.
  Answering the active one removes it; the next becomes active. One at a
  time, in order, is what the surface shows even when the queue is longer
  than one.

## 5. Part 4 - the proof, run live

All of it in the real desktop app (`pnpm tauri dev`), against the real
harness (`STUDIO HARNESS/dist`, rebuilt at the tip of Task 47's commit - see
section 9, point 6) and the user's real home, with the model
`openrouter/google/gemini-3.5-flash` at reasoning `high` (why: section 9,
point 5). Every claim below was checked against the durable store
(`studio.db`) and the workspace on disk while the runs were live, not from
screenshots alone.

- **Full Auto, unattended.** Conversation `cnv_9n5z0unx`, admitted with
  `permission_mode: "full-auto"` settled by the submission itself. The
  request: build a small static website. The run thought, wrote, and
  finished with the pending queue at zero questions raised **at every
  poll during the run** - `index.html` (1,553 bytes), `styles.css`
  (1,316 bytes) and `about.html` (1,190 bytes) exist on disk in the
  conversation's workspace, linked to each other and to the stylesheet,
  and the model's final text describes all three. The person was never
  asked. This is the thing the user has never been able to do.
  **No command line was in this run, deliberately and stated plainly: the
  shell tool still fails on this machine with exit 3221225794 for every
  contained command, which is Task 50's work (its sandbox edits were still
  uncommitted at verification time). Per the brief's own instruction, the
  proof ran as a file-writing build without a command line, and the
  permission system is therefore proven for native/write - not for a
  shell line under Full Auto.**
- **Manual, approve.** Conversation `cnv_x4pxzibf`, `manual`. The write of
  `permission-demo.md` parked; the prompt appeared in the conversation
  ("Write `permission-demo.md` in this conversation's workspace.");
  "Just once" + Allow; the run woke, wrote the file with the exact
  requested content ("written under manual approval."), the queue emptied,
  and no grant row was stored (`permission_grant` stayed empty - "once"
  stores nothing, as designed).
- **Manual, deny.** A second write (`denied-demo.md`) parked; Deny; the run
  continued and reported the refusal in words; the file does not exist.
- **Cancelled.** A third write (`cancelled-demo.md`) parked; the stop
  control; queue empty within a second, run aborted, no file.
- **Auto Edit.** The same conversation switched mid-flight through the
  picker to Accept edits - the PATCH landed in the index
  (`permission_mode: "auto-edit"`) the moment the pick was made - and the
  next write (`autoedit-demo.md`) completed with the queue at zero, in
  about eight seconds, no question. The model reported the file written.
- **Reload.** The app was closed and relaunched. The Full Auto
  conversation's picker reads "Full auto"; the Manual-to-Auto-Edit
  conversation reads "Accept edits" - both from the index, not from React
  state. Before this task a reopened conversation showed whatever the
  window happened to hold.
- **Inherited, live.** Section 4 above: harness killed under an open
  question, answered by the replacement process through the same surface.

**Screenshots.** `report/shots/TASK-48/prompt-dark.png` and
`prompt-light.png` - the prompt in the app, in both themes, each showing
the sentence, the three durations, Deny/Allow, and the composer saying
"Waiting for your answer above" under the stop control.

## 6. Test suites

- **STUDIO `pnpm test`** (vitest): **445 passed / 0 failed** across 47
  files (was 427 before this task; the growth is this task's tests). New:
  `domain/permissions/question.test.ts` (the sentence: write, edit, shell
  by name, git subcommand, fallback title, policy-only reason),
  `domain/session/settings.test.ts` (the mode's stored-overrides-window
  rule), parser cases for the pending list and the mode translation, the
  submission body carrying `permissionMode` in the harness vocabulary and
  omitting it when the stored mode stands, and the conversation record
  refusing a mode that is missing or in the webview's spelling.
- **`pnpm typecheck`**: clean.
- **`pnpm lint`**: see section 9, point 1 - there is no lint script in
  STUDIO.
- **`cargo clippy --all-targets`**: not run - nothing under `src-tauri/`
  moved, and the brief makes it conditional on exactly that.
- Fixture updates, all of the same assertion-bearing kind (no green
  placeholders): the conversation-record fixtures in
  `index-contracts.test.ts` and `TurnMenu.test.tsx` gained the now-required
  `permissionMode`; the `Composer.test.tsx` store stub and the
  `useProviders.test.ts` client stub gained the new surface; the
  `running-mark.test.tsx` conversation gained the field the type now
  carries.

## 7. What was built, file by file

- `platform/harness/contracts.ts` - `EXECUTION_MODES`, the two
  translators, the record field + parser requirement, create/patch fields,
  the pending-approval wire types and `parsePendingApprovals`.
- `platform/harness/conversation.ts` - `TurnSettingsWire.permissionMode`,
  `EffectiveTurnSettings`, `turnSettingsToWire`, the submission body.
- `platform/harness/client.ts` - the three approval methods and the mode
  on create/update.
- `domain/permissions/modes.ts` - docblock records the vocabulary split.
- `domain/permissions/question.ts` - the sentence mapping (new).
- `domain/session/types.ts`, `settings.ts`, `gallery/index.ts` -
  `Conversation.permissionMode`, the derivation, the fixture.
- `stores/workspace/WorkspaceProvider.tsx` - mapping, write-through,
  `setConversationPermission`, `approvals`.
- `features/chat/permissions/usePendingApprovals.ts` + `ApprovalPrompt.tsx`
  (new) - the poll and the card.
- `features/chat/ChatPage.tsx` - wiring, stop-withdrawal, placeholder,
  send path. `composer/Composer.tsx` - passes the conversation id.
  `composer/PermissionControl.tsx` - conversation-aware.
  `composer/StartConversation.tsx`, `features/chat/fork.ts` - the other
  two send paths through the one wire builder.

Nothing under `STUDIO HARNESS/` was edited. `src-tauri/` untouched.

## 8. Left behind, on purpose

- The user's two pre-existing inherited questions (`cnv_1j04nco6` write of
  `index.html`, `cnv49_rename` `shell:ls`) are still in the durable queue.
  They predate this task, belong to dead harness processes, and are the
  user's data; the idle poll now makes them answerable in their own
  conversations. Task 47 left them too.
- `STUDIO HARNESS/dist/` was rebuilt from the committed tip (Task 47's
  commit, `b70e2e6`) and left in place - the desktop supervisor runs that
  build, and it is an untracked build artifact, not a source edit. Task 50
  will rebuild it when its sandbox work lands; the source tree it left was
  not touched.
- The verification conversations remain in the sidebar (Full Auto site,
  the Manual demos, the light-theme demo) - they are the run log of this
  report, named by their own first messages.

## 9. Every place this brief was wrong, and what the work found

1. **"`pnpm test` and `pnpm lint` clean" - there is no lint script.**
   STUDIO's `package.json` has no `lint` (and no eslint config anywhere in
   the repo); the verified gates are `pnpm test` and `pnpm typecheck`, both
   clean. Reported because a brief asking for a gate that does not exist
   would otherwise read as an unrun one.
2. **The record side of the mode needed a decision the brief did not
   name.** The brief said Task 47 fixed "one boundary where the wire value
   is validated" (the submission) - true, but Task 47 also made the
   conversation record's `permissionMode` non-null, which forces the
   hand-mirrored parser to require it. A parser that tolerated a missing
   mode would have had to invent what the conversation is held with; it
   refuses instead, which is the mirror's own doctrine made concrete.
3. **"Several at once" is real but rarer than the brief implies.** The
   gate awaits each resource's authorization in sequence, so a live run
   surfaces one question at a time even for `a && b && c`. Queues of
   several come from inherited rows or parallel calls. The design answers
   both with the same queue UI; the reasoning is in section 4.
4. **The brief's Part 4 model did not work out of the box.** The first
   Full Auto attempt failed with a 400 - "Reasoning is mandatory for this
   endpoint and cannot be disabled." - because OpenRouter had routed
   `gemini-3.5-flash` to a groq-hosted endpoint that refuses the provider's
   own default reasoning. Setting reasoning to `high` (the combination
   Task 47's report used for the same reason) fixed it. The defect is in
   model serving, predates this task, and is not permission work; named,
   not fixed.
5. **The brief's "the run that raised it is gone" is only half the
   restart story on this machine.** The durable row survives - that part
   held exactly - but Flue's own recovery resumed the interrupted run in
   the replacement process, which re-raised the ask under a new id. The UI
   served both rows through the same surface; the first answer cleared the
   inherited row without claiming a resume, and the second drove the
   actually-resumed run to a settled refusal. The harness-side resume is
   existing behavior, not something this task added or changed.
6. **The harness `dist/` the supervisor runs had to be rebuilt, and the
   working tree could not be trusted for it.** The old `dist` predated
   Task 47's commit (no `permissionMode` in it at all), and Task 50's
   sandbox edits were sitting uncommitted in `src/` while this task ran.
   The build was therefore made from the committed tip via `git archive`
   into a temporary directory and copied over the untracked `dist`
   artifact - no harness source file was read into the build, and none was
   touched. Scratch build directory removed afterwards.
7. **The brief's screenshots ask was met, with one addition for honesty:**
   the two captures show the composer's "Waiting for your answer above"
   state too, because the parked composer is part of what this task
   designed and is half the legibility claim.

## 10. Not done, per the brief

Nothing in `STUDIO HARNESS/` (Task 50 owns `src/sandbox/` and more was in
flight); no delete tool; no free-text denial reason (the API takes a
verdict and a duration and nothing else); no ask-a-question tool surface;
no settings-level permission management, allowlists, or grants viewer; no
rewording of the three modes. The scope ladder the kernel offers is parsed
but not offered as a choice in the prompt: an answer without a `scopeId`
resolves server-side to the narrowest rung, which keeps every grant as
small as the kernel displayed and leaves a scope picker for a task that
asks for one.

Nothing was committed; no scratch files remain.
