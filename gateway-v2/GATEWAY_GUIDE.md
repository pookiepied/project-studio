# Gateway v2 — Build Guide

> This is the single source of truth for building `gateway-v2/`. It is written to be
> **cold-start readable**: a contributor (human or AI) who has never seen this project should
> be able to read it top to bottom and know exactly what to build, where each file goes, and
> why — including plain-English explanations of every core concept, because the project owner
> is not a software engineer.
>
> The old gateway was audited in `../gateway/GATEWAY_AUDIT.md`. Every decision below traces to
> a real problem found there; "Why" notes cite the audit section.
>
> **Status:** greenfield. Nothing is built yet. Phase 0 has not started.
> **First provider:** OpenAI (real OpenAI, not a generic OpenAI-compatible shim).
> **Golden rule:** no rush. One provider, one capability at a time, done properly.

---

## 0. The five decisions that shape everything

These were decided by the project owner and are not open for re-litigation while building:

1. **No authentication inside the gateway.** None. See §1.
2. **Provider requests leave the gateway *through* Cloudflare AI Gateway** (for stored keys +
   free analytics), with a direct-key fallback for providers CF doesn't support. See §3.
3. **We do NOT build our own telemetry.** Cloudflare AI Gateway is the analytics backbone; our
   tracker only forwards a thin business summary. See §7.
4. **The gateway is multi-modal from day one** — chat, vision, tools, reasoning, embeddings,
   rerank, STT, TTS, image gen/edit, video gen, music — but each provider only implements what
   it actually supports. See §5.
5. **Media is pass-through, never stored.** Generation is in scope; storage is a different
   service. See §2.

---

## 1. Authentication — there is none, on purpose

The gateway has **no auth layer and no public URL**. This is deliberate and correct for this
system's architecture, not an oversight.

**How the wider system works:** the project is many Cloudflare Workers — `api`, `auth`, `chat`,
`agents`, `gateway`, `mcp`, `skills`, `tracker`, `memory`, etc. **None of them has a public
URL.** The only public entry point is the `api` worker. A request from the public internet hits
`api`, which verifies the caller against the dedicated `auth` worker, and only then forwards the
request internally (via Cloudflare service bindings) to `gateway`, `agents`, etc.

So the gateway is only ever reached by trusted sibling workers over internal bindings. Adding
auth here would be redundant complexity. **Do not add `auth.ts`, JWT checks, or bearer-token
middleware.** The old gateway's auth code is not carried over.

> **Why this is safe (and its one caveat):** there is no anonymous-internet attacker because
> there is no route to attack (audit §J confirmed `workers_dev=false`, no `[[routes]]`). The
> only residual trust assumption is that every worker in the account is trusted — which is the
> owner's intended model. We simply document that assumption rather than defend against it.

**Consequence for the guide:** anywhere the old design or a contributor instinct says "add
auth," the answer is "no — the `api` + `auth` workers already did it upstream."

---

## 2. Scope — what is and is NOT the gateway's job

The single most important section. The old gateway failed here; that's why we restart.

### IN scope

- Normalize an incoming request into one internal format (per modality).
- Validate the request against the target model's declared capabilities **before** calling the
  provider (reject "vision image → text-only model" with a clear error).
- Translate internal request → provider wire format, and provider response → internal format.
- Send the request out **through Cloudflare AI Gateway** (§3).
- Stream responses (SSE) where the modality supports it.
- Return generated media (bytes or provider URL) **straight back to the caller** — pass-through.
- Discover models on a schedule and publish the catalog for the frontend (§6).
- Report provider credit/balance where the provider exposes it (§8).
- Forward a thin usage summary to the external tracker (§7).
- Expose model/provider/capability/health metadata.
- Map provider errors to one stable, user-facing error taxonomy (§4.4, §9).

### OUT of scope — do not build these here

