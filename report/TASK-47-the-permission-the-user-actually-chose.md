# TASK 47 - The permission the user actually chose

Brief: Studio could read a file and do nothing else, because `StudioRuntime`
took a `mode` callback that `app.ts` never passed, so
`this.#mode = options.mode ?? (() => "manual")` decided every conversation
forever. This task made the mode a per-conversation consent - stored in the
conversation index, settled at admission beside the model and reasoning
level, and read by the posture at the exact place and moment the kernel asks
for it - and verified the whole loop with real turns against the built
harness: a Manual write parks on `GET /api/permissions/pending`, an allow
completes it, a deny comes back as a refusal the model reports, and the same
conversation switched to Auto Edit writes without a question while a shell
line still stops.

---

## 1. Part 0 - the machinery, confirmed in the real code

All five claims held. Line numbers drifted in two places; noted in section 9.

1. **`src/permissions/mode.ts`** - three modes (`manual` / `auto-edit` /
   `full-auto`, lines 17-27), and `resolveAsk` (lines 74-85) resolves only a
   default `ask`. The invariant is written twice in the file: the docblock
   ("modes widen the default, never the policy") and the call site's own
   comment.
2. **`src/permissions/kernel.ts:342`** - `const mode = this.#posture.mode();`
   inside `evaluate`, reached only after every policy rule has been consulted
   and returned `undefined`, and only for the default verdict (lines 335-352).
   **`kernel.ts:378`** - `if (!capability || !this.#approver)` throws
   `approval_required`: a missing approver refuses rather than allows.
3. **`src/application/approval-broker.ts`** - `request` writes the durable
   row before the caller parks (lines 76-88); `list` reads the store, "the
   source of truth precisely because it outlives a restart" (lines 99-107);
   `answer` and `cancel` settle through `#settle` (lines 125-139), which
   closes a row this process inherited from a dead one.
4. **`src/transport/http/routes/permissions.ts`** - `GET /pending`,
   `POST /pending/:id`, `DELETE /pending/:id`, every route behind
   `requireAdmissionScope(ADMISSION_SCOPES.APPROVAL)` (line 48); mounted at
   `/api/permissions` in `src/transport/http/create-app.ts:81`.
5. **`src/application/studio-runtime.ts`** - the hardcoded mode. The brief
   said line 306; it is line 308 (`this.#mode = options.mode ?? (() =>
   "manual")`), same line, drifted by two.

The two things Task 46 moved, both confirmed before planning:

- `createAgentSandbox` grants `environment: { PATH: process.env.PATH ?? "" }`
  to the agent sandbox's policy, deliberately and only there
  (`studio-runtime.ts:467-477` at task start). Untouched; the lines are
  byte-identical after this task.
- `src/tools/gate.ts` grew optional `resources` on a tool definition (lines
  34-35) and authorizes every resource a call names, in order, without
  stopping at the first refusal (lines 262-292). `shell/index.ts:187` maps a
  command line to one resource per program.

## 2. Storage - migration 17

`conversation.permission_mode TEXT`, appended as version 17
(`src/storage/migrations.ts:775-791`), never an edit to an applied one.
Nullable on purpose: the absence of a stored answer IS Manual. A mode is a
consent, so a row written before this column existed records no consent -
backfilling would rewrite a decision nobody made, and writing "manual" at
insert would make an unset row indistinguishable from one the user looked at
and left alone. The reader maps null - and any value that no longer parses -
to Manual (`src/conversations/store.ts`, `toExecutionMode`), the same shape
the reasoning level's reader uses for an unreadable choice, pointed the safe
way: a corrupted answer must never widen what a run may do.

## 3. Delivery - the one channel there already was

`submissionTurnSettingsSchema` (`src/contracts/agents.ts:63-68`) gains
`permissionMode: v.optional(executionModeSchema)`, and the turn-settings
middleware writes it to the index on the way in, before `next()` admits the
run - on the create path (`turn-settings.ts:136-146`) and the patch path
(`turn-settings.ts:161-175`). No second channel was invented; a first send
the harness refuses still creates nothing, and a submission carrying an
invalid mode is refused with a 400 before admission rather than translated.

