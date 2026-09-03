# Plan: images on a turn, and the media roadmap

*Researched and, for the image half, implemented 2026-08-28. Companion to Task 39's
report; everything here was measured against the installed `@earendil-works/pi-ai`
0.80.10 catalogs, Flue's runtime (`@flue/runtime` 1.0.0-beta.9), and this
workspace's own code. No facts below are guessed.*

## Part A - What the catalog actually gives us (the honest answer)

### A.1 What the catalog covers today

| Capability | Catalog data | Capability slot | Invocation path today |
|---|---|---|---|
| Language (chat) | Pi language catalog: 35 providers, 1072 models | `textGeneration` | Six live protocols through `src/models/local/apis.ts` |
| Image INPUT (vision) | Per-model `input: ("text" \| "image")[]` on every Pi language record → mapped to `capability.vision` | `vision` field, deliberately NOT a slot (a slot is "which model handles this"; vision is a property of a chat model) | Works end-to-end as of this plan's implementation (below) |
| Image GENERATION | Declared: OpenAI `gpt-image-1` (also `imageEditing`), `dall-e-3`; Pi image catalog: 35 models, all through OpenRouter (`kind: media`, protocol `openrouter-images`) | `imageGeneration` + `imageEditing` slots | **None.** No route, no API loader; `DefaultsSection` says so in its own copy |
| Video GENERATION | Declared: Google `veo-3.0-generate-001`, `veo-3.0-fast-generate-001` — both `shape: "poll"` (long-running operation: response is a name to poll) | `videoGeneration` slot | **None** |
| Text-to-speech | Declared: OpenAI `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`; ElevenLabs `eleven_multilingual_v2`, `eleven_turbo_v2_5` | `speechGeneration` slot | **None.** Webview voice mode's `speaking` stage and waveform are explicit stand-ins |
| Speech-to-text | Declared: OpenAI `whisper-1`, `gpt-4o-mini-transcribe`; ElevenLabs `scribe_v1` | `transcription` slot | Webview seam is REAL and waiting: `useMicInput` captures live levels, `useDictation` records a real `audio/webm;codecs=opus` blob, and `features/voice/transcribe.ts` is the documented seam ("send note.blob to an ASR endpoint and return its text"). The harness has no ASR route yet |
| Web search / fetch | Declared: tavily, brave, exa, jina, firecrawl | `webSearch`, `webFetch` | **Live** (only non-language slots with an invocation path, via `MergedRetrievalResolver`) |
| Embeddings | Declared: OpenAI + Google | `embeddings` slot | None |
| Reranking | Nothing anywhere | `reranking` slot, all-unknown | None |

### A.2 The gaps, stated once

- **pi-ai 0.80.10 has zero speech surface.** Its media surface is images only
  (`generateImages`, one API: `openrouter-images`). No TTS, no STT, no audio
  input - its own `Model.input` type is `("text" | "image")[]`, so audio-input
  models (OpenRouter lists `openai/gpt-audio`) are catalogued as text-only.
  Everything media beyond the image catalog lives in our `declared-catalog.ts`
  as **data with no execution path**.
- `PiImageModel` drops the `output` field (`["image"]` vs `["image","text"]`)
  and reads only `cost`. Harmless today; matters if we ever surface
  image+text outputs (Nano Banana captions).
- `majorityProtocolFor` drives probes only; the runtime resolves each model
  through its own record. Media connections currently resolve nothing - there
  are no loaders for `openai-images`/`openrouter-images`/`elevenlabs`.

### A.3 Consequence (the second question answered)

The catalog does NOT give us media execution, and was never going to: it is
the one-place-a-provider-lives *data* layer. Providers we must support
manually, per capability:

- **Image gen:** OpenAI direct (`gpt-image-1`, `dall-e-3`), OpenRouter (35
  models via `openrouter-images`), plus, if we want them, fal.ai/Replicate as
  new declared entries (both are simple REST with async handles - fal uses
  queue endpoints, Replicate is poll-until-succeeded; both would arrive as a
  `declared` provider with an `InvocationShape`).
- **Video gen:** Google Veo (declared, `poll`), fal.ai (queue + poll), OpenAI
  Sora (when its API opens broadly). Nothing else is worth binding yet.
