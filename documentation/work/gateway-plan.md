# The gateway — the plan

**Status:** Steps 1–7 landed · **Opened:** 2026-09-11 · **Last worked:** 2026-09-11
**Inputs:** [the architecture brief](provider-architecture-brief.md) and
[the protocol research](provider-protocol-research.md). Both are read as
evidence here, not repeated.
**Decision:** [ADR 0051](../decisions/0051-pi-is-the-language-gateway-and-nothing-else.md).
The four decisions in §2 were answered yes on 2026-09-11.

The brief said what the shape should be. The research checked the wire
protocols and found that nothing on the list needs a webhook. This document
turns both into an order of work.

---

## 1. The shape, in one picture

```
STUDIO HARNESS/src/gateway
  language/     Pi (@earendil-works/pi-ai), and nothing else imports Pi
                text chat, vision-in, tool calls, streaming — as today
  media/        our own adapters, one per vendor wire family
                speech, transcription, image, image editing, video
  retrieval/    the five web providers that already exist, moved in
                search: tavily · brave · exa      read: jina · firecrawl
  catalog/      what each connection can serve, and where that knowledge
                comes from: Pi for language, our declared list for the rest
  connections/  the store, keychain credentials, probes (today's providers/)
```

The rule that makes it a subsystem rather than a folder: **Pi is imported
only under `gateway/language`.** Today it is imported from ten files across
`models/`, `platform/`, `reliability/` and `providers/library/`. After step 1
an import of `@earendil-works/pi-ai` anywhere else fails lint. Media and
retrieval never route through Pi; they are our code speaking to vendors
directly, which is already true and becomes enforced.

The tool surface stays ours. The model sees `studio_image`, `studio_video`,
`web_search`, `web_fetch`; which vendor answers is a setting. This is the rule
ADR 0049 §2 already set for the browser.

---

## 2. The four decisions this waits on

Each has a recommendation. Answering "yes to all four" is a complete answer.

**D1 — The chat gateway is Pi, confined to language.** Recommended: yes. Pi
covers 35 providers and about a thousand text models with pricing, and nothing
else in the package is worth keeping (its one image path is OpenRouter only,
through the deep read in `image-catalog.ts`, which goes).

**D2 — The media provider list.** This is the list, given as an
instruction on 2026-09-11, checked against the vendors' live model listings
the same day. One fact changed the shape of it: **OpenRouter now serves every
media modality, not only images.** It has `POST /api/v1/audio/speech` and
`/api/v1/audio/transcriptions` (OpenAI-compatible), `POST /api/v1/images`,
and a polled `POST /api/v1/videos` with its own download endpoint. Its live
lists on the day: 52 image models, 29 video models, 18 speech models, 20
transcription models. The research of 2026-09-08 said "images only"; that
was wrong, or three days stale.

| Order | Provider | Slots it fills | Why this one |
|---|---|---|---|
| 1 | **OpenRouter** | speech, transcription, image, image editing, video | one key the person already holds for chat now reaches Fish Audio, MiniMax, Deepgram, Google, OpenAI, Recraft, Black Forest Labs, Runway, Kling, Seedance, Wan, Veo, Sora |
| 2 | **OpenAI** | image (`gpt-image-2`, `gpt-image-2.5-sunburst`, `gpt-image-2.5-flare`), image editing, speech, transcription | the audio drivers exist; simplest wire |
| 3 | **ElevenLabs** | speech, transcription (Scribe) | the voice surface OpenRouter does not carry |
| 4 | **Google** | image, image editing, video (Veo, Omni), speech, transcription | four slots on one key, source pricing |
| 5 | **FAL** | video, image, image editing | the deepest hosted catalogue and the best queue protocol |
| 6 | **Deepgram** | transcription, speech (Aura) | the cleanest ASR wire and a 2 GB cap |
| 7 | **Fish Audio** | speech, transcription | a sync-bytes adapter; voice cloning if wanted |
| 8 | **MiniMax** | speech, transcription, video | the developer uses it daily; one sync adapter for audio, and a polled one for video |