The conversation index contracts carry the mode the same way the model does:
`conversationRecordSchema` (non-null - the store never hands back a null
mode), `conversationCreateSchema`, and `conversationPatchSchema`
(`src/contracts/conversations.ts:60, 91, 116`). The webview's hand-mirrored
parser (`STUDIO/src/platform/harness/contracts.ts:845`) reads known fields
only, so the new response field is ignored until Task 48 reads it.

## 4. Reading - the mode follows the conversation, measured

**What the posture is actually asked during a run.** Exactly two consumers:

1. The kernel: `evaluate` calls `this.#posture.mode()` per decision
   (`kernel.ts:342`), through the `posture({ mode, trust })` built inside
   `createAgentSandbox` (now `studio-runtime.ts:546`).
2. The undo requirement: `TurnSnapshots`' `required: () => mode() ===
   "full-auto"` (now `studio-runtime.ts:537`), read at capture time.

Both consumers live inside `createAgentSandbox` - the only place in `src/`
that constructs a `PermissionKernel`, and a function whose options carry
`conversationId` (`StudioAgentSandboxOptions`, required without a default).
So the fix is one closure over the value the function already has:

```ts
const mode = (): ExecutionMode => this.#conversationMode(options.conversationId);
```

reading the conversation's row at each ask, defaulting to Manual for a
conversation the index does not know (`studio-runtime.ts:420-423`). The
process-wide `mode` option and the `#mode` field are deleted, not kept as
dead surface; `app.ts` never passed one and nothing else did either (three
integration tests construct the runtime without it and fall back to Manual,
as before).

**How I established which conversation the kernel is deciding for -
measured, not assumed.** Three legs:

1. Structural: `grep` shows one `PermissionKernel` construction in `src/`,
   inside `createAgentSandbox`; the caller is `agents/studio.ts:107-114`,
   which passes `conversationId: "conversation:${id}"` from the initializer's
   `{ id }` - and `agents/studio.ts`'s own comment records that `id` is the
   agent *instance*, one per conversation thread, "measured rather than
   assumed" there already. Every `gate.call` from that sandbox carries the
   same id in its scope.
2. Measured live: the pending approval raised by the Manual turn (section 8)
   carries `request.scope.conversationId = "conversation:cnv47man-mtg9waar"`
   - the conversation the turn was submitted to. The kernel does not guess
   whose decision it is making; the scope on the request it publishes names
   the conversation.
3. Pinned in a test: `tests/integration/conversation-mode.test.ts` asserts
   the pending row's scope conversation id, for a Manual row and against a
   sibling conversation's own mode.

The ambient alternative exists and was rejected for cause:
`src/execution/context.ts` carries `flueConversationId` in an
AsyncLocalStorage, but it is observability plumbing - populated where Flue's
interceptors run, and nothing on the kernel path guarantees a context is
entered. The kernel instance itself being per conversation is stronger: it
cannot answer for any other conversation, with no ambient state to forget.

One caveat stated rather than hidden: the snapshots entry is keyed per
workspace root and reused across runs. Today every conversation's workspace
root is its own (`agents/studio.ts` passes the conversation's directory;
nothing passes `projectId`), so one entry is one conversation and the
per-conversation `required` closure is exact. If a shared project root ever
makes the map's key wider than a conversation, `required` has to move with
the caller, because Full Auto's undo guarantee is per write, not per store;
the comment at the closure says so.

## 5. Naming - one boundary, harness names

The wire value is validated in one place against one list:
`executionModeSchema = v.picklist(EXECUTION_MODES)` (`mode.ts:59`), built
from the same constant `resolveAsk` reads, so the vocabulary cannot drift
from the vocabulary the kernel acts on. It is `manual` / `auto-edit` /
`full-auto` at the submission boundary, at the conversation create and patch
boundaries, in the stored column, and in the record the API returns.
Anything else is refused - the middleware's 400 for a mode outside the three
names is covered by test, including the frontend's own `edits` spelling,
which must not be silently accepted there. Whatever labels the picker shows
is Task 48's business, on the frontend's side of this boundary.

## 6. Part 2 - how the question reaches the user: poll the pending list

