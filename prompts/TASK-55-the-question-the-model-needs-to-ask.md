# Task 55 - The question the model needs to ask

A native tool that lets the model put a real question to the person, with
options, and park until it is answered.

Studio can already stop and ask for *consent* - `ApprovalPrompt` does that for
permissions. It cannot ask for *a decision*. A model that does not know which
of three approaches you want has one option today: guess, and build on the
guess.

## Part 0 - What already exists, and what it means for this

Read these before designing anything. Most of this tool is an existing pattern
with a different payload.

**The durable question channel is built.** `PermissionApprovalBroker`
(`src/application/approval-broker.ts`) parks a promise and writes a row to
`pending_approval` (migration 9) *before* the caller parks, so a question
survives the process that asked it. `GET/POST/DELETE
/api/permissions/pending/:id` serve it. `usePendingApprovals` polls at 1s while
a run is live and 10s while idle, so a question raised while the person was on
another page is still found. A read that fails leaves the question on screen,
because an unanswered question does not stop existing when the process holding
it goes down.

Every restore case this tool needs is solved there. Follow that shape.

**Flue 2.0.3 has nothing for this.** Checked in
`node_modules/@flue/runtime/docs/`: no elicitation, no human-in-the-loop, no
approval primitive. Our MCP layer does not implement MCP elicitation either.
So this is ours to build, and the broker is the precedent.

**`ApprovalPrompt` already says what this is not.** Its own docblock:

> Not a dialog floating over the app, and not the ask-a-question tool. It is
> consent for an action a run is already attempting.

Its placement is right and this tool should copy it: in the conversation flow,
between the transcript and the composer, at the point the turn stopped. Not a
modal. It also already handles several questions waiting at once, answered one
at a time, oldest first.

## Part 1 - A separate table, and why this is not negotiable

This tool gets its own table and its own routes. It does not extend
`pending_approval`.

ADR 0036 is titled "user decisions are durable" and migration 9 says plainly:
*"Nothing expires a row by age: durability is the design."* A permission
question has no timeout, no default, and no auto-answer, because for a
permission the absence of an answer must never become consent.

This tool has a timeout and a recommended option. That is correct for "which
database should I use" and catastrophic for "may I delete this directory". If
the two share a table and a code path, the first bug that treats one as the
other converts a permission prompt into an auto-approval, silently.

They may look similar on screen. They must not be the same rows.

**Note for the UI reference below:** the AICSS approval card offers "Auto
Approve in 30s" on its *command* variant. Do not take that. The countdown
belongs to product questions only.

## Part 2 - The three outcomes

A question resolves exactly one of three ways, and they are distinct paths in
the code, not one path with flags.

| Outcome | What it means | What happens |
|---|---|---|
| **Answered** | An option, or free text | The run continues with the answer |
| **Deferred** | "You decide" - the person is present and declining to choose | The run continues, told nobody chose |
| **Stopped** | "Stop" - the person is present and ending it | The run halts, after one closing turn |

And separately, not an outcome the person produced:

| **Timed out** | Nobody was there | Takes `recommendedOptionId` if the tool supplied one; otherwise parks indefinitely, exactly as an approval does |

**Stop halts.** The two errors are not equally recoverable: a halted run costs
the person ten seconds of "keep going, use your judgment", while a run that
continued on a guess has already written files - and it guessed on a question
it judged worth asking, which is the worst case to guess in.

**Timeout is not stop.** Being away from the desk and actively declining are
different states, and the auto-continue behaviour must not leak from the first
into the second.

**Defer and Stop are separate labelled controls.** This is a requirement, not a
style note. If there is one ambiguous dismissal - an X, a click outside, a
button called "Skip" - people will press it meaning "you decide" and get a
halted run. Every way out of the component must say which of the two it is.
There is no ambiguous dismissal: no click-outside-to-close, no escape-to-close
that resolves the question.

## Part 3 - The tool

Registered in the `native` namespace beside the other nine, in a new `ask`
family. It is a `CallGate.call` like everything else.

**Effects: `["read"]`.** Not an empty list. `PermissionKernel.register` refuses
a capability that declares no effects, and its comment says why: every rule of
the form "do all of its effects allow this?" is vacuously true for nothing, so
an effectless tool would be read-only, allowed in an untrusted folder, and
auto-allowed by default, all earned by declaring nothing.

`read` is the honest answer rather than a workaround. The tool observes the
person's intent and changes no state. Its consequences - read-only, permitted
in an untrusted folder, auto-allowed - are all correct here: a tool that asks a
question must not itself raise an approval, or answering the question requires
approving the asking of it.

```
native/ask_user_question
```

Input, and every field's reason:

- `questions` - one to four. Asked one at a time, in order. Answering the last
  one resolves the call.
- Each question carries:
  - `question` - the sentence. Required.
  - `header` - a short label, at most twelve characters, for the compact
    display.
  - `options` - two to four. Each has a `label` and a `description` saying what
    happens if it is chosen. A recommendation goes first and says so in its
    label.
  - `multiSelect` - whether several options may be chosen at once.
  - `recommendedOptionId` - optional. **The only thing a timeout may take.** A
    question without one parks forever instead of timing out.
- `timeoutMs` - optional. Absent means park indefinitely. Clamped to a sane
  floor, so a model cannot ask a question that expires before a person could
  read it.

**A free-text field is always present and is never declared by the model.** It
is a property of the component, not of the input, so no schema and no model can
remove it. The person can always answer something the model did not think of.

The result the model receives names, per question, which option was chosen or
what text was written, and which of the four outcomes produced it. A deferred
question says so explicitly, so the model can say "you did not choose, so I am
using X" rather than pretending it was told.

