# TASK 61 - The frame that never arrived

Brief: The browser works for the model and says nothing to the person. A
screenshot rides every acting call, but the transcript renders a broken image
and the rail's preview renders none at all. The browser calls themselves hide
behind a disclosure the reader must expand to learn anything happened. And the
generic artifact fence - parse, registry, renderer, all built - has no
producer, so nothing in the product has ever drawn one.

This report is the analysis first and the record of the fix second, in the
order the work was asked for.

## The analysis

### 1. The broken screenshot: two spells of the same loss

Every browser tool result reaches the runtime with its frame as real base64.
The runtime keeps it (`modelToolResult` in
`STUDIO HARNESS/src/application/studio-runtime.ts:194` - supported blocks
pass through, real base64 in `content`, the raw value in `details`). The model
sees its pictures; nothing is lost yet.

The loss happens at persistence. Flue's conversation store
(`persistToolResultContent` in `conversation-stream-store-CXwRWonS.mjs:3821`)
takes every image block in a tool result, writes the bytes to the attachment
store under an id of the shape `att_<messageId>_<index>`, and replaces the
block with a reference. This is the right design - a journal that carried a
hundred-kilobyte frame on every record would be billed on every replay - and
it is not the bug. The bug is that nothing on the reading side turns the
reference back into a picture.

Two readers miss, in two different directions:

- **The live chunk.** The `tool-output` chunk's `output` comes from
  `encodeToolResultEntry` (`dispatch-nU3cIlT-.mjs:2315`): the record's
  structured `output` when the tool's `details` carried an `output` key -
  which no Studio tool does - otherwise `toolResultOutput(result.content)`,
  the persisted content. The frame arrives as
  `{ type: "attachment", attachment: { id, mimeType, ... } }`.
  `frameOf` in `STUDIO/src/features/chat/transcript/live/browserCall.ts:113`
  matches only `type === "image"`, so a live screenshot produces a card with
  no picture at all.
- **The history snapshot.** The projection `toolResultMessage`
  (`dispatch-nU3cIlT-.mjs:924`) maps attachment blocks to
  `{ type: "image", data: <attachment id>, mimeType }`. That passes
  `frameOf`'s check - the data is a string - so `BrowserCard` and
  `BrowserPanel` render `data:image/png;base64,att_entry_tool_outcome_...`.
  A broken image glyph, which is exactly what was reported.

The bytes are served. The Flue coordinator mounts
`GET /agents/studio/<conversationId>/attachments/<attachmentId>`
(`handleAgentAttachmentRead`, `dispatch-nU3cIlT-.mjs:3157`): raw bytes, the
stored mime type, `content-disposition: inline`, immutable private caching,
behind the same admission and AGENT_RUN scope as the submission route the
webview already clears. Nothing on the client has ever called it.

Why not? Two reasons, both real:

- **No client path speaks binary.** `client.ts` is JSON end to end -
  `Accept: application/json`, parsed bodies, `HarnessResult<T>`. And inside
  Tauri the transport seam decodes with `response.text()`
  (`STUDIO/src-tauri/src/services/fetch.rs:78`), which corrupts bytes: a JPEG
  read as lossy UTF-8 is not recoverable on the far side.
- **No client code knew the ids were ids.** `att_...` in a `data` field was
  rendered as if it were base64.

CSP already permits the result: `img-src 'self' data:` in
`STUDIO/src-tauri/tauri.conf.json`, so a resolved frame can ride a `data:`
URL with no configuration change.

### 2. The transcript box that does not exist

ADR 0049 §7: "An artifact appears in the transcript when the browser starts
and updates as it works." What exists instead: `ToolGroups.tsx` renders each
browser call as one row inside `DisclosureRow`, collapsed behind the
assistant's text. The reader sees a chip that says "Clicked" and must expand
the row to see the card - and the card, per §1, has no picture in it. The
report the ADR describes is structurally present but visually absent.

