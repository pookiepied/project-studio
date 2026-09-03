# Phase 7 - the name nobody wrote down

**Date:** 2026-09-03. **Where:** `STUDIO HARNESS/vite.config.ts` (the fix),
`src/conversations/titling.ts`, `src/execution/context.ts`,
`src/observability/flue.ts`, `src/observability/logger.ts`,
`src/storage/flue-journal.ts`, `src/conversations/export-markdown.ts`,
`tests/unit/titling.test.ts`, a new `tests/unit/built-agent-modules.test.ts`,
ADR 0033, and `documentation/work/flue-2-migration.md`. No frontend or Rust
source changed.

**The short version:** automatic titling was broken twice over - the build was
emitting two copies of every agent module on Windows, so `dispatch()` refused
the title job by function identity every single time; and once that was fixed,
the reply that finally arrived was refused again because the model wrapped its
JSON in a markdown fence.

Only the first bug was findable from the harness. The second needed the real
app and a real model, which is exactly what the brief's exit is for.

---

## Part 1 - where the title died

### How it was found, in one step

The brief said the instrumentation to split the search already existed, and
it did. A built harness was driven over HTTP with the scripted test model and
a scratch home: one POST to `/agents/studio/<fresh id>`, then read the
harness's own log lines. Three outcomes were possible and each meant
something different - "dispatched" (the trigger works), "settled without a
captured reply" (the ordering assumption is wrong), "reply was not a usable
title" (everything works, the parse refused).

The first run printed none of them. It printed a fourth:

```json
{"conversation_id":"cnv_442788af-...","attempt":0,
 "error":"[flue] dispatch() target agent is not registered in this built application.",
 "level":"warn","message":"Conversation titling could not be dispatched."}
```

So the studio trigger fired correctly, the ladder started, and the very first
dispatch was refused by the runtime. Every layer the brief suspected - the
event routing, the reply stash, the `agent_end` ordering, the parse - was
downstream of a call that never happened.

### What was actually wrong

`dispatch(agent, request)` in Flue 2.0 resolves its target **by function
value**, not by name. From the runtime's own source:

```js
function getRegisteredAgentIdentity(agent) {
  const identity = resolveAgentIdentity(agent);
  if (identity === void 0) return void 0;
  return registeredAgents.get(identity)?.agent === agent ? identity : void 0;
}
```

That `=== agent` is the whole bug. The built bundle contained **two copies of
`src/agents/title.ts` and two of `src/agents/studio.ts`**, confirmed in the
emitted sourcemap:

```
sources: [ '../src/agents/studio.ts', '../src/agents/title.ts',
           '../src/agents/studio.ts', '../src/agents/title.ts' ]
```

The runtime registered one copy's `Title`; `conversations/titling.ts`
imported and dispatched the other. Same file, same source, two function
objects, and the identity check answered no.

### Why there were two copies

Two module ids for one file, measured by logging Rolldown's resolved ids
during a build:

```
"D:/Creative Library/.../STUDIO HARNESS/src/agents/title.ts"
"D:\\Creative Library\\...\\STUDIO HARNESS\\src\\agents\\title.ts"
```

`@flue/vite` generates its scanned `'use agent'` module by importing each
agent file by an absolute path run through Vite's `normalizePath`, which
forces forward slashes:

```js
`import * as ${varByPath.get(filePath)} from ${JSON.stringify(filePath)};`
```

An absolute specifier goes through Rolldown's own resolver, which on Windows
answers in the platform's separators. Ordinary relative imports
(`titling.ts` importing `../agents/title.js`) are resolved by joining the
importer's directory with the specifier and keep the importer's forward
slashes. Rolldown keys modules by that string, so the same file entered the
graph twice. The module-importer graph says it plainly:

```
"D:/.../src/agents/title.ts"    importers: ["D:/.../src/conversations/titling.ts"]
"D:\\...\\src\\agents\\title.ts" importers: ["\0virtual:flue/agents", ...]
```

This is a Windows-only defect in `@flue/vite@2.0.3`, and it is invisible in
source: every source file was correct, every type checked, and every unit
test passed - because unit tests load modules through Node's resolver, not
the bundler's. The defect existed only in the artifact.

