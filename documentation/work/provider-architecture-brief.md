# Providers beyond text — the brief

**Status:** Research and analysis · **Opened:** 2026-09-08
**Not started, and deliberately not started.** This sits behind three pieces of
work in a fixed order, recorded in §6. Nothing here is built until those land.

This is the captured version of a long spoken brief, checked against the code
rather than transcribed. Where the brief and the codebase disagree, both are
recorded — the disagreement is usually the most useful part.

---

## 1. The problem, in one paragraph

The harness speaks text well and almost nothing else. Everything past text —
image generation, image editing, video, speech, transcription, embeddings, web
search, web fetch — either does not exist, exists as a contract with no driver
behind it, or exists and is invisible because the settings screen has no place
to put it. The hard part is not any single capability. It is that **there is no
equivalent of "OpenAI-compatible" for image, video, or audio**: every provider
has its own request shape, its own result shape, its own idea of whether a call
returns, streams, or is polled. So the cost of supporting a modality is not one
integration; it is one integration per provider, forever.

---

## 2. What already exists — measured, not assumed

The brief assumed far less than is actually here. This section is the
correction, because it changes what the work is.

| Piece | State | Where |
|---|---|---|
| Three provider kinds: `language`, `media`, `retrieval` | **Built** | `contracts/providers.ts:13` |
| Nine capability slots, incl. video, embeddings, imageEditing, webSearch, webFetch | **Built** | `contracts/providers.ts:305` |
| `invocationShape`: `stream` / `sync` / `poll` | **Built** | `contracts/providers.ts:91` |
| All five retrieval providers | **Built and wired** | `retrieval/providers/{brave,exa,firecrawl,jina,tavily}.ts` |
| Search/reader split with defaults | **Built** | `retrieval/registry.ts` — search: tavily, brave, exa; reader: jina, firecrawl |
| Web search and fetch tools | **Built** | `tools/web/{search,fetch,untrusted}.ts` |
| Declared catalog: OpenAI, Google, ElevenLabs, and the five retrieval vendors | **Built** | `providers/library/declared-catalog.ts` |
| Transcription and speech, driver-based | **Built** | `media/service.ts`, `media/drivers/openai-{speech,transcribe}.ts` |
| Media protocols | **Three only** | `openai-images`, `openrouter-images`, `elevenlabs` |
| Image / video drivers | **Missing** | `media/drivers/` has speech and transcribe only |
| Embeddings consumer | **Missing** — the slot exists, nothing reads it | — |
| Settings UI reflecting the three kinds | **Missing** | one "Models and Providers" page |

**Three findings that matter more than the table.**

**The retrieval half is essentially done, and the brief's curated list is
already the implemented list.** Brave, Exa, Firecrawl, Jina and Tavily are all
built, and the registry already splits them the way the brief proposed
independently: Tavily/Brave/Exa answer questions, Jina/Firecrawl retrieve
pages. The belief that "we only showcase Tavily" comes from
`DEFAULT_SEARCH_PROVIDER = "tavily"` — a default, not a limit. What is missing
here is not providers; it is a settings screen that admits the other four
exist.

**Webhooks are already ruled out, and this constrains provider choice
permanently.** `invocationShape` documents the exclusion: a webhook needs a
publicly reachable inbound URL, and a local-first harness behind NAT has none,
so a callback would never complete. Several video providers are webhook-first.
Those either expose a polling path or they cannot be supported at all — this is
a hard filter to apply *during* research, not after.

**A connection is single-kind, and that is the source of the duplicate-key
complaint.** `providerConnectionSchema` is a discriminated variant on `kind`,
and `id` and `kind` are both immutable by contract — "changing either turns a
connection into a different connection." So OpenRouter-for-text and
OpenRouter-for-images are two connections, two keychain entries, and the same
key typed twice. Fixing this is a contract change and needs its own decision;
it is the one item in this brief that cannot be solved in the UI.

---

## 2a. The Pi boundary — measured, and mostly already drawn

The brief asked a direct question: does `@earendil-works/pi-ai` support anything
beyond language, and if it is only language plus OpenRouter images, should it be
confined to language? Both halves are answered here because the answer was
verified rather than assumed.