| Out-of-scope thing | Why | Where it belongs |
|---|---|---|
| **Storing generated images/video/audio** (R2/S3 buckets, serve/delete/cleanup) | Storage lifecycle is a media-service concern. We generate and return bytes; we don't own a bucket. *(Audit §G/§L: dead `images.ts`, orphaned R2.)* | A separate media/storage worker |
| **Authentication / authorization** | Done upstream by `api` + `auth`. *(§1.)* | `api` / `auth` workers |
| **User-facing product copy** (mode labels, marketing text, UI icon enums) | Frontend concern. *(Audit §K: `router/modes.ts`.)* | Frontend / config service |
| **Chat history, conversations, user profiles, memory, titles, summaries** | Application state, not routing. | `chat` / `memory` / app |
| **Reaching into a sibling worker's source** (`../../chat/src/...`) | Breaks standalone deployability. *(Audit §L.)* | Gateway defines its **own** types |
| **Full telemetry/analytics platform** | Cloudflare AI Gateway already provides it. *(§7.)* | CF AI Gateway + thin tracker |

**Litmus test:** if a feature is about *storing*, *displaying*, *remembering*, or *authenticating*,
it is not the gateway's job. If removing it still leaves "route a request to a model and return
the answer" working, it doesn't belong here.

**Media nuance:** image/video/music *generation* is a gateway capability (prompt in → route →
result out). *Persistence* of that result is not. Generation = pass-through. Storage = elsewhere.

---

## 3. Transport — every provider call goes through Cloudflare AI Gateway

This is the biggest architectural change from the old design, and it solves two owner pain
points at once: **not wanting provider keys in env vars**, and **not wanting to build telemetry**.

### How it works

Cloudflare AI Gateway sits in front of each provider. For a provider CF supports natively, we
keep using its official AI SDK package (e.g. `@ai-sdk/openai`) but point its `baseURL` at the
gateway's **native provider path**, and add the `cf-aig` headers:

```
baseURL:  https://gateway.ai.cloudflare.com/v1/{ACCOUNT_ID}/studio-gateway/openai
headers:
  cf-aig-authorization: Bearer {CF_AIG_TOKEN}      # authenticates US to CF AI Gateway
  cf-aig-byok-alias: production                     # picks which stored provider key to use
  # NOTE: the provider's own Authorization header is REMOVED — CF injects the real key (BYOK)
```

- **BYOK (Bring Your Own Key):** provider API keys are stored **in Cloudflare** (Secrets Store),
  each labelled with an **alias** (e.g. `production`, `staging`). We reference the alias in a
  header; we never hold the real key. The gateway's only secret becomes `CF_AIG_TOKEN`.
- **Analytics for free:** because the call passes through CF AI Gateway, CF automatically logs
  requests, tokens, **cost**, errors, and **cache %** per model/provider/time-range. No work on
  our side (§7).

> **Confirmed against CF docs (July 2026):** BYOK aliases via `cf-aig-byok-alias`, the required
> `cf-aig-authorization` token, and "remove provider auth headers when BYOK is enabled" are all
> current. **Deprecation note:** the older `/compat/chat/completions` *unified* endpoint is
> deprecated — we use the **native per-provider path** (`/studio-gateway/openai/...`) instead,
> which works cleanly with the per-provider AI SDK packages. If a unified endpoint is ever
> needed, the current one is `api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1/...`.

### Providers CF AI Gateway supports (native, 23 as of July 2026)

Amazon Bedrock, Anthropic, Azure OpenAI, Baseten, Cartesia, Cerebras, Cohere, Deepgram,
DeepSeek, ElevenLabs, Fal AI, Google AI Studio, Google Vertex AI, Groq, HuggingFace, Ideogram,
Mistral AI, **OpenAI**, OpenRouter, Parallel, Perplexity, Replicate, Workers AI, xAI.

### The fallback (providers CF does NOT support)

Some providers we may want (e.g. **Alibaba/DashScope, MiniMax**) are **not** on CF's list. For
those, the transport layer falls back to a **direct** call with a key from an env var. This is
the *only* reason any provider key lives in env — the minority case, clearly isolated.

