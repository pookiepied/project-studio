# Task 48 - The question Studio has to ask

The composer has a control called "What Studio may do" with three modes. It
changes a value in the workspace store and nothing else. There is no surface
anywhere in Studio that asks a person to approve anything, so in Manual - the
default - a run that wants to write a file waits for an answer that can never
arrive.

Task 47 makes the harness side real: the mode travels with the submission, and
a question that the kernel raises becomes a pending approval the webview can
read and answer. This task builds what the person sees.

**Read Task 47's report before starting**
(`report/TASK-47-the-permission-the-user-actually-chose.md`). It is done,
verified against the real code, and committed. It settles how the question
arrives, and that decision is an input here, not a choice to remake: **poll
`GET /api/permissions/pending`.** The conversation stream cannot carry the
question - Flue's chunk union is closed and the application has no way to
append to it - and the pending list is the only source that survives a
restart. Section 6 of that report has the evidence. Do not go looking for a
better channel.

This task is now the whole remainder of the permission system, not only the
prompt. When it is done, a person can pick a mode, see the question, answer
it, and watch a Full Auto turn work without being asked. Nothing about
permissions should be left over.

---

## Part 0 - What already exists

- `src/domain/permissions/modes.ts` - the three modes as data, with the
  wording already written. Its own docblock says the harness can own the real
  set later and no component changes when it does. That is now happening.
- `src/features/chat/composer/PermissionControl.tsx` - the picker.
- `src/stores/workspace/WorkspaceProvider.tsx` - where the chosen mode lives.
- `src/platform/harness/` - how the webview talks to the harness.

Confirm each before changing it, and confirm that no approval UI exists today.

---

## Part 1 - The mode reaches the harness

The picker's value has to be sent with the submission, alongside the model and
reasoning level that already travel that way. Follow whatever the existing
code does for those two; do not invent a parallel path.

The harness names the modes `manual`, `auto-edit`, `full-auto`. The frontend
calls them `manual`, `edits`, `auto`. Task 47 fixed one boundary where the
wire value is validated. Match it exactly. Concretely, confirmed in the
harness's real code:

- The submission body field is `permissionMode`, beside `modelId` and
  `reasoningLevel` (`src/contracts/agents.ts`,
  `submissionTurnSettingsSchema`).
- The only accepted values are `manual`, `auto-edit`, `full-auto`. Sending
  `edits` or `auto` is a 400 refusal, deliberately - the mode is a consent
  and the harness will not translate one name into another on the user's
  behalf. The translation belongs on your side of the boundary.
- The mode is stored per conversation, not per project, and is read at every
  permission decision. A conversation with no stored mode is Manual.
- `GET /api/conversations` now returns `permissionMode` on each record. The
  picker should show the conversation's real stored mode when a conversation
  is opened, not a value that only lives in React state - today the choice is
  lost on reload and shows Manual while the harness thinks otherwise.

---

## Part 2 - The prompt

When a run raises a question, the person answers it in the conversation, at
the point the turn stopped. This is not a dialog that floats over the app and
it is not the ask-a-question tool - it is consent for an action Studio is
already attempting.

It has to show, plainly, what is being asked for: the capability and the thing
it touches, in the same register as the rest of the product. "Write
`index.html` in this conversation's workspace" is the sentence; the capability
id is not.

The answer carries a verdict and a duration. The harness already accepts
`allow` or `deny`, with `once`, `conversation`, or `always`. Offer all three
durations. `always` is a real grant that outlives the conversation, so it must
read as the heavier choice it is.

While a question is open the turn is stopped. Make that legible - a composer
that looks ready to take another message while the run is parked is a lie
about the state.

**Design work is design work.** Read `src/design/RULES.md` and match what is
already there. This is a surface people will see on their first serious turn.

---

## Part 3 - The cases that are not the happy path

- **Denied.** The model receives a refusal and keeps going. The conversation
  shows what was refused. This is an ordinary outcome, not an error state, and
  it must not be styled as one.
- **Cancelled.** The user aborts the turn while a question is open. The
  pending approval is cancelled, `DELETE /api/permissions/pending/:id` exists
  for exactly this, and nothing is left waiting.
- **Inherited.** After a harness restart the durable question is still in the
  queue but the run that raised it is gone. Answering it must clear it from
  the queue without pretending the run resumed.
- **Several at once.** This is the ordinary case, not an edge case. Task 46
  made the gate authorize every program a command line names, each as its own
  `shell:<name>` resource, so `npm run build && node check.js` raises one
  question per program. Answering them one at a time, in order, is what the
  harness expects. Decide what that looks like when three arrive together and
  say why.

  It also fixes the wording: a program is approved **by name**, not by the
  path we resolved it to, so the sentence is "Run `npm`", and an `always`
  answer means that program from then on.

---

## Part 4 - The proof that the whole thing works

The three parts above are the mechanism. This part is the demonstration that
the permission system is finished, and it is the acceptance test for this
task.

**One real conversation, in Full Auto, that builds something.** Ask Studio to
create a small static website in its workspace - a few files, more than one
write. In Full Auto it must do the whole thing without asking a single
question, and the files must exist on disk afterwards. This is the thing the
user has never been able to do, and it is what "done" means here.

**Then the same request in Manual**, showing every write stopping and being
approved one at a time.

A note on what may block you: the shell tool currently fails on this machine
with exit code 3221225794 for every contained command, which is Task 50's
work and not yours. If Task 50 has landed by the time you run this, include a
command in the Full Auto run. If it has not, run the file-writing proof
without a command line, and **say plainly in the report which one you did and
why**. Do not fake a shell result, and do not report the permission system as
proven end to end if you could not run a command.

---

## Not this task

- Anything in `STUDIO HARNESS/`. The harness side is done and committed. If
  you find something genuinely missing there, report it - do not edit it.
  Task 50 is running in `STUDIO HARNESS/src/sandbox/` at the same time as
  you, and an edit of yours in that repository would collide with it.
- A delete tool. There is no way for the model to delete a file today, which
  is real and known, but it is a harness capability and it belongs to a
  separate task.
- A free-text reason attached to a denial. The approval API accepts a verdict
  and a duration and nothing else. Adding a message is a harness change.
- The ask-a-question tool. Different mechanism, different surface.
- Settings-level permission management, allowlists, or a grants viewer.
- Renaming or rewording the three modes. That copy is settled.

---

## Verification

Run the app and the harness together and take real turns. No mocked pending
approval anywhere in the evidence.

- **Manual**: the turn stops and asks; approving lets it finish and the file
  exists on disk; denying produces a conversation that continues and says
  what was refused.
- **Auto Edit**: the same request proceeds without asking.
- **Full Auto**: Part 4's build, start to finish, unattended.
- **Reload**: the picker still shows the mode the conversation is actually
  held with.

Screenshots of the prompt in the app, in both themes.

`pnpm test` and `pnpm lint` clean, and `cargo clippy --all-targets` with zero
warnings if anything under `src-tauri/` moves.

---

## Rules

`Backend/`, `docs/`, `prompts/` and `report/` are read-only context. Never
`git checkout`, `switch`, `stash`, `reset`, `clean`, `commit` or `rebase`. No
`any`, no non-const `as`, no non-null `!`. UTF-8, no BOM, LF. No en-dashes,
smart quotes, curly apostrophes, ellipsis characters or emoji in source. Edit
by hand, never with a script. No green placeholder tests.

Report to `report/TASK-48-the-question-studio-has-to-ask.md`, including every
place this brief was wrong.
