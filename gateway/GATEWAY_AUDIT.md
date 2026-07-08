# Gateway Codebase Audit

Repo audited: `C:\pookiepied\Backup\Project Studio Backup 04\gateway`
Method: every file in `src/` (84 files) read in full; cross-referenced against `chat/src/gatewayEnv.ts` and `chat/src/server/types.ts` (sibling worker in the same monorepo, imported by relative path). No test files, no docs found anywhere in `gateway/`. All claims below are cited `file:line`. Claims about live provider APIs/docs are explicitly marked "Unknown: requires manual verification".

---

## Direct answers to the 5 required questions

**1. How many providers, and which?**
Counting is genuinely ambiguous because three different "provider lists" exist in this codebase and they disagree (see section L). Taking the union across all three surfaces:

- **`src/providers/adapters/*` (execution layer, chat completions): 15 named providers** — openai, anthropic, google, groq, xai, deepseek, mistral, cohere, bedrock, azure, openrouter, alibaba, minimax, ollama, lmstudio — plus 2 generic/infra classes (`compat.ts` `OpenAICompatAdapter` for arbitrary OpenAI-compatible endpoints, and `generic.ts`, a deprecated re-export barrel — `src/providers/adapters/generic.ts:1-4`).
- **`src/discovery/providers/*` (model catalog layer): 15 providers** — same 15 as above minus (ollama, lmstudio) plus (cloudflare, fal). I.e. discovery covers alibaba, anthropic, azure, bedrock, cloudflare, cohere, deepseek, fal, google, groq, minimax, mistral, openai, openrouter, xai.
- **`src/providers/registry.ts` (modality/enablement config): 16 providers** — the 15 adapters plus none extra, but note `registry.ts` has **no entry for "custom"/compat** despite `compat.ts` being fully functional (`src/providers/registry.ts:21-87` vs `src/providers/adapters/compat.ts:15`).
- **Net asymmetry**: `cloudflare` and `fal` exist only in discovery (static catalogs, executed via raw `fetch()` in routes, never through an adapter — `src/routes/imageGenerate.ts:116`, `src/routes/videoGenerate.ts:178`). `ollama` and `lmstudio` exist only as adapters (local inference) with no discovery provider, so their models never appear in `/v1/models`.

**2. Is there generic OpenAI-compatible endpoint support?**
Yes. `src/providers/adapters/compat.ts` (`OpenAICompatAdapter`, extends `BaseAdapter`) accepts an arbitrary `(providerName, apiKey, baseURL, headers?)` and is wired as the `default` fallback case in `createProvider()` when a `baseUrl` is supplied (`src/providers/index.ts:172-174`). `src/providers/adapters/generic.ts` is a **deprecated** re-export barrel for `OpenAIAdapter`, `XAIAdapter`, `DeepSeekAdapter`, `MistralAdapter`, `OpenAICompatAdapter` (generic.ts:1-9) — kept only for backward-compat imports. `lmstudio.ts` and `ollama.ts` also use `createOpenAICompatible` under the hood, hardcoded to `http://localhost:{port}/v1` with a placeholder API key (`src/providers/adapters/lmstudio.ts:13-14`, `src/providers/adapters/ollama.ts:13-14`).

**3. What SDKs/libraries are used for provider calls?**
Per `package.json:11-26`: official Vercel AI SDK v6 core (`"ai": "^6.0.193"`) plus official per-provider packages — `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/groq`, `@ai-sdk/xai`, `@ai-sdk/deepseek`, `@ai-sdk/mistral`, `@ai-sdk/cohere`, `@ai-sdk/azure`, `@ai-sdk/amazon-bedrock`, plus `@ai-sdk/openai-compatible` (generic OpenAI-compat wrapper used for alibaba/minimax/openrouter/ollama/lmstudio/compat) and `@ai-sdk/provider` (shared types). No custom in-house HTTP client for chat completions — everything in `src/providers/adapters/*` goes through `ai`'s `generateText`/`streamText` (`src/providers/adapters/base.ts:18-25`). However, **outside the chat-completions path**, `src/routes/embeddings.ts`, `rerank.ts`, `tts.ts`, `imageGenerate.ts`, `videoGenerate.ts`, and `src/execution/direct/audio.ts` bypass the adapter layer entirely and either call AI SDK provider factories directly inline or use raw `fetch()` against provider REST APIs (fal.ai, MiniMax, Alibaba DashScope, Azure, OpenRouter). No `@anthropic-ai/sdk`, no `openai` npm package, no `@google/generative-ai`, no `cohere-ai`, no `@aws-sdk/*` — all AWS/Bedrock access goes through `@ai-sdk/amazon-bedrock`, not the raw AWS SDK.

**4. Which endpoints exist, and are they public/internal/admin?**
See full table in section C. Headline: of 20 registered routes in `src/index.ts:25-84`, **only 2 enforce authentication** (`/v1/admin/modes-config` GET/PUT — hard-gated admin JWT; `/v1/audio/speech` — JWT check but fails open if `JWT_SECRET` unset). The primary route, `/v1/chat/completions`, and every other data/cost-bearing route (`/v1/embeddings`, `/v1/rerank`, `/v1/images/generate`, `/v1/videos/generate`, `/v1/videos/status/:jobId`, `/v1/audio/transcriptions`, `/v1/models`, `/v1/modes`, `/v1/provider-balance/:provider`) have **no auth check at all**. `/internal/stt` has a spoofable header-based guard; `/internal/rate/check` and `/internal/rate/record` have **no guard whatsoever** despite the `/internal/` path prefix.

**5. Is there an admin/control-plane layer, and what can it control?**
Yes — `src/routes/adminModes.ts` (`GET`/`PUT /v1/admin/modes-config`), gated by JWT with `role==="admin"` (`adminModes.ts:80-89`). It controls: (a) per-mode model-ID/description overrides for the 4 user-facing presets (`auto`/`fast`/`standard`/`advanced`, stored under KV key `admin:modes`), and (b) the auto-router's mode (`static`/`dynamic`) and static model override (KV key `admin:auto-config`). It does **not** control tool access, system prompts, provider enablement, rate limits, or CORS — those are all build-time/env-var config (`wrangler.toml`, `src/services/router/config.ts`), not runtime-admin-controllable.

---

## A. Executive Summary

This is a Cloudflare Workers-based LLM gateway that proxies chat completions, embeddings, reranking, TTS/STT, and image/video generation across 15 provider integrations, using the official Vercel AI SDK v6 for the core chat path and a mix of AI SDK-direct-calls/raw-fetch for auxiliary modalities. Model discovery is a scheduled (cron, every 6h) + on-demand hybrid that writes to a Cloudflare KV cache; pricing is partly dynamic (computed from KV-cached per-model data at request time in `pricing.ts`) but the underlying per-model numbers are frequently hardcoded static constants baked into discovery-provider source files, particularly for OpenAI, Google, Groq, Alibaba, xAI, DeepSeek, MiniMax, and the static-catalog providers (Anthropic, Bedrock, Cloudflare, fal).

The single most severe finding is **near-total absence of authentication on the primary and most expensive routes** — `/v1/chat/completions`, `/v1/embeddings`, `/v1/rerank`, `/v1/images/generate`, `/v1/videos/generate`, `/v1/audio/transcriptions`, `/v1/models`, `/v1/modes`, and `/v1/provider-balance/:provider` have zero authentication logic in their handlers, and no global auth middleware exists in `src/index.ts`. Anyone who can reach the deployed Worker URL can consume any configured provider's API budget, including BYOK keys sent via the `x-provider-api-key` header. Two "internal" routes (`/internal/rate/check`, `/internal/rate/record`) also have no protective guard at all, unlike `/internal/stt` which at least checks a spoofable header. This must be treated as the top remediation priority.