### Where this lives: `core/transport/`

```
core/transport/
  cloudflareGateway.ts   # builds the CF baseURL + cf-aig headers for a given provider/alias
  directKeys.ts          # fallback: direct provider baseURL + env-var key
  index.ts               # chooses CF vs direct per provider, returns { baseURL, headers }
```

Every provider adapter asks `transport` for its `{ baseURL, headers }` — it does not hardcode a
URL. Switching a provider from direct → CF (once CF adds support) becomes a one-line config
change, not an adapter rewrite.

> **Why:** the old gateway hardcoded every provider base URL inside the adapter and kept ~15
> provider keys in env (audit §L "inconsistent constructor signatures", `wrangler.toml:46-85`).
> Centralizing transport makes BYOK-via-CF the default and env-keys the exception.

---

## 4. The core layer — plain-English explanations

`core/` is the **shared spine**: the things every provider and every feature agree on, written
once. Here is what each file is, in plain language, and why it's in core.

```
core/
  types.ts            # The shared "shape" of a request and a response, for every modality.
  capabilities.ts     # The master list of what the gateway can do, and what each model supports.
  registry.ts         # The one place that knows every provider and which models they own.
  errors.ts           # One way to describe and return errors, in plain user-facing language.
  streaming.ts        # The one piece of code that streams a live response back (typing effect).
  validation.ts       # Checks a request is valid BEFORE we spend money calling the provider.
  transport/          # HOW a request physically leaves the gateway (CF AI Gateway or direct).
  # NOTE: no auth.ts — see §1.
```

**`types.ts` — "one shape everyone agrees on."** Every provider speaks a slightly different
JSON dialect. OpenAI wants `messages`, Anthropic wants a separate `system` field, Google wants
`functionDeclarations`. `types.ts` defines OUR single internal shape for each modality (a
`ChatRequest`, an `EmbeddingsRequest`, etc.). Providers translate to/from these. Nothing else in
the codebase ever sees a provider's raw shape. *(Kills audit §D/§I "each modality invents its own
inline shape.")*

**`capabilities.ts` — "what can we do, and what can each model do."** Two things:
- The **Capability enum**: the master list of gateway abilities — `chat`, `embeddings`, `rerank`,
  `transcription` (STT), `speech` (TTS), `image.generate`, `image.edit`, `video.generate`,
  `audio.generate` (music), `credits`.
- **Model sub-features** (this answers the owner's "where are reasoning/tools/streaming?"
  question): things like **vision, tools, reasoning, JSON-schema, streaming, prompt-caching** are
  NOT separate capabilities — they are *sub-features of chat that vary per model*. `gpt-4o`
  supports vision; an older text model does not. So they are declared **per model** in each
  provider's `models.ts`, and `validation.ts` enforces them. (See the table in §5.2.)

  > "Enum + modality definitions" simply means: (a) a fixed list of ability names, and (b) for
  > each model, a checklist of which sub-features it has. That checklist is what lets us reject a
  > bad request politely instead of letting the provider return a confusing error.

