# Compaction — the brief

**Status:** Research and design · **Opened:** 2026-09-19
**Decision proposed, not yet taken.** Nothing here is built. §8 is the order
it would be built in once the open choices in §7 are settled.

This is the captured version of a long spoken brief, checked against the
code and against Flue's own source rather than transcribed. Where the brief
and what exists disagree, both are recorded — the disagreement is usually
the most useful part.

---

## 1. The problem, in one paragraph

A conversation grows until it fills the model's window, and long before
that point the model gets worse at it. Studio shows how full the window is
and does nothing about it: there is no button, no automatic step, no
record of a conversation ever having been shortened, and a person who
reaches the edge has to start over. The brief asks for a mechanism that
compacts automatically at a sensible point, can be run by hand, survives
crashes and cancellations cleanly, keeps the context meter honest, copes
with models whose window is unknown, and produces a summary that is more
than a summary — a structured checkpoint that keeps the goals, the rules
the person laid down, the state of the work, and a short narrative of
what happened.

## 2. What already exists — the finding that changes the plan

The architecture notes say Flue owns compaction (ADR 0003; mental-model
§3.5). That was checked against `@flue/runtime` 2.0.3 as installed, source
and reference, not the marketing page. It is true, and it is more complete
than the brief assumed. Every claim below was read in
`dist/dispatch-*.mjs` (`src/compaction.ts`) and
`dist/conversation-stream-store-*.mjs`.

**It is on today.** `useModel()` takes a `compaction` option; Studio passes
none, so the default applies: enabled, model-aware reserve, 8,000 recent
tokens kept verbatim. Any direct-vendor model in Studio with a known window
will already be compacted by Flue when it fills — nobody has seen it because
no conversation has got there, and because nothing in the UI would show it.

**When it triggers.** After every assistant message, Flue reads the usage
the provider reported for that request and compacts when
`used > window − reserve`. The reserve is capped at 20,000 tokens and at
the model's max output, and on a small window it becomes a third of the
window. So a 200k model compacts at ~180k (90%), a 1M model at ~980k (98%),
an 8k model at ~5.3k. Threshold compaction **cannot engage when the window
is unknown** (`contextWindow: 0`), which is the state of every model on a
custom provider in Studio today (`local/runtime.ts` writes `?? 0`).

**Where it cuts.** Only at a user or assistant message, never inside a tool
call/result pair, and it runs between model calls inside a run — so a
long tool loop compacts between two steps, not in the middle of one. When
the current turn is itself too large to keep, the turn's early part is
summarised separately ("turn prefix") and its recent part is kept whole.

**What it writes.** A structured checkpoint, fixed format: Goal;
Constraints & Preferences; Progress (Done / In Progress / Blocked); Key
Decisions; Next Steps; Critical Context; plus a generated list of files
read and modified, carried across compactions. A second compaction is
given the previous summary and told to *update* it — preserve, add, move
items from In Progress to Done — not to start again. Tool results are
truncated before summarisation, so the summariser is not fed a 50 KB log.

**How it is stored.** As one `compaction` record in the append-only
conversation log, with `firstKeptEntryId`, `sourceLeafId`, the summary,
tokens-before and the summarisation cost. The context sent to the model
afterwards is rebuilt from that record: summary first, then the kept
recent entries. The transcript entries before the cut are not deleted;
they are behind the record. An aborted compaction writes nothing.

**How it is shaped, and what it costs.** A separate request: the
transcript serialised as text inside a user message, under a summariser
system prompt. No prompt-cache prefix match, so the whole history is read
at full price once per compaction. `CompactionConfig.model` can point that
call at a cheaper model; the default is the session model. The
cache-safe fork shape the brief suggests (append "summarise this" to the
existing prefix) is *not* what Flue does — C-09 in the archive asked this
question and this is the answer.

**Overflow.** A provider error that classifies as context overflow makes
Flue compact and retry the request once; a second overflow fails the run.
This works whether or not the window is known — it is the one automatic
path for an unknown window.

**Manual.** Flue 2.0 removed `session.compact()`. `harness.compact()`
exists but compacts a tool's scratch conversation, not the agent's. The
internal `runCompaction("manual")` code path is complete and emits
`compaction_start { reason: "manual" }`; nothing public reaches it.