Architecturally, the codebase shows clear signs of successive AI-assisted refactors: two separate CORS implementations (`config/cors.ts`+`middleware/cors.ts` vs a dead `isOriginAllowed()` in `utils/providerUtils.ts:25-28` that is never called), a deprecated adapter barrel file (`generic.ts`) still present, a whole route file (`images.ts`) with handlers never registered in the router, and three different "list of supported providers" (adapters/discovery/registry) that disagree with each other on 4 providers. The gateway is otherwise well-isolated from app-specific concerns — `tracking/`, `durable/`, and `services/router/` do not persist chat content or user data, with the caveat that `src/services/router/modes.ts` bakes user-facing marketing copy (mode labels/descriptions/icons) into gateway code, a minor separation-of-concerns issue rather than a security one.

No test files exist anywhere in `gateway/`. No README or documentation files exist anywhere in `gateway/`.

---

## B. Provider Inventory Table

| Provider | In `adapters/`? | In `discovery/providers/`? | In `registry.ts`? | Notes / red flags |
|---|---|---|---|---|
| openai | Yes (`openai.ts`) | Yes (live `/v1/models`) | Yes | Consistent |
| anthropic | Yes | Yes (static catalog) | Yes | Consistent; no live `/models` endpoint (documented, `discovery/providers/anthropic.ts:4`) |
| google | Yes | Yes (live) | Yes | Consistent |
| groq | Yes | Yes (live) | Yes | Consistent |
| xai | Yes | Yes (live) | Yes | Consistent; registry claims `video` support (`registry.ts:39`) with no xai-specific video code — see D/E |
| deepseek | Yes | Yes (live) | Yes | Consistent |
| mistral | Yes | Yes (live) | Yes | registry claims `embedding` (`registry.ts:47`) but `mistral.ts` adapter exposes no `provider` getter for an embeddings route to use (unlike azure/bedrock/cohere) — **possible dead capability claim** |
| cohere | Yes | Yes (live, 3 parallel calls) | Yes | Consistent |
| bedrock | Yes | Yes (static catalog) | Yes | Consistent; pricing always `null` |
| azure | Yes | Yes (config-driven, no live list) | Yes | Consistent |
| openrouter | Yes | Yes (live) | Yes | Consistent; broadest registry claim (`registry.ts:62-65`) |
| alibaba | Yes | Yes (live) | Yes | Consistent |
| minimax | Yes (`MinimaxAdapter` + separate `MinimaxTTS` class) | Yes (hybrid live/static) | Yes | **registry.ts:72 claims `stt` support — zero STT code found in `minimax.ts` adapter** (STT is actually implemented separately in `execution/direct/audio.ts`, not the chat adapter — registry granularity issue) |
| ollama | Yes | **No** | Yes | Local inference; never appears in `/v1/models` catalog |
| lmstudio | Yes | **No** | Yes | Local inference; never appears in `/v1/models` catalog |
| cloudflare | **No** | Yes (static, gated by `env.AI` binding) | **No** | Image-gen only; catalogued but **no execution path exists at all** — see section M |
| fal | **No** | Yes (static, gated by API key) | **No** | Image/video-gen only; executed via raw fetch, not an adapter |
| "custom" / compat | Yes (`compat.ts`, fully functional) | No | **No** | Functional adapter has zero registry entry — `getEnabledModalities("custom",...)` always returns `[]` (`registry.ts:97-102`) |

**Total distinct provider identifiers across all three systems: 18** (15 adapters + cloudflare + fal, with ollama/lmstudio absent from discovery and cloudflare/fal/compat absent from registry).

---

## C. Endpoint Inventory Table

All routes registered in `src/index.ts:25-84`. "Auth" column reflects what the handler function itself does — no global auth middleware exists (`app.use()` is never called in `index.ts`).

| Method | Path | Intent | Auth enforced? | Streaming | Provider/category |
|---|---|---|---|---|---|
| GET | `/health` | Public | No (trivial) | No | n/a — status check (`index.ts:25-32`) |
| POST | `/v1/chat/completions` | Public | **No** | Yes (SSE, `chat.ts:73-112`) | All 15 chat-capable adapters via `createProvider()` |
| GET | `/v1/models` | Public | **No** | No | Discovery catalog (all providers) |
| GET | `/v1/modes` | Public | **No** | No | KV-backed mode config |
| GET | `/v1/admin/modes-config` | Admin | **Yes** (JWT + `role==="admin"`, `adminModes.ts:80-89`) | No | n/a |
| PUT | `/v1/admin/modes-config` | Admin | **Yes** (same) | No | n/a |
| POST | `/v1/audio/transcriptions` | Public | **No** | No | groq, openai, azure, openrouter, alibaba, minimax (via `AudioExecutor`) |
| POST | `/v1/audio/speech` | Public | **Yes, but fail-open** — only checked `if (env.JWT_SECRET)` (`tts.ts:37-40`) | No | google, openai, openrouter, alibaba, groq, minimax, azure |
| POST | `/v1/images/generate` | Public | **No** | No (returns raw image bytes) | fal, openrouter, openai (raw fetch, no adapter) |
| POST | `/v1/videos/generate` | Public | **No** | No (async job + polling) | fal, openrouter (raw fetch, no adapter) |
| GET | `/v1/videos/status/:jobId` | Public | **No** | No | fal, openrouter |
| POST | `/v1/embeddings` | Public | **No** | No | openai, google, mistral, cohere, bedrock (direct AI SDK calls, bypasses adapters) |
| POST | `/v1/rerank` | Public | **No** | No | cohere, bedrock (AI SDK), openrouter (raw fetch) |
| GET | `/v1/provider-balance/:provider` | Public | **No** | No | openrouter only; all others return `supported:false` |
| POST | `/internal/stt` | Internal (intended) | **Weak** — spoofable header check in `index.ts:73-75` (`x-service-binding==="1"` OR missing `origin` header), not cryptographic | No | Delegates to `/v1/audio/transcriptions` logic |
| GET | `/internal/rate/check` | Internal (intended) | **None at all** — no guard in `index.ts:80` or in `rateTracker.ts` | No | n/a — Durable Object / KV counter |
| POST | `/internal/rate/record` | Internal (intended) | **None at all** — same gap | No | n/a |
| — | `handleImageServe` / `handleImageDelete` (`images.ts`) | Intended public/internal (unclear) | N/A | No | **Never registered in `index.ts` — dead code, unreachable via HTTP** |
| `*` (catchall) | — | Public | N/A | No | Returns 404 JSON (`index.ts:83-85`) |
| (cron) | `scheduled()` | n/a | n/a | n/a | Triggers `modelSyncService.syncModels(env)` every 6h (`index.ts:87-93`, `wrangler.toml:103`) |

---

## D. Model Capability Matrix

Strictly what adapter code implements (not provider capability in general). "✓(shared)" means the capability flows through `BaseAdapter`/`shared/messages.ts` generically rather than provider-specific code, so it works only if the underlying `@ai-sdk/*` package supports translating that content type for that provider.