**`registry.ts` — "the one list."** Assembles every provider into a single lookup: given a model
ID, which provider owns it; what capabilities/sub-features it has; the full catalog. A provider
is registered by adding one import + one array entry. *(Kills audit §B/§L "three disagreeing
provider lists.")*

**`errors.ts` — belongs in core, and here's why.** The owner asked whether errors should be in
core or elsewhere. **Core is correct**, because errors are *cross-cutting*: every feature and
every provider needs to fail the same way. `errors.ts` defines a `GatewayError` with a stable
`code` (e.g. `MODEL_NOT_FOUND`, `CAPABILITY_NOT_SUPPORTED`, `NO_CREDIT`, `PROVIDER_RATE_LIMITED`,
`PROVIDER_TIMEOUT`, `VALIDATION_ERROR`, `PROVIDER_UNAVAILABLE`, `INTERNAL_ERROR`), a proper HTTP
status (402 for no credit, 404 not found, 429 rate limited, 500 internal, 503 unavailable, etc.),
and a **plain-English user-facing message**. One `toErrorResponse()` formats every error. Every
file imports from here. A raw provider error is *mapped* to one of these before it ever reaches
the caller. *(Kills audit §H: 12 ad-hoc error strings + one route that re-threw raw exceptions.)*

**`streaming.ts` — "the typing effect, written once."** The single loop that takes a provider's
streamed output and sends it back as SSE frames, handles mid-stream errors, and forwards
cancellation when the caller disconnects. Every streaming modality uses it. *(Kills audit §I:
Groq's custom path that dropped cancellation.)*

**`validation.ts` — "check before you spend."** Before any provider call, confirm the request is
legal for that model: vision only to vision models, tools only to tool models, reasoning-effort
only to reasoning models, file size/format limits. Fail with a friendly `GatewayError`. *(Kills
audit §G "zero request-body validation.")*

---

## 5. The provider layer

### 5.1 One folder per provider

```
providers/openai/
  index.ts          # bundles everything below into one ProviderModule object
  capabilities.ts   # WHICH capabilities OpenAI supports + per-model sub-features
  models.ts         # OpenAI's model catalog + pricing (discovery source for this provider)
  chat.ts           # text + vision + tools + reasoning + JSON + streaming  (ALL of these!)
  embed.ts          # embeddings
  transcribe.ts     # STT (Whisper)
  speak.ts          # TTS
  image.ts          # image generation + editing
  credits.ts        # OPTIONAL — only if the provider exposes a balance API (OpenAI: no; OpenRouter: yes)
  # A capability file exists IF AND ONLY IF the provider supports it.
  # The set of files in this folder IS the provider's capability matrix.
```

**Answering the owner's "where is text/reasoning/tools/streaming?" directly:** there is no
separate `text.ts` or `reasoning.ts`. **`chat.ts` IS text generation**, and vision, tools,
reasoning, JSON-schema, and streaming are all *sub-features handled inside `chat.ts`*, switched on
per model. They're declared in `capabilities.ts`/`models.ts` and enforced by `validation.ts`.

### 5.2 Chat sub-feature matrix (declared per model, not per file)

| Sub-feature | Declared where | Enforced where | Meaning |
|---|---|---|---|
| vision (image input) | `models.ts` per model | `validation.ts` | can accept image parts |
| tools / function calling | `models.ts` per model | `validation.ts` | can call tools |
| reasoning / thinking | `models.ts` per model | `validation.ts` + `chat.ts` | supports reasoning-effort/budget |
| JSON schema / structured output | `models.ts` per model | `validation.ts` | can enforce a response schema |
| streaming | `models.ts` per model | `core/streaming.ts` | can stream tokens |
| prompt caching | `models.ts` per model | `chat.ts` | supports cache read/write |

> **Why per-model, not per-provider:** whether vision/reasoning works varies *within* a provider.
> The old gateway put reasoning in a single shared switch that silently no-op'd for 12 of 15
> providers (audit §D/§E). Declaring per model makes "unsupported" an explicit, testable reject.

### 5.3 The `ProviderModule` shape (spec)

```
ProviderModule = {
  id: "openai"
  capabilities: Capability[]           // from ./capabilities.ts
  models(): Promise<Model[]>           // discovery source (§6)
  chat?:       ChatHandler             // present IFF supported
  embed?:      EmbedHandler
  rerank?:     RerankHandler
  transcribe?: TranscribeHandler
  speak?:      SpeakHandler
  image?:      ImageHandler
  video?:      VideoHandler
  audioGen?:   AudioGenHandler
  credits?:    CreditsHandler          // §8 — optional per provider
}
```

A handler is present only if the provider supports that capability. A feature route calls
`provider.embed?.(...)` and, if undefined, returns `CAPABILITY_NOT_SUPPORTED` — one uniform line.
Each handler's only job: internal type → provider wire format (via AI SDK, over the transport
from §3) → internal type. No provider field names leak past the handler.

---

## 6. Discovery — the model catalog (required subsystem)

The owner's existing design, kept and made first-class. Two jobs:

1. **Discover models on a schedule** (cron) by asking every provider's `models()` for its current
   model list + pricing.
2. **Publish a normalized catalog for the frontend** — the frontend reads this to build its model
   picker. This is intentional and stays.

```
discovery/
  discover.ts    # orchestrates provider.models() across all registered providers (parallel, fault-isolated)
  catalog.ts     # normalizes results into one shape, writes to KV, serves via /v1/models
  schedule.ts    # cron entrypoint (every 6h by default) — reads the cron string from ONE constant
```

- **Storage:** Cloudflare KV (`MODELS_KV`). Full catalog under one key; per-model pricing under
  `pricing:{modelId}` for cheap cost lookups.
- **Serving:** `GET /v1/models` returns the KV catalog (fast, no live calls). A manual/forced
  refresh is possible but is an internal concern (no public abuse surface — §1).
- **Fault isolation:** one provider failing during discovery must not abort the whole run
  (per-provider try/catch, record status). *(Audit §F confirmed the old design did this correctly —
  we keep it.)*
- **Pricing honesty:** `models.ts` fetches live pricing where the provider exposes it (OpenRouter
  does; OpenAI's must be maintained as clearly-marked static constants). Never present a hardcoded
  guess as if it were live. Unknown price = `null`/`N/A`, never invented. *(Kills audit §F's
  "no hardcoded pricing" claim that was actually false.)*

> **Cron consistency:** the cron string lives in ONE place and `wrangler.toml` references the same
> value — no duplicated literal that can drift (audit §F flagged the old duplicate at `index.ts:21`).

---

## 7. Tracking — Cloudflare AI Gateway is the backbone (decided)

**Decision (owner asked for a recommendation; this is it): do NOT build our own telemetry.**

Because every provider call goes through CF AI Gateway (§3), CF already records, per
model/provider/time-range: total requests, token usage, **cost**, errors, and **cache-hit %**,
with dashboard + GraphQL access and time filters (30d/7d/24h/1h/etc.). Rebuilding that ourselves
would mean unreliably reverse-engineering token counts out of streams — exactly the fragility the
owner called out.

**What our `tracking/` layer does (thin):** forward only the small set of *business* fields CF
can't know — e.g. which end-user or feature a request belongs to, the BYOK alias used, and a
normalized cost/token summary — to the external `tracker` worker (fire-and-forget), for our own
per-user attribution UI.

```
tracking/
  track.ts   # builds a thin normalized summary, sends to TRACKER binding, never blocks the response
```

- No chat content or raw prompts persisted here (audit §K: keep `inputPreview` bounded/redacted).
- CF AI Gateway = platform analytics. Our tracker = business attribution. They don't overlap.

> **Practical caveat from the docs:** CF's analytics may not always split input vs output tokens
> or log full payloads. If we need that granularity for billing, the thin summary in `track.ts`
> can carry the AI SDK's reported `usage` object (which does split tokens) — so we get exact
> numbers without building a telemetry pipeline.

---

## 8. Credits — provider balance (required subsystem, peer to discovery)

Reports how much credit/money remains, per provider. Today mostly **OpenRouter** exposes this;
design so any provider *can*.

```
credits/
  credits.ts    # orchestrates provider.credits() for providers that implement it; caches in KV
  schedule.ts   # optional cron to refresh balances periodically
```

- `credits` is an **optional per-provider capability** (`ProviderModule.credits?`). A provider
  without a balance API simply doesn't implement it, and `GET /v1/credits/:provider` returns
  `supported: false` for it. *(Mirrors the old gateway's OpenRouter-only credits, but generalized
  so adding a second credit-capable provider is just implementing one handler — audit §L noted the
  old credits code was OpenRouter-hardcoded.)*
- Surfaced in the health endpoint (§10) and via `GET /v1/credits`.

---

## 9. Endpoints — the complete list

Every route. **None require auth** (§1). All are internal-only.

| Method | Path | Purpose | Streaming |
|---|---|---|---|
| GET  | `/health` | Rich status: providers reachable, discovery freshness, CF AI Gateway reachable, credits, version (§10) | No |
| POST | `/v1/chat/completions` | Chat (text/vision/tools/reasoning/JSON) | Yes (SSE) |
| POST | `/v1/embeddings` | Embeddings | No |
| POST | `/v1/rerank` | Reranking | No |
| POST | `/v1/audio/transcriptions` | STT | No |
| POST | `/v1/audio/speech` | TTS | No |
| POST | `/v1/images/generations` | Image generation (pass-through) | No |
| POST | `/v1/images/edits` | Image editing (pass-through) | No |
| POST | `/v1/videos/generations` | Video generation (async job) | No |
| GET  | `/v1/videos/status/:jobId` | Poll a video job | No |
| POST | `/v1/audio/generations` | Music/audio generation (future) | No |
| GET  | `/v1/models` | The discovered catalog (frontend reads this) | No |
| GET  | `/v1/credits` | All provider balances | No |
| GET  | `/v1/credits/:provider` | One provider's balance | No |
| GET/PUT | `/v1/admin/config` | Control-plane toggles (§11) | No |
| (cron) | discovery sync | Refresh model catalog every 6h | — |
| (cron) | credits refresh (optional) | Refresh balances | — |

> Endpoint names mirror the OpenAI REST shape where one exists, so existing clients/SDKs work
> without custom mapping.

---

## 10. Health endpoint — rich status

`GET /health` is not a trivial "ok". It reports:

- gateway version + uptime
- per-provider reachability (can we reach it through CF AI Gateway right now)
- **CF AI Gateway** reachability (the transport backbone)
- discovery freshness (when was the catalog last refreshed; is it stale)
- credit balances (from §8, cached)
- which capabilities/providers are currently enabled (from admin config §11)

This makes `/health` the one-call operational overview of the whole gateway.

---

## 11. Admin / control-plane — its OWN top-level folder (not under features)

The owner correctly flagged that admin is **not a feature**. Features are request-shaped
(chat, embeddings, images…). Admin is a control-plane. So it lives at the top level:

```
admin/
  route.ts    # GET/PUT /v1/admin/config
```

It controls, at **runtime** (no redeploy):

- enable/disable a **provider**
- enable/disable a specific **model**
- enable/disable a **capability** (e.g. turn off image generation globally)
- set the active **BYOK alias** (e.g. switch `production` ↔ `staging`)
- trigger a discovery refresh

Config is stored in KV and read by the registry/validation layers. *(The old gateway's admin only
did model-tier overrides — audit answer #5. This generalizes it to real provider/model/capability
control.)*

---

## 12. Full folder structure

```
gateway-v2/
  src/
    core/
      types.ts            # one internal shape per modality
      capabilities.ts     # Capability enum + per-model sub-feature declarations
      registry.ts         # the single provider/model source of truth
      errors.ts           # GatewayError taxonomy + toErrorResponse (user-facing, proper HTTP codes)
      streaming.ts        # the one SSE loop
      validation.ts       # pre-flight capability checks
      transport/
        cloudflareGateway.ts  # CF AI Gateway baseURL + cf-aig headers (BYOK alias)
        directKeys.ts         # fallback for providers CF doesn't support (env-var key)
        index.ts              # picks CF vs direct per provider

    providers/
      openai/
        index.ts
        capabilities.ts
        models.ts
        chat.ts             # text + vision + tools + reasoning + JSON + streaming
        embed.ts
        transcribe.ts
        speak.ts
        image.ts
        # credits.ts only if the provider has a balance API (OpenAI: no)

    features/               # request-shaped route handlers (provider-agnostic)
      chat/route.ts
      embeddings/route.ts
      rerank/route.ts
      audio/route.ts        # STT + TTS
      images/route.ts       # gen + edit (pass-through, NO storage)
      video/route.ts        # gen (pass-through / async job)
      models/route.ts       # serves the discovered catalog

    discovery/              # model discovery + catalog publishing (§6)
      discover.ts
      catalog.ts
      schedule.ts

    credits/                # provider balance subsystem (§8)
      credits.ts
      schedule.ts

    tracking/               # thin business summary -> tracker (§7). NOT full telemetry.
      track.ts

    admin/                  # control-plane, separate from features (§11)
      route.ts

    health/
      route.ts              # rich status (§10)

    infrastructure/
      cloudflare/
        env.ts              # the gateway's OWN env type (no ../../chat imports)
        kv.ts               # KV wrapper (catalog, pricing, credits, admin config)

    index.ts                # wires features/discovery/credits/admin/health. No auth. No provider specifics.

  tests/                    # we write tests this time (audit §N)
  wrangler.toml             # secret: CF_AIG_TOKEN (+ minimal direct keys for non-CF providers). No image R2.
  package.json
  tsconfig.json
  GATEWAY_GUIDE.md          # this file
  README.md                 # written at Phase 5
```

---

## 13. The two contributor workflows (the payoff)

**Add a provider:** create `providers/<name>/`, add `capabilities.ts` + `models.ts` + one file per
supported capability, add `index.ts`, then one import + one array entry in `core/registry.ts`, and
(if CF supports it) nothing else — transport is automatic; else add a direct-key entry. No route
changes, no central switch, no touching other providers.

**Add a capability to a provider:** add its handler file, list it in that provider's
`capabilities.ts`, wire it into `index.ts`. If the capability is new to the whole gateway, also add
it to `core/capabilities.ts` + `core/types.ts` + a `features/` route — once, then any provider can
opt in.

---

## 14. Phase plan

Strict order. Each phase is independently reviewable, ships tests, and leaves the gateway working.
**No phase starts until the previous is reviewed.**

### Phase 0 — Skeleton, core contracts, transport
- Scaffold the tree. Write `core/` (`capabilities`, `types` with all modality shapes stubbed,
  `errors`, `registry`, `validation`, `streaming`, `transport/`).
- `infrastructure/cloudflare/env.ts` (own types) + `kv.ts`.
- `index.ts` with `/health` (basic) wired, empty registry. **No auth.**
- `wrangler.toml` (secret `CF_AIG_TOKEN`, KV bindings), `package.json`, `tsconfig.json`.
- Test: skeleton builds, `/health` responds.
- **Exit:** `npm run build` clean; `/health` 200; registry empty; transport can produce a valid
  CF AI Gateway `{baseURL, headers}` for a dummy provider.

### Phase 1 — OpenAI: chat (text + vision + tools + reasoning + streaming), via CF AI Gateway
- `providers/openai/`: `capabilities.ts`, `models.ts` (live `/v1/models` + clearly-marked pricing),
  `chat.ts` — calls OpenAI **through** the CF AI Gateway transport.
- `features/chat/route.ts` + `features/models/route.ts` + `discovery/` (so `/v1/models` works).
- Validation rejects vision→text-only, tools→unsupported, reasoning→unsupported.
- Tests: chat non-stream, chat stream, tool call, vision input, one rejected-capability case,
  and a transport test asserting the `cf-aig-*` headers are set and the provider Authorization
  header is absent.
- **Exit:** a real OpenAI chat completion works end-to-end (streamed + non-streamed) through CF AI
  Gateway, and appears in the CF AI Gateway analytics dashboard.

### Phase 2 — OpenAI: embeddings
`providers/openai/embed.ts` + `features/embeddings/route.ts`. Tests.

### Phase 3 — OpenAI: audio (STT + TTS)
`transcribe.ts`, `speak.ts` + `features/audio/route.ts`. Tests.

### Phase 4 — OpenAI: image generation/editing (pass-through, NO storage)
`image.ts` + `features/images/route.ts`. Returns bytes/URL straight to caller. Tests.

### Phase 5 — Discovery hardening, credits, tracking, admin, health, README
- Full discovery cron + catalog publishing.
- `credits/` (OpenRouter-ready even before OpenRouter is added, as the reference implementation).
- `tracking/track.ts` → tracker binding.
- `admin/route.ts` runtime toggles. Rich `/health`.
- README.

### Phase 6+ — More providers, one folder at a time
- OpenRouter (chat + credits — the first credit-capable provider; CF-supported transport).
- Anthropic (chat + vision + tools + reasoning; no embeddings/tts — folder simply lacks them).
- Google (chat + embeddings + tts + vision).
- Then, as needed: a rerank provider (Cohere), ElevenLabs (TTS), a video model, a music model.
- Alibaba/MiniMax etc. arrive via the **direct-key fallback** (§3) since CF doesn't proxy them.

> Video and music get real modality types in `core/types.ts` when the first provider needing them
> is added — designed-for now, built when needed.

---

## 15. Audit issues this design eliminates (traceability)

| Audit finding | How v2 kills it |
|---|---|
| §B/§L: three disagreeing provider lists | One `core/registry.ts`, auto-assembled from folders |
| §J: auth gaps, fail-open | No auth by design; `api`+`auth` workers handle it upstream (§1) |
| §H: 12 ad-hoc error strings, one route re-throws | One `GatewayError` taxonomy, user-facing, proper HTTP codes |
| §I: Groq override drops abort/retry | One `core/streaming.ts`; no per-provider call paths |
| §D/§E: reasoning silently no-ops for 12 providers | Declared per model, validated, never silent |
| §G/§L: dead `images.ts`, orphaned R2 | Media is pass-through; no storage, no buckets |
| §K: product copy in `modes.ts` | Not in the gateway at all |
| §L: `../../chat/src/...` imports | Gateway owns its types in `infrastructure/.../env.ts` |
| §L: OpenRouter-hardcoded credits | `credits` is an optional per-provider capability (§8) |
| §F: false "no hardcoded pricing" claim | Live pricing where available; static clearly marked; unknown = N/A |
| §F: duplicated cron literal | One cron constant, referenced by `wrangler.toml` |
| §3/§L: 15 provider keys in env | BYOK via CF AI Gateway; only `CF_AIG_TOKEN` in secrets (§3) |
| whole telemetry burden | CF AI Gateway is the analytics backbone; thin tracker only (§7) |
| §G: zero request validation | `core/validation.ts` pre-flight on every request |
| §N: zero tests | Every phase ships tests |
| §O: zero docs | This guide + README at Phase 5 |

---

## 16. Open decisions (revisit when relevant; do not block Phase 0/1)

- [ ] Exact BYOK alias strategy (single `production` alias vs per-environment) — Phase 0/1.
- [ ] Whether `/v1/models` is pure-KV (recommended) vs occasionally live — Phase 1.
- [ ] Whether credits refresh is cron-based or on-demand-cached — Phase 5.
- [ ] Exact async-job + polling contract for video/music — defined in `core/types.ts` when the
      first such provider is added.
- [ ] Which provider introduces rerank first (Cohere is natural) — Phase 6+.
- [ ] Final naming swap: when v2 reaches parity, delete `gateway/`, rename `gateway-v2/` →
      `gateway/`. The Worker `name` stays `studio-gateway` throughout so bindings/analytics/BYOK
      config carry over unchanged.

---

## 17. Naming & deployment note

`gateway-v2/` is a temporary folder name so it can coexist with the current `gateway/` during the
build. The Worker/project is still "the gateway" (`studio-gateway`). When v2 is verified, delete
the old `gateway/` and rename this folder to `gateway/`. Keeping the Worker `name` constant means
the CF AI Gateway instance, its stored BYOK keys, and its analytics history all carry over — the
rename is a folder move, not a fresh deploy.