- **TTS:** OpenAI (`/v1/audio/speech`, sync bytes), ElevenLabs (declared,
  streams `audio/mpeg` bytes over plain HTTP POST - no WebRTC needed for
  one-shot speech).
- **STT:** OpenAI (`whisper-1`, `gpt-4o-mini-transcribe` - multipart upload),
  ElevenLabs Scribe (multipart upload). The webview already holds a real
  MediaRecorder blob; only the harness route is missing.
- **Live voice (the streaming "live mode" question):** this is a genuinely
  different transport family - Gemini Live and OpenAI Realtime are WebSocket/
  WebRTC session protocols, not request/response, and Pi has no surface for
  them. Plan it as its own later protocol kind (`realtime`), fed by the same
  connection store. It is NOT part of the tool work below.

## Part B: image upload - implemented this session

### B.1 What already existed (measured, not assumed)

Flue, the harness's agent runtime, has supported images end-to-end since it
landed: `POST /agents/studio/:id` accepts `{ message, images?: [{ type:
"image", data(base64, ≤14M chars), mimeType, filename? }] }`; it persists the
bytes (SHA-256-verified, 512 KiB chunks in `flue_attachment_chunks`), records
the user message with attachment refs, and on EVERY turn rebuilds the model
context with real `{type:"image", data}` content parts plus an
`<attachments>` manifest naming each image's id. Wire events carry metadata
only (bytes are redacted), and the webview transcript already renders
attachment chips from that metadata. **The entire gap was the webview front
half - nothing picked files, nothing stored them, nothing put `images` in the
body.**

### B.2 Answers to the design questions the task posed

- **How many images / how big?** One honest intersection of every provider we
  serve plus our own transport: **5 images per turn, 10 MB per image,
  PNG/JPEG/WebP/GIF.** Ten megabytes of binary encodes just under Flue's
  14M-character base64 ceiling with the JSON wrapper to spend. Rules run at
  pick time (before encoding), with named rejections shown in the composer.
  Per-provider headroom (Anthropic ~100, Google ~3600, Mistral 8, plus
  size/aspect ceilings) stays in the plan, not the UI - no provider we serve
  accepts *fewer* than these rules.
- **Does the model re-see the images later turns?** Yes - necessarily. Chat
  APIs are stateless: every turn re-sends the conversation. Flue rebuilds the
  context from its journal each turn and re-projects every attachment as a
  real image part, so the model sees the pixels again each turn, forever,
  even across restarts. The manifest gives images stable ids for reference;
  the pixels always travel. This is also why the 5-image rule matters: it is
  a recurring per-turn cost, not a one-time upload.
- **Bytes or path?** Bytes - the only correct answer here. The attachment
  directory is deliberately outside the sandbox's read roots; the read tool
  is text-only and refuses binary; every tool call is permission-gated. There
  is no path the model could follow to see the picture. So the image is read
  at pick time and sent base64 in the moment of submission. (The sandboxed
  model also cannot fetch from the web by default - web fetch is itself a
  gated tool.)
- **PDFs and other attachments:** deliberately not started. Files need an
  in-turn chunking policy and provider-side file surfaces (Anthropic files
  API, OpenAI file search); that is its own task. The `Files`/`Folder` items
  stay honest no-ops.

### B.3 What shipped (files)

- `src/domain/attachments/images.ts` - the rules: four formats, 5/turn, 10 MB
  each, magic-byte sniffing (the header outranks the filename), and
  `visionRefusal(modelId, count, models)` for the send-time model check.
- `Composer.tsx` - strip state, hidden file input, receipt-clear rule that
  treats text+images as one message identity.
- `PendingImages.tsx` - thumbnails inside the frame above the field; the
  preview IS the base64 string the submission carries.
- `AddMenu.tsx` - Image item wired to the picker (demo/gallery keeps no
  handler, since the demo transport carries only words).
- `conversation.ts` - `TurnImageWire` + optional third `submitTurn` parameter;
  a text-only turn's body is byte-for-byte what it always was.
- `useConversation.ts` / `useConversationTranscript.ts` / `first-turn.ts` /
  `ChatPage.tsx` / `StartConversation.tsx` - images threaded through every
  send surface, with the pre-send vision refusal rendered as a SendRefusal
  beside the connection notices.
