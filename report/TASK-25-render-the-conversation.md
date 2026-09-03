# TASK 25 — The conversation renders, against a real agent

**Date:** 2026-08-24
**Scope:** `STUDIO/src/platform/harness/` (new `conversation-chunks.ts`; `conversation.ts`,
`contracts.ts`, `index.ts` and their tests), new transcript projection
(`STUDIO/src/features/chat/transcript/projection.ts`) with tests, new live components
(`transcript/live/`), `useConversationTranscript.ts`, `useConversation.ts`,
`ChatPage.tsx`, `Composer.tsx`, `ThinkingBlock.tsx`, `useTranscriptWindow.ts`.
**Status:** Complete. Nothing committed -- the working tree holds the changes.

---

## Verification, run one suite at a time

| Check | Result |
|---|---|
| `STUDIO` `pnpm test && pnpm typecheck` | **10 files / 154 tests passed** after the re-verification pass (original run: 148; baseline to beat: 9 / 125); `tsc -b` clean |
| `STUDIO/src-tauri` `cargo test` | **64 passed; 0 failed** (baseline matched; no Rust changes) |
| `STUDIO/src-tauri` `cargo clippy --all-targets` | **0 warnings** |
| `STUDIO HARNESS` `pnpm test` | **84 files / 1275 tests passed** (baseline matched); +25 skipped by the pre-existing environment gate in `tests/contained.ts` (keyring/sandbox containment), not by this task |

No ENOENT storm; suites were run strictly sequentially.

Beyond the suites: a live end-to-end check drove the *unmodified production*
client and reducer against a launched harness (`launchHarness`, real HTTP, a
fake Tauri seam that reads the real SSE):

```
cold start: { outcome: 'absent' } | deliveries: absent      <- brand-new conversation
admitted turn f04f104a
  batch live[message-started]
  batch live[message-delta(reasoning) x12 | message-delta(text)]
  batch live[message-completed]
  batch live[submission-settled]
agent end=complete thinking(161ch) -> text(19ch)
LIVE CHECK PASSED
```

Earlier wire probes (same harness, same model) also captured a full tool turn:
reasoning deltas -> `tool-input{read}` -> `message-completed` -> `tool-output`
-> second `message-started` -> deltas -> settlement. The scratch probes were
deleted after use; nothing was committed anywhere.

---

## Part 0 -- what the live agent actually put on the wire

### The request the client was building was worse than suspected

The brief suspected a missing `view=updates`. Observation says more: the
history view is the default for a plain GET, and it **refuses `offset`, `tail`
and `live` outright**:

```
GET /agents/studio/cnv-probe25?offset=-1&live=sse
  -> 400 {"error":{"type":"invalid_request","message":"Request is malformed.",
          "details":"History reads do not accept offset, tail, or live parameters."}}
```

Since Rust's `compose_stream_url` appends exactly `offset=...&live=sse` to
whatever path the webview sends, **every attach Task 24 ever made was refused
before a single frame could flow.** The streaming client had never spoken to a
real agent, and its first conversation would have been its last. Pinned now in
`conversation.test.ts`: cold start fetches `/agents/:id?view=history` by path,
with no offset or live parameter, and every stream opens at
`/agents/:id?view=updates`.

### What a real turn actually sends

Representative frames from a live turn (`stealth/ox-alpha` via OpenRouter),
one SSE `data` frame per projected batch:

```
event: data data:[{"type":"conversation-reset",...,"position":{"batch":0,"index":0}}, ...]
event: data data:[{"type":"message-delta","messageId":"entry_...","kind":"reasoning",
                   "delta":"The","position":{"batch":5,"index":0}}]
event: data data:[{"type":"tool-input","toolCallId":"592d...","toolName":"read",
                   "input":{"path":"package.json"},"position":{"batch":6,"index":0}}]
event: data data:[{"type":"message-completed","usage":{"input":1760,"output":42,...}, ...}]
event: data data:[{"type":"tool-output","toolCallId":"592d...",
                   "output":"     1\t{\n     2\t  \"name\": \"project-studio-v2\",..."}]
event: data data:[{"type":"message-started","submissionId":"d4ab...", "model":{...}}]
event: data data:[{"type":"submission-settled","outcome":"completed","result":{"text":"project-studio-v2"},...}]
event: control data:{"streamNextOffset":"0000000000000000_0000000000000007","upToDate":true}
```

Facts worth writing down, because everything downstream leans on them:

- **One submission spans several assistant messages.** Each tool step starts a
  new message (`message-started` carries the same `submissionId`). "Turn" in
  this codebase's grouping rule therefore maps to *assistant message*, not
  submission.
- **Tool answers arrive after the message that issued them has already
  completed**, keyed by `toolCallId` alone -- no messageId on `tool-output`.
  Correlation must be global, never positional.
