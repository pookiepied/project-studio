# Phase 1 - the history that has to survive

**Date:** 2026-09-01. **Where:** the working tree of
`D:\Creative Library\Workspace\Project Studio` (no git operation of any kind
was run; per the phase rules the tree is left uncommitted for the user to
land on `main`).

**What this phase delivered:** a harness command, `pnpm export`, that reads
Flue's journal and the Studio index read-only and writes every conversation
on this machine to a self-describing export - one JSON file a future importer
can re-seed from, one Markdown file a person can read. It ran for real
against this machine's data and its output was verified against the live
beta harness's own projection: three conversations, including the largest
orphan, agree message for message, text for text. Nothing was upgraded,
deleted, moved, or written anywhere under `~/.studio/`.

---

## 1. What is true on this machine, measured

All numbers re-measured on 2026-09-01 (16:00-19:30 local), read-only, against
byte-identical copies of the real databases (sha-256 verified before and
after every run). The brief's Part 0 was measured on the same day and **every
load-bearing number held**:

| Brief's claim | Measured | Holds |
|---|---|---|
| `flue_meta.schema_version` is 4 | 4 | yes |
| 51 streams, 1,862 batches, 102 submissions | 51 / 1,862 / 102 | yes |
| attachment, image, run and event tables empty | all 0 | yes |
| 27 streams match our index, 24 orphans | 27 / 24 | yes |
| orphan offsets include 224, 145, 138, 125 | 224 (`cnv_c61u5vmo`), 145 (`cnv_rhbeykc1`), 138 (`cnv_druaee3n`), 125 (`cnv_btp43xkl`) | yes |
| 16 conversations, 7 `cnv49_*` fixtures, 9 real | 16 / 7 / 9 | yes |
| `next_offset` is the batch count; seq contiguous | true for all 51 streams | yes |

Properties measured beyond the brief, because the walk needed them:

- **Delta sequences are contiguous 0..n-1 per block** (152 delta blocks, zero
  exceptions). The walk still sorts stably by sequence and falls back to
  arrival order rather than trusting contiguity.
- **Content is text-only on this machine**: every `user_message` and
  `tool_outcome` content part is `{ type: "text" }`. The walker handles
  non-text parts by reporting them in the conversation's `losses` list and
  keeping them in the verbatim records, but nothing here exercised that path.
- **One outcome per tool call, at most**: 88 `assistant_tool_call` records,
  85 `tool_outcome` records, no `toolCallId` appears twice, 83 of the 85
  outcomes were committed (`tool_results_committed`).
- **All 102 submissions are settled** (`direct=91`, `dispatch=11`); there is
  no in-flight debris in `flue_agent_submissions`.