**Decision: `GET /api/permissions/pending` polling. Not the conversation
stream. The stream cannot carry the question, and making it carry one would
mean patching Flue.** The evidence, from `@flue/runtime@1.0.0-beta.9` as
installed:

- The `?view=updates` protocol is a closed union of nine chunk types -
  `conversation-reset`, `message-appended`, `message-started`,
  `message-delta`, `tool-input`, `tool-output`, `tool-output-error`,
  `message-completed`, `submission-settled`
  (`node_modules/@flue/runtime/dist/internal.d.mts`, `ConversationStreamChunkBody`),
  with the protocol's own sentence: "The canonical record schema is never
  exposed; these chunks describe only UI-relevant conversation operations."
- The runtime's public API has no way for the application to append a chunk
  into an agent conversation stream. The only subscription surface is
  `observe()`, explicitly in-isolate: it "does not replay durable workflow
  history nor aggregate events across processes". There is no publish.
- The webview's mirror (`STUDIO/src/platform/harness/conversation-chunks.ts`)
  parses that fixed union; an unknown chunk type survives as a fact carrying
  only its position - so even a hand-injected question chunk would render
  nothing without a third mirror change in the same change.

Injecting the question into the stream would therefore mean patching
`@flue/runtime` a fourth time to widen a schema its authors deliberately
closed, plus rewriting the webview mirror to parse a chunk the harness does
not own. The pending list needs none of that, and it has a property the
stream could not match honestly: `broker.list()` reads the durable store
(`approval-broker.ts:100`), which is exactly the state that survives a
restart - so the poll answer and the crash-recovery answer are the same
answer from the same source, with no second representation to reconcile.

The cost is stated rather than waved away: the poll runs while a question
may be open, which is while a run is live - the webview knows when it is
attached to a live run, so the cadence is Task 48's to choose and the
endpoint is one SELECT over a table that is empty nearly always.

