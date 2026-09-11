# ADR 0051 — Pi Is The Language Gateway, And Nothing Else

**Status:** Accepted · 2026-09-11
**Builds on:** [ADR 0009](0009-local-byok-providers.md) — in-process BYOK over
Pi. This ADR keeps that and draws the line around it.
**Builds on:** [ADR 0049 §2](0049-the-browser-is-ours-the-engine-is-the-machine-s.md)
— the surface is ours, the plumbing is borrowed. The same rule, applied to
every model vendor rather than to one browser engine.
**Plan:** [the gateway plan](../work/gateway-plan.md). This ADR decides the
shape; the plan says how it is built.
**Number 0050** is reserved for remote access ("Open on other devices"),
which is built and waits on its name.

## Context

The harness speaks text through `@earendil-works/pi-ai`, which describes
itself as a unified LLM API: 35 providers, about a thousand language models,
with pricing, all regenerated on each release. That is a good thing to depend
on for chat, and ADR 0009 chose it for chat.

Everything past text is a different world. There is no "OpenAI-compatible"
for images, video or audio; every vendor has its own request shape, its own
result shape, and its own idea of whether a call returns, streams or is
polled. Pi has none of it — no audio, no video, no transcription, no
embeddings — except one registered image provider, OpenRouter, whose model
list the harness read out of Pi's package directory by path because the file
was not even exported.

That one read was the problem in miniature. Image generation had no driver
anywhere; the only thing Pi's image catalog did was list models that nothing
could run, and it did so by tying a capability Pi does not serve to a package
that happened to be present. Left alone, the next capability would have done
the same: reached for Pi because Pi was there, and been shaped by what Pi
happened to expose rather than by what the vendor's wire actually needs.

Meanwhile the code that does talk to vendors directly — the OpenAI speech and
transcription drivers, the five web providers — was already ours and already
Pi-free, but scattered across `models/`, `media/`, `retrieval/` and
`providers/` with no line that said which of them could touch Pi and which
could not. The boundary existed in practice and nowhere in writing.

## Decision

### 1. Pi is confined to language

Pi is the language gateway: text chat, vision-in, tool calls, streaming.
It is not consulted for any other modality, not for a catalog, not for a
type. Its one image path is removed rather than replaced, and no capability
added later may import it.

### 2. The boundary is a folder, enforced by lint

Everything that talks to a model vendor lives under `src/gateway/`, one
folder per kind of gateway:

| Folder | What it is |
|---|---|
| `language/` | Pi: registry, adapters, runtime, credential bridge, prompt trace, and `pi-catalog.ts` |
| `media/` | Studio's own drivers, one per vendor wire family: speech, transcription, and as they land, image, image editing, video |
| `retrieval/` | the five web providers behind `web_search` and `web_fetch` |
| `catalog/` | the provider library: the declared catalog, joined with what the language gateway answers |
| `connections/` | the connection store, keychain credentials, probes, model catalog and edits |

An import of `@earendil-works/pi-ai` from anywhere outside
`src/gateway/language/` fails lint. Tests are exempt, because a test of the
language gateway may need to build Pi's shapes.

### 3. No Pi type leaves the language gateway

The catalog needs three things Pi knows about a language model: its
reasoning levels, its price, and its capability. The language gateway
answers all three as contract types (`ReasoningLevel[]`, `ModelPricing`,
`ModelCapability`) from `pi-catalog.ts`, and the catalog asks rather than
imports. If Pi is ever replaced, the catalog does not notice.

### 4. Media and retrieval are ours, speaking to vendors directly

Every adapter under `media/` and `retrieval/` calls the vendor's HTTP API
itself. An aggregator such as OpenRouter or FAL is one such vendor, with one
adapter; the fact that OpenRouter also serves chat through Pi gives its media
adapter no path back to Pi. The tool surface the model sees is Studio's
(`studio_image`, `studio_video`, `web_search`, `web_fetch`); which vendor
answers is a setting.

## Consequences

- The library no longer lists OpenRouter's image models. Nothing could run
  them, so no working behaviour is lost; they return with the OpenRouter
  media adapter in step 4 of the plan, read live from OpenRouter's own
  listing rather than from Pi's package.
- `models/`, `media/`, `retrieval/` and `providers/` are gone as top-level
  folders. Sixty-six files changed import paths and nothing changed
  behaviour; every test that existed still passes at its new path.
- A connection is still one kind (`language`, `media`, `retrieval`). One
  OpenAI key is still typed once per kind. That is the next decision, and it
  is unrelated to Pi — it would survive removing Pi entirely.
- Replacing Pi, should that day come, is a change under one folder. That is
  the whole point of a folder with a lint rule on its door.
