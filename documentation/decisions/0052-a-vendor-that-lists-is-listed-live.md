# ADR 0052 — A Vendor That Lists Is Listed Live, And The Hand List Is The Featured Shelf

**Status:** Accepted · 2026-09-13
**Builds on:** [ADR 0051](0051-pi-is-the-language-gateway-and-nothing-else.md)
— media and retrieval vendors are spoken to by our own adapters. This ADR
decides where the models those adapters can drive come from.
**Plan:** [the media catalogue and dictation plan](../work/media-catalog-and-dictation-plan.md),
D1 and D2. Landed in steps 1–3 (`1c7787c4`, `b8ab1a83`, `231c5a55`).

## Context

The gateway drove eight media vendors, but the catalogue for seven of them
was `declared-catalog.ts`: three to six ids per vendor, written by hand on
the day the adapter landed. FAL alone lists fifteen hundred models with a
category on each; OpenRouter answers four modality queries with a hundred
and twenty. A hand list is a year behind the arena the month it is written,
and a picker that shows five of fifteen hundred is not a catalogue, it is a
suggestion pretending to be one. Meanwhile the developer's own research
named which few models are worth recommending, which a longer hand list
would have buried.

## Decision

### 1. A vendor that publishes a listing is read live

OpenRouter, FAL, ElevenLabs, Google and OpenAI each publish a model list,
and each is read from it: fetched on demand, cached an hour per origin (and
per credential where the vendor answers only a key), an empty answer never
cached, an unreachable vendor answering nothing rather than throwing into a
settings screen. The machinery is one module, `gateway/catalog/media-listing.ts`;
a vendor module owns only its URLs, its page shape, and which of its fields
earn which slot. Deepgram, Fish Audio and MiniMax publish no listing and
keep declared lists, and the compiler, not a comment, records which vendors
those are (`MEDIA_LISTINGS` is a `Record<MediaProtocol, ...>`).

### 2. Every listing classifies by the vendor's own word, over an all-unsupported floor

A live entry states what the vendor stated and nothing more: FAL's
`metadata.category`, OpenRouter's `output_modalities`, Google's
`supportedGenerationMethods`, ElevenLabs' `can_do_text_to_speech`, and for
OpenAI - which carries no capability field - the family the id names. A
dimension the vendor did not mention is `unsupported`, because a word that
does not promise pictures did not promise pictures. (Declared entries keep
`unknown` for their silences; that asymmetry is deliberate and documented
in the module.)

### 3. Categories no Studio slot answers are dropped, and counted

Upscalers, video editors, background removers, lip-sync, 3D: nothing in
Studio would call them, and a model in the picker that nothing invokes is
the placeholder problem the gateway plan removed. A listing keeps only what
maps to an existing slot and logs how many entries it dropped, so the next
slot is decided from a number rather than a feeling. FAL kept about 990 of
1,501 on the day this landed. Image-to-video is video generation: the tool
already takes an input image.

### 4. The declared entries become the featured shelf

The hand list is no longer the catalogue; it is the recommendation. Each
declared entry may be `featured`, the pickers show featured first and
marked, and the live list follows beneath. That is where research goes -
into which few models lead the shelf, not into a longer list - and the
featured ids are checked against the vendor's live listing, so the shelf
never points at a model that is not there.

### 5. No pricing is shown for media

Audio, image and video are priced per second, per image, per character and
per megapixel across vendors; there is no honest single number to print. A
listing may carry prices and they are dropped at the door, per the gateway
plan's decision, until a format exists that shows them honestly.

## Consequences

- A person with a FAL key sees FAL's catalogue, not five of it, with the
  recommended models on top. The same for OpenRouter, ElevenLabs, Google and
  OpenAI.
- Creating a vendor connection now opens a socket to the vendor for its
  list, which is right in the app and a side effect in a test of something
  else: `ModelCatalog({ liveListings: false })` keeps such tests off the
  network, and every listing test runs against a stand-in on loopback.
- The dropped-category count is the evidence for the next slot. Image
  upscaling is the obvious first candidate; it is decided when the number
  says so.
- A vendor changing its listing shape breaks a live list, not a build: the
  listing answers nothing, the featured shelf still shows, and the log line
  says which vendor.