- Receiving side needed nothing: Flue persists and echoes attachments, and
  `LiveUserMessage` already rendered attachment chips.

## Part C: architecture - what is a tool, and what is the app itself

*Revised 2026-08-28 after review: speech and transcription are NOT agent
tools. Speaking and hearing are things the software does for its person -
the microphone button, read-aloud on a reply - not things a model asks for.
Only generation that a model would request inside a turn is a tool.*

### C.1 The corrected split

| Capability | Surface | Who invokes it | Permission posture |
|---|---|---|---|
| Image generation / editing | `studio_image` native tool | the model, inside a turn | CallGate / PermissionKernel, like every tool |
| Video generation | `studio_video` native tool | the model, inside a turn | same |
| Speech-to-text | dictation in the composer | the person, with the mic button | none - the user's own key, their own audio, like `GET /library` |
| Text-to-speech | read-aloud on replies | the person, with the speaker control | none - same reasoning |
| Live voice (later) | voice mode | the person | its own task, separate protocol family |

This keeps the permission surface honest: a tool is a thing the model does
that the person may want to veto. Dictation and read-aloud are the person
acting, so they flow through plain `/api/media/...` routes behind the
standard admission scope, exactly like the providers routes - never through
the permission kernel.

### C.2 Where the code goes (harness) - and why no file is a monolith

The tree mirrors the two seams that already exist: `models/local/apis.ts`
(one loader per language protocol) and `tools/native/` (one file per tool).
Media gets the same one-responsibility-per-file discipline:

```
src/media/resolve.ts
    The ONLY module that names capability slots for media. Wraps
    CapabilityResolver.resolve(slot) into media's own vocabulary
    (slot -> {connection, model, credential, baseUrl, protocol}).
    Deliberately thin: the seam already exists; this adapts it, it does not
    re-decide anything.

src/media/drivers/types.ts
    One result type per capability (SpeechResult {audioBase64, mimeType},
    TranscribeResult {text}, ImageResult {images[{data,mimeType}]},
    VideoResult {fileBase64, mimeType}). Four small types, not one
    god-interface.

src/media/drivers/openai-speech.ts        POST /v1/audio/speech -> audio bytes
src/media/drivers/openai-transcribe.ts    multipart POST /v1/audio/transcriptions
src/media/drivers/elevenlabs-speech.ts    POST /v1/text-to-speech/:voice -> streamed audio
src/media/drivers/elevenlabs-transcribe.ts  scribe multipart upload
src/media/drivers/openai-images.ts        /v1/images/generations + /edits, b64_json
src/media/drivers/openrouter-images.ts    thin wrap of Pi's generateImages (the one image API Pi ships)
src/media/drivers/veo.ts                  poll shape: POST predictLongRunning -> GET operation -> download

    One file per protocol, each ~100-200 lines: build request, call
    requestDirect, parse response, map errors to StudioError subclasses.
    No driver imports another driver; no driver knows about slots.

src/media/multipart.ts
    The multipart body builder shared by the two transcribe drivers (binary
    parts, boundary, content-length) - the one piece of non-trivial wire
    mechanics, owned once.

src/media/service.ts
    Dispatch: capability slot + optional model hint -> resolve -> driver by
    protocol -> result. Owns the shape branch (sync vs poll), the ceilings
    (audio minutes per call, image count), and nothing else. This is the
    single module routes and tools both read, so the two surfaces can never
    drift about which driver serves what.

src/contracts/media.ts
    Valibot schemas for the route payloads
    (transcribe: {audio base64, mimeType, modelId?}; speech: {text, modelId?,
    voiceId?}; image/video jobs later) - same pattern as contracts/providers.ts.

src/transport/http/routes/media.ts
    POST /api/media/transcribe, POST /api/media/speech. Thin: parse ->
    service -> respond, error-status mapping like routes/retrieval.ts.

src/net/http.ts                          (extension, not rewrite)
    `body?: string | Uint8Array` (write() already takes both; the type was
    the only gate) and one new `requestBinary()` reader that reads the same
    pinned stream into a Buffer under the same ceiling. Audio responses are
    binary; the current utf8 reader would corrupt them. The judge-pin-redirect
    path is untouched - one security path stays one.

src/tools/native/media/image.ts          studio_image
src/tools/native/media/video.ts          studio_video
src/tools/native/index.ts                registers the two (two lines)

src/app.ts                               constructs MediaService, mounts routes (wiring only)
```