Two aggregators on purpose. OpenRouter is the wide one — every modality on
the chat key. FAL is the deep one for video: models land there first, its
queue has durable ids, cancel, and a status stream, and it is the fallback
if a model is not on OpenRouter. Both are worth their adapter.

Not as direct adapters: **Black Forest Labs**, **Runway**, **Recraft** and
**Seedance**. All four are on OpenRouter today (`black-forest-labs/flux.2-*`,
`flux-3-video`, `runway/gen-4.5`, `runway/aleph-2`, `recraft/recraft-v4.1-*`,
`bytedance/seedance-2.5`) and on FAL, so the models are reachable on day one
through adapters we already write. A direct adapter would buy source pricing
and first-day access to new releases, at the cost of one more wire shape
forever; that trade is not worth it while both aggregators carry them. Any
one of them is a later, single-step addition if a reason appears.
**Groq** is not added, by instruction. **Replicate** overlaps FAL with
one-hour expiry on everything. **RunPod** and **ComfyUI** are infrastructure
the user runs, a separate feature.

**D3 — One key serves every kind.** Recommended: yes, as a contract change.
Today a connection is one `kind`, so OpenAI-for-chat and OpenAI-for-images
are two connections and the same key typed twice. The fix is that a
connection is to a *vendor*, and the vendor's connection declares which
gateways it serves (`language`, `media`, `retrieval`, any subset). This is
the only contract change with a migration, and it comes first, before any
adapter, so no adapter is written against the old shape.

**D4 — Video and slow images are background jobs with artifacts.**
Recommended: yes. Every video provider polls; every polled result is a URL
that dies (10 minutes at BFL, an hour at Replicate, a day at Wan, two at
Veo). So a job downloads the bytes the moment it completes and stores them in
Studio's own store; a vendor URL is never the artifact. The `BackgroundJobs`
machinery, the rail panel and the Stop already exist and are reused whole.

---

## 3. The answers to the standing questions

