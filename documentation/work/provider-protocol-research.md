# Providers beyond text — the protocols

**Status:** Research and analysis · **Opened:** 2026-09-08
Companion to [the architecture brief](provider-architecture-brief.md). The brief
did the architectural half; this document does the other half — the actual wire
protocols, checked against the vendors' own documentation in September 2026.

**Method.** Every claim below was checked against a vendor documentation page
during this research, and the citation follows it. Where something could not be
confirmed from the vendor's own pages, it is written as *unconfirmed* with an
account of what was missing — these APIs change often, and a confidently wrong
request shape becomes an adapter someone debugs for a day. The constraints
applied throughout, from the brief and the contract, are: webhooks are
impossible (nothing behind NAT has an inbound URL, so the only supported
waiting shapes are `sync`, `poll` and `stream`); auth is one user-supplied API
key held in the OS keychain (OAuth, service accounts and cloud IAM signing are
flagged loudly when found); and the tool surface is ours, so only the wire
shape matters, not the vendor's SDK.

---

## 1. The one-page summary

**The headline: no provider on the named list fails the no-webhook filter.**
Every video provider has a polling path — Runway's API has no webhook feature
at all, FAL and Replicate treat webhooks as an optional extra, Veo and Wan and
MiniMax document submit-then-poll as the normal flow, and BFL's whole API is
poll-shaped. The filter that actually bites is not the waiting shape; it is
**result lifetime**. Most video providers hand back a URL that dies — BFL in
10 minutes, Replicate in an hour, Wan in 24 hours, Runway in 24–48, Veo in two
days — and none of the polled ones except OpenRouter and OpenAI will hand over
bytes inline. The consequence for design is the same as the brief's §5.5
question: the harness must download and own the bytes at the moment a job
completes, and "how long does this URL live" becomes adapter knowledge the
scheduler can never ignore. This is evidence for the brief's instinct, not
against it: a polled video job with an artifact on completion is exactly the
`BackgroundJobs` machinery that already shipped.

**The recommended order, with the reasoning:**

1. **Audio first — OpenAI and ElevenLabs.** Audio is the cheapest path from
   contract to visible capability because everything is one synchronous
   round trip, two of the three existing `mediaProtocolSchema` entries are
   already audio-shaped, and the OpenAI speech and transcription drivers
   already exist in `media/drivers/`. OpenAI's adapter also picks up image
   generation on the same key, and ElevenLabs's picks up Scribe.
2. **FAL second — the video backbone.** One adapter speaking one queue
   protocol buys the entire hosted video catalogue (Veo, Kling, Wan,
   Seedance, Hailuo, LTX, Grok Imagine, FLUX 3) plus editing-capable image
   models, with durable request ids, a documented cancel endpoint, and an SSE
   status stream. It is the only aggregator in the named list that carries
   video at all, and its queue matches `BackgroundJobs` almost field for
   field.
3. **Google third.** One key and one adapter family now covers four slots —
   image generation, TTS, a dedicated transcription model
   (`gemini-3.5-transcribe`), and video through Veo — which is the best
   slots-per-adapter ratio of any direct vendor. It costs the newest API
   surface in this research (the Interactions API went GA in June 2026) and
   one smoke test on the Veo docs, flagged below.
4. **OpenRouter images alongside, as breadth.** Already a contract entry, and
   the same key the user already holds for text. Its image API is sync-only
   with a documented 94-second hold and no job id, so it is breadth on top of
   the backbone, not the backbone itself.
5. **Direct specialists last, each for one reason:** Runway for its own video
   models, Black Forest Labs for FLUX image quality and its editing lineage,
   Deepgram when users outgrow the OpenAI 25 MB transcription cap.

**Recommend against initially, with what that gives up:** Replicate (a second
aggregator, but with the strictest expiry discipline in the research and a
semi-documented file-upload endpoint, overlapping what FAL already buys);
MiniMax direct and Alibaba Wan direct (both reachable through FAL and Runway);
Fish Audio (a fifth TTS voice in a modality already covered three times).

Full reasoning and the per-adapter trades are in §5. Everything is a
recommendation — which providers to support is a product decision with a
permanent maintenance cost, and it is not made here.

---

## 2. Modality tables

"Survives no-webhook" means: the job can be submitted and its completion
learned entirely without an inbound URL.

### 2.1 Image

| Provider | Wait shape | Result shape | Auth | Survives no-webhook |
|---|---|---|---|---|
| OpenRouter `/api/v1/images` | `sync` (SSE stream optional, OpenAI models only) | base64 inline | Bearer key | Yes |
| OpenAI gpt-image-2 | `sync` (SSE partials optional) | base64 inline | Bearer key | Yes |
| Google Gemini image (Interactions API) | `sync` | base64 inline | API key header | Yes |
| Black Forest Labs FLUX.2 | `poll` | signed URL, **10-minute life** | `x-key` header | Yes |
| Runway `text_to_image` | `poll` | URL, 24–48 h life | Bearer key | Yes |
| FAL image models | `poll` (sync for fast models) | CDN URL, retention configurable | `Key` header | Yes |
| Replicate image models | `sync` ≤60 s via `Prefer: wait`, then `poll` | URL, **1-hour life** | Bearer key | Yes |

### 2.2 Video

| Provider | Wait shape | Result shape | Auth | Survives no-webhook |
|---|---|---|---|---|
| Google Veo 3.1 | `poll` (long-running operation) | URL on the Gemini file store, **2-day life**; bytes obtainable | API key header | Yes |
| Google Omni Flash | `sync` by default; `poll` of the Files API above 4 MB; SSE optional | inline base64, or file URI (TTL unconfirmed) | API key header | Yes |
| Runway `text_to_video` / `image_to_video` | `poll` (no webhook exists in the API) | URL, 24–48 h life | Bearer key + version header | Yes |
| FAL-hosted video models | `poll` (sync and SSE optional) | CDN URL, retention configurable | `Key` header | Yes |
| MiniMax H3 (v2 API) | `poll` | URL, "time-limited", re-query to refresh | Bearer key | Yes |
| MiniMax Hailuo (v1 API) | `poll`, then a second call: `file_id` → download URL (**1-hour life**) | URL | Bearer key | Yes, with a two-step indirection |
| Alibaba Wan (DashScope) | `poll` only — sync calls are refused | URL, **24-hour life**; task id itself only queryable for 24 h | Bearer key | Yes |
| BFL FLUX 3 video | `poll` | signed URL (lifetime undocumented; images expire in 10 min) | `x-key` header | Yes |
| Replicate video models | `sync` ≤60 s, then `poll` | URL, **1-hour life** | Bearer key | Yes |