**Events.** `compaction_start { reason, estimatedTokens }` then exactly one
`compaction { messagesBefore, messagesAfter, durationMs, isError, error?,
usage? }`, on the same in-process event stream the titler and the context
meter already subscribe to. The summarisation model calls appear as `turn`
observations with `purpose: "compaction"`.

**What is fixed.** The prompt. There is no hook, option or callback for it.

## 3. The decision

**Use Flue's engine. Build four things around it. Patch two things into
it, and send both upstream.**

Building our own summariser — a second agent handed the transcript — would
reproduce exactly what Flue does (its shape *is* "a separate agent with
the transcript pasted in") without the durable record, the overflow
recovery, the split-turn handling, the incremental update, the file-ops
ledger or the event stream, all of which are the hard part. The brief's
own rule applies: native first, when it matches the design. It matches on
everything except the prompt and the trigger, and both of those are small
patches on a runtime this repository already patches
(`patches/@flue__runtime@2.0.3.patch`).

### 3.1 Four things beside Flue (Studio's own)

1. **A manual compaction route** — `POST /conversations/:id/compact` —
   that calls the (patched-in) manual compaction, refuses while a run is
   in flight (Flue's `SessionBusyError`, reported as "finish or stop the
   run first"), and applies the cool-down rule of §4.7.
2. **The window fact for every model.** Threshold compaction is only as
   good as `contextWindow`; §4.5 says how it gets there.
3. **A compaction policy** passed to `useModel({ compaction })`: the
   reserve we choose (§4.3), the summariser model the person chooses
   (§4.4), and the prompt (§4.6).
4. **The surface.** A `compaction` item in the transcript, the meter
   re-reading itself, the picker's warning when the chosen model's window
   is smaller than the conversation, and the `/compact` command. §5.

### 3.2 Two things inside Flue (patches, upstreamable)

1. **Expose manual compaction for an agent instance** on the Node runtime:
   one function that finds the live coordinator for `(agent, id)` and runs
   `runCompaction("manual")` under the same one-operation-at-a-time rule.
   The code path exists; only the door is missing. Flue reserves a
   `compaction` signal name "for future framework use", which suggests
   upstream intends something here; the patch is the interim.
2. **A prompt override on `CompactionConfig`** — `prompt` and
   `updatePrompt`, strings, defaulting to Flue's own. Unknown fields throw
   today, so this is one line of validation and two of substitution.

Both are the kind of change Earendil has accepted before (the archive's
C-01 plan names "upstream PR" as step three of its own ladder).

## 4. The questions, answered

### 4.1 Which shape — fork, or a separate summariser?

Separate summariser, because that is the one Flue provides, and because
the fork shape's advantage is smaller than it looks in Studio. The fork
saves the re-read at full price, roughly 10× on a 150k conversation with
the same model. But it forces the *same* model to summarise, and it
happens at most once per ~150k tokens of work, so the saving is one
expensive request per long session. The lever Flue does give — a cheap
summariser model — recovers most of that saving on every compaction, and
lets a person pick a model that is good at summarising rather than one
that is good at coding. Revisit if measured cost says otherwise
(C-01's fixture is still the right instrument).

### 4.2 Auto compaction — where is the line?

**Reserve = max(20,000, 15% of the window)**, which is Flue's rule with a
floor that scales. On 200k that is compaction at 170k (85%); on 1M at
850k; on 8k Flue's own small-window rule takes over (a third of the
window). Not 90%: the summariser request has to fit in the same window and
carry the whole transcript plus its instructions, the last turn's tool
output can be 50 KB, and models degrade well before their advertised
limit — the point of compacting is to keep answers good, not to use every
token. Not 80%: on a 1M model that is 200k tokens of headroom thrown away
per cycle, and each cycle re-reads everything.

### 4.3 What happens in the middle of an edit?

Flue never cuts inside a tool call and its result, and it runs between
model calls, so an edit is either wholly before the cut or wholly after
it. Files touched are listed in the summary. The remaining risk is
semantic: the model wrote half a change across several tool calls and the
summary has to say so. That is a prompt problem (§4.6: "In Progress" must
name the file and what is half done), not a scheduling problem, and it is
why Studio does not add a "wait until the model looks idle" rule — waiting
past the threshold risks an overflow, which is the worse outcome.

### 4.4 Which model summarises?

Default: the session model. Offered: a Settings choice, "Summarise long
conversations with", listing every chat model, with the same "cheaper
model is fine here" note the title model has. The summariser's window must
be at least as large as the reserve-adjusted trigger point of the session
model, or the summarisation request itself overflows; the picker for this
setting hides models whose window is smaller than the current session
model's.

### 4.5 A model with an unknown window

Three layers, cheapest first.

1. **Ask the catalogs.** When a person adds a model to a custom provider,
   Studio looks the slug up in Pi's catalog and models.dev by name
   (`glm-5.3-flash` is in both) and pre-fills the window and max output.
   The person can change it. This is the proposal the brief describes,
   and it will answer nearly every real case.
2. **Ask the person.** The Add Model dialog's context-window field stops
   being optional in spirit: empty is allowed, but the row shows "window
   unknown — Studio can only compact this model when the provider
   refuses a request", so the consequence is stated where the choice is
   made.
3. **Fall back to overflow recovery.** With `contextWindow: 0` Flue still
   compacts when the provider reports an overflow, then retries. The
   meter shows the used tokens with no percentage, and manual compaction
   works whenever the cool-down allows. Studio does not invent a window:
   a guessed 128k on a real 32k model means an overflow anyway, and a
   guessed 32k on a real 1M model means compacting thirty times too
   often.

### 4.6 The summary — layers, and the "overview" the brief wants

Flue's checkpoint format already carries most of the brief's list: goal,
constraints and preferences (the "simple English" instruction lives
here), progress, decisions, next steps, critical context, files. Studio's
prompt (via the patch) keeps that skeleton and adds two sections and one
rule:

- **Overview** — five to ten sentences of plain narrative: what this
  stretch of the conversation was about and how it went. Written for the
  model and readable by the person. It must not restate the sections
  below it; it is the story, they are the ledger.
- **Reminders** — things the person said not to do, corrections they
  gave, and mistakes the model made and should not repeat. Distinct from
  preferences: a preference is how to work, a reminder is a wall.
- **The rule for conversations that are not work.** The prompt says: if
  no files, commands or tasks were involved, leave Progress, Files and
  Next Steps out entirely and let Overview, Preferences and Reminders
  carry the summary. One prompt with conditional sections, not a
  classifier step that decides what kind of conversation it was — a
  second model call is a second thing that can fail, and the summariser
  can see for itself what the transcript contains.

The update prompt gets the same sections and the same preserve-and-move
rules Flue already has.

Tool outputs are not a layer of the summary. They are truncated before
the summariser sees them (Flue), and the right long-term answer is the
one mental-model §3.5 already records: prevent large results at
execution time rather than compact them later (C-11, still open).

### 4.7 Cool-down — "you cannot compact again yet"

Studio's rule, applied to manual compaction only (Flue's threshold cannot
fire twice in a row by construction — after a compaction the context is
small). A manual compaction is refused unless **both** hold:

- at least one complete turn has happened since the last compaction (or
  since the conversation began), and
- the measured context is at least **30% of the window**, or at least
  **30,000 tokens** when the window is unknown.

Below that the button is present and disabled with the reason: "Nothing
to compact yet — the conversation is 12% full." A person who really wants
a fresh start at 12% wants a new conversation, and the sidebar has one.
The 30% figure is a starting point to tune; it is a constant in one place.

### 4.8 Fail-safety — cancel, crash, quit, model change

- **Cancelled** (stop button, or abort): Flue emits `compaction` with
  `isError`, writes nothing. The conversation is exactly as it was. Studio
  shows "Compaction cancelled" once and clears it.
- **Crash or quit mid-compaction:** the summarisation request dies with
  the process; nothing was written because the record is written only
  after the summary returns. On restart the conversation is unchanged and
  the meter still says it is full. Nothing re-triggers automatically at
  launch — the next turn does, at its end, by the same threshold rule.
  Half a summary cannot exist: the record is atomic in the append-only
  log, and Flue validates it on replay (a record whose kept entry does not
  exist fails loudly rather than silently).
- **Quit while a run is compacting automatically:** same as above; the
  run itself is the case ADR 0045 already covers.
- **Model changed to a smaller window at 89%:** nothing happens until the
  next message. When it is sent, the first request overflows; Flue
  compacts with the *new* model's settings and retries once. If the
  transcript does not fit the new model's window even for summarising,
  that request fails and the run fails with a clear error. Studio's
  addition is the warning before that: the picker marks a model whose
  window is smaller than the current usage — "This conversation is
  larger than this model's window; it will be compacted on the next
  message" — so the person chooses knowing.
- **Model changed to a model with an unknown window:** the meter loses
  its percentage, the warning says so, and §4.5 applies.

### 4.9 The meter after compaction

Today the meter shows the usage of the latest request. After a
compaction the next request has not happened yet, so the number is stale
in the worst way: it says "full" about a conversation that was just
emptied. Two fixes, both needed:

- On the `compaction` event, the harness writes a provisional usage row:
  estimated from the summary's length plus the kept tail plus the system
  prompt, marked `estimated: true`. The meter shows it as "≈ 14% ·
  re-measured on the next turn".
- The next `turn` observation replaces it with the measured number, as
  now.

### 4.10 Fork

Not part of compaction, and the brief is right that today's fork is not a
fork: it renders the transcript to text and sends it as the first message
of a new conversation. Flue 2.0 has no public branch API (checked again;
the tree is there in the log — `parentId`, `activeLeafId` — but nothing
creates a second leaf from outside). A real fork needs either a Flue API
or a copy of the durable log up to a point, and either is its own piece
of work. Recorded here so it is not lost; not scheduled here.

## 5. The surface

- **Transcript:** a `compaction` item where the cut happened — one line,
  "Conversation compacted · 172k → 14k", expandable to the summary. The
  entries above it stay visible to the person (they are still in the
  log); the item is where the model's memory begins.
- **Running:** the same one-line item in its live state, "Compacting…",
  with the composer disabled and Stop available (abort → §4.8).
- **Meter:** the percentage, the estimate mark after a compaction, and a
  "Compact now" action in its menu, disabled with the reason under §4.7.
- **Picker:** the window warning of §4.8.
- **Settings › Models:** the summariser model.
- **`/compact`:** the same action from the composer. This is the first
  slash command; the command mechanism itself (user-defined prompts as
  commands, the way Claude Code does it) is a separate feature and should
  be designed as one, with `/compact` as a built-in it ships with rather
  than a special case that predates it.
- **Artifact:** the brief mentions one. Not proposed here — the summary is
  in the transcript item, and an artifact that duplicates it is the
  duplication the brief itself warns against.

## 6. What the brief asked for that this does not do

- **The cache-safe fork shape.** Not Flue's; §4.1.
- **A classifier that decides the conversation's kind before
  summarising.** One conditional prompt instead; §4.6.
- **A guessed window for unknown models.** Refused; §4.5.
- **Waiting for a "safe moment" past the threshold.** Refused; §4.3.
- **A separate compaction artifact.** Refused; §5.

## 7. Open choices for the person

1. The reserve rule (§4.2): 15% floor at 20k, or a flat 10%?
2. The cool-down numbers (§4.7): 30% / one turn?
3. Whether the summariser model setting ships in the first cut or later.
4. Whether to send the two patches upstream before or after they land
   here (they land here either way).

## 8. Order of work

1. **Window facts.** Catalog lookup on Add Model; the unknown-window
   warning; the picker warning. No compaction changes yet, and every
   custom model gains a window. Smallest, and everything else depends on
   it.
2. **Policy and events.** `useModel({ compaction })` with the reserve
   rule; subscribe to `compaction_start` / `compaction`; write the
   provisional usage row; the transcript item; the meter. Automatic
   compaction becomes visible and honest. This is the first cut people
   can use.
3. **The two patches.** Manual trigger and prompt override; the Studio
   prompt of §4.6; the route; the cool-down; "Compact now" in the meter
   menu.
4. **`/compact`** — as the first built-in of the command mechanism, when
   that mechanism is designed.
5. **Summariser model setting**, if not folded into step 3.
6. Measure with C-01's fixture; revisit §4.1 with numbers.