**What Pi supports.** Version 0.84.4 describes itself as a "Unified LLM API".
Its entire image surface is one registered provider — `openrouter-images`, in
`dist/providers/images/register-builtins.js` — and there is no audio, video,
speech, transcription or embeddings module anywhere in the package. So the
guess was right: language, plus OpenRouter images, and nothing else.

**Where Pi already is and is not.** `media/` and `retrieval/` import no pi-ai at
all. The speech and transcription drivers, and all five retrieval providers, are
already our own code talking to vendors directly. Pi is confined to `models/`
plus `platform/runtime.ts`, `reliability/model-retry-policy.ts`, and the two
`providers/library` catalogues.

**The single leak.** `providers/library/image-catalog.ts` reads Pi's bundled
image-model manifest out of its package directory. That is the one place where a
non-language capability depends on the language gateway, and it is about a
hundred lines. Cutting it completes the separation.

**The decision.** Pi is the **language gateway** and is scoped to language.
Media and retrieval get our own adapters, in their own subsystems, with no path
back to Pi. This is not a refactor so much as finishing a boundary that is
already drawn and writing it down so it stops eroding — a capability added later
must not reach for Pi because Pi happens to be present.

It is also the same rule
[ADR 0049 §2](../decisions/0049-the-browser-is-ours-the-engine-is-the-machine-s.md)
set for the browser: the surface is ours, the plumbing is borrowed, and the
plumbing can be replaced without touching a contract. Pi becomes one subsystem
among several rather than the thing everything routes through by default.

**What this does not fix.** The duplicate-connection problem in §2 is ours, not
Pi's. It follows from `providerConnectionSchema` being a variant discriminated
on an immutable `kind`, and it would survive removing Pi entirely. Good news in
one respect — no dependency is involved and it is entirely ours to change — but
it stays a separate decision, and it needs an ADR because immutable connection
identity is load-bearing for how credentials are stored.

**A consequence worth stating now.** `mediaProtocolSchema` lists
`openai-images`, `openrouter-images` and `elevenlabs`. Only `openrouter-images`
has anything behind it, and that anything is Pi. Under this decision
`openrouter-images` needs our own adapter like every other media protocol, and
the other two were already contract entries with no driver. So the media
protocol list should be treated as a wish rather than an inventory until each
entry has a driver of ours behind it.

---

## 3. The shape of the answer

### 3.1 The tools are ours; the providers are adapters behind them

This is already decided precedent, not a new proposal.
[ADR 0049 §2](../decisions/0049-the-browser-is-ours-the-engine-is-the-machine-s.md)
settled the same question for the browser: the tool surface is Studio's, the
third party is plumbing underneath, and the reasoning transfers without
modification. One `studio_image_generate` with a provider adapter behind it,
never one tool surface per vendor.

The alternative the brief raised and then talked itself out of — bundling each
provider's own remote MCP server — fails for the reason it identified: the
model would face a different tool surface depending on which provider happened
to be connected, so every prompt, every example and every downstream behaviour
would become provider-dependent. It also multiplies the surface exactly as ADR
0048 was written to prevent. `media/service.ts` already anticipates the right
answer in a comment: *the image and video tools "will dispatch through here
too."*

### 3.2 The normalising abstraction is the job, and we already built it

The brief's hardest question — "there is no single protocol" — has a narrower
answer than it appears. The protocols differ in *wire format*, which is what
adapters absorb. What they differ in structurally is only how you wait, and
that is a three-value axis the contract already names: `stream`, `sync`,
`poll`.

- **Audio** (ASR and TTS) is `sync`. Request, response, bytes. This is why the
  brief's instinct that audio is easier is correct, and it is why audio already
  works.
- **Image** is `sync` or `poll` depending on vendor and size.
- **Video** is `poll`, always, and slow — minutes, not seconds.

Video being a slow polled job is the useful realisation, because a slow job
that reports progress and produces an artifact is **exactly what shipped this
session**: `BackgroundJobs`, the ending notice, the rail panel with a Stop, and
the artifact machinery. Video generation should be a background job with an
artifact, not a blocking tool call, and none of that has to be invented.