- **605 of the 1,862 batches hold more than one record** - batch `seq` is not
  record-unique, so the walk orders records by (seq, position within the
  batch's array).
- **Title streams carry no `user_message`.** The titler's input arrives as a
  `signal` record (`signalType: "dispatch_input"`) whose `content` is a JSON
  string `{ message: ... }`. Three signal types exist on this machine:
  `submission_aborted` (13), `submission_interrupted` (2), `dispatch_input`
  (11).

### Where the brief and the docs were wrong

1. **The beta's schema version is 4, and beta.9 accepts exactly 4 - not
   "the 5 the migration guide describes."** Read from the installed
   `@flue/runtime@1.0.0-beta.9` bundle: `assertSupportedFlueSchemaVersion`
   returns only for `storedVersion === String(4)` and throws
   `PersistedSchemaVersionError` otherwise. A machine holding a version-5
   journal would be rejected by the *current* runtime too. The migration
   doc's "an export tool that assumes v5 table shapes is assuming something
   this machine contradicts" is correct and understated: v5 shapes are wrong
   for the beta as well.
2. **The 2.0 rejection was verified in code, not taken from a guide.** In the
   2.0.3 tarball (Phase 0's copy), the persisted-version check reads
   `flue_meta.format_version`, falls back to legacy `schema_version`, and
   throws `PersistedFormatVersionError` for anything but `8`; on accepting a
   version-8 journal it rewrites the row to `format_version = 1`. For our
   version-4 journal the check throws before any write - so even a stray
   2.0.3 open would reject our journal without mutating it. The upgrade is
   the deadline the brief says it is; the exact mechanism is now recorded.
3. **"The transcript lives in the batches, addressed by stream" is
   incomplete.** Two real user messages exist **only** in
   `flue_agent_submissions.payload` and never reached the stream:
   `cnv_15s5deuz`, submissions `747198a4-...` ("What happened, did you
   failed? Explain") and `a7b1e582-...` ("?"), both settled as
   `submission_aborted` with one batch each and no input record. A
   stream-walking export loses them, and so does the snapshot seam - the
   runtime's own `history()` cannot show what the stream never recorded.
   The export therefore walks **three** tables: streams, batches, and
   submissions; both messages are recovered into the transcript, marked
   `recoveredFrom: "flue_agent_submissions"`, placed at the position of
   their settlement record.
4. **"A conversation produces more than one stream" is only mostly true.**
   Five conversations we still hold have no title stream (`cnv49_build`,
   `cnv49_final`, `cnv49_ladder`, `cnv49_rename`, `cnv_uqyyin8a`), and no
   orphan has one. Also, one orphan is itself a purged fixture:
   `cnv49_probe_reach`.
5. **The snapshot seam loses nothing that matters except what point 3 covers
   - and it renders two things differently than a naive reading of the
   tables expects.** Measured by booting the real beta harness against the
   copied databases and comparing its `history()` snapshot to the export
   (section 5): the snapshot renders `submission_aborted` /
   `submission_interrupted` signals as **user-role transcript messages**
   carrying the signal text, and it merges nothing else. The export matches
   that rendering (via `"signal"` on the user message), after having first
   rendered them as timeline events and measuring the difference.

---

## 2. The seam, decided

**The export reads the tables directly: `flue_conversation_streams`,
`flue_conversation_stream_batches`, and `flue_agent_submissions`.**

Why not `harness-client.ts`'s `history(threadId)`:

- `history()` is an HTTP seam. Using it means booting the whole beta
  application - runtime, providers, admission, our studio runtime - pointed
  at a database, opening both files read-write through the normal boot path,
  to read a file. The export must run offline, once, under time pressure,
  with the app about to be upgraded. It also must be testable against a
  fixture database, which an HTTP seam is not.
- The snapshot is, by its own SDK documentation, a UI projection:
  "Streaming assembly details (delta sequencing, active blocks) are never
  exposed here". It carries materialized parts and settlements, but no
  signal records beyond their projected message form, no retry schedules,
  no per-record identities, and - decisively - it cannot recover the two
  payloads in `flue_agent_submissions` that never reached the stream. The
  tables are the ground truth; the projection is one interpretation of
  them, and the export already carries its own.

What the snapshot path would have cost, concretely: a server boot per export
run, an admission session and a port in the export's happy path, a test
suite that boots servers, and the two recovered messages.

What the tables path cost instead: the walk re-implements the
materialization (deltas into text, blocks into messages, outcomes onto
calls). That risk was bought down two ways - the assembly rules are pinned
by fixture tests (section 4), and the export carries the verbatim record
stream alongside the materialized transcript, so any future importer can
re-derive everything without trusting this walk (section 3).

---

## 3. The format, and why it is shaped that way

`format: "project-studio.conversation-export"`, `formatVersion: 1`. One JSON
envelope, written pretty-printed, UTF-8, LF, no BOM.

- **The envelope** carries `exportedAt`, the source journal path, the
  journal's own `schemaVersion` (verbatim, `"4"`), the runtime version, the
  three source tables, the orphan policy in force, journal-wide counts, and
  global `notes` (for example what an `exclude` policy left out).
- **The unit is the conversation, keyed by our index id** - the
  `cnv_*` id that is also Flue's `instanceId` - because that is the identity
  our `conversation` row and the brief's re-association requirement share.
  Each conversation carries `knownToStudio` and, when known, the full
  Studio index record (title, project, pinned, archived, model, reasoning
  level, permission mode, timestamps). Its `streams` array holds one entry
  per agent stream (`studio` first, then any side agent), since Flue
  actually holds one stream per agent conversation, each with its own Flue
  conversation id.
- **Each stream carries two layers, and each layer is the hedge for the
  other:**
  - `entries` - the materialized transcript in stream order: user messages
    (including dispatch inputs and, matching the app's own projection,
    abort/interrupt signals), assistant messages with `reasoning`, `text`
    and `tool_call` blocks ordered by `blockIndex`, deltas assembled by
    sequence, tool results attached to their calls with `isError` and
    `committed`; plus timeline events for retries and non-completed
    settlements.
  - `records` - the verbatim parsed record stream, in stream order. The
    materialization was written against a schema this export cannot see
    into the future of; the records make its reading falsifiable and let an
    importer re-derive rather than trust. Dropping them would have made
    this export's own interpretation of the data uncheckable.
  - `losses` - per conversation, everything that could not be made
    readable: unparseable batches (kept raw in `unparsedBatches`), tool
    results with no recorded call, reasoning that arrived encrypted with no
    decodable text, non-text content parts. Nothing is dropped quietly.
  - `submissions` - the per-submission ledger with outcomes and the
    `recovered` mark.

**Markdown (`conversations.md`) renders the same timeline** - one heading per
conversation with its provenance ("Known to Studio: **no**. This conversation
was deleted in the app; ..."), then the messages as prose: user, assistant
with reasoning quoted, tool calls with fenced JSON arguments and results.
This is the hedge the brief asks for: if the re-seed is never written, a
person can open one file and read their history without any of our code.

**Policies** (`--orphans include|exclude|split`, default `include`):
`include` writes all conversations to `conversations.json` +
`conversations.md` with provenance marked; `exclude` writes only known
conversations and records in the envelope's `notes` exactly what it
measured and left out; `split` writes `conversations-known.*` and
`conversations-orphaned.*`, each a complete envelope over its half.

**The run never overwrites**: an output directory that already holds files
is refused, because the person running this is doing it once, under
pressure, in front of an upgrade that destroys the source.

---

## 4. The orphan decision, made loudly

The brief requires this decision to be the user's, stated and asked, not
decided silently. **It was asked** (with the measured facts: 24 conversations,
52 user messages, 69 tool calls, about 178,000 characters - more content
than the 27 streams our index still knows) **and no answer was given**; the
session continued on its own instructions.

Decision taken, as the recommendation that was put to the user: **export
everything in one file, provenance marked** (`include`).

Reasoning, for the record:

- The export is the hedge against an irreversible loss. Excluding the
  orphans would make the deletion defect permanent - it would convert "the
  app never implemented delete" into "we deleted", the second
  irreversibility the brief explicitly warns against.
- Marking provenance keeps every conversation addressable and leaves the
  choice - keep, restore, or discard - to the delete-and-archive mechanism
  after Phase 8, acting on complete knowledge instead of none.
- The cost is a few hundred kilobytes of clearly labeled debris inside a
  14.3 MB file.

Nothing is foreclosed: the command is read-only and re-runnable, and
`--orphans exclude` or `--orphans split` produce the other two behaviours
verbatim. The inventory a person needs to decide is in section 5: four
orphans are substantial transcripts (10,000-20,000 characters), the rest
are greeting-scale exchanges, and one is a purged test fixture
(`cnv49_probe_reach`).

What was **not** done, per the brief: the orphans were not deleted,
archived, or rewritten anywhere; nothing under `~/.studio/` was touched at
all.

---

## 5. The real run, and its proof

**How it was run:** the real `flue.db` and `studio.db` were copied (all
three WAL files each) to `C:\Users\pooki\.zcode-scratch\phase1\home\`,
sha-256-verified byte-identical to the originals before the run, and the
command was pointed at the copies:

```
pnpm export --flue-db <copy>\flue.db --studio-db <copy>\studio.db
```

The originals were re-hashed after the run: **byte-identical**. The export
therefore never wrote to `~/.studio/data/` even though the copies were the
source.

**Output** (the run after the signal-rendering fix, which is the one that
stands):

```
Exported 40 conversations (51 agent streams, 102 user messages,
192 assistant replies, 88 tool calls) in 212 ms.
Known to Studio: 16; orphaned (deleted in the app): 24.
  C:\Users\pooki\studio-conversation-export-2026-09-01T13-11-20\conversations.json (14.3 MB)
  C:\Users\pooki\studio-conversation-export-2026-09-01T13-11-20\conversations.md (368.4 KB)
```

| Count | Value | Cross-check against the raw tables |
|---|---|---|
| conversations | 40 | 16 known + 24 orphaned ids |
| streams | 51 | the streams table's row count |
| user messages | 102 | 89 `user_message` + 11 dispatch inputs + 2 recovered |
| signal messages | 15 | 13 `submission_aborted` + 2 `submission_interrupted` |
| assistant replies | 192 | = `assistant_message_started` count |
| tool calls / results | 88 / 85 | = `assistant_tool_call` / `tool_outcome` counts |
| records | 16,644 | = every parsed record across 1,862 batches |
| recovered from submissions | 2 | the two `cnv_15s5deuz` payloads |
| unparseable batches | 0 | matches `JSON.parse` over the whole journal |

Duration: **0.2 to 0.5 seconds** across runs. Size: **14.3 MB JSON + 368 KB
Markdown**. Under time pressure, this is one command and a coffee-less wait.

**Read end to end: `cnv_ntervdmo`** ("Greeting User", active 2026-08-30,
7,231 stream records over 271 batches). The export reads as a coherent
conversation: greetings, a discussion about the model's name, a restaurant
website request, a `write` tool call that failed with "The permission
request was cancelled.", an abort signal and settlement exactly there, the
user pasting HTML back, and a final exchange about the assistant's tools -
zero losses, and the titler stream's output (`{"title":"Greeting User"}`)
matches the title our index row still shows.

**The proof that counts - agreement with the live app.** The real beta
harness (`dist/server.mjs`, the artifact the Tauri host starts) was booted
against fresh copies of both databases with a test admission session, and
its own `history()` snapshot - the projection the frontend renders - was
compared message-for-message against the export:

| Conversation | Snapshot messages | Export messages | Result |
|---|---|---|---|
| `cnv_ntervdmo` (known) | 34 | 34 | full agreement: roles, texts, reasoning, tool names and inputs |
| `cnv_1j04nco6` (known, has an interruption signal) | 20 | 20 | full agreement |
| `cnv_c61u5vmo` (orphan, largest journal) | 35 | 35 | full agreement |

The first comparison run found the signal-rendering difference described in
section 1, item 5; the walker was aligned to the app's projection and the
three comparisons above were run against the rebuilt export. An orphan's
transcript is message-for-message what Flue itself still serves - the
deleted conversations are real history, not noise.

**The nine real conversations the index still knows** (title, materialized
message count): `cnv_ntervdmo` "Greeting User" (34), `cnv_x4pxzibf` "Create
permission-demo.md file" (13), `cnv_9n5z0unx` "Build a static Steep tea shop
website" (8), `cnv_32j3oip4` "Create light-demo.md file" (7),
`cnv_6ujqvy4l` "Greeting User" (4), `cnv_wayjjlvv` "Greeting User" (3),
`cnv_uqyyin8a` "Hello" (2), `cnv_alpi76s6` "Greeting the assistant" (2),
`cnv_d0dp2in5` "Chatting with the Assistant" (2). Plus the 7 `cnv49_*`
fixtures. The orphans carry, among other things: a 17,342-character
conversation about rendering code (`cnv_c61u5vmo`), 100 science fun facts
with heavy tool use (`cnv_btp43xkl`), and a 10,065-character "why is the
sky blue" session (`cnv_rhbeykc1`).

---

## 6. The re-seed: an honest refusal

**The re-seed cannot be written today, and this phase does not pretend to.**

- The target does not exist. Re-seeding means producing a journal the 2.0
  runtime accepts, and 2.0.3 is not installed on this machine - installing
  it is Phase 2's `pnpm add` and is forbidden this phase. No v8 (format
  version 1) database survives on this machine from Phase 0's spike to read
  shapes from.
- The record envelope is going to move. Phase 7 of the plan already renames
  `dispatchId` to `submissionId` and moves the event envelope forward. An
  importer written today against guesses would be re-written against facts,
  with no way to test it until Phase 2 lands anyway.
- A stub that "re-seeds" by writing plausible bytes would be worse than
  nothing: it would either be rejected at first boot (harmless but a lie)
  or accepted and wrong (catastrophic, and silent).

**What the export guarantees to a future importer** (the contract, written
now so the importer can be written by someone who cannot ask questions):

1. `records` is the verbatim record stream of each agent conversation, in
   stream order - the same events the beta runtime's own projection is
   built from. Any transcript can be re-derived from them; `entries` is a
   convenience rendering, not the source of truth.
2. Each conversation's identity is complete: our `cnv_*` id (the
   re-association key into `studio.db`, which survives the upgrade
   untouched - its 16 rows, including titles, are still there), Flue's own
   `conv_*` id, the agent name, and the stream path.
3. Provenance is explicit (`knownToStudio`), and the orphan question is a
   per-conversation flag, not a convention.
4. `losses` and `unparsedBatches` name every imperfection; on this
   machine's data both are empty or explain themselves.

**What would have to be true for the import to be written:** Phase 2's pins
landed, so 2.0.3 can be driven; the v8 stream-store's table and record
shapes read from the installed runtime's source, the same way this phase
read beta.9's; a decision (the user's, again) on whether re-seeded orphans
re-enter the sidebar, which needs `conversation` rows created or a
load-on-demand design; and a fixture harness that builds a v8 journal so
the importer can be tested without the user's data. That is a small, sharp
task once Phase 2 exists - and none of it is a reason to hold the upgrade,
because the export has already made the loss survivable.

---

## 7. Verification

- `pnpm typecheck` clean.
- **Fixture tests, not the user's data**: `tests/unit/conversation-export.test.ts`
  (16 tests) builds a real journal file on disk from the beta runtime's own
  table SQL and record shapes measured on this machine, then covers: the
  storage reader (version, rows, order, refusal of missing or foreign
  files), the walk (delta assembly by sequence including out-of-order
  arrival, block ordering by `blockIndex`, tool results attached with
  `isError`/`committed`, recovered submissions placed at their settlement,
  dispatch inputs, unknown record types preserved, unparseable batches
  reported), grouping and provenance (including the join through a real
  `ConversationStore`), the envelope contract, both split and exclude
  policies, markdown readability, and the never-overwrites rule.
- **The full suite**: `pnpm test` (which builds first) - first run: 1,485
  passed, 25 skipped (host-gated sandbox suites), one failure:
  `tests/integration/mcp-flue.test.ts` timed out waiting for a harness boot
  that produced no output on two attempts. That flow imports nothing this
  phase added; the same file passed in isolation minutes later, and a
  minimal probe booted the same artifact with the same environment in
  5.4s. The failure mode - a spawn wedged before its first byte - is the
  episodic Windows stall the test file itself documents a replacement
  mechanism for. Full re-run result below.
- **Real run with counts** (section 5) and three-conversation agreement
  with the live harness.
- **Read-only discipline**: originals sha-256-identical before and after;
  the fixture test asserts the journal is byte-identical (size and mtime)
  after an export run.

**Full re-run:** 1,486 passed, 25 skipped, 0 failed (the mcp-flue suite
included). The tree is green: `pnpm typecheck` clean, `pnpm test` clean.
One confession for the record: the rule that suites run one at a time was
briefly broken - a single-file vitest run was launched while the full
re-run was still in flight. No bogus failure resulted (the re-run is
quoted above, complete and green), but the rule exists precisely because
this kind of overlap can manufacture one, and it should not have been
risked.

---

## 8. What changed in the tree

Added:

- `src/storage/flue-journal.ts` - the read-only reader for Flue's journal
  (`DatabaseSync` stays inside `src/storage` per the 008.3 gate; shapes
  verified against the actual tables; refuses a missing or foreign file).
- `src/conversations/export-walk.ts` - the record walk, materialization,
  grouping, provenance, counts.
- `src/conversations/export-markdown.ts` - the human-readable rendering.
- `src/conversations/export-run.ts` - policy arithmetic, envelope, file
  writing; owns no connections and no walking.
- `src/conversations/export-cli.ts` - the `pnpm export` entry point.
- `tests/unit/conversation-export.test.ts` - the fixture-based suite.

Changed:

- `src/storage/database.ts` - `openReadOnlyDatabase()`, for readers that
  must never write: no migration, no journal-mode change, version read not
  advanced, same newer-build refusal as `migrate`.
- `src/storage/migrations.ts` - `readUserVersion` exported (the read-only
  open needs the version without advancing it).
- `tests/unit/architecture.test.ts` - `conversations/export-cli.ts` added to
  the closed set of database-opening entry points, with the reason.
- `package.json` - the `export` script.

Not touched: `STUDIO/`, `patches/`, any `@flue/*` version, the lockfile,
`app.ts`, and - measured, not assumed - anything under `~/.studio/`.

Per the phase rules this tree is left **uncommitted**; landing it on `main`
is the user's hand.

---

## 9. For the person running this under pressure

```
cd "STUDIO HARNESS"
pnpm export --flue-db C:\path\to\copy\flue.db
```

Pass a **copy** of `flue.db` (with its `-wal` and `-shm` files, copied
while the app is closed). Accept the default output directory; take the two
files it names; do not delete the Markdown one. Then, and only then,
upgrade.