Generated artifacts land in `conversationArtifactsDirectory(id)` - the
directory already exists, is created at admission, is a sibling of the
sandbox root (the model cannot browse it), and purge already removes it with
the conversation. `studio_image` returns a real image block to the loop (the
runtime already carries `ModelImageContent` for tool results) and writes the
file; `studio_video` writes the mp4 and returns path + summary. **No new SQL
tables**: Flue's journal owns the transcript record, the disk owns the bytes,
and a speculative artifact index would be schema we cannot yet justify.

ElevenLabs voice choice is a connection setting, not a tool argument:
stored on the connection record, surfaced in the Providers pane, read by the
driver through `resolve`.

### C.3 Where the code goes (webview)

```
src/platform/harness/contracts.ts        parse mirrors for the two media routes
src/platform/harness/client.ts           HarnessClient.transcribe(), HarnessClient.speak()
src/features/voice/transcribe.ts         the documented stub finally filled: client.transcribe(note.blob)
                                         (keeps the bracketed stand-in only when no harness answers)
src/features/chat/transcript/live/AssistantTurn.tsx
                                         speaker control beside the copy action; busy while speaking
src/features/voice/speak.ts              play/stop helpers around one Audio element, no queue until asked for
```

## Part D: sequencing - the milestones, and where each starts

| # | Milestone | Ships | Size |
|---|---|---|---|
| M1 | Media foundation **(SHIPPED 2026-08-28)** | contracts/media.ts, resolve.ts, net/http binary extension, multipart.ts, routes/media.ts + openai speech+transcribe drivers, tests | done |
| M2 | Dictation live **(SHIPPED 2026-08-28)** | client.transcribe + transcribe.ts seam filled - the mic button transcribes on the model the Providers pane names | done |
| M3 | Read-aloud | client.speak + speaker control on replies (openai-speech driver already landed in M1; elevenlabs-speech + voice-id setting rides here) | small |
| M4 | studio_image | openai-images + openrouter-images drivers, the tool, registration, artifact write, permission posture, loop image block | one session |
| M5 | studio_video | veo driver (poll shape), the tool | half session |
| M6 | polish (optional) | per-protocol connection probes; per-provider image headroom overrides; models.dev limits | as wanted |

M1 verification, for the record: `tests/unit/media-routes.test.ts` (7 tests)
drives the REAL provider store through a fake OpenAI audio server on a real
loopback socket - multipart upload bytes inspected, binary audio round-trips
base64, unset slot refuses before the wire, provider refusals relay their own
sentence and never a key. `net-http.test.ts` gains the binary reader test.
STUDIO 357 passed / 0 failed (33 files); harness typecheck + build clean, the
30-failed sandbox baseline unchanged.

Everything above reuses one of three existing seams - `CapabilityResolver`
for slots, `requestDirect` for the wire, `registerNativeTools` for tools -
so no milestone opens a new architectural front.

## Appendix: per-provider functional matrix (the wire facts)

| Slot | Vendor | Protocol shape | Notes |
|---|---|---|---|
| imageGeneration | OpenAI | sync, b64_json | gpt-image-1 (+ imageEditing), dall-e-3 |
| imageGeneration | OpenRouter | sync via Pi generateImages | 35-model catalog already in Pi |
| imageEditing | gpt-image-1 / OpenRouter | sync, input image as part | |
| videoGeneration | Google Veo | poll: POST -> operation -> GET -> download | declared models carry shape "poll" |
| videoGeneration (later) | fal.ai / Replicate | queue -> status -> result | new declared providers when wanted |
| speechGeneration | OpenAI | sync, binary audio response | tts-1, tts-1-hd, gpt-4o-mini-tts |
| speechGeneration | ElevenLabs | sync, streamed audio | voice id from the connection record |
| transcription | OpenAI | multipart upload | whisper-1, gpt-4o-mini-transcribe |
| transcription | ElevenLabs | multipart upload | scribe_v1 |
| live voice | Gemini Live / OpenAI Realtime | WebSocket/WebRTC session | separate protocol kind, own task, never through mediaProtocol |
