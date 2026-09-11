# The media catalogue and dictation — the plan

**Status:** Planned, not started (2026-09-11) · **Opened:** 2026-09-11 · **Last worked:** 2026-09-11
**Inputs:** [the gateway plan](gateway-plan.md) (landed), the developer's
FAL model research of 2026-09-11 (Elo arena rankings against FAL prices,
image and video only), and two live checks made while planning: the
OpenRouter media listing answers 54 image, 29 video, 18 speech and 20
transcription models today, and FAL's `GET https://api.fal.ai/v1/models`
lists its whole catalogue with a category per model.
**Decision:** none yet; D1, D3 and D5 below become ADRs when their steps land.

The gateway can drive eight media vendors, but the person can only see a
handful of models on most of them, because the declared catalogue is a
hand-written shortlist. The composer has a microphone button that does
nothing when pressed, and even when it works it says nothing until the
recording stops. This document decides both, in an order of work.

---

## 1. What is true today

**Catalogue.** Only OpenRouter is listed live (four `output_modalities`
queries, an hour's cache). FAL, Google, Deepgram, Fish Audio, MiniMax,
ElevenLabs and OpenAI's media models come from `declared-catalog.ts`, a
curated list of three to six ids per vendor. Any model can be added by id on
the connection row, but discovery is limited to the shortlist. The
developer's research names some fifty current models on FAL alone, in
categories Studio has no slot for (upscaling, video editing, reference-image
generation), and in the categories it does have, the shortlist is a year
behind the arena.

**OpenRouter on the Media page.** The harness returns 121 media models for
an OpenRouter connection today. If the page shows fewer, the fault is on the
way to the screen, not in the listing; §4 step 0 is to look.

**Dictation.** `features/voice/` is complete as a batch: `useMicInput` runs
`getUserMedia` → AnalyserNode → MediaRecorder, `useDictation` posts the
recording to `POST /api/media/transcribe` on stop and appends the text to
the field, `DictationBar` shows level bars, a clock, a processing face and a
blocked face. Pressing the button and seeing nothing means `getUserMedia`
neither resolved nor rejected: the stage stays `requesting`, which has no
face of its own. The most likely cause is that WebView2's permission
request for the microphone is never answered inside the Tauri window. That
is a diagnosis to make in the running app, not a guess to build on.

---

## 2. The decisions

### D1. Live where the vendor lists, declared only where it does not, and the declared list becomes a "featured" shelf

A vendor that publishes a model listing is listed live, the way OpenRouter
already is: fetched on demand, cached an hour, empty answers not cached,
every entry classified into Studio's slots from the vendor's own metadata.
A vendor with no listing keeps a declared list. The declared entries stop
being the catalogue and become the **featured** shelf: the few models Studio
recommends per slot, shown first and marked, with the live list beneath.
That is where the developer's research goes — not into a bigger hand
list, but into which few models are featured.

Per vendor:

| Vendor | Listing | Classification |
|---|---|---|
| OpenRouter | live (exists) | `output_modalities`, `input_modalities` → imageEditing |
| FAL | **live**, `api.fal.ai/v1/models` paged, `Key` auth | `metadata.category`: text-to-image → imageGeneration; image-to-image → imageEditing; text-to-video and image-to-video → videoGeneration; text-to-speech → speechGeneration; speech-to-text → transcription; others not listed (see D2) |
| ElevenLabs | live, `/v1/models` (exists for probe) | `can_do_text_to_speech`; Scribe ids declared |
| Google | live, `/v1beta/models` | `supportedGenerationMethods`: `predictLongRunning` → video; `generateContent` with image output → imageGeneration; TTS ids declared |
| OpenAI | live ids from `/v1/models`, capability by id pattern | `gpt-image-*` → image generation and editing; `*tts*` → speech; `*transcribe*`, `whisper-*` → transcription; `text-embedding-*` → embeddings |
| Deepgram, Fish Audio, MiniMax | declared (no listing, few models) | as today |

No pricing is shown for media, as decided in the gateway plan; FAL's
listing carries prices, and they are read but not surfaced until a format
exists to show them honestly.

### D2. The slots stay as they are; categories Studio cannot drive are not listed

FAL and OpenRouter list upscalers, video editors, background removers,
lip-sync and more. Studio has no tool that would call them, and a model in
the picker that nothing invokes is the placeholder problem the gateway
plan just removed. So: a live listing keeps only the categories that map to
an existing slot, and the count of what it dropped is recorded in the
listing's log line, so the next slot (image upscaling is the obvious first)
is decided from a number rather than a feeling. Image-to-video is
videoGeneration — the tool already takes an input image.

### D3. Dictation becomes live by segments, on the adapters that exist; true streaming is a later adapter capability

"Live" means text appears while the person is still speaking. Two ways:

- **Segments.** Keep recording; every time the level analyser sees a pause
  of ~700 ms after speech (or a 12 s ceiling), cut the MediaRecorder, post
  that segment to the same `/transcribe` route, and append the text as it
  returns. Works on every transcription adapter already built, with no new
  wire, and the final flush on stop is the batch path as today.
- **Streaming.** Deepgram, ElevenLabs and OpenAI each have a websocket
  realtime API. Each is a new adapter method (`transcribeStream`), a new
  route shape, and a vendor-by-vendor build.

Segments first. It is one commit on the frontend and one route reuse, and
the two-second lag it carries is what the person asked for ("parallelly
transcribed"). Streaming is recorded as the next step for whichever vendor
the person actually dictates through, once segments show the lag matters.

### D4. Improve is an offer after dictation, a one-shot agent on the default model, and undoable

After a dictation ends, the composer shows a small **Improve** chip beside
the dictated text, only while that text is still unedited and unsent. It
sends the dictated span (not the whole field) to a one-shot agent in the
shape of `agents/title.ts`, on the conversation's default language model,
with a fixed instruction: fix punctuation and casing, drop fillers and
false starts, keep every fact and the person's own words and language,
return the text only. The reply replaces the span; the original is held so
one gesture puts it back. Nothing is persisted: no message, no turn, no
usage row beyond what the language gateway already records.

### D5. The microphone is granted by Studio itself, on every webview, before the page asks

WebView2 answers a page's `getUserMedia` by raising `PermissionRequested`
on the host. Left unhandled in a Tauri window the request stalls, and
handled by the default it shows Edge's own permission bar inside Studio's
frame — a foreign UI in a window that draws its own chrome. Studio answers
the event itself: for its own origin and the microphone kind, `Allow`,
every time, for every webview it creates (the main window from
`tauri.conf.json`, the diagnostic window and the pop-outs from `lib.rs`),
attached from `on_webview_ready` so no builder can forget it. Other kinds
(camera, location, notifications, clipboard read) are `Deny` — Studio asks
for nothing else, and a page that asks anyway gets no bar to click. The
grant is per origin, so a remote page served to a phone is not affected:
it runs in the phone's browser, which asks in its own way.

This is the developer's own approach from a previous Tauri application,
and it is the right one here for one more reason: the person already chose
to install Studio and press the microphone; a second prompt in a borrowed
style answers a question nobody asked. The remaining check is Windows's
own microphone privacy setting, which no handler can override; when that
refuses, `getUserMedia` rejects with `NotAllowedError` and the strip's
blocked face says so, as it does today.

---

## 3. Questions answered before they are asked

**Why not one adapter per FAL model family?** FAL's queue is one wire for
every model; the adapter already takes any endpoint id. Listing is the whole
gap.

**Why keep declared lists at all?** Three vendors have no listing, and the
featured shelf is how a recommendation reaches the picker without a person
reading two hundred ids.

**Why not Web Speech API for dictation?** It is Google's recogniser via the
browser, not the person's chosen provider, and WebView2 does not ship it.

**What if the microphone is blocked by policy, not by an unanswered
prompt?** Then the fix is a Tauri capability, not a handler; step 1 finds
out which.

---

## 4. The steps, one commit each

0. **Look, then fix what the look shows.** Restart Studio on the rebuilt
   harness. On the Media page with an OpenRouter connection: count what
   shows against the 121 the harness returns; if fewer, find the filter and
   fix it. Press the microphone: confirm the stage stalls at `requesting`,
   then land D5 — the `PermissionRequested` handler on every webview
   through `with_webview` and the `webview2-com` crate at the version
   Tauri 2.11 pins — and give `requesting` a face so a stall can never
   look like nothing again. Tests: the pane against a 121-model
   answer; the dictation hook against a `getUserMedia` that never settles.
1. **The listing contract.** A `MediaListing` interface in
   `gateway/catalog/` with the hour cache, empty-not-cached rule and slot
   classification pulled out of `openrouter-media.ts` so a second vendor
   does not copy it; `DeclaredModel.featured` and the `featured` flag on the
   contract model; the pane shows featured first and marked.
2. **FAL live.** Paged `api.fal.ai/v1/models`, category mapping per D1,
   dropped categories counted; the probe already reaches this host. The
   declared FAL entries become featured and are brought to the research's
   picks (Wan 3.0, MiniMax H3, Seedance 2.x, FLUX.2, Nano Banana 2,
   Seedream 5.0, Qwen Image 3).
3. **ElevenLabs, Google and OpenAI live**, each by its own listing and rule.
4. **Segmented dictation.** Pause detection over the analyser the bar
   already reads; segment post and append; final flush; the bar shows the
   text arriving. Tests with a scripted level and a stand-in transcriber.
5. **Improve.** The chip, the one-shot agent, the replace-and-restore.
   Tests: the chip appears only for unedited dictated text; the agent
   receives the span and nothing else; undo restores the original.
6. **ADR** for D1 and D3, written when steps 2 and 4 have landed and the
   decision has been exercised.

Each step: written, tested against stand-ins on loopback, suites green on
both sides, one commit, pushed to `main`.

---

## 5. Out of scope, and where it went

- Slots for upscaling, video editing and reference-image generation: D2,
  decided from the dropped-category count after step 2.
- Streaming transcription: D3, after step 4 shows whether the lag matters.
- Read-aloud and voice mode already exist and are not touched; they gain the
  wider speech listing for free.
- Media pricing: still no honest format; unchanged from the gateway plan.