### 2.3 Text to speech

| Provider | Wait shape | Result shape | Auth | Survives no-webhook |
|---|---|---|---|---|
| ElevenLabs `text-to-speech` | `sync` (chunked stream variant) | audio bytes in body, format by query parameter | `xi-api-key` header | Yes |
| OpenAI `audio/speech` | `sync` (chunked or SSE stream) | audio bytes in body: mp3/opus/aac/flac/wav/pcm | Bearer key | Yes |
| Google Gemini TTS (Interactions API) | `sync` (SSE from model version 3.1) | base64 in JSON, 24 kHz 16-bit mono | API key header | Yes |
| Fish Audio `/v1/tts` | `sync` (chunked transfer) | raw audio bytes in body | Bearer key | Yes |
| MiniMax `t2a_v2` | `sync` (SSE variant on the same endpoint; separate async path for 1M-character jobs) | **hex-encoded string in JSON** by default, or a URL valid 24 h (non-streaming only) | Bearer key | Yes |

### 2.4 Speech to text

| Provider | Wait shape | Result shape | Auth | Survives no-webhook |
|---|---|---|---|---|
| Deepgram `/v1/listen` | `sync` (callback optional) | JSON in body | `Authorization: Token` header | Yes |
| OpenAI `audio/transcriptions` | `sync` (SSE stream supported) | JSON in body; 25 MB input cap | Bearer key | Yes |
| ElevenLabs Scribe `/v1/speech-to-text` | `sync` (webhook opt-in only) | JSON in body; export formats arrive base64-in-JSON | `xi-api-key` header | Yes |
| Google `gemini-3.5-transcribe` (Interactions API) | `sync` | JSON-ish interaction: text plus word annotations | API key header | Yes |
| Google Cloud Speech-to-Text v2 | `sync` short audio, LRO `poll` beyond 60 s | inline JSON or Cloud Storage | service account / ADC — **heavy** | Yes, but auth is the wrong shape for us |

---

## 3. Provider sections

### 3.1 Aggregators

#### OpenRouter — images