**Restart correctness, held on both paths.** The durable row is written
before the caller parks; `#settle` closes an inherited row (whose waiter is
gone) and removes it from the queue, reporting `true` so a UI that actioned
it does not keep showing it. Proven twice: in the integration suite
(`tests/integration/conversation-mode.test.ts`, "a question inherited from a
dead process stays answerable and leaves the queue") and live in section 8,
twice over - the verification's copied database surfaced two real questions
inherited from the user's own dead harness processes, both cancellable, and
the scenario's own SIGKILL left a question that a restarted harness listed
under the same id and closed on request.

## 7. Part 3 - the non-negotiables, checked

- **A mode never overrides a policy ask.** Nothing in this task touches
  `evaluate`'s order; `resolveAsk` remains reachable only for the default
  verdict. The Auto Edit live turn proved it from the other side: `shell`
  declares `execute`, the effect table marks that elevated
  (`contracts/effects.ts:126-130`), and the shell question was still raised
  in Auto Edit. The integration suite pins it ("in Auto Edit a write proceeds
  without a question, and a shell line still stops"), and
  `tests/unit/trust-and-modes.test.ts` ("what a mode may not do") passes
  unchanged.
- **Full Auto still requires undo.** `required` reads `requiresUndo`'s
  meaning through the same effect table (`mode() === "full-auto"`), now
  per conversation. Nothing weakened.
- **No approver still means refuse.** `kernel.ts:378` is untouched; the
  integration suite exercises it (the shell call in Auto Edit, with the
  question cancelled, refuses with a `denied` PermissionError rather than
  proceeding).
- **A refusal is not an error that kills the run.** Measured, not assumed:
  the denied tool call came back as an error tool result the model read, and
  the model answered in words. Section 8, turn 2.

## 8. Verification - real turns against the built harness

`dist/server.mjs`, rebuilt at the tip of this task, run as its own process
with `PROJECT_STUDIO_MODEL_SOURCE=local`, a temporary Studio home, and a copy
of the user's real database (so the real OpenRouter connection resolved; the
OS keyring holds the key, not the home). Every request below is real HTTP
with a Bearer admission token. Model: `openrouter/google/gemini-3.5-flash`,
reasoning `high` - the combination the user's own working conversations used
today (why not the manually-added `z-ai/glm-5.3-flash`: section 9, point 5).

**Step 0 - the queue on a fresh start.** The copied database listed two
questions inherited from dead processes (the user's own: a `native/write`
for `cnv_1j04nco6`, a `native/shell` `shell:ls` for `cnv49_rename`), each
cancelled over the API with 204 - the restart path, working before any of
this task's scenarios ran. After cleanup: `pending: []`.

**Turn 1 - Manual, allow.**

```
POST /agents/studio/cnv47man-mtg9waar
  {"message":"Use the write tool to create a file named permission-demo.txt
   in your workspace with exactly this content: 'written under manual mode
   after approval'. Then reply with the word done.",
   "modelId":"openrouter/google/gemini-3.5-flash",
   "reasoningLevel":"high","permissionMode":"manual"}
-> 202 {"streamUrl":"http://127.0.0.1:64768/agents/studio/cnv47man-mtg9waar",
        "offset":"0000000000000000_0000000000000000",
        "submissionId":"23565bc4-9912-4de4-b45b-dcc17580f4dd"}
```

The run stopped. `GET /api/permissions/pending` answered:

```
[{"id":"8f24a9b3-c543-4bd4-b7c7-ae06be210bb7",
  "request":{"capability":{"id":{"namespace":"native","name":"write"},
             "title":"Write file","effects":["write"],...},
             "scope":{...,"agentId":"studio",
                      "conversationId":"conversation:cnv47man-mtg9waar",...},
             "resource":"C:\\Users\\pooki\\AppData\\Local\\Temp\\
                studio-task47-1788122377602\\data\\conversations\\
                cnv47man-mtg9waar\\workspace\\permission-demo.txt",
             "scopes":[{"id":"this-file",...},{"id":"this-folder",...}]},
  "decision":{"verdict":"ask","source":"default",
              "reason":"native/write has not been approved yet."}}]
```

The capability, the resolved path, and the conversation it belongs to - all
three named, as the brief demanded. File before answer: `false`.

```
POST /api/permissions/pending/8f24a9b3-... {"verdict":"allow","duration":"once"}
-> 204
```

The parked run woke: the model called `write` with exactly the requested
content, the file existed on disk after settlement, the queue was empty, and
the model's final text was `done`.

**Turn 2 - Manual, deny.** Same conversation, submission body carries only
the message - the stored settings stand, mode included.

```
POST /agents/studio/cnv47man-mtg9waar (no settings keys) -> 202
  submissionId ab7a8ddc-30a3-4e8d-8874-48fb432c22ef
  offset 0000000000000000_0000000000000012
```

A second question, for `denied-demo.txt` (id `1a4e24fb-9757-4c6e-9cfc-...`),
answered:

```
POST /api/permissions/pending/1a4e24fb-... {"verdict":"deny","duration":"once"}
-> 204
```

The durable journal records the refusal the loop handed the model:

```
tool_outcome {"toolName":"write","isError":true,
              "content":[{"type":"text","text":"You declined this action."}]}
```

and the model's own report, in its final text: **"The write did not happen
because the action was declined."** The run settled `completed` - no crash.
The file does not exist; the queue emptied.

**Turn 3 - the same conversation, Auto Edit.**

```
POST /agents/studio/cnv47man-mtg9waar
  {"message":"Use the write tool to create a third file named autoedit-demo.txt
   ...","permissionMode":"auto-edit"}
-> 202
```

The write completed with the pending queue at length 0 - the file appeared,
nobody was asked, the model said `done`, and `GET /api/conversations` now
reports the conversation's `permissionMode` as `"auto-edit"` (the wire value
the middleware settled, round-tripped through the record).

**Turn 4 - Auto Edit, a shell line still stops, and the question survives a
restart.** Asked to run `node --version`; the queue answered
`native/shell` / `"shell:node"` (id `b15b4a33-6223-4359-87f8-...`). The
harness process was killed with SIGKILL while the question was outstanding;
a restarted harness listed the same row under the same id;
`DELETE /api/permissions/pending/b15b4a33-...` returned 204 and the queue
emptied; the recovered run raised nothing further within 5s and was aborted
cleanly (`{"aborted":true}`).