## Part 4 - The timeout must be a stored deadline

Store `expiresAt` on the row. Do not hold a `setTimeout`.

A timer in memory dies with its process. A question asked with a two-minute
deadline a moment before a crash would then wait forever, which is the exact
failure the durable store exists to prevent. Whoever picks the row up next -
the same process, or a new one after a restart - reads `expiresAt` and can see
it has already passed.

An expired question with a recommendation resolves to it. An expired question
without one stays pending; it does not resolve and it does not disappear.

## Part 5 - What halting actually does

Not a kill. A cut run leaves a dead conversation that never says what it
wanted.

1. The tool returns a result saying the person stopped it.
2. The model gets **one** turn to write a closing message - "I stopped because
   I need to know whether to migrate the existing rows."
3. The run then ends, **enforced by the runtime**, not trusted to the model.

The result is a conversation that says why it stopped and what it needs, which
is what makes continuing seven days later possible.

## Part 6 - Storage and HTTP

**Migration 19.** Verified: 18 is the highest applied. Applied migrations are
frozen and append-only; do not touch 1-18.

One table. The row holds the question payload, the conversation and scope it
belongs to, `asked_at`, `expires_at` (nullable), and the answer once given. The
payload is what the UI renders: it describes a question and its options, and it
carries no credential.

Routes mirror the approval ones in shape, under their own prefix - list
pending, answer one, cancel one. Cancelling is what an aborted run does to its
own outstanding questions.

## Part 7 - The UI

Placement is `ApprovalPrompt`'s: in the flow, between transcript and composer,
where the run stopped. One question at a time; the others are named beneath it.

The reference is the AICSS approval card, `questions` variant
(`https://www.aicss.dev/components/approval-card`). **Take the interaction, not
the implementation.** Borrow: the option rows, sequential advance between
questions, the countdown with rolling digits, submit-on-enter. Do not borrow
its colours, spacing, typography, or `lucide-react` - we have
`src/design/tokens/` (`geometry`, `motion`, `typography`) and our own icon
registry at `src/components/icons/registry.tsx`. Anything new goes into that
registry in its style. The result must read as part of Studio, not as a
component dropped into it.

The countdown is only rendered when the question actually has a deadline. A
timer on a question that will wait forever is a lie.

### One card shell, two callers

Both kinds of question stop the run and appear in the same place, one above the
composer. If they are built separately they will drift apart visually, and the
person will be looking at two different-looking things that do the same job.

So build **one presentational shell** - the framing, the question sentence, the
option rows, the control row, the keyboard behaviour - and have both
`ApprovalPrompt` and the new component render through it.

The shell is presentation only. It holds no policy: no timeout, no default, no
opinion about what an unanswered question means. Those live in the two callers,
which is what keeps Part 1's separation true in the code rather than only in
this document. A shell that grew a `timeout` prop would hand permissions the
one thing they must never have.

Concretely: the permission caller passes a verdict and a duration and no
deadline; the ask caller passes options, an optional deadline, and the defer
and stop controls. If a prop only ever makes sense for one of them, it does not
belong on the shell.

**What you may change in the permission path: how it looks.** Restyling
`ApprovalPrompt` onto the shared shell is in scope and wanted.

**What you may not change: what it does.** The broker, the kernel, the pending
store, the routes, the verdict and duration vocabulary, and the rule that the
narrowest duration is preselected all stay exactly as they are. If a change to
the shell would require changing any of those, the shell is wrong - not them.

The AICSS card's `plan` variant and its "View Plan" control are Task 56's
reference, not this one. Build the shell so a third caller is possible; do not
build the third caller.

## Not this task

The todo tool, the compact pill, and generalizing the Rail. Those are Task 56,
and this tool must not grow a todo-shaped feature on the way past.

Subagents. Flue 2.0.3 provides them natively (`useSubagent`, `defineSubagent`,
`GeneralSubagent`, and a framework-owned tool named `task` - **that name is
taken, do not use it**). We adopt them in a later task, not here.

The permission approval path's *behaviour*. Its appearance moves onto the
shared shell, as Part 7 describes; nothing behind it changes.

## Verification

- Every load-bearing test gets a negative control: break the mechanism, watch
  that exact test fail, restore it. Say in the report which controls you ran.
- A test that a permission question still cannot time out and still has no
  default, so the separation in Part 1 is bound by something and not just by
  this document. This one matters most: it is what stops a later change to the
  shared shell from quietly giving permissions a deadline.
- A test that the shared shell exposes no deadline to the permission caller.
- The existing permission tests must pass unchanged. If restyling makes one
  fail, the restyle changed behaviour and is wrong; do not edit the test to
  match.
- A test that an expired deadline is honoured after a restart, by writing the
  row with a past `expiresAt` and reading it back through the store rather than
  by waiting.
- A test that a question with no recommendation does not resolve on expiry.
- `pnpm build` before the suite - the integration tests spawn the built
  entrypoint, and a clean run without it fails about forty tests for that
  reason alone, with no failure saying so.
- Run the suites one at a time.

## Rules

`documentation/rules.md` is required reading. In addition, for this session:

**You do not commit and you do not switch branches.** This overrides
`documentation/rules.md` section 11. Leave the work in the tree and report.

No `any`, no non-const `as`, no non-null `!`. UTF-8, no BOM. Preserve each
file's existing line endings - the filesystem tools are CRLF, the shell and
process files are LF. No scripted search-and-replace across files.

`Backend/`, `documentation/`, `prompts/`, `report/` and `opencode/` are
read-only, except the one report file you write.