**Why the studio agent survived it.** `createAgentRouter(agent)` resolves an
identity *string* and routes by that, falling back to the `agentName` static
when the function carries no build-stamped binding:

```js
const identity = resolveAgentIdentity(agent);   // -> "studio", via Studio.agentName
```

So HTTP turns worked on the unregistered copy by accident. Only `dispatch()`
compares function values, and the title agent is reached only by `dispatch()`.

### The fix

A resolver plugin in `STUDIO HARNESS/vite.config.ts` that resolves normally
and then spells the answer the way the platform does - which is what the
ordinary resolver already returns, so the two ids collapse into one:

```ts
async resolveId(source, importer, options) {
  const resolved = await this.resolve(source, importer, options);
  if (resolved === null || resolved.external === true) return resolved;
  const id = resolved.id;
  if (id.includes("\0") || id.includes("?") || !isAbsolute(id)) return resolved;
  const normalized = normalize(id);
  return normalized === id ? resolved : { ...resolved, id: normalized };
}
```

Virtual modules, externals and ids carrying a query are left untouched, and
on POSIX `normalize` is the identity function, so no non-Windows build
resolves differently. The bundle went from 204 modules to 201 - the three
duplicates - and the sourcemap now names each of our sources exactly once.

Re-running the same probe against the rebuilt artifact:

```json
{"conversation_id":"cnv_59969ef8-...","attempt":0,
 "level":"info","message":"Conversation titling dispatched."}
{"conversation_id":"cnv_59969ef8-...",
 "level":"warn","message":"Conversation titling reply was not a usable title."}
```

The whole chain runs: trigger, dispatch, the reply captured off `agent_end`,
the parse. The parse refuses because the scripted test model answers
`Echo: <your message>`, which is not the JSON object the contract asks for -
the expected outcome for that source, and the proof that the reply reached
the parser at all.

### The second bug, which only the real app could show

With the dispatch fixed, a real conversation in the real app still kept its
derived title. The title agent had run and settled `completed`, so this was a
different failure, and the journal says exactly what it was. The title run's
own stream, read back from `flue.db`:

```
assistant_message_started  {"api":"google-generative-ai","provider":"google",
                            "model":"gemma-4-26b-a4b-it", ...}
assistant_text_delta       "```json\n{\"title\": \"Explain Bundler Module Duplication"
assistant_text_delta       " Impact\"}\n```"
submission_settled         "completed"
```

The model produced **exactly the object the contract asks for** and wrapped it
in a markdown code fence. `titleFromReply` calls `JSON.parse` on the raw
reply, the fence is not JSON, the parse throws, the reply is refused, and the
derived title stands. The prompt already says "Do not use markdown" and
"Return exactly one valid JSON object with no surrounding text"; the model
fenced it anyway.

**And it does so non-deterministically.** Three titling runs in the real app,
all on the same model (`google/gemma-4-26b-a4b-it`, which is what the cost
ladder picks against the user's OpenRouter connection):

| Conversation | Reply | Result |
|---|---|---|
| `cnv_m6yfqjy5` | `{"title":"Greeting and Introduction"}` | titled |
| `cnv_69y2wm0n` | ` ```json\n{"title": "Explaining Bundler Module Duplication Issues"}\n``` ` | refused |
| `cnv_p4q5zl4p` | ` ```json\n{"title": "Explain Bundler Module Duplication Impact"}\n``` ` | refused |

Same model, same prompt, a coin flip per conversation. That also explains the
pre-migration history the brief quoted: some old conversations carry model
titles and some carry derived ones, and it was never a property of the
conversation.

This is worth forgiving in the parser rather than out-prompting, because the
model layer deliberately routes titling to the **cheapest** reachable model,
and fencing JSON is what small instruction-tuned models do. Refusing a fence
makes the cost policy and the feature mutually exclusive.

The fix unwraps one envelope and nothing else - a reply that is a fence and
only a fence:

```ts
const FENCED_REPLY = /^```[A-Za-z0-9_-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/;
```

Anchored at both ends, so prose before or after the fence is still a refusal,
as is a second field, a bare string, or a list. Three tests pin the accepted
shape and three pin the refusals that stay refusals.

### The guard, so it cannot come back silently

A build-level defect that no test could catch is exactly why this lived so
long, so `tests/unit/built-agent-modules.test.ts` now reads the **artifact**:
every emitted sourcemap, asserting that no source of ours appears twice in a
chunk, plus a named check on the two agent modules. `pnpm test` builds before
it runs, which is how it has a bundle to read; run bare it says so rather
than passing on nothing.

It was verified to fail without the fix, not just to pass with it. With the
plugin removed and the bundle rebuilt:

```
AssertionError: expected [ ...(2) ] to deeply equal []
+   "providers-DP7W1zy8.mjs.map: ../src/agents/studio.ts",
+   "providers-DP7W1zy8.mjs.map: ../src/agents/title.ts",
AssertionError: expected [ '../src/agents/title.ts', ...(1) ] to have a length of 1 but got 2
```

The assertion is the whole bundle rather than the two agent files, because
the next module split this way will not be an agent.

### The exit - a name a model wrote, in the real app

`target/debug/studio.exe`, dev frontend on 1420, launched from `src-tauri`.
Supervisor log: `harness ready pid=1464 127.0.0.1:50589`.

A fresh conversation, model set to **Free Models Router** (the zero-cost
OpenRouter alias), one message typed into the real composer:

> No tools, no files, no searching - just answer from memory in two short
> sentences: why is a shopping list easier to reuse than a recipe?

The reply streamed in ("A shopping list contains generic items like milk,
eggs, and bread that you buy repeatedly regardless of what you're cooking. A
recipe, by contrast, is tied to one specific dish..."), the exchange settled,
and the name in the header and the sidebar changed from the derivation to:

> **Comparing Shopping List and Recipe Reusability**

Read back from the real index: `title_manual = 0`, so it is a machine title
and a rename would still outrank it. The row before the titler ran would have
read "No tools, no files, no searching - just" - eight words of the person's
own message.

**This one conversation proves both fixes at once.** The title run's journal
shows the reply arrived fenced:

```
"```json\n{\"title\": \"Comparing Shopping List and Recipe Re" "usability\"}\n```"
model: google/gemma-4-26b-a4b-it
```

So the dispatch had to reach the agent (bug one) *and* the parse had to
forgive the fence (bug two). Either one still broken and the sidebar would
have kept the eight words.

The sidebar at the end of the run reads as a before-and-after of this phase:
the two newest conversations carry model-written names, and every one below
them carries the derived eight words.

The app was closed with the window's close control: supervisor log
`shutting down harness pid=1464` - graceful stop, as designed.

Three live turns were spent in total, all on the zero-cost router, never
looped and never benchmarked. The credential appears in no log, error,
fixture, screenshot, test, or this report.

---

## Part 2 - the envelopes, measured

A temporary `observe()` subscriber was added to the composition root behind an
environment flag, the harness was built and driven through one real turn, and
every observation was written out verbatim. The subscriber was removed
afterwards and the tree re-verified clean; the scratch scripts were deleted.

**The full order of one turn, both agents** (`eventIndex`, agent, type):

```
  0 studio  submission_queued      14 studio  submission_settled
  0 studio  submission_running      0 title   submission_queued
  1 studio  operation_start         0 title   submission_running
  2 studio  agent_start             1 title   operation_start
  3 studio  turn_start              2 title   agent_start
  4 studio  turn_request            3 title   turn_start
  5 studio  message_start           4 title   turn_request
  6 studio  text_delta              5 title   message_start
  7 studio  text_delta              6 title   text_delta
  8 studio  turn                    7 title   text_delta
  9 studio  message_end             8 title   turn
 10 studio  turn_messages           9 title   message_end
 11 studio  agent_end              10 title   turn_messages
 12 studio  operation              11 title   agent_end
 13 studio  idle                   12 title   operation
                                   13 title   idle
                                   14 title   submission_settled
```

**A settled submission, verbatim** (direct, on the studio agent):

```json
{"type":"submission_settled","submissionId":"sub_01M1HW0KKR456ZA82Y4H8HW2DH",
 "outcome":"completed","instanceId":"cnv_2480bd27-6767-4fa8-a668-84c47a9d267a",
 "agentName":"studio","v":3,"eventIndex":14,"timestamp":"2026-09-02T20:12:22.709Z"}
```

**A dispatched title run's end, verbatim:**

```json
{"type":"agent_end","messages":[{"role":"assistant","content":[{"type":"text",
 "text":"Echo: Write down how the transcript should measure a turn."}],
 "api":"project-studio-test","provider":"project-studio-test","model":"default",
 "usage":{...},"stopReason":"stop","timestamp":1788379942737}],
 "conversationId":"conv_01M1HW0KT16Q1E18JY5TWWM3D9","session":"default",
 "operationId":"op_01M1HW0KT99J5NMBNSWZAJH7W6","harness":"default",
 "instanceId":"cnv_2480bd27-6767-4fa8-a668-84c47a9d267a",
 "submissionId":"sub_01M1HW0KST0CFMR1EZKB8RTHZZ","agentName":"title",
 "v":3,"eventIndex":11,"timestamp":"2026-09-02T20:12:22.748Z"}
```

**Direct and dispatched stamp the same fields.** Every event on both runs
carries the same envelope; the only difference measured anywhere is `kind` on
the queued and running events - `"direct"` against `"dispatch"`.

### What the trace settled

1. **`agent_end` really does precede `submission_settled`.** eventIndex 11
   against 14, with `operation` and `idle` between them. The routing's
   load-bearing assumption holds, and **Part 1's bug was not this** - the
   ordering was right all along.
2. **`submission_settled` carries almost nothing.** Type, `submissionId`,
   `outcome`, `instanceId`, `agentName`, envelope. No `conversationId`, no
   `session`, no `harness`, no `operationId`. The two fields the orchestrator
   routes on are exactly the two that are there.
3. **`instanceId` is ours; `conversationId` is Flue's.** The instance id is
   the conversation id the webview minted (`cnv_<uuid>`), which is what makes
   `conversationIdOf()` correct. `conversationId` is a runtime-minted
   `conv_<ulid>` naming the durable stream - not the product's conversation,
   and routing on it would name the wrong thing.

### The fixtures that were guessed wrong

`titling.test.ts` built its 2.0-shaped events by hand. Three corrections, all
now measured:

| Fixture | Was | Wire |
|---|---|---|
| `agentEnd` envelope | run identity only | also `conversationId`, `session`, `harness`, `operationId`, `submissionId` |
| `agentEnd` message `provider` | `"project-studio"` | `"project-studio-test"` (the pi provider id) |
| event ordering indexes | `agent_end` 1, `settled` 0 | `agent_end` 11, `settled` 14 |

None of the three is routed on, so none of them was hiding the bug. They are
corrected anyway: a fixture that claims to be the wire has to be the wire, and
the third one had the two events in an order the runtime never produces.

**One fixture checked and left alone.** `conversation-export.test.ts` builds a
`dispatchId`-carrying `signal` record with `signalType: "dispatch_input"`.
That looked like a fourth stale fixture, and it is not: its own header says it
is verbatim from `@flue/runtime@1.0.0-beta.9`, and the export exists to rescue
**pre-migration** journals. It stands for a wire that really did carry those
fields. For the record, 2.0 writes a dispatch input as a plain `user_message`
record instead, measured on a live journal:

```json
{"v":1,"id":"record_dispatch_input_sub_01M1HW0KST0CFMR1EZKB8RTHZZ",
 "type":"user_message","conversationId":"conv_01M1HW0KT16Q1E18JY5TWWM3D9",
 "submissionId":"sub_01M1HW0KST0CFMR1EZKB8RTHZZ",
 "messageId":"entry_dispatch_c3ViXzAxTTFIVzBLU1QwQ0ZNUjFFWktCOFJUSFpa",
 "parentId":null,"content":[{"type":"text","text":"..."}]}
```

Neither `dispatchId` nor `signalType: "dispatch_input"` exists anywhere in
2.0.3 - grepped, not assumed - and the export's `user_message` branch already
reads the new shape correctly (Part 5).

### One measured artifact worth writing down

`submission_running` reports `maxAttempts: 10` for the title run, while
`Title.durability = { maxAttempts: 1 }`. This is not a lost setting. The
submission row is created at admission, before any render can be read, so it
carries the store default; the agent's durability lands when the input is
applied, in `markSubmissionInputApplied`. The settled row confirms it:

```
title  status=settled  attempt_count=1  max_attempts=1     (Title.durability   = 1)
studio status=settled  attempt_count=1  max_attempts=3     (Studio.durability  = 3)
```

Anyone reading the running event will see 10 and should not chase it.

---

## Part 3 - the renames

**The renames were already done, by Phases 2-5.** Grepped across the harness,
the webview and the Rust host: `runId`, `run_id`, `run_start`, `run_end`,
`dispatchId` and `dispatch_id` appear in exactly one place in the whole
workspace, and that place is the beta-9 export fixture described above. The
envelope is `v: 3`, confirmed on every live event.

So this part's real work was the rule the brief stated: **a rename that
changes what a field MEANS is not a rename** - and one of these was.

### The rename map

| 1.0 | 2.0 | Meaning change? |
|---|---|---|
| `run_start` / `run_end` | `agent_start` / `agent_end` | No. Same event, new spelling. |
| `dispatchId` | `submissionId` | **Yes, a merge.** Direct and dispatched submissions now share one field; `kind` (`"direct"` / `"dispatch"`) is what separates them. |
| `runId` | `instanceId` **and** `submissionId` | **Yes, a split.** One identity became two. |
| envelope `v: 2` | `v: 3` | No. |

### The call site that was reading the wrong one of the two

`FlueExecutionLinks` (`src/execution/context.ts`) took the `submissionId` half
of the split and **dropped the `instanceId` half entirely**. Flue hands both to
the execution interceptor - `FlueExecutionContext` carries `instanceId`,
`agentName`, `submissionId`, `conversationId` and more - and `linksForFlue`
read `submissionId` and `conversationId` only.

That is the finding, and it is worse than a missing field. `conversationId`
in that pair is Flue's own `conv_<ulid>` stream id, **not** the product's
conversation. So every Flue-rooted log line and span link named a conversation
that cannot be joined to anything a person can see, while the one field that
could - the instance id, which *is* the conversation id the webview minted -
was on the floor.

Fixed: `FlueExecutionLinks` and `ExecutionContext` now carry `instanceId` and
`agentName` (`flue_instance_id`, `flue_agent_name` in structured logs), and
the `requestId` fallback for a Flue-rooted context prefers the instance over
Flue's stream id. `agentName` earns its place separately: one instance runs
two agents seconds apart - the conversation's own turn, then the background
titling run behind it - and without it the two are indistinguishable in a
trace.

ADR 0033 was amended with the split, the merge, the `conversationId`
correction, and the two new rows in its identity table.

---

## Part 4 - `title_model`, restored

**The brief's Part 0.4 is right about the channels it names and wrong about
the conclusion.** It is true that the model identity cannot come from
`message-started`, `message-completed`, or the history projection - Phase 6
measured all three, and they carry nothing. But the titler is not on those
channels. It is on `observe()`, and the observation's assistant message
carries the model as required fields of its own type:

```json
"api":"project-studio-test","provider":"project-studio-test","model":"default"
```

That is the same `agent_end` message the reply text is already read from, so
`title_model` costs one extra field on a value already in hand. The reply
stash now holds `{ text, model }`, and the log line is back:

```json
{"conversation_id":"cnv_c2850a94-...","title_model":"project-studio-test/default",
 "level":"warn","message":"Conversation titling reply was not a usable title."}
```

It is logged on the refusal path as well as on success, because a model that
will not produce the one object the prompt asks for is a rung of the ladder
worth knowing about. `responseModel` is preferred over `model` when present,
so a router that served something other than what was asked for is named
honestly. A unit test asserts the fact rather than the code path.

**Two other sources exist, and are recorded rather than used.** The durable
journal's `assistant_message_started` record carries
`modelInfo: {api, provider, model}` - which is how the conversation export
already prints "(project-studio-test / default)" beside every reply. And the
telemetry spans carry `gen_ai.request.model` and `gen_ai.provider.name`. The
observation channel was chosen because it is in-process, needs no exporter
configured, and is already subscribed.

### The exit: one turn, end to end in telemetry

Run with `PROJECT_STUDIO_OTEL_EXPORTER=memory` and a dump path, one real turn.
The dump holds two traces and three metric instruments:

```
trace 7e42f20c  invoke_agent studio   agent=studio inst=cnv_c2850a94-... sub=sub_01M1HWR1FJ
trace 7e42f20c   +- chat default      agent=studio inst=cnv_c2850a94-... sub=sub_01M1HWR1FJ  model=default
trace 30a446b6  invoke_agent title    agent=title  inst=cnv_c2850a94-... sub=sub_01M1HWR1NQ
trace 30a446b6   +- chat default      agent=title  inst=cnv_c2850a94-... sub=sub_01M1HWR1NQ  model=default

metrics: gen_ai.client.operation.duration, gen_ai.client.token.usage,
         gen_ai.invoke_agent.duration
```

The `chat` span of the titling run, every attribute:

```json
{"flue.instance.id":"cnv_c2850a94-d891-489d-a12e-5da2bffd7aee",
 "flue.submission.id":"sub_01M1HWR1NQN21RJ6C60ZJW6DPK","flue.agent.name":"title",
 "flue.harness.name":"default","flue.session.name":"default",
 "flue.operation.id":"op_01M1HWR1P74YW9YSHZRVR7MCTQ",
 "flue.turn.id":"turn_01M1HWR1PG2VAYSGKW3V0987T6","flue.event.index":4,
 "gen_ai.operation.name":"chat","gen_ai.provider.name":"project-studio",
 "gen_ai.request.model":"default","gen_ai.request.stream":true,
 "gen_ai.agent.name":"title","gen_ai.conversation.id":"conv_01M1HWR1P09NDK0MQDGP5HAMH2",
 "server.address":"project-studio-test","flue.turn.purpose":"agent",
 "gen_ai.response.finish_reasons":["stop"],"gen_ai.usage.input_tokens":0,
 "gen_ai.usage.output_tokens":0,"gen_ai.usage.cache_read.input_tokens":0,
 "gen_ai.usage.cache_creation.input_tokens":0,"flue.usage.total_tokens":0}
```

**What it shows, and the one thing it does not.** A complete turn is visible:
the agent invocation, the model call inside it, the finish reason, the token
and duration metrics, and the full identity chain. But the conversation's turn
and the titling run behind it are **two separate traces** - there is no span
link between them, because the dispatch happens after the settlement, outside
the turn's context. The only thing that joins them is `flue.instance.id`,
which is the same value on both. That is exactly the field Part 3 found
missing from our own execution links, which is why the two parts landed
together: with it, a person can ask "what did this conversation cost" and get
both the turn and its title back; without it they could not.

One honest note on attribution: these span attributes are stamped by
`@flue/opentelemetry`, not by our `linksForFlue`. Our links feed the
structured logger and the turn-boundary interceptor, which is where
`flue_instance_id` and `flue_agent_name` now appear.

---

## Part 5 - the contract suites, redirected

**The brief's Part 0.3 is correct and the plan's premise is wrong.** There is
no Studio SQLite stream store to test. `src/db.ts` is 44 lines, of which 16
are code: path resolution and boot logging around
`export default sqlite(path)` - Flue's own Node adapter, unwrapped. Adopting
the contract suites would test Flue's
implementation of Flue's interface, in our repository, proving nothing about
our code; writing a store so the suites had something to test would be
inventing a subsystem to justify a test.

**What this harness actually relies on the adapter for, and what proves it.**

| Reliance | Proof |
|---|---|
| Durable submissions survive a process restart | integration: "resumes an accepted submission after a Node process restart" |
| A hard kill does not duplicate completed work | integration: "recovers after SIGKILL without duplicating the completed conversation" |
| Attempt counts are re-derived, not restarted | integration: "re-derives the attempt count across a restart instead of starting over" |
| Flue state and application state stay separate | integration: "keeps Flue execution state separate from application state across a cold start" |
| A clean shutdown leaves no hot WAL | integration: "closes the application database cleanly on shutdown, leaving no hot WAL" |
| An identical resend is not deduplicated | integration: "does not deduplicate an identical resend - a lost ack stays unknown" |

Those run the real built artifact against a real file on disk, through the
real HTTP surface, across real process restarts. They are stronger evidence
for what we depend on than any in-process contract suite would be. **Item
closed.**

**The one real gap, named.** The coupling the contract suites would never
have covered is the opposite direction: `src/storage/flue-journal.ts` reads
Flue's tables **directly**, read-only, for the conversation export - a
dependency on Flue's private schema that upstream owes us nothing about. Its
shapes were measured against a schema-4 (beta-9) journal, and the export test's
fixtures are that journal.

So it was run against a real 2.0 journal rather than reasoned about. It
works - one conversation, both agent streams, user messages and replies with
their model identity:

```
### Assistant - 2026-09-02T20:12:22.737Z (project-studio-test / default) - stop reason: stop
```

One wart surfaced and was fixed: the header printed "Flue journal schema
version unknown", because 2.0 replaced `flue_meta.schema_version` with
`flue_meta.format_version`. The reader now reads both, newest key first, and
prints `Flue journal version format 1`. A rescue tool being vague about the
thing it is rescuing is a small bug, but it is the kind this file exists to
not have.

---

## Verification

- `pnpm typecheck` (harness): clean. `tsc -b` (frontend): clean.
- Frontend suite: **47 files, 456 tests, all green**.
- `cargo clippy --all-targets`: zero warnings. Rust suite: **65 passed, 0
  failed**. No Rust source changed this phase.
- `pnpm test` (harness, builds first), run whole twice:
  - **Run 1: 1494 passed, 11 failed, 25 skipped (713.9s).**
  - **Run 2: 1497 passed, 10 failed, 25 skipped (679.4s).**

  **Per-failure attribution, run 1 (11).** Ten are the Phase 8
  retry-regression floor, all in `tests/integration/harness.test.ts`,
  verbatim the enumerated acceptance list. The eleventh is the `mcp-flue`
  intermittent the brief named, in exactly the shape it named it: `runs a
  real selected tool through approval and removes it after disable` failed
  with `No approval arrived`, then reported a second failure on teardown,
  `EBUSY: resource busy or locked, unlink
  '...studio-mcp-flue-qOJD6L\flue.db-shm'`. That is the
  primary-failure-plus-slow-graceful-stop pair Phase 6 characterised. No
  deadline was raised and no test was touched.

  **Per-failure attribution, run 2 (10).** The floor exactly, one failing
  file (`harness.test.ts`), nothing above it. `mcp-flue` passed, which is the
  third independent confirmation that it is intermittent rather than broken.

  **Nothing above the floor is attributable to this phase in either run.**

  The passing totals: Phase 6 ended at 1492. Run 1 read 1494 because three
  new tests existed by then (two in `built-agent-modules`, one for
  `title_model`). Run 2 read 1497: the same three, plus the two fence cases
  added after run 1, plus the `mcp-flue` test that failed in run 1 and passed
  in run 2. Totals including failures move 1502 to 1505 to 1507, which is the
  five tests this phase adds and nothing else.
- Rules: no `any`, no non-const `as`, no non-null `!`; UTF-8, LF, no BOM;
  every edit by hand. The temporary `observe()` subscriber and the throwaway
  probe scripts were removed; `git status` shows only the nine intended files.

## Every place this brief was wrong

1. **"Titling produces no model title today ... whether the dispatch never
   happens, the run fails, the reply is never captured, or the parse rejects
   it."** The list is missing the answer. The dispatch was *attempted and
   refused*, by the runtime, for a reason that has nothing to do with titling:
   the build emitted the agent module twice and `dispatch()` compares function
   values. Every candidate the brief named lives downstream of that.
2. **"The routing was written from the type surface, never from a live trace
   ... that ordering is an assumption. If it is wrong, the reply is taken from
   an empty stash and the derived title stands - which is exactly the
   symptom."** The ordering assumption was correct - `agent_end` at eventIndex
   11, `submission_settled` at 14 - and so was every other routing decision in
   that file. The symptom matched a hypothesis that happened to be false, which
   is why the brief was right to make finding the death site the first step
   rather than reasoning from the shape of the failure.
3. **"The `title_model` log fact cannot be recovered from those channels. The
   candidates are the telemetry events and the settled settings row."** True of
   the message channels, but it framed the problem as needing re-sourcing. The
   observation the titler was *already reading* carries `provider` and `model`
   as required fields. Two further sources also exist and the brief named
   neither: the durable journal's `assistant_message_started.modelInfo`, and
   `gen_ai.request.model` on the telemetry spans.
4. **"`titling.test.ts` pins the routing with hand-built 2.0-shaped events.
   Check those fixtures ... this phase is where three of them get checked."**
   Three fixture errors were found and corrected, but the brief pointed at the
   wrong three files: the `dispatchId` fixture that looks stalest is correct
   for the beta-9 journal it explicitly stands for, and all three real errors
   were in `titling.test.ts` itself. None of them was hiding the bug.
5. **"`src/execution/context.ts`, `src/execution/outcomes.ts`,
   `src/observability/flue.ts` and `src/observability/logger.ts` are where the
   old identity vocabulary lives."** The old vocabulary was already gone from
   all four - earlier phases did the renames. What actually lived there was the
   *consequence* of one: the `runId` split dropped its `instanceId` half, so
   the only Flue id that can name a person's conversation was never linked.
6. **"Ten failures are the floor ... `mcp-flue` is a known intermittent above
   it."** Both halves held exactly: run 1 landed on eleven (the ten plus
   `mcp-flue`, failing in the precise two-part shape the brief described),
   run 2 landed on ten with `mcp-flue` passing. The brief's instruction to
   report both numbers rather than a total is what makes that legible as one
   flaky test rather than a regression.
7. **The brief treated titling as one bug.** "Whether the dispatch never
   happens, the run fails, the reply is never captured, or the parse rejects
   it - that is the first thing to find out, and the answer shapes everything
   else in this phase." The answer was **two of those at once**, in series:
   the dispatch never happened, and once it did, the parse rejected the
   reply. Fixing the first made the second visible for the first time. This
   is the strongest argument for the brief's own insistence that the exit is
   a real conversation and not a test - the second bug was invisible to every
   test in the repository, including the ones written this phase, because the
   scripted model does not fence and the fixtures were written by hand.
8. **"Live model turns spend the user's money."** Worth recording that they
   did not, here: the model layer's ladder sorts every available model by
   cost ascending, so titling ran on `google/gemma-4-26b-a4b-it` through the
   free router on every run. The policy the ladder exists to enforce was
   observable end to end for the first time this phase, because
   `title_model` is back in the log to say so.

## State left on the user's machine, named

- Five conversations in the real index from this phase's exit runs, all
  keepable or deletable in the UI like any conversation: the exit itself
  ("Comparing Shopping List and Recipe Reusability"), "Greeting and
  Introduction", two "Explain in two sentences why a bundler that", and one
  "What is the difference between a durable submission" whose turn was still
  running when the app was closed and settled `aborted` as a result. It kept
  its derived title, and that is the trigger behaving correctly rather than a
  fourth bug: the titler fires only on `outcome: "completed"`, so a turn that
  died never spends a model call on itself. Verified after the fact - the
  submission row reads `failed: This operation was aborted` and no
  `agents/title/...` stream exists for it at all.
- The `~/.studio` journal, the beta journal, the Phase 1 export and
  everything else under the Studio home are otherwise untouched. Both
  databases were only ever opened read-only by this phase's own inspection.
- Temp: the probe directories this phase created were removed, as was the one
  `studio-mcp-flue-*` directory the run-1 `EBUSY` left behind.