## 9. Every place this brief was wrong, and what the work found

1. **Line numbers had drifted.** The hardcoded mode is at
   `studio-runtime.ts:308`, not 306; the `requiresUndo` read the brief cites
   at 437 was at 491 at task start (and is at 537 after this task's edits).
   Substance unchanged.
2. **"Add the permission mode the same way" - the same way, minus the null.**
   `model_id` and `reasoning_level` both clear to null, because both have a
   default to clear to. The mode's bottom is Manual, a real answer, so the
   column is nullable but the record never reads as null: an unset row IS
   Manual, and a fourth wire state (a mode that is "cleared") would be a
   state with no meaning. Deliberate, stated at the schema, the store, and
   the patch path.
3. **The brief's Part 2 framing undersold the stream problem.** "Before
   settling for that, find out what the conversation stream already does" -
   what it does is a closed, nine-type union the application cannot append
   to, by the runtime's own documented design. The poll is not the
   convenient answer; it is the only answer that does not patch Flue, and it
   is the one whose answer survives a restart by construction.
4. **Appending migration 17 broke one existing test, for the reason that
   test was written to catch.** `tests/unit/provider-merge.test.ts` pinned
   `user_version: 16` as "the migration ran fully". The pin is replaced with
   `MIGRATIONS.length` (already imported there), which is the same assertion
   without a literal every append would break. Reported because it is a
   change to an existing test, not a green placeholder: the assertion still
   fails if migrations stop running.
5. **The model the brief's verification assumed is currently unusable, in
   the user's own hands, not only mine.** `openrouter/z-ai/glm-5.3-flash`
   (the manually-added pick) refuses `reasoningLevel: "default"` outright
   ("Reasoning is mandatory for this endpoint and cannot be disabled") and,
   at every level that is accepted, stops with `stopReason: "length"` after
   one output token; the user's own latest conversation with it failed the
   same way (`stopReason: "error"`, 0 tokens, in the real journal). The live
   verification therefore used `openrouter/google/gemini-3.5-flash` +
   reasoning `high`, the combination the user's working conversations used
   today. Named, not fixed: the model-serving defect predates this task and
   is not permission work.
6. **The brief's step 0 ("GET /api/permissions/pending on a fresh start")
   is only empty for a fresh home.** A real home can legitimately hold
   unanswered questions from a dead process - this one held two. The
   invariant is not "the queue starts empty"; it is "every row is
   answerable and leaves the queue when answered", which is what was
   demonstrated.

Not done, per the brief: the approval dialog and any webview change (Task
48); `src/sandbox/` (untouched); `BASE_POLICY`; tool schemas and
`src/tools/shell/` and `src/tools/filesystem/read.ts`; grants and their
durations. Scratch verification files were removed; nothing was committed.

## 10. Test suites, run one at a time

- **HARNESS** (`pnpm typecheck` clean; `pnpm test` = build + `vitest run`):
  **1434 passed / 11 failed / 25 skipped** across 99 files. Of the 11: nine
  in `tests/unit/tools/shell.test.ts` and one in
  `tests/integration/mcp-flue.test.ts` are the documented environmental
  refusal - this host has not had the one-time
  `pnpm sandbox:prepare "C:\Users\pooki"`, so the AppContainer refuses every
  contained child (exit code 3221225794 = 0xC0000022); Task 46's report
  records the same machine state, and `tests/integration/sandbox-bwrap` and
  `sandbox-appcontainer` assert the refusal rather than hiding it. One
  failure was caused by this task and fixed: the `provider-merge` version
  pin (section 9, point 4), re-run to 18/18.
- **STUDIO** (`npm test`): **427 passed / 0 failed** across 45 files. The
  webview is untouched by this task; the suite was run as required and as a
  guard, since the harness contract's response grew a field its parser
  ignores.
- Touched-file pass, one at a time, all green after the final edit:
  `provider-merge` (18), `turn-settings` (14), `conversations-store` (21),
  `storage` (28), `architecture` (32), `approval-broker` (8),
  `trust-and-modes` (22), `conversation-mode` (4, new).
