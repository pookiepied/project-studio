# ADR 0053 — Dictation Is Live By Segments, On The Transcribers That Exist

**Status:** Accepted · 2026-09-13
**Builds on:** [ADR 0051](0051-pi-is-the-language-gateway-and-nothing-else.md)
— transcription is a media adapter per vendor, one request in, text out.
**Plan:** [the media catalogue and dictation plan](../work/media-catalog-and-dictation-plan.md),
D3 and D4. Landed in steps 4 and 5 (`516ff1b4` and the Improve commit).

## Context

Dictation was one take: record, stop, wait, then a paragraph. A person
speaking for a minute saw nothing for a minute, then everything, and could
not tell until the end whether the transcriber was keeping up or whether
the microphone had died. "Live" - words arriving while the person is still
speaking - can be had two ways. Every transcription vendor Studio drives has
a websocket realtime API, each different, each a new adapter method, a new
route shape and a vendor-by-vendor build. Or the take can be cut into
pieces and each piece sent through the one route that already exists.

## Decision

### 1. The take is cut into segments at its pauses, and each is transcribed as it is cut

The microphone hook already computes a smoothed level for the waveform. A
cutter reads that same number once per frame and ends a segment at a pause
of 700 ms after speech, or at twelve seconds without one - never inside the
first second, never in a room where nobody has spoken. A cut is the
MediaRecorder stopped and a new one started on the same stream, because a
recorder's timeslice chunks are not decodable on their own; each segment is
therefore a whole file that `POST /api/media/transcribe` already accepts,
on every adapter already built. The remainder at stop is the final segment.

### 2. Text lands in speaking order, whatever order the vendor answers in

Segments are transcribed concurrently and delivered sequentially: each
segment's text waits for every earlier segment's to land. An empty segment
is a breath, not a failure. A segment the transcriber refuses ends the take
once, with the transcriber's sentence, and drops the segments behind it.
Escape drops what has not landed and keeps what has: a sentence in the
field was said. "Nothing intelligible" is said only when a whole take
delivered nothing.

### 3. Improve is offered afterwards, for exactly the dictated words, and is undoable

After a take, the composer offers Improve for the tail the take wrote and
no other text. It sends that span to a fixed-prompt agent in the shape of
the title agent - the person's default text model, reasoning off, no tools,
no sandbox, not on the HTTP surface, its CRITICAL block answering any
instruction hidden in the dictation - which fixes punctuation and casing,
drops fillers and false starts, and keeps every word, fact and name. The
reply replaces the span; the original is held; Undo swaps them back. A
keystroke, a send or a new take withdraws the offer. Nothing is persisted.

### 4. Streaming stays a later adapter capability

A websocket stream per vendor is the next step for whichever vendor the
person actually dictates through, taken when the segment lag - about one
pause plus one round trip - turns out to matter. It would be a new adapter
method beside `transcribe`, not a replacement for this.

## Consequences

- Every transcription vendor is live today, with no new wire. The lag is
  one pause and one request.
- The cutter and the pipeline are pure and tested against a scripted level
  and a transcriber released out of order; the audio graph itself is the
  one part a test cannot hold, and is hand-checked.
- Improve costs one model turn on the default model per press, recorded
  by the language gateway like any turn and nowhere else.
- The strip shows the tail of what has landed while the field is out of
  sight, which is what tells the person the transcriber is keeping up.