- Reasoning and text deltas interleave inside one message.
- Every chunk carries `{batch, index}`; offsets are opaque strings
  (`0000000000000000_0000000000000007`). Heartbeats are comment lines; control
  frames always carry `streamNextOffset`.
- Admission answers `202` with `{streamUrl, offset, submissionId}`.

### Cold start, confirmed against the doc

The brief's guess was right and is what ships: history first
(`GET ?view=history` -- one JSON snapshot, `Stream-Next-Offset` header), then
`?view=updates&offset=<snapshot.offset>&live=sse`. The protocol sentence "do
not resume without retaining the projection state produced by the matching
history snapshot" is load-bearing because of one server behaviour I verified
in Flue's source and on the wire: **a mid-stream reattach does not replay a
reset** -- `conversation-reset` is emitted only when a batch contains
`conversation_created` or `compaction`. A suffix read really can omit message
starts; resuming without local state would render deltas addressed to messages
that never began here.

### A third cold-start state the brief did not mention

History returns **404** for a conversation whose agent instance has never
received a prompt ("Streams are created when their agent instance receives its
first prompt"). That is not a failure; it is how every fresh conversation
looks. The client delivers it as `absent` (new delivery kind, new settlement
outcome), the hook renders it as `idle`, and `submit()` reattaches after a
successful admission because the first turn is what creates the stream this
page has been unable to find since mount.

`HEAD` exists and works, but history carries everything needed, so nothing
uses it.

---

## Part 1 -- the mirror

`platform/harness/conversation-chunks.ts` extends the facts mirror with
content: delta text and kind, tool name/input/output/errorText, usage, model,
timestamps, plus readers for the snapshot shape (`ConversationUiMessage` and
its parts, settlements) that BOTH the history view and the `conversation-reset`
chunk carry. `contracts.ts` re-exports the module so the boundary stays
"import from index".

- An unknown chunk type survives carrying type and position only -- pinned by
  test, including that dedupe still advances past it.
- Fields the wire omits are `null`, never invented. Tool answers are wrapped
  in `{present, value}` so an explicit null result stays distinguishable from
  an absent one.
- History parsing is strict (any malformed message fails the whole snapshot,
  because history is the cold start's source of truth); chunk parsing is
  lenient per field, because one broken field must not take down a batch.

---

## Part 2 -- the projection

`features/chat/transcript/projection.ts` reduces ordered chunks into
`TranscriptItem`s: user messages, and per-assistant-message segments --
text runs, thinking runs, tools groups -- in wire order.

**Grouping is structural and cannot be wrong** because both halves of the unit
are wire facts: the bucket belongs to ONE assistant message (`messageId` on
every `tool-input`) and is named by the tool itself (`toolName`). Labels are
the verb form of the name plus a count ("Read 2 · Ran 1"); an unknown tool
renders under its raw name rather than under a guess. No code path in the
reducer or components can emit a semantic label, because none exists there.
Consecutive calls share a segment; written text between calls starts another
segment, preserving interleaving.

**Replay idempotence:** every chunk passes the monotonic-position gate
(at-or-before applied => dropped); `applyChunks` returns the input untouched
when a whole batch is redelivery, so React bails out too. Cross-batch state
(open run positions, call sites for later outputs) persists in the projection,
so a delta lands in the segment the previous delta opened however many
deliveries later, and a `tool-output` finds its call wherever the log put it.

**An interrupted turn is never a finished one:** `end` comes only from
`message-completed`, a settlement, or a snapshot's own part states. A stream
that stops mid-sentence leaves `stopped`; a failed/aborted settlement marks
still-open messages of that submission `failed`/`aborted` WITHOUT touching
messages that genuinely completed earlier. Tests cover each adversarial case
the brief named: mid-turn stop, redelivered batch (including across an
unknown-type chunk), missing tool result (pending, not failed), unknown chunk
type, orphan deltas dropped instead of inventing a message.

---

## Part 3 -- the wiring

`useConversationTranscript` binds connection to reduction;
`transcript/live/` renders items (`LiveTranscript`, `AssistantTurn`,
`LiveUserMessage`, `ToolGroups`, `ConnectionNotice`). ChatPage renders live
for every ordinary conversation; the artifact gallery keeps the seeded demo
surface because its replies are staged artifacts no harness produces. Composer
gained `onSend/busy/onStop`; when present they replace the demo send entirely
-- two transports, one control, and stop means ABORT (ADR 0045 section 5).

Connection states render as follows: `no-harness`, `harness-starting`,
`attaching`, `interrupted` (+ Reattach, which resumes from the retained
offset), `run-failed` (+ way back in) get words; `live`/`idle`/`streaming` get
none -- a connected conversation narrates itself through its content.
Streaming text reuses `useSmoothText`/`StreamedMarkdown`; only the last text
segment of an unsettled turn paces, so a reattach never retypes history.
Thinking blocks are per-segment, positioned where they occurred, collapsed by
default. §1's rule holds structurally: nothing above the reducer feeds any
request; the composer submits a string, period.

The provider used for all live verification: OpenRouter BYOK, configured
through the harness's own settings store (`openrouter-test` custom provider ->
`https://openrouter.ai/api/v1`, key in the OS keychain, default model
`stealth/ox-alpha`) so future sessions reuse it. The key never appears in
code, logs, fixtures, or this report.

---

## Where this brief was wrong (or the docs were)

1. **"Find out what the default view actually returns"** -- it returns a 400
   refusal for anything carrying `offset`/`live`, which is what Rust appends
   to every stream request. The defect was not a missing parameter; it was a
   guaranteed refusal on every attach.
2. **Two cold-start states, said the brief; there are three.** `404 until
   first prompt` had to become a first-class `absent` outcome, plus a
   reattach-after-first-submit in the hook, or a fresh conversation sits dead.
3. **The protocol doc overstates client-side requirements.** It says updates
   may not be resumed without retained projection state, but the SERVER
   reconstructs canonical prefix through any offset (including `-1`, where it
   emits a full reset). The operative constraint is the other sentence:
   suffixes omit message starts. Both behaviours are now relied on explicitly
   and named in comments.
4. **A discriminated chunk union does not survive TypeScript.** With an open
   `type: string` survivor member (required: unknown types must live for
   dedupe), literal comparisons cannot narrow away the catch-all, so every
   consumer needed casts. The house's flat-record-with-nulls shape is not just
   tradition; it is what this contract can be typed as honestly.
5. **Provider capacity leaks into transcripts as empty COMPLETED turns.**
   When OpenRouter's shared pool rate-limits (`429`, "temporarily rate-limited
   upstream"), Pi retries and the harness then records `message-completed` +
   `submission-settled: completed` with zero content. That is the log's own
   word, and rendering honours it -- but a turn that silently completes empty
   is indistinguishable in the transcript from a model choosing silence. The
   harness surfacing provider errors as failed settlements (or error parts)
   feels like a real gap; it is harness-side and noted here rather than fixed
   in STUDIO.
6. Small stuff: admission is `202` (fine, but worth knowing); `HEAD` was
   offered and not needed; the brief's line-number pointer for the view defect
   (`conversation.ts:271`) pointed at the right function.

## Left for later

- A surface for submission failures (a refused POST currently changes no
  phase); retry/edit/fork semantics against a durable log (what does "retry"
  mean when the log is append-only?); sidebar titles from live transcripts.
- Per-call file icons, relative paths, line deltas, and timing -- doc section
  2's "Soon"; the group rows already expand twice, ready for them.
- Thinking-segment durations (wire carries no per-segment timing yet).
- Everything the brief fenced off: end-of-run summary, output spilling,
  background tasks, semantic grouping, cross-window coordination. No
  scaffolding for any of it was left.

---

## Re-verification pass (2026-08-25)

The session that produced this task was interrupted repeatedly (rate limits,
network drops, killed background processes), so the whole implementation was
re-audited line by line -- actual code first, tests second -- on the chance a
half-written file or stale edit had survived. Results:

**Integrity.** Every touched file re-read in full and hashed: no truncation,
no BOM, zero non-ASCII outside two UI copy strings ("·", "…"); no scratch
files, conflict debris, or `.orig`/`.rej` anywhere; `git diff` of every
modified file reviewed hunk by hunk and matched intent.

**Three real defects found, all in paths the happy-path tests never walked,
all fixed with failing tests first (`projection.test.ts`):**

1. **`conversation-reset` dropped the assistant index.** The reset replaced
   items and rebuilt call sites but not the message-id index, so any delta or
   tool input arriving after a compaction reset was routed nowhere -- silent
   content loss exactly at the moment the transcript is being replaced. The
   reset now rebuilds every index, and seeding registers the trailing segment
   as continuable so post-seed deltas extend it instead of splitting one
   paragraph into two.
2. **Seeding ignored snapshot settlements.** A cold start rendered the
   unfinished tail of a failed/aborted submission as merely stopped --
   violating the interrupted-means-something rule at the transcript layer.
   Seeding now applies failed/aborted outcomes to still-incomplete messages
   of that submission, leaving genuinely finished ones finished.
3. **The caret could lie.** "Being written" included attaching/live phases
   and ignored end state, so after a crash-recovery reattach the caret blinked
   indefinitely on a dead stopped message. Now a pure predicate
   (`isMessageBeingWritten`): turn running AND newest AND not ended.

**Known minor, accepted:** for the artifact gallery the live hook still runs
unconditionally beside the demo surface (hooks cannot be conditional); it
costs one harmless history request per gallery mount.

**Suites after fixes, run alone:** STUDIO **154 tests / 10 files**, typecheck
clean; cargo test **64 passed**; clippy **0 warnings**; STUDIO HARNESS **1275
passed / 84 files** (+25 pre-existing environment skips).
