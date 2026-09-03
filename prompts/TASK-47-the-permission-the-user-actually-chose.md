# Task 47 - The permission the user actually chose

Studio can read a file and can do nothing else.

The reason is one line. `StudioRuntime` takes a `mode` callback, and `app.ts`
never passes one, so `this.#mode = options.mode ?? (() => "manual")` decides
every conversation forever. In Manual the kernel turns every default `ask`
into a real question, hands it to the approval broker, and the run parks on a
promise that nothing will ever resolve, because no surface in Studio has ever
asked a person anything.

Everything needed to fix that already exists and is already wired. This task
connects it and stores the one value it is missing.

---

## Part 0 - Confirm the machinery before changing it

Read these and confirm each, in the real code, before writing anything.

1. `src/permissions/mode.ts` - three modes, `manual` / `auto-edit` /
   `full-auto`, and `resolveAsk` resolves only a **default** `ask`, never a
   policy one.
2. `src/permissions/kernel.ts` around line 342 and 378 - the posture's
   `mode()` is consulted, and a missing approver refuses rather than allows.
3. `src/application/approval-broker.ts` - `request` parks a promise and writes
   a durable row first; `list` reads the store because it outlives a restart;
   `answer` and `cancel` settle it.
4. `src/transport/http/routes/permissions.ts` and its mount in
   `create-app.ts` - `GET /api/permissions/pending`,
   `POST /api/permissions/pending/:id`, `DELETE /api/permissions/pending/:id`,
   all behind the `approval` admission scope.
5. `src/application/studio-runtime.ts:306` - the hardcoded mode.

Two things moved under this task's feet after the brief was written, both
landed by Task 46. Read them before you plan:

- `createAgentSandbox` in the same file now grants `environment: { PATH }` to
  the agent sandbox, deliberately and only there. You will be editing the same
  function. Do not disturb that grant.
- `src/tools/gate.ts` grew an optional `resources` on a tool definition, and
  the gate now authorizes **every** resource a call names, in order, without
  stopping at the first refusal. One `shell` call with a chained command line
  therefore raises one question per program. Several pending approvals for a
  single tool call is now the ordinary case, not an edge case.

If any of the five is not what this brief says, stop and report. The rest of
the task assumes all five.

---

## Part 1 - The mode becomes a per-conversation value

The picker sits in the composer, beside the send button. It is a
per-situation consent, so it belongs to the conversation, not to the process
and not to a global setting.

**Storage.** The conversation index already carries `model_id` and
`reasoning_level` for exactly this reason. Add the permission mode the same
way: a new migration, appended, never an edit to an applied one. An unset
value means `manual`.

**Delivery.** `src/transport/http/middleware/turn-settings.ts` already solves
this problem once. It reads the submission body through a clone, validates the
fields, and writes them to the index **before** `next()` admits the run,
because the run's initializer reads the row. Extend that middleware and
`submissionTurnSettingsSchema` with the mode. Do not invent a second channel.

**Reading.** `app.ts` composes the runtime once for the process, but the mode
is per conversation, so `mode` cannot simply be a closure over one value.
Work out what the posture is actually asked during a run and make the answer
follow the conversation that run belongs to. Explain in the report how you
established which conversation the kernel is deciding for - measured, not
assumed. If it turns out the kernel genuinely cannot know, say so plainly and
propose the smallest honest alternative rather than guessing.

**Naming.** The frontend calls them `manual` / `edits` / `auto`. The harness
calls them `manual` / `auto-edit` / `full-auto`. The harness names are the
real ones. Do not rename them and do not translate silently in three places;
pick one boundary where the wire value is validated and reject anything else.

---

## Part 2 - The question reaches the user

`GET /api/permissions/pending` exists and polling it would work. Before
settling for that, find out what the conversation stream already does:
`application/harness-client.ts` names a `live: "sse"` channel and the webview
reads `?view=updates`. A permission question that arrives on the same channel
as the turn it belongs to is worth having, because the alternative is a UI
that discovers mid-turn silence by asking every second.

Decide, in the report, with the reason. Either answer is acceptable. An
answer with no evidence behind it is not.

Whatever you choose, the pending list must stay correct after a restart. The
durable row survives; the parked promise does not. A question inherited from a
dead process must still be answerable and must still leave the queue.

---

## Part 3 - Non-negotiable

**A mode never overrides a policy `ask`.** `mode.ts` states this as the
invariant and `resolveAsk` is only reached for the default. If your change
lets Full Auto proceed past a rule that says ask, it is wrong, however
convenient.

**Full Auto still requires undo.** `requiresUndo` exists and
`studio-runtime.ts:437` already reads it. Do not weaken that to make the mode
usable.

**No approver still means refuse.** The kernel's behaviour when nobody is
watching does not change.

**A refusal is not an error.** When a user denies, the tool call comes back as
a clean refusal the model can read and respond to, not an exception that kills
the run.

---

## Not this task

- The approval dialog itself. That is the frontend track, Task 48.
- Any change to `src/sandbox/`.
- The policy table in `BASE_POLICY`. What asks and what does not is settled.
- New tools, or changes to any tool's schema. Task 46 owns the tool surface
  and is running now; do not touch `src/tools/shell/` or
  `src/tools/filesystem/read.ts`.
- Grants and their durations. `answer` already carries `once` /
  `conversation` / `always` and the grant store already honours them.

---

## Verification

The proof is a real turn. With the harness running and a conversation in
Manual, ask Studio to write a file into its workspace. The write must stop, a
pending approval must appear on `GET /api/permissions/pending` naming the
capability and the resolved path, answering it `allow` must let the write
complete, and answering `deny` must produce a refusal the model reports rather
than a crash.

Then switch the same conversation to Auto Edit and repeat: the write proceeds
without a question, and a shell command still stops.

Show the actual request and response bodies. A test that mocks the broker
proves nothing about this task.

Run the two vitest suites one at a time.

---

## Rules

`Backend/`, `docs/`, `prompts/` and `report/` are read-only context. Never
`git checkout`, `switch`, `stash`, `reset`, `clean`, `commit` or `rebase`. No
`any`, no non-const `as`, no non-null `!`. UTF-8, no BOM, LF. No en-dashes,
smart quotes, curly apostrophes, ellipsis characters or emoji in source. Edit
by hand, never with a script. No green placeholder tests.

Report to `report/TASK-47-the-permission-the-user-actually-chose.md`, including
every place this brief was wrong. Task 38's section 9 is the standard.