The two-projections rule
(`documentation/architecture/transcript-and-rendering.md` §2) already holds
here: grouping is by tool kind within one assistant turn's calls, which is
structural, not inferred. The fix is rendering, not projection: a turn's
browser calls deserve one always-visible report - latest frame, the run of
steps, each call expandable beneath - not rows hidden inside a disclosure.

### 3. The rail preview that forgets

`useBrowserPreview` (`STUDIO/src/features/chat/useBrowserPreview.ts`) walks
the projected transcript backwards, finds the latest *answered* browser call,
and pushes it at the rail entry. Three consequences:

- A reattach or reload rebuilds the transcript from history, the hook re-walks
  it, and pushes only the one latest call again. The rail's step list - which
  lives only in `RailProvider` state, appended to, never rebuilt from the
  transcript - survives only within one live session. The history is the
  conversation's, and the rail does not get it back.
- The steps are strings, built by `stepOf` from one call each: no action kind,
  no failure mark, no per-step frame, no place. "Detailed events on the right"
  cannot be built from one line per step.
- Only answered calls are pushed, and only the newest. A call that errored -
  a stale ref, a refused destination - never reaches the person's eye in the
  rail at all.

The entry state must be *derived* from the projected transcript - all answered
browser calls, in order, structured - rather than accumulated on the side.
`transcript-and-rendering.md` §4 already states the principle for summaries:
computed, never stored.

### 4. The artifact mechanism with no producer