OpenRouter's image API is one endpoint, `POST https://openrouter.ai/api/v1/images`,
taking `model`, `prompt`, and normalised parameters (`resolution` tiers of
512/1K/2K/4K, `aspect_ratio`, explicit `size`, `output_format`, `background`,
`seed`), with per-provider routing through a `provider` object. The response is
base64 inline — "Images are returned as base64-encoded bytes" as `b64_json` —
so there is no URL expiry problem at all
([image generation guide](https://openrouter.ai/docs/guides/overview/multimodal/image-generation),
[API reference](https://openrouter.ai/docs/api/api-reference/images/generate-an-image)).

There is **no polling and no job id**. The operation is a single synchronous
POST (SSE if `stream: true`, and streaming is currently native only on OpenAI
models; other providers buffer). The docs' own example generation took 94
seconds, and a `524` "Infrastructure Timeout" error code exists — so the
design must tolerate a two-minute hold, and a dropped connection loses the job.
Image editing is supported but is reference-guided generation, not a masked
edit: up to 16 `input_references` (HTTP URLs or base64 data URLs). Model
discovery is `GET /api/v1/images/models`; the catalogue includes OpenAI
gpt-image, Google Gemini image, FLUX.2, Seedream and Recraft. Auth is a plain
Bearer key.

*What it costs us permanently:* a normalising adapter whose request/response
shape is its own (not OpenAI's), a client timeout generous enough for a ~2
minute hold with no polling fallback, and reference-style editing that cannot
expose a mask.

#### FAL

FAL's queue is the best structural fit for a polled, restartable local harness
of anything in this research. Submit is `POST https://queue.fal.run/{model-id}`
with `Authorization: Key $FAL_KEY` (the literal `Key ` prefix is required); the
response carries `request_id`, `status_url`, `response_url` and `cancel_url`.
Polling is `GET .../requests/{request_id}/status` through `IN_QUEUE`,
`IN_PROGRESS` (with logs) and `COMPLETED`, then the result is fetched from the
`response_url`; cancellation is a `PUT` to the cancel URL. The docs are
explicit about durability: *"Store the `request_id` if you need to check status
or retrieve results later, even from a different process."* A direct sync path
exists on `fal.run`, and an SSE status stream stays open until `COMPLETED`
([queue API](https://fal.ai/docs/documentation/model-apis/inference/queue),
[inference overview](https://fal.ai/docs/documentation/model-apis/inference)).

Webhooks are strictly optional — *"By providing us a webhook endpoint you get
notified when the request is done as opposed to polling it"* — and polling is
the primary path
([webhooks](https://fal.ai/docs/documentation/model-apis/inference/webhooks)).

Results are public URLs on `v3b.fal.media`; no inline-bytes option is
documented. File retention is *"configurable"* with no documented numeric
default, and expired files are permanently deleted — so the safe policy is to
download at completion, always
([media expiration](https://fal.ai/docs/documentation/model-apis/media-expiration),
[CDN](https://fal.ai/docs/documentation/model-apis/fal-cdn)). Input images for
editing or image-to-video can be uploaded via the SDK or a REST multipart
endpoint, referenced by public or presigned URL, or inlined as base64 data URIs
(which the docs discourage above a few KB).
[Auth](https://fal.ai/docs/documentation/setting-up/authentication).

The catalogue is broad and uniformly queued: video includes Veo 3.1, Gemini
Omni Flash, Kling v1–v3 and O3, Wan 2.2–3.0 Prime, Seedance, MiniMax
H3/Hailuo, LTX-2, Grok Imagine, FLUX 3 and PixVerse; images include Nano
Banana, GPT Image, FLUX with Kontext editing, Seedream edit, Qwen, Ideogram,
Recraft and Krea. Sample pricing returned by their pricing endpoint: Veo 3.1
at 0.40 USD per unit "seconds", Kling v2.5-turbo pro at 0.07 (unit semantics
unconfirmed).

*What it costs us permanently:* URL-only results with no guaranteed retention
(immediate download is mandatory), an input-upload path of our own, the `Key`
prefix quirk, and — because it is the only video aggregator in the named list
— concentrated dependence on one vendor for the whole video slot.

#### Replicate

`POST https://api.replicate.com/v1/predictions` with `{version, input}` (the
version accepts `owner/name` for official models, `owner/name:version`, or a
bare version hash; official models also have a per-model predictions endpoint).
`Prefer: wait=n` holds the request open up to 60 seconds before returning the
prediction in a `starting` state, after which you poll
`GET /v1/predictions/{id}` through starting/processing/succeeded/failed/
canceled/aborted. Predictions time out after 30 minutes
([HTTP reference](https://replicate.com/docs/reference/http),
[lifecycle](https://replicate.com/docs/topics/predictions/lifecycle)).

Webhooks are explicitly optional: *"Webhooks are handy, but they're not
strictly necessary to use Replicate."* SSE streaming exists for models that
support it, mostly language models
([streaming](https://replicate.com/docs/topics/predictions/streaming)).

The sharp edges: outputs are URLs on `replicate.delivery` that *"will expire
after one hour"*, and *"for predictions created through the API, output files
are automatically deleted after an hour"* — with no documented way to extend
retention. Prediction data (input, output, logs) is also removed after an
hour by default
([output files](https://replicate.com/docs/topics/predictions/output-files),
[data retention](https://replicate.com/docs/topics/predictions/data-retention)).
Inputs are HTTP URLs or data URLs (small files only), with a `POST /v1/files`
multipart upload for larger ones — but that endpoint is documented in their
blog rather than in the API reference's table of contents, which is its own
warning sign
([files how-to](https://replicate.com/blog/fine-tune-flux-with-an-api)). Auth
is a plain Bearer token.

*Why it is recommended against despite fitting:* it overlaps FAL's catalogue
while being strictly harder to live with — one-hour output expiry, one-hour
data expiry, a semi-documented upload endpoint, and version pinning for
community models. What it would have bought us is a second aggregator as
insurance and its official-model catalogue; the cost is a full adapter plus
the strictest expiry discipline in this research.

### 3.2 Image

#### OpenAI — GPT Image models

Two endpoints: `POST /v1/images/generations` and `POST /v1/images/edits`. The
edits endpoint accepts a JSON body (up to 16 input images as `file_id` or
base64 data URLs — no public URL needed) or multipart, and carries an
`input_fidelity` control. GPT image models return base64 only: `url` mode is
"Unsupported for the GPT image models, which always return base64-encoded
images". Everything is one synchronous round trip — "Complex prompts may take
up to 2 minutes to process" — with optional SSE partial images
([image reference](https://developers.openai.com/api/reference/resources/images/),
[guide](https://developers.openai.com/api/docs/guides/image-generation)). Auth
is a plain Bearer key, but note the gate: *"you may need to complete the API
Organization Verification from your developer console before using GPT Image
models"*.

**Model currency matters here.** The deprecations page shows gpt-image-1
shutting down 2026-10-23, gpt-image-1-mini and gpt-image-1.5 on 2026-12-01
(both replaced by `gpt-image-2`), dall-e-2/3 already removed on 2026-05-12,
and — importantly — the Sora-2 Videos API shutting down 2026-09-24. OpenAI is
therefore an image option and emphatically not a video option
([deprecations](https://developers.openai.com/api/docs/deprecations)).

#### Google — Gemini image generation

The Imagen path is dead: "Imagen models are deprecated and will shut down on
August 17, 2026", and Google's own replacement guidance points everything at
the Gemini native image models
([Imagen docs](https://ai.google.dev/gemini-api/docs/imagen)). The current
path is the **Interactions API**: `POST https://generativelanguage.googleapis.com/v1beta/interactions`
with models `gemini-3.1-flash-lite-image`, `gemini-3.1-flash-image` (up to 4K)
and `gemini-3-pro-image`. Input is text, or parts including base64 images;
`response_format` carries `aspect_ratio` and `image_size`. Editing is
first-class — image parts plus instructions, multi-turn via
`previous_interaction_id`, and up to 14 blended reference images. Everything
is a single synchronous response containing inline base64, watermarked with
SynthID. Auth is the plain Gemini API key header
([image generation docs](https://ai.google.dev/gemini-api/docs/image-generation)).
A batch API with webhooks exists but is an opt-in trade of latency for rate
limits; nothing requires it.

#### Black Forest Labs — FLUX

BFL's API is poll-shaped by design: *"The BFL API follows an asynchronous
design, where you first make a request for a generation and then query for the
result."* Submit `POST https://api.bfl.ai/v1/flux-2-pro` (and sibling
endpoints for the model tiers) returns `{id, polling_url}`; you poll the
returned URL (or `GET /v1/get_result?id=`) through Pending, Reasoning,
Generating, Ready or Error states. Every endpoint accepts an optional
`webhook_url`, and the polling path is complete without one. Auth is a plain
key in the `x-key` header
([generating images](https://docs.bfl.ml/quick_start/generating_images.md),
[get result](https://docs.bfl.ml/api-reference/utility/get-result.md),
[integration guidelines](https://docs.bfl.ml/api_integration/integration_guidelines.md)).

Two things make BFL the tightest provider in this research. First, results are
signed URLs with a 10-minute life: *"Signed URLs are only valid for 10
minutes. Please retrieve your result within this timeframe"* — the harness
must download in the poll loop the moment a task turns Ready, not "soon".
Second, editing input for FLUX.2 is documented as URL strings
(`input_image` … `input_image_8`); whether base64 is accepted is *unconfirmed*
for FLUX.2 (the older Kontext endpoint explicitly accepts "Base64 encoded
image or URL", up to 20 MB). A harness behind NAT needs that answer before
committing, or must run a small upload path. BFL also now offers FLUX 3 video
(`POST /v1/flux-3-video`, `mode: t2v | i2v | v2v`, keyframes, 5–20 s, audio
generation) through the same poll shape
([FLUX 3 video](https://docs.bfl.ml/flux_3/flux3_video.md)).

#### Runway — the image face

Runway is a multi-model platform now: twelve generation endpoints including
`text_to_image` and `image_to_video`. Image models include `gen4_image`,
`muse_image`, and resold third-party models (`seedream5_pro`, `gemini_image3_pro`,
`gpt_image_2`); editing works through `referenceImages` (URL or data URI).
Auth is a plain Bearer key plus a mandatory `X-Runway-Version: 2024-11-06`
header; input images can be data URIs (5 MB inline limit) or a `POST /v1/uploads`
endpoint ([models guide](https://docs.dev.runwayml.com/guides/models.md),
[ai-context](https://docs.dev.runwayml.com/ai-context.md)). The task
lifecycle is covered with the video section below, because it is shared.

### 3.3 Video

#### Google Veo (Gemini API, not Vertex)

Submit `POST https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning`
with `x-goog-api-key`, then poll `GET {base}/{operation.name}` until `done` —
a long-running operation whose name can be reconstructed after a restart
([Veo docs](https://ai.google.dev/gemini-api/docs/veo)). The result URI is at
`.response.generateVideoResponse.generatedSamples[0].video.uri`, downloaded
with the API key attached, and the deadline is explicit: *"Generated videos
are stored on the server for 2 days, after which they are removed."* Image-to-
video takes a base64 `inlineData` image; parameters cover aspect ratio,
resolution, duration (4/6/8 s), reference images and last-frame control.
Current models: veo-3.1 generate/fast/lite, with veo-3.0 deprecated.

Two honesty notes. The Veo page contains the contradictory line *"This feature
is currently only available with the generateContent API"* while its own REST
examples use `predictLongRunning` — trust the complete curl examples, but this
is the first thing to smoke-test. And the exact `operation.name` string shape
is *unconfirmed* (the docs never print one). Alongside Veo, the Gemini API now
recommends **Gemini Omni Flash** (`gemini-omni-1.1-flash`, Interactions API)
as the default video model: synchronous by default, a `delivery: "uri"`
response format that returns a file URI to poll until `ACTIVE` for outputs
over 4 MB, SSE streaming, text-to-video and image-to-video tasks, extend up to
40 s ([Omni docs](https://ai.google.dev/gemini-api/docs/omni)). The TTL of
that file URI is *unconfirmed*.

#### Runway video

`POST /v1/image_to_video` and `/v1/text_to_video` return only `{"id"}`; poll
`GET /v1/tasks/{id}` through PENDING, THROTTLED, RUNNING, SUCCEEDED, FAILED,
CANCELLED, at five-second-plus intervals. **No webhook feature exists anywhere
in the documented API** — the docs index, the API primer and the OpenAPI
surface contain no webhook path; polling is the only completion signal
([ai-context](https://docs.dev.runwayml.com/ai-context.md),
[core API](https://docs.dev.runwayml.com/_llms-txt/core-api.txt)). Outputs are
CloudFront URLs that *"will expire within 24-48 hours of accessing the API"*,
with the docs telling integrators to download and save. Video models span
Runway's own gen4.5 and aleph2 plus resold veo3.1, hailuo3, wan3, seedance2
and grok variants; durations and ratios are per-model. Task ids are durable
UUIDs, so a restart can resume polling. Nothing is WebSocket-only.

#### FAL-hosted video models

All hosted video models speak the one queue protocol from §3.1; no video model
requires a webhook, and no video schema inspected showed the file_id-style
indirection — results are direct URLs in the standard queue response
([catalogue](https://fal.ai/models?categories=text-to-video)). Model families
and example ids: `fal-ai/veo3.1` (+fast/lite, image-to-video, first-last-frame,
reference variants), `google/gemini-omni-flash`, `minimax/h3-max/text-to-video`,
`fal-ai/kling-video/v3/pro/text-to-video`, `bytedance/seedance-2.5/text-to-video`,
`alibaba/wan-3.0-prime/text-to-video`, `fal-ai/wan/v2.7/text-to-video`,
`lightricks/ltx-2.5/image-to-video/fast`, `xai/grok-imagine-video/v1.5/text-to-video`,
`blackforestlabs/flux-3/text-to-video`. Veo 3.1 on FAL takes duration 4/6/8 s
with audio on by default. This single paragraph is most of the case for the
FAL adapter.

#### MiniMax video (Hailuo) — direct

Two API generations coexist. The current v2 (H3) flow: submit
`POST https://api.minimax.io/v2/video_generation` with a multimodal content
array (text, image_url — public URL, platform file reference, or base64 data
URI — plus first_frame/last_frame/reference roles); poll
`GET /v2/query/video_generation/{task_id}` through queued/running/succeeded/
failed/cancelled; the result carries `content.url`, described as a
"time-limited download URL… query again to obtain a new URL after it expires"
(numeric TTL unconfirmed). Tasks remain queryable for 7 days. The legacy v1
(Hailuo 2.3/02) flow returns only a `file_id`, requiring a second call to
`GET /v1/files/retrieve` whose download URL is *"valid for 1 hour"* — a
two-step indirection the v2 API avoids. Callbacks are optional; polling is
complete without them. Auth is a plain Bearer key; no `group_id` appears
anywhere in the international docs
([v2 create](https://platform.minimax.io/docs/api-reference/video-generation-v2-create.md),
[v2 query](https://platform.minimax.io/docs/api-reference/video-generation-v2-query.md),
[docs index](https://platform.minimax.io/docs/llms.txt)). Current models:
MiniMax-H3 and MiniMax-H3-Max, with legacy Hailuo 2.3/02.

#### Alibaba Wan video (Model Studio / DashScope)

The documented flow is exclusively submit-then-poll — "Create a task → Poll
for the result" — with sync calls refused outright via a mandatory
`X-DashScope-Async` header. The new host embeds a workspace id in the hostname
(`{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com`), but the legacy
`dashscope-intl.aliyuncs.com` host "remains fully functional" and keeps the
credential a single Bearer key. Submit
`POST …/api/v1/services/aigc/video-generation/video-synthesis`, poll
`GET …/api/v1/tasks/{task_id}` through PENDING/RUNNING/SUCCEEDED/FAILED/
CANCELED. Image-to-video takes `img_url` as a public URL or base64 data URI.
The result URL and the task id share the same clock: *"Valid for 24 hours.
The video is in MP4 format"* and *"Valid for queries for 24 hours"*. wan2.5+
generate audio (automatic dubbing, or `input.audio_url`)
([text-to-video reference](https://www.alibabacloud.com/help/en/model-studio/text-to-video-api-reference),
[image-to-video reference](https://www.alibabacloud.com/help/en/model-studio/image-to-video-api-reference)).
Current models: wan2.7 (new protocol), wan2.6/2.5/2.2/2.1 (legacy protocol).

### 3.4 Text to speech

#### ElevenLabs

`POST /v1/text-to-speech/{voice_id}` — synchronous, returning audio bytes in
the body with the format negotiated by an `output_format` query parameter
(mp3_44100_128 default; pcm, wav, opus, ulaw, alaw variants, with the highest
bitrates and WAV gated behind subscription tiers). A `/stream` variant
returns chunked bytes; ElevenLabs describes this as reducing perceived
latency, and the WebSocket interfaces are complements for input streaming, not
requirements — one-shot synthesis over plain HTTP is complete, including with
the flagship `eleven_v3` model
([convert](https://elevenlabs.io/docs/api-reference/text-to-speech/convert.md),
[streaming](https://elevenlabs.io/docs/api-reference/streaming.md),
[models](https://elevenlabs.io/docs/overview/models.md)). Auth is the
`xi-api-key` header. Voices are listed from `GET /v2/voices`. Current models:
eleven_v3, eleven_v3_conversational, eleven_multilingual_v2, eleven_flash_v2_5
(~75 ms), with turbo deprecated in favour of flash.

#### OpenAI

`POST /v1/audio/speech` — one synchronous endpoint returning audio bytes
(mp3 default; opus, aac, flac, wav, pcm), with chunked streaming supported
("audio can be played before the full file is generated") and a new
`stream_format` parameter (`audio` or `sse`; SSE not on tts-1)
([speech reference](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create.md),
[guide](https://developers.openai.com/api/docs/guides/text-to-speech)).
Current models: gpt-4o-mini-tts (promptable style via `instructions`, 13 built
in voices with marin and cedar recommended), tts-1 and tts-1-hd (smaller voice
set, no instructions). Input caps at 4096 characters, so long texts need
client-side splitting. No TTS model is on the current deprecation list. Plain
Bearer auth.

#### Google (Gemini API)

TTS rides the same Interactions API as image generation:
`POST /v1beta/interactions` with `response_format: {type: "audio"}` and a
`speech_config` naming one of 30 preset voices; multi-speaker is two voices.
The result is base64 audio inside the JSON interaction — the guide's own
decoder treats it as headerless 24 kHz 16-bit mono PCM. Streaming is
supported from model version 3.1 (`gemini-3.1-flash-tts-preview`); the 2.5
Flash/Pro TTS models remain listed. Plain `x-goog-api-key` auth
([speech generation](https://ai.google.dev/gemini-api/docs/speech-generation),
[Interactions reference](https://ai.google.dev/api/interactions-api)).
Documented limitations worth knowing: occasional 500s that need retrying, and
content rejections for vague prompts. The legacy Cloud Text-to-Speech API is
the heavy path — its docs show Application Default Credentials and access
tokens, not a plain key — so Gemini is the only API-key route
([Cloud TTS](https://docs.cloud.google.com/text-to-speech/docs/create-audio)).

#### Fish Audio

`POST https://api.fish.audio/v1/tts`, Bearer key, JSON or MessagePack body.
Two quirks: the model is selected in an HTTP **header** (`model: s2.1-pro`,
with `s1`, `s2-pro`, `s2.1-pro-free` the alternatives), and zero-shot
reference audio in the request requires MessagePack. The response is raw
chunked audio bytes (format set in the body: wav/pcm/mp3/opus); no JSON,
base64 or URL variant is documented
([TTS endpoint](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech.md),
[guide](https://docs.fish.audio/developer-guide/core-features/text-to-speech.md)).
Voice cloning is a separate model-creation endpoint; the WebSocket interface
is for input streaming only. No polling or webhooks exist for TTS. Legacy
speech-1.5/1.6 models are deprecated.

#### MiniMax

`POST https://api.minimax.io/v1/t2a_v2` — synchronous over HTTP, Bearer key,
with an alternate host (`api-uw.minimax.io`) for lower time-to-first-audio.
The critical fact is delivery: *"output_format — Options: [url, hex]. Default
is hex… In streaming, only hex is supported. Returned url is valid for 24
hours."* So the default result is a **hex-encoded string inside JSON** (double
the wire size, needing a hex-to-bytes step), the URL option is non-streaming
only, and base64 is not offered at all. Streaming is SSE on the same endpoint;
a separate async path exists for 1M-character jobs but is not needed. Models:
speech-2.8-hd/turbo and speech-2.6-hd/turbo (2.8 adds interjection tags);
voices by `voice_id` with an emotion parameter. `base_resp.status_code` must
be checked on every response
([T2A HTTP](https://platform.minimax.io/docs/api-reference/speech-t2a-http.md)).
Auth on the international platform is a single Bearer key; whether the
Chinese-mainland platform still requires a group id is *unconfirmed*.

### 3.5 Speech to text

#### Deepgram

`POST https://api.deepgram.com/v1/listen` — one synchronous POST, audio bytes
in the body (or a `{"url": …}` JSON body for hosted files), feature flags as
query parameters (`model=nova-3`, `smart_format`, `punctuate`, `paragraphs`,
`utterances`, `diarize_model`, `keyterm`). The response is structured JSON:
alternatives with word-level timestamps, confidences, speaker labels, and
paragraphs. Limits: 2 GB file size, and *"Deepgram does not store transcripts,
so the API response is the only opportunity to retrieve the transcript."* The
callback parameter exists for async use but is optional — sync is the default
([pre-recorded reference](https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded),
[limits](https://developers.deepgram.com/docs/pre-recorded-audio)). Auth is
`Authorization: Token <key>`. `/v1/listen` remains the current documented API
for pre-recorded audio (only their conversational Flux model moved to a v2
path).

#### OpenAI

`POST /v1/audio/transcriptions`, multipart, Bearer key. The recommended model
is now `gpt-transcribe`; `gpt-4o-transcribe-diarize` carries speaker labels;
whisper-1 carries word timestamps and srt/vtt. **All four of the older ids are
deprecated with removal on 2027-02-26** — and the recommended `gpt-transcribe`
returns only `{text, languages, usage}`, with no segments, so any richer-output
parser needs migration planning
([transcription guide](https://developers.openai.com/api/docs/guides/transcription),
[deprecations](https://developers.openai.com/api/docs/deprecations)).
File limit is 25 MB with no documented workaround. Streaming over this
endpoint now exists (`stream=true`, SSE transcript events) without the
Realtime API; response formats are json, diarized_json and verbose_json.

#### ElevenLabs Scribe

`POST /v1/speech-to-text`, multipart (`model_id: scribe_v2`, `file`),
`xi-api-key` auth, fully synchronous — webhooks are an opt-in mode that
returns 202 and delivers later. File limits are generous (the reference says
"less than 5.0GB", the FAQ says 3 GB — the docs disagree with themselves;
durations to 10 hours in standard mode). The response is rich: word and even
character-level timestamps, speaker ids, audio events (laughter, applause),
entities, and requested export formats arriving base64-encoded inside the same
JSON ([speech-to-text reference](https://elevenlabs.io/docs/api-reference/speech-to-text/convert),
[capability page](https://elevenlabs.io/docs/overview/capabilities/speech-to-text)).
Scribe rides the same key as TTS, which is why it folds into the existing
`elevenlabs` protocol entry rather than needing its own connection.

#### Google

The Gemini API now has a **dedicated ASR model**,
`gemini-3.5-transcribe`, documented through the Interactions API: audio input
inline as base64 (under 20 MB total request) or via a Files API URI (up to
2 GB per file, stored 48 hours, no download of user uploads), with a
`transcription_config` carrying language hints, custom vocabulary, a
"smart" mode (disfluency removal, paragraphing), speaker diarization (up to 8
speakers) and word-level timestamps. The transcript comes back in
`interaction.output_text` with word timings as annotation blocks — whose
offsets are strings like `"0.450s"`, an easy parser miss. Limits: 1 hour per
request, dropping to 30 minutes with diarization or timestamps enabled
([transcribe docs](https://ai.google.dev/gemini-api/docs/transcribe),
[audio docs](https://ai.google.dev/gemini-api/docs/audio)). Plain
`x-goog-api-key` auth. Two caveats: new Google AI Studio keys are now
"auth keys" bound to a Google Cloud service account — still delivered as one
plain key string, so the keychain shape holds, but the API "rejects requests
from unrestricted standard keys"
([API key docs](https://ai.google.dev/gemini-api/docs/api-key)); and Cloud
Speech-to-Text v2 remains the heavy path — its authentication docs describe
service accounts and ADC with no API-key option shown — justified only if its
guaranteed-structured output is ever needed
([Cloud STT auth](https://cloud.google.com/speech-to-text/docs/authentication)).

### 3.6 Deferred: RunPod and ComfyUI

RunPod and ComfyUI are not providers in the sense this document uses the word,
and the brief's instinct to set them aside is correct. A provider, for us, is
a vendor whose catalogue sits behind one API key: the user picks a model, we
shape a request, the vendor runs it. RunPod is GPU cloud — the user writes a
handler, builds a worker image, configures hardware and scaling, and only then
has an endpoint to call
([serverless overview](https://docs.runpod.io/serverless/overview.md)) — so
what sits behind the key is whatever the user deployed, which is
infrastructure they operate, not a catalogue we curate. ComfyUI is a node-graph
application the user runs on their own machine; its API is a local queue that
writes outputs to the user's own disk, with no key and no billable meter at
all. Supporting either well is a different feature — attaching to a
user-operated backend, with a different permission and cost model — and it
deserves its own decision rather than being squeezed into the provider
connection shape. No further work here.

---

## 4. The retrieval review

Our split — search to Tavily, Brave and Exa; page-reading to Jina and
Firecrawl — is still the right division, and nothing in the vendors' current
docs argues for restructuring it. The three search providers still fail in
genuinely different ways (Tavily returns extracts and an answer, Brave
answers from its own index, Exa matches on meaning), and the two readers
still fail differently from each other (Jina renders JavaScript and returns
markdown; Firecrawl gets past the bot checks that turn Jina away). That
diversity of failure is the whole point of having fallback slots, and it
survives.

What changed, checked against current documentation:

- **Tavily** — current. `POST https://api.tavily.com/search` with Bearer auth
  is exactly what our implementation sends
  ([search reference](https://docs.tavily.com/documentation/api-reference/endpoint/search.md)).
  The vendor has added Extract, Crawl and Research endpoints, none of which
  affect our split.
- **Brave** — current. `GET https://api.search.brave.com/res/v1/web/search`
  with the `X-Subscription-Token` header remains the documented shape
  ([web search docs](https://api-dashboard.search.brave.com/app/documentation/web-search/query)).
- **Exa** — the endpoint is current (`POST https://api.exa.ai/search`, and our
  `contents: {text: …}` nesting matches the documented pattern), **but the
  documented auth header changed**: the current guide says "Pass your API key
  via the `Authorization: Bearer` header"
  ([search reference](https://exa.ai/docs/reference/search-api-guide-for-coding-agents.md)),
  while our implementation sends `x-api-key`. Whether the old header is still
  accepted is *unconfirmed*; switching our header to Bearer is a one-line
  change and should happen the next time the file is touched.
- **Jina** — current. `r.jina.ai` remains the documented r.reader API, with a
  new EU-resident variant and an `X-Return-Format` header; `s.jina.ai` is a
  separate search-plus-read API, not a replacement
  ([Jina API docs](https://docs.jina.ai/llms.txt)).
- **Firecrawl** — superseded but alive. Our implementation calls
  `POST https://api.firecrawl.dev/v1/scrape`; the vendor's docs now present
  v2 as the API ("A new v2 version of this API is now available with improved
  features and performance"), with `POST /v2/scrape` keeping the same
  essentials we use — `formats: ["markdown"]`, `onlyMainContent`, and a
  `data.markdown` response
  ([v1 scrape page with the v2 banner](https://docs.firecrawl.dev/v1/api-reference/endpoint/scrape.md),
  [v2 scrape](https://docs.firecrawl.dev/api-reference/endpoint/scrape.md)).
  v1 still responds today, so this is a scheduled migration, not an outage;
  the change is small and local to one file.

One small item to verify rather than fix: our Jina reader parses the `Title:`
prefix off the first line of a `text/plain` response; the vendor's agent
guidance now pushes `Accept: application/json`. Nothing suggests the plain
shape is going away, but it is worth confirming when the file is next touched.

---

## 5. Recommended adapter list

Adapter count is the cost, not provider count, so each entry is stated as a
trade: what the adapter buys, and what it costs us permanently.

**Tier one — start here.**

1. **OpenAI media** (today's `openai-images` entry, widened). Images
   (gpt-image-2, plus the edits endpoint for `imageEditing`) and speech and
   transcription on one key. Buys three capability slots from one adapter
   with the simplest wire in this research — synchronous, inline base64 and
   bytes — and the two existing audio drivers already live in
   `media/drivers/`. Costs: OpenAI's dated model churn (gpt-image-1 dies
   2026-10-23; 1.5 and mini die 2026-12-01), a possible organisation
   verification gate, a 25 MB transcription cap, and a ~2-minute synchronous
   hold that client timeouts must tolerate.
2. **ElevenLabs** (already a contract entry). Speech now, Scribe as the
   transcription slot on the same key. Buys the strongest voice surface with
   synchronous bytes and nothing heavier than a key. Costs: tier-gated audio
   formats, voice ids as a second selectable entity the settings UI must
   learn, and a protocol entry that quietly grows to cover two endpoints.
3. **FAL.** The video backbone. Buys the whole hosted video catalogue plus
   editing-capable image models behind one submit/poll/cancel protocol with
   durable request ids and an SSE status stream — the closest match to the
   `BackgroundJobs` machinery in the entire research. Costs: URL-only results
   with no documented retention default (immediate download is mandatory), an
   input-upload path of ours to build, the `Key ` header prefix quirk, and
   concentrated dependence on one aggregator for the whole video slot.

**Tier two — the direct providers worth their permanent tax.**

4. **Google (Gemini media).** One key and one adapter family covering image
   generation, TTS, transcription (`gemini-3.5-transcribe`), and video via
   Veo and Omni Flash — four slots, the best ratio of any direct vendor, and
   Veo at source pricing rather than through FAL's markup. Costs: the newest
   API surface here (Interactions, GA June 2026, with an `Api-Revision`
   header and one doc inconsistency on the Veo page needing a smoke test),
   the Files API upload step for inputs above 20 MB, a 2-day download
   deadline on Veo output, and Google's key-type transition to explain in
   settings.
5. **Runway.** Buys Runway's own video models (gen4.5 and aleph2) and a
   multi-model router, on a poll-only API with no webhook feature at all and
   data-URI inputs, so it is NAT-safe by construction. Costs: a pinned
   version header, another per-vendor shape maintained forever, 24–48 hour
   URL expiry — and overlap with FAL's catalogue, since Runway resells
   veo3.1/wan3/hailuo3 too. The justification is specifically their own
   models, not breadth.
6. **Black Forest Labs.** Buys FLUX image quality and a real editing lineage
   (Kontext, then FLUX.2's multi-image input) plus FLUX 3 video at source.
   Costs: the tightest result expiry in this research — signed URLs live 10
   minutes, so the download belongs inside the poll loop — the `x-key`
   header, poll-only operation, and an unconfirmed answer on whether FLUX.2
   accepts base64 input images, which must be tested before committing.

**Tier three — named, but recommended against for now.** Each deferral gives
something up, stated so the reader knows what they are trading away.

7. **Deepgram.** The cleanest ASR wire in the research — one synchronous POST,
   structured diarized JSON, a 2 GB cap. Recommended against initially
   because transcription would already be served by OpenAI, ElevenLabs and
   Google; a fourth adapter buys margin, not capability. Revisit when users
   actually hit the 25 MB OpenAI cap or the 1-hour Google limit.
8. **Replicate.** Overlaps FAL with stricter constraints: outputs deleted
   after an hour, prediction data purged after an hour, a files endpoint
   documented only in a blog post, and version pinning for community models.
   What it would have bought: a second aggregator as insurance and the
   official-model catalogue. Revisit only if FAL fails us.
9. **MiniMax direct.** H3 and Hailuo are already reachable through FAL
   (`minimax/h3-max`) and Runway (`h3_max`). Direct buys the newest MiniMax
   releases first and unmediated pricing; costs a full adapter, the
   legacy-API file_id indirection if v1 is ever needed, and an unresolved
   question about the Chinese platform's group id.
10. **Alibaba Wan direct.** wan3 and wan-3.0-prime are on FAL and Runway.
    Direct buys wan2.7 first with source pricing; costs region and workspace
    host selection (mitigated by the legacy host and a `baseUrl` override),
    the mandatory async header, and 24-hour lifetimes on both the task id
    and the result URL.
11. **Fish Audio.** Fits fine — synchronous bytes, one key — but it would be
    a fifth TTS in a modality already covered three times, with a
    model-in-header quirk and MessagePack bodies for zero-shot cloning.
    What it would have bought: a cheap voice-cloning option. Revisit if a
    user asks for cloning specifically.

---

## 6. Contract impact

**`invocationShapeSchema` holds. No new waiting shape is needed.** This is the
clearest positive result of the research: every provider in every modality
fits `sync`, `poll` or `stream`. Audio is `sync` (with `stream` options)
everywhere; image is `sync` (OpenAI, Google, OpenRouter) or `poll` (BFL,
Runway, FAL, Replicate beyond 60 s); video is `poll`, always. No provider
forced a webhook, and none forced a fourth shape. The brief's §3.2 bet is now
evidence rather than instinct.

**`mediaProtocolSchema` is the real contract work.** It currently lists
`openai-images`, `openrouter-images` and `elevenlabs`. The evidence says the
union should name a vendor's media wire family, not a single endpoint, because
one key and one adapter now credibly span several slots: OpenAI's family
covers images, speech and transcription; ElevenLabs covers speech and Scribe;
Google's covers image, video, TTS and ASR. If protocols stay per-endpoint,
one OpenAI key becomes three connections and the duplicate-key disease in the
brief's §2 multiplies. Concretely: widen `openai-images` to an OpenAI media
family, keep `openrouter-images`, keep `elevenlabs`, and add — as each is
adopted — `fal`, `google-gemini-media`, `runway`, `bfl`, `deepgram`, `minimax`,
`dashscope`, `fish-audio`. Each addition stays a contract change, which is the
union's purpose.

**`CAPABILITY_SLOTS` holds unchanged.** Every finding lands in an existing
slot: `imageGeneration`, `imageEditing` (supported in some form by every image
provider — OpenAI's edits endpoint, Google's image parts, BFL's
`input_image`, OpenRouter's `input_references`, Runway's `referenceImages`,
FAL's Kontext and Seedream-edit models), `videoGeneration`, `speechGeneration`,
`transcription`. `embeddings` stays a slot without a consumer, per the brief.

**Credentials: everything in scope fits one keychain-held API key.** Three
notes for the UI rather than the contract. Google's key-type transition still
delivers a single plain string, but the settings copy must say new AI Studio
keys are "auth keys" and that unrestricted standard keys are rejected. Alibaba
is solved by `baseUrl`: the legacy `dashscope-intl` host takes a lone Bearer
key, so the workspace-id-in-hostname form never has to reach the credential
shape. MiniMax's possible `group_id` on the Chinese platform is *unconfirmed*
and would be a genuine second credential if it exists — the international
platform needs only a key. Runway's version header and FAL's `Key ` prefix
are protocol constants, not credentials.

**Result lifetime must become adapter knowledge the scheduler honours.** The
providers split three ways — inline bytes (audio mostly), inline base64
(OpenAI, Google, OpenRouter images), and URLs that die (BFL 10 minutes,
Replicate 1 hour, Wan 24 hours, Runway 24–48 hours, Veo 2 days, FAL and
MiniMax "time-limited"). The design consequence is single and firm: at job
completion the harness downloads and owns the bytes, and never persists a
vendor URL as the artifact. This lands the brief's §5.5 question ("who owns
the bytes") with an answer rather than a decision point.

**One model-record note.** `providerModelSchema.shape` being per-model is
exactly right for the aggregators: FAL serves sync-friendly and queue-only
models on one protocol, and Replicate's `Prefer: wait` makes `sync` a 60-
second-capped flavour of `poll`. The per-model shape field absorbs both.

---

## 7. What could not be confirmed

Honest gaps, each with where the search fell short. None blocks the
recommendations; each should be checked before the adapter named beside it is
written.

- **FAL**: no numeric default for CDN file retention (retention is
  "configurable"; the stored-result expiry quoted in the queue docs is
  minutes-to-hours and sits on a confusing page); the exact raw-REST upload
  handshake that returns a CDN URL (documented via SDK only); the semantics
  of the pricing endpoint's "seconds" unit.
- **OpenRouter**: the numeric client/server timeout on the long synchronous
  POST; moderation behaviour of the `/v1/images` endpoint.
- **Replicate**: whether `replicate.delivery` URLs need the Authorization
  header; whether `/v1/files` is formally documented anywhere but the blog;
  whether official-model aliases always roll forward.
- **OpenAI**: the SSE event schema for `stream_format: "sse"` on speech;
  whether `gpt-transcribe` accepts `stream=true`; whether any documented
  workaround exists for the 25 MB transcription cap; how universal the
  organisation-verification gate for GPT Image models is.
- **Google**: the literal `operation.name` string shape for Veo polling (the
  docs never print one, and the Veo page contradicts itself about the API
  path — smoke-test first); the TTL of the Omni Flash Files-API URI; the
  exact mime_type inside Gemini TTS audio content; the wire framing of
  Interactions streaming (SSE versus JSON lines); a raw-REST Files API
  upload example; the exact model-id strings for the 2.5 TTS variants;
  whether Cloud TTS accepts plain API keys at all.
- **BFL**: whether FLUX.2's `input_image` accepts base64 (Kontext
  explicitly does; FLUX.2 docs show URLs only); how long a task id remains
  pollable before "Task not found".
- **Runway**: a retention policy for task ids.
- **MiniMax**: a numeric TTL for the v2 result URL ("time-limited" only);
  whether the Chinese-mainland platform still requires a group id.
- **ElevenLabs**: whether the eleven_v3 model restricts output formats (the
  format docs are silent on v3 specifically); reconciling Scribe's 5 GB
  reference figure against the FAQ's 3 GB.
- **Deepgram**: whether plain `Authorization: Bearer` (not JWT) is accepted
  with an API key; a duration ceiling for Nova-3 batch audio (only Whisper
  Cloud's 20-minute cap is documented).
- **Exa**: whether the legacy `x-api-key` header remains accepted now that
  the docs specify `Authorization: Bearer`.