| Provider | Text | Vision (image in) | Tools | Reasoning/thinking budget | Streaming | JSON schema tools | Prompt caching | Embeddings | Rerank | Image gen | STT | TTS | Audio input | Video input | Video gen | Realtime/WS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| openai | ✓ | ✓(shared) | ✓(shared) | **✗ no case in `buildThinkingOptions`** (`base.ts:275-297`) | ✓ | ✓(shared, `shared/tools.ts`) | ✓(shared, cache fields captured generically `base.ts:45-50`) | Claimed by registry, no adapter code (route calls AI SDK directly) | — | via raw fetch in `imageGenerate.ts`, not adapter | via `AudioExecutor`, not chat adapter | via `tts/providers.ts`, not chat adapter | ✓(shared, file blocks) | ✓(shared, hardcoded mp4 mediaType) | — | Missing |
| anthropic | ✓ | ✓(shared) | ✓(shared) | **✓ full** (`base.ts:277-280`) | ✓ | ✓(shared) | ✓ (Anthropic is primary AI-SDK cache user) | — | — | — | — | — | ✓(shared) | ✓(shared) | — | Missing |
| google | ✓ | ✓(shared) | ✓(shared) | **✓ full** (`base.ts:282-285`) | ✓ | ✓(shared) | ✓(shared) | Claimed by registry, no dedicated adapter code (route calls AI SDK directly) | — | Claimed by registry, no adapter code | — | via `tts/providers.ts` | ✓(shared) | ✓(shared, comment explicitly says built for Gemini) | — | Missing |
| groq | ✓ (custom `complete()` override for `gpt-oss-120b`, `groq.ts:26-62`) | ✓(shared) | ✓(shared), but custom override path **drops abortSignal, topP, 402-retry fallback** | **✗ no case** | ✓ | ✓(shared) | ✓(shared, generic) | — | — | — | via `AudioExecutor` | via `tts/providers.ts` | ✓(shared) | ✓(shared) | — | Missing |
| xai | ✓ | ✓(shared) | ✓(shared) | **✗ no case** | ✓ | ✓(shared) | ✓(shared) | — | — | — | — | — | ✓(shared) | Claimed by registry (`registry.ts:39`), video-handling comment cites only Gemini — **questionable** | Claimed by registry, no xai-specific code | Missing |
| deepseek | ✓ | ✓(shared) | ✓(shared) | **✗ no case** (R1 reasoning is auto/always-on upstream, so may be non-issue) | ✓ | ✓(shared) | ✓(shared) | — | — | — | — | — | ✓(shared) | ✓(shared) | — | Missing |
| mistral | ✓ | ✓(shared) | ✓(shared) | **✗ no case** | ✓ | ✓(shared) | ✓(shared) | Claimed by registry; route calls AI SDK Mistral directly, no `provider` getter in adapter | — | — | — | — | ✓(shared) | ✓(shared) | — | Missing |
| cohere | ✓ | ✓(shared) | ✓(shared) | **✗ no case** | ✓ | ✓(shared) | ✓(shared) | Route calls AI SDK Cohere directly | Route calls AI SDK Cohere `reranking()` directly | — | — | — | ✓(shared) | ✓(shared) | — | Missing |
| bedrock | ✓ | ✓(shared) | ✓(shared) | **✗ no case** — mismatch since Claude-via-Bedrock loses thinking that direct Anthropic gets | ✓ | ✓(shared) | ✓(shared) | Route calls AI SDK Bedrock `textEmbeddingModel()` directly | Route calls AI SDK Bedrock `reranking()` directly | — | — | — | ✓(shared) | ✓(shared) | — | Missing |
| azure | ✓ | ✓(shared) | ✓(shared) | **✗ no case** (loses o1/o3 reasoning support via Azure) | ✓ | ✓(shared) | ✓(shared) | Exposes `provider`/`resolveDeployment()` for external routes (`azure.ts:33,35-37`) | — | — | via `AudioExecutor` (Whisper deployment) | via `tts/providers.ts` | ✓(shared) | ✓(shared) | — | Missing |
| openrouter | ✓ | ✓(shared) | ✓(shared) | **✓ full** (`base.ts:287-291`) + special cost extraction (`base.ts:241`) | ✓ | ✓(shared) | ✓(shared) | Registry claims it; no adapter code | Raw fetch to `/v1/rerank` in `rerank.ts:151-168` | Raw fetch in `imageGenerate.ts:160-175` | via raw JSON+base64 in `execution/direct/audio.ts:160-202` | via `tts/providers.ts` (shares OpenAI-compat handler) | ✓(shared) | ✓(shared) | Raw fetch in `videoGenerate.ts:269-284`, polling not standardized | Missing |
| alibaba | ✓ | ✓(shared) | ✓(shared) | **✗ no case** (Qwen thinking mode unsupported) | ✓ | ✓(shared) | ✓(shared) | — | — | — | via `AudioExecutor` (Paraformer) | via `tts/providers.ts` | ✓(shared) | ✓(shared) | — | Missing |
| minimax | ✓ (`MinimaxAdapter`) | ✓(shared) | ✓(shared) | **✗ no case** | ✓ | ✓(shared) | ✓(shared) | — | — | — | via `AudioExecutor` (requires `MINIMAX_GROUP_ID`) | via separate raw-fetch `MinimaxTTS` class, hardcoded `model:"speech-02-hd"` (`minimax.ts:47`) | ✓(shared) | ✓(shared) | — | Missing |
| ollama | ✓ | ✓(shared, if local model supports) | ✓(shared) | **✗ no case** | ✓ | ✓(shared) | N/A (local) | Registry claims it; zero embedding code in adapter | — | — | — | — | ✓(shared) | ✓(shared) | — | Missing |
| lmstudio | ✓ | ✓(shared) | ✓(shared) | **✗ no case** | ✓ | ✓(shared) | N/A | — | — | — | — | — | ✓(shared) | ✓(shared) | — | Missing |
| cloudflare | — | — | — | — | — | — | — | — | — | Catalogued in discovery, **no execution path found in any route** — see section M | — | — | — | — | — | — |
| fal | — | — | — | — | — | — | — | — | — | Raw fetch (`imageGenerate.ts:116`, `videoGenerate.ts:178`) | — | — | — | — | ✓ (async job+poll) | — |

**Realtime/WebSocket: Missing across the board.** No WebSocket handling was found anywhere in `src/` — all "streaming" is SSE over a single HTTP response (`chat.ts:73-112`, `TransformStream`).

---

## E. Provider Documentation Comparison

All statements in this section are based on training knowledge and are explicitly marked as such — verify against current provider docs before acting.