**Web search and fetch.** Nothing to build. Five providers exist, are wired,
and split the right way (search answers a question; read fetches a page).
The work is (a) a settings screen that admits they exist, (b) two one-line
repairs the research found: Exa's auth header moved to `Authorization:
Bearer`, and Firecrawl's `/v1/scrape` is superseded by `/v2/scrape`.
Search and fetch stay one tool each with a provider setting; the model never
picks a vendor.

**Chat models.** Pi, unchanged in behaviour, moved under `gateway/language`.
Model catalogue and pricing keep coming from Pi's package. Nothing in the
runtime, retry policy or prompt trace changes except import paths.

**Speech and transcription.** OpenRouter, OpenAI (exists), ElevenLabs,
Google, Deepgram, Fish Audio, MiniMax. All synchronous; none needs a job. The declared catalogue is stale
and is corrected in step 2: `whisper-1` and the `gpt-4o-*-transcribe` ids are
deprecated for 2027-02-26 in favour of `gpt-transcribe`; `scribe_v1` is now
`scribe_v2`; `eleven_turbo_v2_5` is deprecated for `eleven_flash_v2_5`.

**Image and video.** OpenRouter (images sync, video polled with its own
download endpoint), OpenAI and Google synchronous (base64 inline), FAL
polled, MiniMax polled for video. `dall-e-3` in the declared catalogue was removed by the vendor on
2026-05-12 and `gpt-image-1` shuts down 2026-10-23; the current model is
`gpt-image-2`, with `gpt-image-2.5-sunburst` and `gpt-image-2.5-flare`
released this month. `veo-3.0-*` is deprecated; `veo-3.1-*` is current, and the
Imagen family shuts down 2026-08-17 (already past), so Google images are the
Gemini image models through the Interactions API.

**Embeddings.** The slot stays; no adapter, no screen. Nothing in the harness
consumes an embedding, and a setting that changes nothing observable is worse
than none. The first consumer (workspace retrieval or memory) is the decision,
and it brings its own step.

**A models.dev for media.** There is none. models.dev, which we already use
for icons, covers language models only. The closest things are each
aggregator's own listing: OpenRouter `GET /api/v1/images/models`, FAL's model
and pricing endpoints. So the media catalogue is our declared list, curated
by hand and dated, with no pricing shown; audio, image and video pricing is
per second, per image, per character, per minute, and there is no honest
single number to print. Two live listings are worth reading at connection time rather
than declaring: OpenRouter's (`/api/v1/images/models`, `/api/v1/videos/models`,
`/api/v1/models?output_modalities=speech|transcription`, all with pricing
fields) and FAL's. Direct vendors stay declared by hand.

---

## 4. The steps, one commit each

1. **The gateway takes shape.** Create `gateway/` and move `models/`,
   `media/`, `retrieval/`, `providers/` and the two catalogues under it;
   delete `image-catalog.ts` and its Pi deep read; add the lint rule that
   confines `@earendil-works/pi-ai` to `gateway/language`. No behaviour
   changes; every existing test passes with import paths updated. ADR 0051
   is written with this step.
2. **A connection is to a vendor.** The contract change from D3: a
   connection declares the gateways it serves; the store migrates existing
   single-kind connections; one key is entered once. The declared catalogue
   is corrected to current model ids in the same step, because the catalogue
   is what the migration reads.
3. **Media adapters, and a media job.** `gateway/media` gains the adapter
   interface every vendor implements — `sync` returns bytes, `poll` returns a
   job id and a status reader, and every result is bytes the harness owns.
   The `MediaJob` is a `BackgroundJobs` job with an artifact on completion
   and a Stop that calls the vendor's cancel when one exists.
4. **OpenRouter media.** The first adapter, because it reaches the most
   models on a key the person already has: speech and transcription on the
   OpenAI-compatible audio endpoints, images on `/api/v1/images`, video as a
   job on `/api/v1/videos` with its download endpoint. `studio_image` and
   `studio_video` both land here, dispatching through `MediaService`. The
   four live listings are read at connection time.
5. **OpenAI and ElevenLabs.** The OpenAI adapter widens from images to the
   media family (gpt-image-2 and 2.5, edits, speech, transcription) and the
   two existing audio drivers fold into it. ElevenLabs gains speech and
   Scribe.
6. **Google and FAL.** The Interactions API family (image, TTS,
   `gemini-3.5-transcribe`, Veo through `predictLongRunning`, Omni Flash),
   with Veo's documented contradiction smoke-tested first. FAL's queue:
   submit, status, response, cancel, and the upload path for input images;
   its catalogue read at connection time.
7. **Deepgram, Fish Audio, MiniMax.** Three synchronous audio adapters and
   MiniMax's polled video, each small, each one commit.
8. **Settings.** "Models and Providers" becomes **Providers**, holding
   **Models** (language), **Media** (image, video, audio) and **Tools**
   (search and fetch). Adding a provider offers a vendor list; a vendor's
   page shows every gateway it serves and one key field. The retrieval page
   is where Brave, Exa, Jina and Firecrawl become visible for the first time.
   The Exa header and Firecrawl v2 repairs land with it.

Steps 1–3 are structural and carry no new provider; nothing a user can
touch changes until step 4, which alone lights every media slot. That is deliberate: every adapter after step 3
is written once against the final shape.

---

## 5. What is out of scope, and where it went

- Black Forest Labs, Runway, Recraft, Seedance, Alibaba: reachable through
  OpenRouter and FAL, no direct adapter, reasons in §2 D2. Each is one
  adapter under `gateway/media` if wanted later. Groq: excluded by
  instruction. Replicate: overlaps FAL.
- RunPod and ComfyUI: a separate feature, attaching to a backend the user
  operates. Its own brief when asked for.
- Embeddings: §3.
- Voice on the phone (HTTPS): the remote-access thread, not this one.