The client has a complete artifact system:
`STUDIO/src/domain/artifacts/` (envelope, five statuses, three-outcome parse
with truncation detection), a registry, a shell that opens the rail, and
`Markdown.tsx` routing ```artifact fences to it. The harness side has the
directory (`conversationArtifactsDirectory`, created per conversation in
`createSandbox`) and nothing that writes or serves it. The system prompt
never mentions artifacts. No tool returns one. The fence has never been
produced in the product's life.

ADR 0049 §7 decides what the browser's artifact is: the report in the
transcript and the preview in the rail, both of which this task builds. The
generic fence - a `studio_artifact` tool, a served artifacts directory, a
producer side - is a separate mechanism and a separate task; bolting it onto
the browser task would double the review surface for no shared code. Recorded
here so the gap is a decision rather than a surprise.

### 5. What is not broken

- The model's view. `resolveMessageAttachments` re-resolves attachment refs
  to real images for the model context; a browsing model sees its own
  screenshots. The bug is person-facing only.
- The browser server, the session, the frames themselves (960px JPEG q45 per
  the plan's measurement), the kernel's per-call approval, the destination
  judge, the untrusted-content labelling.
- The persistence design. Attachment canonicalization is correct; the missing
  piece is a reader.

## The plan

1. **A binary arm on the seam.** `service_fetch_bytes` beside
   `service_fetch` in `STUDIO/src-tauri/src/services/` - same path
   validation, same supervisor-held credential - answering with the response
   body as raw bytes (Tauri's IPC byte response), registered in `lib.rs`.
   The JSON seam stays exactly as it is.
2. **A client attachment reader.** One module under
   `STUDIO/src/platform/harness/`: given a conversation id and an attachment
   id, fetch the bytes through the binary seam outside Tauri via plain
   `fetch`, resolve to a `data:` URL, cache by attachment id (the route is
   immutable), and dedupe in-flight requests. Failures are values; a frame
   that cannot load is a card without a picture, never a thrown render.
3. **Read both spellings.** `frameOf` additionally reads
   `{ type: "attachment" }` blocks and `image` blocks whose data is an
   attachment id, and returns a frame that says which kind it is. Inline
   base64 (a directly-attached image in a user message, say) still works
   unchanged.
4. **Resolve in the renderers.** `BrowserCard` and `BrowserPanel` take the
   frame ref and render the resolved data URL; while unresolved they render
   the card without the picture, never a broken img.
5. **The transcript report.** A turn whose tool group holds browser calls
   renders one browser report card, always visible: the latest resolved
   frame, the place, the steps so far in that turn, each call expandable to
   its full reading. Non-browser calls in the same turn keep their rows.
6. **The rail, derived.** The browser rail entry is rebuilt from the whole
   projected transcript on every change: structured steps (action, verb,
   subject, place, failed mark, frame ref when the call returned one), the
   latest resolved frame, and the panel showing a step's picture when its
   step is chosen. Errored calls appear as failed steps.
7. **Tests at each joint**: attachment-block reading (`browserCall`), the
   derived rail rebuild (hook test over a scripted transcript), the report
   card (ToolGroups render), the attachment reader (stubbed invoke/fetch),
   and the Rust bytes seam (same shape as `fetch.rs`'s live-harness test).

## Implemented

**The binary arm on the seam.** `service_fetch_bytes` in
`STUDIO/src-tauri/src/services/fetch.rs`, beside `service_fetch`: the same
path validation and the same supervisor-held bearer, answering
`tauri::ipc::Response` — raw bytes across the invoke boundary, which the
webview's `invoke` resolves as an `ArrayBuffer`. A refusal is read from the
harness's own JSON `error` sentence and carried as `ServiceError::Refused`
(new variant in `services/error.rs`), redacted like every other string that
could echo the credential. Registered in `services/mod.rs` and `lib.rs`. The
JSON seam is untouched.

**The client attachment reader.** `STUDIO/src/platform/harness/attachments.ts`:
`attachmentDataUrl(conversationId, reference)` resolves a reference to a
`data:` URL through the binary seam; `isAttachmentReference(data)` tells an
id from base64 (`_` is not a base64 character, so the `att_` prefix is
unambiguous in both directions). Resolutions are cached for the session (the
route is immutable), in-flight requests are shared (one transcript names the
same frame in the card, the report and the rail at once), and failures are
remembered under a minute's bound — long enough that paging past a frame the
harness cannot produce does not hammer the route, short enough that a harness
which was still booting is believed the next time the frame is asked for.
The reader cannot tell a 404 from a boot in progress, so neither "always
retry" nor "never retry" is true; the bound is the honest middle. Outside
Tauri, with no bytes seam at all, the answer is `null`,
which renderers read as "no picture"; see Notes for why there is no
plain-fetch fallback.

**Both spellings read.** `frameOf` in `browserCall.ts` now returns a
discriminated frame — `{ kind: 'inline' }` for real base64,
`{ kind: 'attachment' }` for a reference — and reads both persistence
spellings: the raw attachment block a live chunk forwards, and the image
block whose data the history projection mapped to the attachment's id.
`browserStepOf` turns one call into the structured step (action, verb tensed
by its own outcome, subject read from the input, place, failed mark, frame)
that both report renderers share — one mapping, two sizes, so they cannot
disagree.

**Resolve in the renderers.** `useAttachmentFrame`
(`STUDIO/src/features/chat/useAttachmentFrame.ts`) resolves either frame kind
to an `<img src>`; `BrowserCard` and the new report render an image only when
a URL actually exists — no frame URL is no image element, never a broken
glyph claiming bytes that are not here.

**The transcript report.** `BrowserReport.tsx` is the always-visible box ADR
0049 §7 describes: the newest frame on top without a click, the place beside
the header, and every call beneath as an expandable step that opens to the
full card. `ToolGroups` lifts a segment's browser calls into one report
placed where the first of them stood; non-browser calls keep their ordinary
rows, and the now-unreachable browser branches in the row renderers are
deleted rather than left behind. `conversationId` is threaded
ChatPage → LiveTranscript → AssistantTurn → ToolGroups, because attachments
are keyed by the conversation they were produced in.

**The rail, derived.** `useBrowserPreview` rebuilds the whole report from the
projected transcript on every change — every browser call oldest first as
structured steps (a call still running is a present-tense step with no place
claimed; a failed call is a failed step that lends nothing to the frame), the
latest place and picture read newest-first per fact — and hands it to
`showBrowser` as one replacement. The RailProvider entry holds
`BrowserStep[]` and the frame ref as the log carries it; a content signature
(count, settled count, last call id, conversation id) keeps an unrelated
transcript chunk from replacing an entry whose browser said nothing new.
`BrowserPanel` shows the selected step's picture — newest answered step by
default, any framed step on choice — through the same resolver the transcript
uses, so a picture is either truly present or truly absent.

## Outcome

Tests: client 905 → 926 (85 → 87 files), Rust lib 65 → 66. `pnpm typecheck`
and `pnpm test` green; `cargo test --lib` green (66 passed).

Break-verification, each break confirmed to fail the named test and then
reverted:

- Attachment-block reading and `att_`-in-image reading withheld in `frameOf`
  → "reads an attachment reference as the frame it usually is" failed.
- `failed.add` withheld in the reader → "remembers a refusal, so a missing
  frame is not re-asked for on every render" failed.
- Report signature guard disabled → "does not re-report when a chunk touches
  no browser call" failed (the entry was replaced, and the identity
  assertion caught it).
- Newest-first header scan inverted → "hands the rail every step, oldest
  first" failed.
- `showBrowser` append instead of replace → "replaces the report in place,
  and stays where the reader left it" failed.
- Rust refusal branch withheld → `a_byte_refusal_carries_the_harness_
  sentence_and_not_the_token` failed.
- The failure bound removed (refusals remembered forever) → "forgets a
  refusal after a minute, so a harness that comes back is believed" failed.

A final read of the new code before the suites found one real edge case,
now fixed: the failure cache remembered refusals for the whole session, and
a session whose first frames were asked while the harness was still booting
would have frozen those frames as permanently missing. The reader cannot
distinguish a 404 from a boot in progress, so the cache now holds a failure
for a bounded minute and asks again after — pinned by the recovery test
named above.

The signature-guard test earned its keep during development: its first run
caught a real ordering bug (a separate reset effect ran after the report
effect on mount and wiped the signature, so every chunk re-reported). The
guard now carries the conversation id inside the signature and there is no
second effect to disagree with the first.

## Notes

- **The plan's step 2 was changed in one respect.** It said the attachment
  reader would fall back to plain `fetch` outside Tauri. It does not: outside
  Tauri there is no credential story (the browser holds no bearer), the
  harness's CORS posture refuses such a fetch anyway, and `connection.ts`'s
  rule — deliberately no browser fallback for reading — is the rule this
  module keeps. The answer outside Tauri is `null`, the same state a picture
  still loading occupies.
- **An unresolved reference says "The picture has not arrived yet."** The
  resolver answers `null` for both "in flight" and "asked and refused", and
  the one sentence is chosen to stay true across both — the alternative
  ("Fetching…") claimed work in progress that had already stopped.
- **Test wiring, for the reviewer:** the new required `conversationId` prop
  was added to existing render tests as one reviewed single-token edit per
  file (47 sites in `ToolGroups.test.tsx`, 10 in `AssistantTurn.test.tsx`, 3
  in `AssistantTurn.elapsed.test.tsx`, 1 helper in `LiveTranscript.test.tsx`)
  — no script, every site the same deliberate insertion.
- **Verification gap, stated plainly:** the Tauri application was not
  smoke-run end to end against a live browser session in this task. The
  binary seam's success path needs a conversation holding a real attachment,
  which only a run creates; its refusal path is tested against a live
  harness. Everything render-side is covered by the suites above, but a
  person has not yet watched a real screenshot arrive in the box and the
  rail. That is the first thing to do on this branch.
- No harness code changed; no dependency added; nothing in `docs/`,
  `documentation/` or `tasks/` was touched. No new rules discovered for the
  book.
- The generic artifact fence's producer side remains unbuilt on purpose
  (§4 above) — a separate task, not a loose end of this one.