- **Anthropic**: The static catalog (`discovery/providers/anthropic.ts:27-184`) lists Claude Opus/Sonnet/Haiku 4.5, 3.7, 3.5, 3 Opus, with specific prices and context windows current "as of May 2026" per its own comment. Unknown: requires manual verification — model names like "claude-opus-4-5"/"claude-sonnet-4-5"/"claude-haiku-4-5" and the exact pricing figures ($15/$75, $3/$15, $0.8/$4 per M tokens) reflect a future-dated environment relative to this assistant's training cutoff, so they cannot be validated against real Anthropic docs from here. Recommend a manual live check before trusting any hardcoded price in this file.
- **OpenAI discovery** (`discovery/providers/openai.ts:54-58,78-82,102-106,126-130,152-156`): applies one flat price per model *category* (all "gpt" models get input:0.01/output:0.03 regardless of whether it's a mini or full-size model). Based on training knowledge, OpenAI's real pricing varies substantially by exact model tier — this flat-rate approach is very likely to misreport actual cost for any OpenAI model beyond whichever single model the constants were tuned for. Flag as overclaim/inaccuracy, verify manually.
- **Groq**: `NO_PARALLEL_MODELS = ["gpt-oss-120b"]` (`adapters/groq.ts:11`) and the discovery comment (`discovery/providers/groq.ts:43-53`) citing Groq's tool-use docs for which model families support tool calling — plausible and specific enough to be genuine documentation-derived knowledge, but the assistant cannot verify the current state of console.groq.com/docs from training data with confidence for "as of May 2026" claims. Mark unknown, needs verification.
- **Cohere / Mistral / Azure / Bedrock pricing = null**: consistent with training knowledge that these providers either don't expose per-token pricing via API (Cohere bills by billed/search units, Mistral doesn't return cost in `/v1/models`) or pricing varies by contract/region (Azure, Bedrock) — this is a defensible design choice, not an overclaim.
- **OpenRouter dynamic pricing** (`discovery/providers/openrouter.ts:96-98`): OpenRouter's `/api/v1/models` genuinely does return `pricing.prompt`/`pricing.completion` as USD-per-token in its public API per training knowledge — this is the one provider where the "live pricing" claim is credible without further verification, though exact field names/units should be spot-checked against current OpenRouter docs.
- **Reasoning/thinking support gap** (section D): Based on training knowledge, OpenAI's o-series (o1/o3/o4) models, xAI's Grok reasoning variants, and DeepSeek R1 all have real, documented reasoning-effort/budget controls in their respective APIs (and the AI SDK v6 providers for at least OpenAI expose a `reasoningEffort`-style provider option based on training knowledge of the `ai` package). The gateway's `buildThinkingOptions()` (`base.ts:275-297`) only wires this through for anthropic/google/openrouter — silently dropping the `reasoningBudget` parameter for the other providers is a genuine functional gap, not just a documentation nuance.
- **xAI video capability**: registry.ts:39 claims `video` in xai's `supports` list. Based on training knowledge, xAI's public API (as of the assistant's training data) is primarily text/vision-focused; whether Grok has a documented video-understanding or video-generation capability accessible via API is unknown to the assistant with confidence — mark "Unknown: requires manual verification," and note the codebase's own `shared/messages.ts:51-58` comment says the video-block handling was written specifically for Gemini, not xAI, reinforcing that this registry claim looks aspirational/untested.

---

## F. Model Discovery and Pricing Audit

- **Discovery is a hybrid of live and static**, per provider:
  - **Live (`/models`-style API call)**: openai, google, groq, openrouter, alibaba, xai, deepseek, mistral, cohere (9 providers) — `discovery/providers/{openai,google,groq,openrouter,alibaba,xai,deepseek,mistral,cohere}.ts`.
  - **Fully static/hardcoded catalog**: anthropic, bedrock, cloudflare, fal (4 providers) — each file documents *why* (no public models endpoint, or IAM/control-plane complexity).
  - **Config-driven static**: azure — derived from parsing the `AZURE_DEPLOYMENTS` JSON env var (`discovery/providers/azure.ts:63-79`), not a live API call.
  - **Hybrid**: minimax — chat models attempt live `/v1/models` with static fallback (`discovery/providers/minimax.ts:152-210`); ASR and TTS-engine entries are always static; voice slots are fetched live from `/get_voice`.
- **Orchestration**: `src/discovery/discovery.ts`, class `ModelDiscovery.discoverAll()` (`discovery.ts:41-110`) runs all providers in parallel via `Promise.all`; per-provider failures are caught and recorded as `status:"error"` without aborting the whole run (`discovery.ts:139-156`).
- **Cron trigger**: `wrangler.toml:102-103` (`crons = ["0 */6 * * *"]`) → `src/index.ts:87-93` `scheduled()` handler compares `event.cron` against a **duplicated literal** `CRON_MODEL_SYNC` (`index.ts:21`) — this string must be kept manually in sync with `wrangler.toml` since it is not read from config.
- **On-demand trigger**: `GET /v1/models` (`src/routes/models.ts:9-46`) can force a fresh sync if the cache is empty, `?sync=true` is passed, or a configured MiniMax custom voice is missing/mismatched (`models.ts:21-33`) — **no auth gate on `?sync=true`**, meaning any unauthenticated caller can force a full discovery pass across every live provider API on demand (minor cost-amplification / abuse vector, flagged in section J).
- **Storage**: Cloudflare KV, binding `MODELS_KV` (`wrangler.toml:22-24`). Full catalog under key `models_cache` (`CACHE_CONFIG.MODELS_KV_KEY`, `src/config/constants.ts:15`) with 6h TTL (`CACHE_CONFIG.MODELS_TTL`, `constants.ts:14`). Per-model pricing additionally written under separate keys `pricing:{modelId}` (`modelSync.ts:62-70`) so `estimateCostUsd()` can look up cost without loading the full catalog.
- **Pricing computation** (`src/tracking/pricing.ts`): genuinely dynamic at the *computation* layer — priority is (1) provider-returned direct cost (OpenRouter only), (2) KV-stored per-token pricing looked up by model ID at request time, (3) `null`/"N/A". The file's own comment states "No hardcoded pricing table" (`pricing.ts:9`) — **this is true of `pricing.ts` itself**, but misleading about the system as a whole: the underlying per-model dollar figures written into KV originate from hardcoded constants in most discovery-provider files (openai.ts, google.ts, groq.ts, alibaba.ts, xai.ts, deepseek.ts, minimax.ts, anthropic.ts) rather than any live pricing API except OpenRouter (bedrock.ts, azure.ts, cloudflare.ts, fal.ts, mistral.ts, cohere.ts either return `null` or hardcoded static per-item constants). Flag: the "no hardcoded pricing" claim is accurate for `pricing.ts`'s computation logic but not for the system's actual price *data*.
- **Stale doc-comment found**: `modelSync.ts:93-94` claims `getCachedModels()` "Falls back to hardcoded models if KV fails" — the actual implementation (`modelSync.ts:96-107`) returns `null` on failure, with no hardcoded fallback. This is inaccurate documentation, not a functional bug, but worth fixing.

---

## G. Media Handling Audit

- **Image input** (`src/providers/adapters/shared/messages.ts:34-49`): `image_url` blocks converted to AI SDK `ImagePart`, supporting both `data:` URIs and remote `URL` objects — no format/size validation at this layer; validation (if any) happens upstream of the caller of `/v1/chat/completions`, which itself performs zero request-body validation on `messages` content (`chat.ts` has no schema check beyond `model` presence).
- **File/PDF input** (`messages.ts:41-49`): generic `file` blocks map to `FilePart` with caller-supplied `mediaType`/`data`/`filename` — no allow-list of accepted MIME types, no size limit enforced in this conversion layer.
- **Video input** (`messages.ts:51-58`): `video_url` blocks are converted to `FilePart` with **hardcoded `mediaType: "video/mp4"`** regardless of the actual video format — comment explicitly scopes this to "Gemini multimodal input"; sending a non-MP4 video to any other provider through this path would mislabel the content type.
- **Image generation** (`src/routes/imageGenerate.ts`): three raw-fetch integrations (fal `https://fal.run/{modelId}`, OpenRouter `/chat/completions` with `modalities:["image"]`, OpenAI `/images/generations`). No stored output — bytes are streamed straight back to the caller (`imageResp()`, `imageGenerate.ts:46-51`); **no R2 persistence in this route** despite `IMAGES_BUCKET`/`TEMP_IMAGES_BUCKET` bindings existing in `wrangler.toml:36-43` — those buckets are managed exclusively by `src/routes/images.ts` (serve/delete/cleanup), which per section C is **never wired into the router**, meaning the R2-backed image storage/serving feature is currently dead code from an HTTP-reachability standpoint (cleanup cron jobs, if any, were not found calling these functions from within `gateway/src`).
- **Video generation** (`src/routes/videoGenerate.ts`): async job pattern with a **self-contained job ID** — base64url-encoded JSON `{p,m,r}` (provider/model/requestId), requiring no KV/DO state (`videoGenerate.ts:47-58`). fal.ai uses its native queue API; OpenRouter's async polling is explicitly **not implemented** — `pollOpenRouterVideo()` (`videoGenerate.ts:304-331`) always reports `status:"processing"` for genuinely-async jobs, with a code comment admitting this is "not yet standardized on OpenRouter."
- **Audio input (STT)**: `src/routes/audio.ts` validates file presence, model presence, 25MB size cap (`FILE_LIMITS.MAX_AUDIO_FILE_SIZE`, `config/constants.ts:9`), and MIME allow-list (`SUPPORTED_AUDIO_TYPES`, `constants.ts:18-25`) before delegating to `AudioExecutor` (`src/execution/direct/audio.ts`), which implements 6 provider-specific wire formats (groq/openai multipart, azure deployment-URL, openrouter JSON+base64, alibaba multipart, minimax multipart+GroupId).
- **Audio output (TTS)**: `src/tts/providers.ts` implements 6 provider integrations with hardcoded voice-name mapping tables (`src/tts/voices.ts`) translating a "generic" voice name to each provider's native voice ID — static data, not fetched dynamically, low risk since it's cosmetic.
- **SSRF surface**: `imageGenerate.ts:215` fetches whatever URL OpenRouter's own API response contains (`rawUrl`) — this is provider-controlled, not directly attacker-controlled, low risk. `source_image`/`reference_images` request fields (`imageGenerate.ts:26-35`) are passed through to the *provider's* API as URL strings, not fetched by the gateway directly, so SSRF risk from these fields lands on the provider, not this Worker — **Low** risk to the gateway itself, but worth noting the gateway performs no URL validation before forwarding these fields to fal/OpenRouter.

---

## H. Error Handling Audit

**No centralized error taxonomy exists.** `src/middleware/response.ts` provides a single helper, `createErrorResponse(message, status, type, request?)` (`response.ts:3-9`), which wraps a `{error:{message,type}}` JSON body with CORS headers — this is a formatting helper, not a taxonomy (no enum of error types, no mapping from internal exceptions to canonical error codes). Individual routes each invent their own `type` strings ad hoc: `"invalid_request_error"`, `"auth_error"`, `"provider_error"`, `"api_error"`, `"internal_error"`, `"image_generation_error"`, `"video_generation_error"`, `"service_unavailable"`, `"bad_request"`, `"not_found"`, `"unauthorized_error"`, `"configuration_error"` — at least 12 distinct ad hoc type strings across the route files, with no shared constant/enum anywhere.

Provider-adapter errors (`base.ts:130-138,171-176,260-266`) are wrapped as `Error("[{providerName}] HTTP {status}: {message}")` for `APICallError` instances only; non-`APICallError` exceptions (e.g. network failures, `ECONNREFUSED` for local providers) are rethrown unwrapped, bypassing the `[provider] HTTP ...` tagging and the `emitProviderError` telemetry hook entirely.

Notable inconsistency: `src/routes/tts.ts:108-110` — the `catch` block sets a status flag and **re-throws** rather than returning a structured JSON error response, unlike every other route file, which converts exceptions into `createErrorResponse`/inline JSON. This means an unhandled exception from any TTS provider handler propagates as a raw Worker exception rather than a client-friendly error.

**Recommendation**: introduce a shared `GatewayError` class (or discriminated error-type enum) with fields `{type, httpStatus, message, provider?, retryable?}`, and a single `toErrorResponse()` formatter used by every route, replacing the current pattern of each route file re-implementing its own ad hoc error JSON shape.

---

## I. Streaming and Protocol Audit

- **Transport**: HTTP + Server-Sent Events (SSE) only. No WebSocket support anywhere in `src/` (confirmed by absence of any `WebSocketPair`/`Upgrade: websocket` handling in `index.ts` or any route file).
- **Chat streaming** (`src/routes/chat.ts:73-112`): manual `TransformStream` piping SSE frames (`data: {json}\n\n`) from `adapter.streamFull(params)` (an async generator yielding `StreamEvent` objects: `content`/`reasoning`/`tool_calls`/`usage`). Sends `data: [DONE]\n\n` on completion (`chat.ts:85`), and on error, attempts to write an `{type:"error"}` SSE frame before `[DONE]` (`chat.ts:92-95`) — guarded by a nested try/catch since the client may have already disconnected (`chat.ts:96-98`).
- **Abort propagation**: `request.signal` is passed through as `params.abortSignal` (`chat.ts:70`) and wired into every `generateText`/`streamText` call in `BaseAdapter` (`base.ts:108,157,200`) — genuine cancellation support for the base path. **Exception**: Groq's custom `complete()` override for `gpt-oss-120b` + tools (`adapters/groq.ts:26-62`) does **not** pass `abortSignal` to its direct `generateText` call — a real regression where client disconnects would not cancel that specific upstream call.
- **`maxRetries: 0`** is set on every AI SDK call (`base.ts:109,158,201`) — the SDK's internal retry logic is disabled everywhere; there is no gateway-level retry/backoff wrapper found anywhere in the reviewed files, meaning a single transient upstream failure surfaces directly to the client with no automatic retry.
- **Streaming for non-chat modalities**: embeddings, rerank, TTS, image-gen, video-gen are all single-response (non-streaming) by design — appropriate for their content types.
- **Video generation "streaming"**: implemented as async job submission + polling (`videoGenerate.ts`), not SSE/WebSocket — reasonable given generation latency, but the OpenRouter polling path is incomplete (see G).

---

## J. Security Audit

**Deployment context (confirmed from `wrangler.toml`): this Worker has no public URL.** `workers_dev = false`, `preview_urls = false` (`wrangler.toml:5-6`), and there is no `[[routes]]` or custom-domain block anywhere in the config. The only entry points are Cloudflare service bindings from other Workers in the same account (this Worker is the *callee* — see `[[services]]` in the caller's config, not present here) and the `scheduled()` cron handler. This materially changes the severity of "no auth" findings below: an internet attacker cannot reach these routes directly because there is no routable URL for them to hit.

**Residual caveat that does not go away:** a service binding is an *intra-account* trust boundary, not an *authenticated* one. Any other Worker deployed under this same Cloudflare account — not just the intended caller — can invoke this gateway with no credential check. If the calling Worker (e.g. `chat`) is ever compromised (e.g. via its own public-facing surface), or if this account later hosts other Workers with a lower trust level, the blast radius here is the same as if this were public. Treat "no public URL" as removing *one* attacker (anonymous internet), not as a substitute for auth.

Findings, re-ranked with that context applied:

1. **Medium (downgraded from Critical) — No authentication on `/v1/chat/completions`, `/v1/embeddings`, `/v1/rerank`, `/v1/images/generate`, `/v1/videos/generate`, `/v1/videos/status/:jobId`, `/v1/audio/transcriptions`, `/v1/models`, `/v1/modes`, `/v1/provider-balance/:provider`** (`index.ts:25-84`). Not exploitable by an internet attacker given no public route exists, but any other Worker in the account can call these with no identity check, and BYOK keys via `x-provider-api-key` (`chat.ts:41`) are proxied with no rate limit or identity check regardless of caller. Recommend adding auth as defense-in-depth against the intra-account case above, not as an emergency fix.
2. **Medium (downgraded from Critical) — `/internal/rate/check` and `/internal/rate/record` have no guard at all** (`index.ts:80-81`), unlike `/internal/stt` which at least checks a header. Same reasoning as #1: not internet-reachable, but any other in-account Worker can read/corrupt the per-provider rate counters.
3. **Low (downgraded from High) — `/internal/stt`'s guard is spoofable, not cryptographic** (`header('x-service-binding')==='1' || !header('origin')`, `index.ts:73-75`). Moot against internet callers since there's no public route; only relevant if this account's trust model changes.
4. **Low (downgraded from High) — TTS auth is fail-open, not fail-closed.** `src/routes/tts.ts:37-40` only calls `verifyBearerToken` if `env.JWT_SECRET` is set. Still worth fixing (fail-closed is a one-line change and free insurance), but not urgent given no public exposure today.
5. **Medium (unchanged) — `images.ts` serve/delete routes are dead code but a latent risk if re-wired carelessly.** `handleImageDelete` (`images.ts:27-37`) has no auth check; this is a code-review risk for whenever the route gets wired in, independent of the gateway's current exposure.
6. **Informational (downgraded from Medium) — no rate limiting on unauthenticated routes.** Moot while there are no anonymous (internet) callers; would matter again if #1 is not fixed and the account's trust model ever changes.
7. **Informational (downgraded from Medium) — unauthenticated `?sync=true` on `/v1/models`** (`models.ts:12,25-33`) triggers live discovery calls to every provider. Moot for internet abuse; a same-account Worker could still hammer it to burn provider request-rate quota.
8. **Low (unchanged) — API key handling itself is clean.** Keys come from Worker secrets (`env.ts`/`getApiKey()` in `providers/index.ts:69-92`) and are never logged. BYOK keys (`x-provider-api-key`) are used directly and not persisted; only a `source: "byok"` tag reaches `recordUsage()` (`chat.ts:86,89`), not the key value. Unaffected by exposure model — kept as-is.
9. **Informational (downgraded from Low) — CORS config is inconsistent/partially unused.** `src/middleware/cors.ts` is applied ad hoc (`chat.ts` never calls it), and a second unused allow-list function `isOriginAllowed()` (`utils/providerUtils.ts:25-28`) exists as dead code alongside `config/cors.ts:2-10`'s `CORS_CONFIG.allowedOrigins`. CORS is a browser-only enforcement mechanism and is close to moot with no public route reachable by a browser directly — worth cleaning up as dead code, not as a security fix.
10. **SSRF via media URLs — split into two distinct paths after re-tracing (unchanged severity: Low, but now grounded in code, not assumed):**
    - **Image-generation reference/source images** (`imageGenerate.ts:114,150-153`): user-supplied URLs are forwarded as *strings* inside the JSON body to fal.ai/OpenRouter. Those providers' infrastructure does the fetching, not this Worker. No outbound request originates here.
    - **Chat vision input** (`providers/adapters/shared/messages.ts:38,57`): a user-supplied image/video URL is wrapped as `new URL(url)` and handed to the Vercel AI SDK. For providers that accept a URL directly (e.g. OpenAI), the SDK forwards the string — the provider fetches it, not this Worker. For providers that require base64 (e.g. Anthropic does not accept arbitrary external image URLs), the AI SDK core downloads the URL **from inside this Worker** to convert it before sending — confirmed in `node_modules/@ai-sdk/provider-utils/dist/index.js` (`validateDownloadUrl`, `downloadBlob`). This is the one genuine outbound-fetch-of-attacker-controlled-URL path in the stack, and it is **not affected by the "no public URL" reassessment above** — the untrusted input still originates upstream (the end user, via whatever public-facing app calls this gateway), so the lack of a public URL on the gateway itself does not remove this risk. Mitigating factor found in the same file: the SDK already blocks `localhost`, `.local`/`.localhost`, and private IPv4/IPv6 ranges (10.x, 172.16–31.x, 192.168.x, 169.254.x/link-local, etc.) by literal hostname before downloading. Residual gap: the check is a string match on the hostname, not a DNS-resolved check, so a public-looking hostname that resolves to a private IP (DNS rebinding) would not be caught — a narrow, low-probability gap in a third-party dependency, not gateway code, and not something to "fix" locally without patching or wrapping the SDK's fetch.

---

## K. Gateway Boundary Violations

- **`src/tracking/*`**: clean. Purely usage/cost/telemetry metadata forwarded to an external `TRACKER` service binding (`wrangler.toml:98-100`, typed `Fetcher` in `chat/src/gatewayEnv.ts:88`) — no chat content or message bodies are persisted by the gateway itself. The one soft spot: `TrackingParams.inputPreview?: string` (`tracking/usage.ts:30`, forwarded verbatim at `usage.ts:81`) — its content depends entirely on caller discipline; no truncation/redaction is enforced inside `usage.ts` itself. Recommend auditing all call sites that populate `inputPreview` to confirm it's genuinely a bounded preview and not raw user content.
- **`src/durable/RateTrackerDurableObject.ts`**: clean. State shape is exclusively `{providerKey}:{date} → integer counter` (`RateTrackerDurableObject.ts:52-58`) — no app data, no chat content, pure rate-limiting.
- **`src/tracking/credits/*`**: clean. OpenRouter account balance polling, cached in `CREDITS_KV` (15-min TTL) and forwarded to the tracker for historical charting — this is billing/account metadata, not user data.
- **`src/services/router/config.ts`**: borderline-acceptable. Model-tier routing and a single hardcoded per-provider daily budget (`PROVIDER_BUDGETS`, `config.ts:47-49`) — this is control-plane/infra logic analogous to a reverse-proxy's failover config, a defensible gateway concern.
- **`src/services/router/modes.ts`**: **separation-of-concerns violation, not a security/privacy one.** This file hardcodes user-facing product copy — mode labels ("Fast", "Standard", "Advanced"), marketing descriptions ("Instant replies", "Balanced quality", "Maximum capability"), and a UI `icon` enum (`"leaf"|"lightning"|"star"|"sparkle"`) directly consumed by the frontend (`modes.ts:8-45`). This ties gateway deploys to frontend copy changes and duplicates what would typically live in the client app or a dedicated config service — recommend migrating the human-facing labels/descriptions/icons out of the gateway and leaving only the model-ID routing table here.
- **No evidence of chat history, conversation persistence, or user profile storage anywhere in `gateway/src`.** The gateway correctly does not own a chat datastore — that responsibility appears to live in the sibling `chat` worker (confirmed by `env.ts`/`types.ts` re-exporting types from `../../chat/src/...`, see section L).

---

## L. Architecture and Organization Review

- **Monorepo coupling, not a standalone package.** `src/env.ts:4,6` and `src/types.ts:4-12` import types via **relative paths reaching outside the `gateway/` directory** into a sibling `chat/` worker (`../../chat/src/gatewayEnv`, `../../chat/src/server/types`). This means `gateway/` is not independently deployable/portable without the `chat/` directory present at a fixed relative location — a real coupling risk if these two workers are ever meant to be split into separate repos, and worth flagging even though the in-repo comment frames it as intentional ("Single source of truth... no duplication; wrangler bundles the import" — `env.ts:1-3`).
- **Three disagreeing "provider list" sources** (fully detailed in sections B and the direct-answers section): `src/providers/adapters/*` (execution), `src/discovery/providers/*` (catalog), `src/providers/registry.ts` (modality config). They diverge on 4 providers (cloudflare, fal present only in discovery; ollama, lmstudio present only in adapters) and registry.ts additionally omits a working adapter (`compat.ts`/"custom"). Recommend a single canonical provider registry that all three subsystems derive from, rather than three independently-maintained lists.
- **Duplicate/dead CORS logic**: `config/cors.ts` + `middleware/cors.ts` (used, inconsistently) vs `utils/providerUtils.ts:25-28` `isOriginAllowed()` (fully dead, zero callers).
- **Dead code — `src/providers/adapters/generic.ts`**: self-documented as `@deprecated` (`generic.ts:1-4`), a re-export barrel kept only for backward-compatible imports. Should be removed once import sites are confirmed clear (not verified in this audit — flag for a follow-up grep across the full monorepo, not just `gateway/src`).
- **Dead code — `src/routes/images.ts`**: entire file (`handleImageServe`, `handleImageDelete`, `cleanupExpiredImages`, `cleanupExpiredTempImages`) has no registered HTTP route in `src/index.ts`. The R2 buckets it manages (`IMAGES_BUCKET`, `TEMP_IMAGES_BUCKET`) are declared in `wrangler.toml:36-43` with TTL comments referencing "chat cron" (`wrangler.toml:35`) — suggesting the cleanup functions may be intended to run from the sibling `chat` worker's cron, not this one, but that call path was not found in the files audited here. Flag as **Unknown: requires manual verification** whether these functions are actually invoked from elsewhere in the monorepo.
- **Inconsistent adapter constructor signatures**: openai/anthropic/deepseek/google/mistral/xai/groq accept `(apiKey, baseURL?, headers?)`; cohere/alibaba/minimax accept `(apiKey)` only with a baked-in base URL; lmstudio/ollama accept `(port, host)` with a hardcoded placeholder API key. No shared interface enforces this — adding a `baseURL` override to cohere/alibaba/minimax later would require touching call sites, not just the adapter class.
- **Inconsistent provider-instance exposure**: azure/bedrock/cohere adapters expose a `get provider()` accessor so other routes (embeddings, rerank) can reach the underlying AI SDK instance; openai/google/mistral/openrouter do not, yet their embedding/rerank capabilities are claimed in `registry.ts` and are actually implemented by separate routes constructing their own AI SDK provider instances inline (`embeddings.ts:126-183`, `rerank.ts:116-182`) rather than reusing the chat adapter. This works today but means the adapter classes are not actually the single source of truth for "how to talk to provider X" — there are two independent integration surfaces per multi-modality provider.
- **Reasoning/thinking support concentrated in 3 of 15 adapters** (anthropic, google, openrouter) via a single switch statement in the shared base class (`base.ts:275-297`) rather than being an adapter-owned capability — architecturally this is a reasonable shared-code choice, but it silently produces no-ops for the other 12 providers when `reasoningBudget` is passed, several of which (per section E) have real reasoning-model products that this silently fails to control.
- **Groq's custom `complete()` override** (`adapters/groq.ts:26-62`) is the only adapter subclass that overrides base behavior rather than purely configuring `getModel()`/`providerName` — and in doing so drops `abortSignal`, `topP`, and the 402-retry-without-tools fallback that the base class provides, a maintenance hazard: any future improvement to `BaseAdapter.complete()` will not automatically apply to Groq's `gpt-oss-120b`+tools path.

---

## M. Cloudflare and Portability Review

**Cloudflare-specific bindings** (`wrangler.toml`):
- KV namespaces: `MODELS_KV` (model catalog + pricing cache), `MCP_KV` (admin/modes config + "auto-router overrides" per comment `wrangler.toml:26`), `REVOKED_KV` (JWT revocation list).
- R2 buckets: `IMAGES_BUCKET` (7-day TTL generated images), `TEMP_IMAGES_BUCKET` (24h TTL temp images) — both currently orphaned from HTTP routing (section L).
- Durable Object: `RATE_TRACKER_DO` (class `RateTrackerDurableObject`) — atomic per-provider daily counter.
- `[ai]` binding: `AI` — used exclusively to gate Cloudflare Workers AI model discovery (`discovery/providers/cloudflare.ts:119,122-125`); **no code path was found anywhere in `gateway/src` that actually calls `env.AI` to run inference.** `cloudflare.ts`'s own comment (`cloudflare.ts:9-10`) states friendly model IDs map to `@cf/...` paths "inside the image generation router in imageGenerate.ts," but `imageGenerate.ts`'s `switch(provider)` (`imageGenerate.ts:77-83`) only handles `fal`/`openrouter`/`openai` — **no `"cloudflare"` case exists**. This means Cloudflare AI models are catalogued (appear in `/v1/models`) but have **no execution path at all** — a user selecting a `cloudflare:*` model in the UI would hit the `imageGenerate.ts` default case and get a 400 "Unknown image provider" error. This is a more severe version of the "cloudflare has no adapter" finding from section B — confirmed dead feature, not just an architectural inconsistency.
- Service binding: `TRACKER` (typed `Fetcher`) — external usage/telemetry/credits sink, not Cloudflare-proprietary in concept (any HTTP-reachable service would work) but implemented via Cloudflare's zero-latency service-binding mechanism specifically.
- Cron trigger: `[triggers] crons = ["0 */6 * * *"]` — Cloudflare Workers Cron Triggers, drives `scheduled()` in `index.ts:89-93`.
- `compatibility_flags = ["nodejs_compat"]` (`wrangler.toml:4`) — needed for some npm dependency (likely one of the AI SDK packages or a transitive dependency) to run in the Workers runtime.

**Portable / not Cloudflare-specific**:
- All provider HTTP calls (`fetch()`, AI SDK packages) — standard Web APIs, portable to any runtime supporting `fetch`.
- Core chat-completion logic (`providers/adapters/*`, `routes/chat.ts`) — no Cloudflare-specific APIs used beyond the `ExecutionContext`/`ctx.waitUntil()` pattern for fire-and-forget tracking calls (`chat.ts:86,89,130`, `tracking/usage.ts:94-96`) — this pattern has rough equivalents in other edge runtimes (e.g. Deno Deploy, Vercel Edge) but isn't a standard/portable API itself.
- JWT verification (`middleware/auth.ts`) uses Web Crypto (`crypto.subtle`), which is portable across modern runtimes, not Cloudflare-specific.

**Portability verdict**: the business logic (provider adapters, routing, pricing computation) is largely portable, but the **storage layer is fully Cloudflare-coupled** (KV for cache/config, R2 for images, Durable Objects for rate counting, service bindings for cross-worker calls) — migrating off Cloudflare Workers would require replacing all four of these primitives with equivalents (e.g. Redis/DynamoDB for KV, S3 for R2, a distributed lock or single-instance counter for the DO, and plain HTTP calls for the service binding). The **monorepo coupling to `chat/src/...`** (section L) is a bigger portability blocker than the Cloudflare bindings themselves, since it's a repo-structure dependency rather than a swappable infrastructure primitive.

---

## N. Testing Gaps

**No test files found.** An exhaustive search of the entire `gateway/` directory for `*.test.ts`, `*.spec.ts`, `__tests__` directories, `vitest.config.*`, and `jest.config.*` returned zero results. There is no test runner configured in `package.json` (`package.json:6-10` scripts are only `dev`/`deploy`/`tail`; no `test` script exists). `tsconfig.json` has no test-related excludes/includes because there is nothing to exclude. This means:
- Zero automated verification exists for any provider adapter, any route handler, any discovery provider, or any pricing/tracking logic.
- Every finding in this audit (e.g., the Groq custom-path regression, the reasoning-budget no-op for 12 providers, the auth gaps) would have been caught by even minimal unit/integration tests.
- Recommend, at minimum: (1) unit tests for `src/providers/adapters/shared/{messages,tools}.ts` (pure conversion functions, easy to test in isolation), (2) unit tests for `src/utils/modelParser.ts` and `src/tracking/pricing.ts` (pure functions), (3) integration-style tests for each route handler mocking `GatewayEnv`, and (4) a contract test asserting the three provider lists (adapters/discovery/registry) stay in sync.

---

## O. Documentation Gaps

**No README or markdown documentation files exist anywhere in `gateway/`.** An exhaustive search for `*.md` and `readme*` (case-insensitive) across the entire directory tree returned zero results. This means:
- No onboarding document explaining the gateway's purpose, how to run it locally (`wrangler dev`), or how to deploy it.
- No documented list of required environment variables/secrets beyond the inline comments in `wrangler.toml:46-85` (which are reasonably thorough for secrets, but not for behavior).
- No architecture diagram or written explanation of the adapters/discovery/registry three-way split — a new contributor would have to reverse-engineer the relationship (as this audit did) rather than read it.
- No documented API reference for the routes in section C — API consumers have no OpenAPI spec or endpoint list to reference; the only "documentation" is scattered inline comments per route file (e.g. `chat.ts`'s and `tts.ts`'s header comments), which are useful but not equivalent to a maintained API doc.
- In-code documentation is otherwise **unusually good** for a codebase with zero external docs — most files have substantial header comments explaining rationale (e.g. `providers/gateway.ts:1-26`, `tracking/credits/index.ts:1-43`, `discovery/providers/fal.ts:1-24`) — the gap is specifically the absence of any top-level README tying these together.

---

## P. Prioritized Refactor Plan

**Phase 1 — Safety/correctness (do first, before any other refactor)**
1. Add authentication middleware at the Hono app level (`src/index.ts`) covering every route except `/health`, gated by the same JWT scheme already implemented in `middleware/auth.ts` — currently only 2 of 20 routes enforce it.
2. Fix `/internal/rate/check` and `/internal/rate/record` to require the same service-binding check as `/internal/stt`, and make that check itself less spoofable (e.g. a shared secret header rather than presence/absence of `Origin`).
3. Make TTS auth fail-closed: if `JWT_SECRET` is unset, return 503 (configuration error) rather than skipping auth silently (mirror the pattern already used in `adminModes.ts:81-83`).
4. Fix Groq's custom `complete()` override (`adapters/groq.ts:26-62`) to pass `abortSignal`/`topP` and retain the 402-retry-without-tools fallback, or eliminate the override entirely by moving the `parallelToolCalls:false` logic into `providerOptions` merging inside the shared `complete()` path.
5. Decide the fate of `src/routes/images.ts`: either wire it into `index.ts` with proper auth, or delete it along with the now-unused `IMAGES_BUCKET`/`TEMP_IMAGES_BUCKET` bindings if the feature was abandoned.
6. Resolve the Cloudflare-AI-binding dead end: either add a `cloudflare` case to `imageGenerate.ts`'s provider switch so the catalogued Cloudflare models are actually reachable, or remove `discoverCloudflare()` from the discovery pipeline if the feature is not going to be finished.

**Phase 2 — Normalization**
1. Introduce a shared error taxonomy (`GatewayError` class/enum) and route every handler's error path through one formatter, replacing the ~12 ad hoc `type` strings.
2. Consolidate CORS handling into one implementation; delete the dead `isOriginAllowed()` in `utils/providerUtils.ts`.
3. Standardize adapter constructor signatures (`(apiKey, baseURL?, headers?)` for all cloud providers) so cohere/alibaba/minimax can gain base-URL overrides without an interface change later.
4. Wire `reasoningBudget` support (or an explicit documented no-op) for OpenAI, xAI, DeepSeek, and Groq at minimum, given they have real reasoning-model products per training-knowledge (verify current API shapes before implementing).

**Phase 3 — Provider architecture**
1. Establish one canonical provider registry that `adapters/`, `discovery/`, and `registry.ts` all derive from (or generate from), eliminating the current 3-way divergence on cloudflare/fal/ollama/lmstudio/compat.
2. Decide whether embeddings/rerank/TTS/STT should route through the adapter classes (adding `provider` getters uniformly, per azure/bedrock/cohere's existing pattern) or remain a deliberately separate integration surface — currently it's an unplanned mix of both.
3. Remove the deprecated `generic.ts` barrel once import sites across the monorepo are confirmed clear.

**Phase 4 — Media/long-running jobs**
1. Finish or remove the OpenRouter async video polling path (`videoGenerate.ts:304-331`), which currently always reports "processing" for true-async jobs.
2. Decide on and implement image storage/retrieval (Phase 1 item 5) as a complete feature rather than half-wired routes.
3. Add request-body validation (size/shape) for `/v1/chat/completions`'s `messages` array — currently completely unvalidated beyond `model` presence.

**Phase 5 — Control plane**
1. Move `services/router/modes.ts`'s user-facing labels/descriptions/icons out of the gateway into the frontend or a dedicated config service, leaving only the model-ID routing table in the gateway.
2. Extend per-provider rate/budget enforcement (`PROVIDER_BUDGETS`) beyond just `google`, especially once Phase 1's auth work is in place (auth + rate limiting together close the "unmetered spend" gap).
3. Consider whether the admin control-plane (`adminModes.ts`) should also expose provider-enablement toggles at runtime rather than requiring a `wrangler.toml`/env-var redeploy (`ENABLED_PROVIDERS`).

**Phase 6 — Portability**
1. If cross-repo independence is ever a goal, break the `../../chat/src/...` relative imports in `env.ts`/`types.ts` by publishing the shared wire-format types as a small internal package (or duplicating them intentionally with a documented sync process) rather than reaching across worker boundaries via relative paths.
2. Abstract the KV/R2/DO/service-binding usages behind small interfaces if multi-cloud portability is ever required — not urgent given the current single-cloud deployment target, but worth doing before any such migration is attempted.

---

## Q. Final Checklist — items needing manual verification

- [ ] Confirm whether `src/routes/images.ts`'s cleanup functions are actually invoked from the sibling `chat` worker's cron (the wrangler.toml comment references "7-day TTL via chat cron" — not found in `gateway/src`).
- [ ] Confirm whether Cloudflare Workers AI (`env.AI` binding) is ever actually invoked anywhere in the monorepo for the catalogued `cloudflare:*` image models, given no case for `"cloudflare"` exists in `imageGenerate.ts`'s provider switch — this audit found the feature to be dead code within `gateway/src`, but a sibling worker was not checked.
- [ ] Verify current Anthropic model names/pricing against live docs — the static catalog's model names ("claude-opus-4-5" etc.) and prices could not be corroborated against training knowledge and may reflect a simulated/future-dated environment.
- [ ] Verify current OpenAI per-model pricing — the discovery layer applies one flat rate per model category rather than per exact model, which is very likely inaccurate for at least some models in each category.
- [ ] Verify current Groq tool-calling/parallel-tool-calling model support list (`groq.ts:43-53`) against console.groq.com/docs.
- [ ] Verify whether xAI's API genuinely supports video input/understanding as claimed by `registry.ts:39` — the codebase's own video-handling code was written for Gemini only.
- [ ] Verify whether Mistral's, OpenAI's, and OpenRouter's claimed embedding/rerank/TTS/STT capabilities (per `registry.ts`) are actually wired correctly given their adapter files expose no `provider` getter — confirm the separate AI-SDK-direct calls in `embeddings.ts`/`rerank.ts`/`tts/providers.ts` actually cover every capability the registry claims.
- [ ] Confirm the real behavior of `@ai-sdk/openai-compatible`'s translation of `ImagePart`/`FilePart` for alibaba/minimax/ollama/lmstudio/openrouter/compat — the shared message-conversion code assumes uniform support, but this depends on the underlying SDK package's per-provider behavior, not verified in this audit.
- [ ] Confirm current Cloudflare AI Gateway provider-slug mapping (`providers/gateway.ts:36-46`) is still accurate — slugs like `"grok"` for xAI are the kind of detail that changes as Cloudflare's AI Gateway evolves.
- [ ] Determine whether `MINIMAX_GROUP_ID`/Bedrock bearer-token placeholder-credential approach (`adapters/bedrock.ts:27-28`) remains safe against future `@ai-sdk/amazon-bedrock` versions — flagged as fragile but not currently broken.
- [ ] Audit every call site of `recordUsage()` across the wider monorepo (not just `gateway/src`) to confirm `inputPreview` is genuinely truncated/non-sensitive wherever it's populated.
- [ ] Confirm whether any global auth/rate-limiting is applied upstream of this Worker (e.g. at a Cloudflare-level WAF, an API Gateway in front of it, or the `chat` worker proxying all traffic) — if so, the severity of Section J findings 1-2 would be substantially reduced; this audit found no such evidence within `gateway/src` itself, but the sibling `chat` worker was not audited for this.