### 3.3 Adapter count is the cost, not provider count

The brief's real question was "how many providers before we are cooked". The
honest measure is not providers but **distinct request shapes we maintain
forever**. That reframes the curation:

- **Aggregators first.** OpenRouter (text, and increasingly image) and FAL
  (image and video) each normalise many models behind one shape. Two adapters
  buy most of the catalogue.
- **Direct providers only where the aggregator cannot reach**, or where quality,
  price or licensing demands it — Google for Veo, ElevenLabs for voice, Black
  Forest Labs for FLUX.
- **Every direct provider is a permanent tax**, paid in breakage at times we do
  not choose. It should be added because something specific is unreachable
  otherwise, never for completeness.

RunPod and ComfyUI are a different category — infrastructure a user operates,
not a provider with a catalogue. The brief already set ComfyUI aside; RunPod
belongs with it, deferred rather than curated.

### 3.4 Embeddings: a slot, not a screen

`embeddings` is in `CAPABILITY_SLOTS` and OpenAI and Google both declare
embedding models. Nothing in the harness consumes an embedding. Until
something does — semantic memory, or retrieval over the workspace — a settings
page for it would be a control that changes nothing observable, which is a
worse outcome than its absence. **Leave the slot, build no UI, revisit when a
consumer exists.** The consumer is the decision, not the provider.

---

## 4. The settings reorganisation

The brief's proposed information architecture is right, and cheaper than it
sounds, because the data model already has the split — only the UI collapses
it. Today one page is called "Models and Providers" and holds everything.

**Provider** is the category. Under it:

- **Models** — the `language` kind. Text and vision-in/text-out.
- **Media** — the `media` kind, with image, video and audio grouped inside it.
- **Tools** — the `retrieval` kind. Web search and web fetch, which is where the
  five already-built providers finally become visible.

Two things this must get right:

**One key, entered once.** The single-kind connection contract (§2) means the
UI cannot deliver this on its own. Either connections gain the ability to span
kinds, or the UI learns to create the sibling connections itself and present
them as one thing. The first is a real contract change; the second is a
convenience that will leak. This needs deciding before the screen is designed.

**Naming.** "LLM" is jargon and "AI Models" is vague when the other two pages
are also models. **Models** for language, **Media** for generation, **Tools**
for retrieval reads cleanly and matches the contract's own words.

Known UI faults recorded here so they are not lost, to be fixed after the
structural work rather than before it: there is no good way to choose a
provider when adding one, and the model library lists providers whose models
have not been added, producing empty states that explain nothing.

---

## 5. What has to be decided before anything is built

1. **Can one connection serve more than one kind?** The duplicate-key complaint
   depends entirely on this. Contract change, so it needs an ADR. Note §2a: this
   is unrelated to Pi and would survive removing it.
2. **Aggregator-first, or direct-first?** §3.3 recommends aggregator-first.
   Deciding it once fixes the adapter list rather than relitigating per vendor.
3. **Which video providers survive the webhook filter?** Applied during
   research, not after.
4. **Is video a background job with an artifact?** §3.2 says yes and the
   machinery exists. Confirm before designing the tool.
5. **What is the normalised result of an image or video tool?** A file in the
   workspace, an artifact in the transcript, or both — and who owns the bytes.
6. **Does search/fetch stay one tool with a provider setting**, or become
   provider-visible to the model? Today it is the former, which is right, and
   the settings screen must not accidentally change it.

---

## 6. Where this sits in the order of work

Fixed, and this brief does not jump the queue.

1. **Step 3 of the capability-discovery plan** — `native/discover` and
   withhold-by-default. In progress.
2. **The rest of the MCP mechanism** — the remaining steps of
   [the discovery plan](capability-discovery-plan.md).
3. **The browser** — [the browser plan](browser-capability-plan.md), including
   running it for real and seeing it work.
4. **This.** Research each provider's actual protocol, decide the curated list,
   design the tools, then build.

The research in §3 and §5 can proceed in parallel with 1–3, because it is
reading and deciding rather than building. Nothing here is implemented until
3 is genuinely finished.
