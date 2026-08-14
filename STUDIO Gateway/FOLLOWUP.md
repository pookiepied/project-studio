# Studio Gateway — Follow-up Documentation

> One-file resume so a new chat can continue. Last updated: 2026-08-13. Commits `2ceda1d`, `1255d88`, Phases A-E (D1-D6, E1-E4 done).

## 1. Quick Resume (paste this into a new chat)

```
We are working on STUDIO Gateway (Cloudflare Workers + Hono + D1).
Unified OpenAI-compatible URL: Gateway.example.com/v1.
Two-layer model: catalog ingestion is first-party from models.dev (full 184 providers), admin gates via enabled (operator-owned, popular 20 loud) → exposed (production). Gateway proxy only serves exposed. Phases A-E done: auth hardening (fail-closed production, timingSafeEqual, redact), rate limit (per-key cleanup, correct resetAt, X-RateLimit headers), catalog preservation (006), vision/documents hardening, reasoning budget validation, registry reliability (no silent downgrade). 91 tests, 22 curated runtime providers.
```

## 2. Original Instructions & Intent

User's gateway idea was simple: one URL for every model. Early code had 20 `src/providers/*/adapter.ts` folders, 4 hand-rolled protocol adapters, D1 with `providers/credentials/models/gateway_keys`, encrypted keys, 6h discovery cron. Plan was text first, then image → video → audio. Now production-grade with wider providers and no 50k-line rewrite — fix early.

## 3. Final Goal

* Single gateway Worker that is **transparent OpenAI-compatible** for: `POST /v1/chat/completions`, `/v1/responses`, `/v1/images/generations`, `/v1/audio/{speech,transcriptions}`, `/v1/embeddings`, `GET /v1/models`, `POST /v1/videos/generations` (Fal-only), `POST /v1/documents/preprocess` (experimental). `rerank`/`audio.music`/`image.edit` not advertised until runtime exists.
* **First-party catalog** from `models.dev` 184 providers / 6291 models — fetch all, tag every field, gate in admin.
* Gateway isolated from admin/health/rate-limit; admin is where disabled→enabled→production happens.
* No per-provider folder sprawl; quirks single table, factory for 17 generics.

## 4. What Was There / What Changed

**Before (blueprint.md):** 20 hard-coded providers, 20 adapter folders deleting `store`/`strict`, only `chat`+`models`+`responses`.

**Changed Phases A-E:**
- **A:** Harden auth fail-closed (`wrangler.toml` production default), timingSafeEqual, redact `x-admin-token`, rate limit per-key + correct `resetAt` + `X-RateLimit-*`, catalog `exposed` preserve, vision 400, registry static map.
- **B:** `adapters/sdk.ts` → `router.ts` + `catalog/mapper.ts`, `services/discovery` → `catalog/discovery`, `gateway/orchestrator` → `gateway/resolver`, `custom/fal|elevenlabs` → `third-party/*/catalog`, `popular` → `enabled-allowlist` + `defaults`, `lib` → `infra`/`observability`.
- **C:** Quirks single table before SDK (`common.ts`), `factory.ts` for 17, `shared/sse` + `protocol-sse` stable `crypto.randomUUID()`, `rowToModelDef` + `authorizeGateway`, dead `extractBudgetTokens` removed, openai budget dropped.
- **D1:** `ENVIRONMENT=production` default + `[env.development.vars]`, `gatewayAuth` middleware deleted (helper `authorizeGateway` canonical), `requireAdmin` Bearer case-insensitive + `timingSafeEqual`, logger redacts `x-admin-token`.
- **D2:** `RATE_LIMIT_WINDOW_MS 60_000` + `MILLISECONDS_PER_SECOND` constants, `DELETE WHERE key_id=? AND timestamp<?`, `resetAt = oldest+WINDOW`, `X-RateLimit-*`/`Retry-After` via `gatewayAuth` + `errorHandler`, 7 ratelimit tests.
- **D3:** `sync.ts` preserves `providers.enabled` (no overwrite), `006` seeds `nvidia/perplexity` + fixes `fireworks` `/v1`, `409` on duplicate `model_id` exposed `admin/providers`+`models/bulk`.
- **D4:** `needsVisionFallback` covers `image_url/image/file/document/pdf/inlineData/data:` + `source.media_type`, `documents` D1 lookup not client trust, `DOCUMENT_*` constants, removed `vision.pdf/document.ocr` from `PROVIDER_CAPABILITIES`.
- **D5:** `REASONING_BUDGET_MIN 1 MAX 128_000`, `validateBudgetTokens`, `BUDGET_SUPPORTED_PROVIDERS {anthropic,google}`, `isBudgetSupported` check in `chat`+`responses` + SDK defense, 16 reasoning tests.
- **D6:** `CURATED_THIRD_PARTY_IDS` derived, `logger.error` + `throw providerError` on curated loader fail (no silent generic), 6 registry tests.

## 5. Overview (How It Works Now)

```
Admin layer (gated)              Catalog layer                    Gateway layer (isolated)
POST /admin/catalog/sync ──► fetch models.dev api.json ──► 184 providers D1 (popular 20 loud for new, existing preserved)
                                   │                              │
POST /admin/providers/:id ──► {enabled:true} ◄────────────────────┘  operator-owned
PATCH /admin/.../models/:mid {exposed:true} ──► 409 if model_id already exposed elsewhere
                                                      │
Consumer Bearer sk-gw_* ──► POST /v1/{chat,images,audio,embeddings} ──► authorizeGateway (X-RateLimit) → findExposedModel (JOIN providers.enabled) → decrypt → isBudgetSupported? → needsVisionFallback? → getProviderRuntime (static map, no silent downgrade) → AI SDK → OpenAI shape
```

Two fetch queues, one table: **catalog** (bulk) + **live** (`GET /v1/models`). Both `ON CONFLICT` preserve `exposed`/`enabled` (providers `enabled` preserved).

## 6. Project Status

* **Commits:** `2ceda1d`, `1255d88`, Phases A-E.
* **Health:** `pnpm check` pass, `oxlint` 0, `vitest` 91/91 (auth 10, ratelimit 7, vision 12, reasoning 16, registry 6, etc.), `wrangler dry-run` 3004.83 KiB.
* **Migrations:** 001 initial, 002 google+openai, 003 all 20, 004 fal/elevenlabs, 005 catalog widen, 006 nvidia/perplexity + fireworks fix. D1 `studio-gateway` prod id.
* **Routes:** `/` `health/ready`, `/v1/{models,chat/completions,responses,images/generations,audio/*,embeddings,videos/generations,documents/preprocess}`, `/admin/{providers,credentials,keys,models,catalog/sync,discovery/run}`.
* **Providers:** 22 curated runtime (20 migrated +2 sync, 17 generic via factory, 5 first-party). `PROVIDER_CAPABILITIES` 3 + generic, all `verified:false` until fixture tests.
* **Not yet:** admin UI, live D1 seed run, route integration tests for images/audio/videos/documents, `verified:true`.

## 7. How To Run / Sync / Test

```bash
cd "STUDIO Gateway"
pnpm install
pnpm db:migrate --local          # applies 001..006
curl -H "x-admin-token: $ADMIN_TOKEN" -X POST http://localhost:8787/admin/catalog/sync
curl -H "x-admin-token: $ADMIN_TOKEN" http://localhost:8787/admin/providers | jq '.data | length' # 22
curl -H "x-admin-token: $ADMIN_TOKEN" -X PUT http://localhost:8787/admin/providers/openai/credential -d '{"apiKey":"sk-..."}'
curl -H "x-admin-token: $ADMIN_TOKEN" -X PATCH http://localhost:8787/admin/providers/openai/models/gpt-4o -d '{"exposed":true}'
curl -H "Authorization: Bearer sk-gw_..." http://localhost:8787/v1/models
curl -H "Authorization: Bearer sk-gw_..." http://localhost:8787/v1/chat/completions -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}'
pnpm check && pnpm lint && pnpm test
```

Needed env: `CREDENTIAL_ENCRYPTION_KEY` (base64 32B), `ADMIN_TOKEN` (fail-closed prod), `ENVIRONMENT=production|development`, `GATEWAY_BASE_URL`.

## 8. What's Left / Next

1. **E5 done** — docs now reflect 22 providers, 6 catalog files, gateway/resolver, infra/observability, 91 tests.
2. **F:** Capability & feature completion (F1 rerank decision, F3 image edits, F4 audio music, F5 video imageToVideo, F6 documents WASM) — see plan.
3. **G:** Provider transport correctness (forward `max_tokens`/`temperature` etc. for third-party, image url handling, SSE abort).
4. **H:** Catalog performance (batch `upsertCatalogModel` via `db.batch()`).
5. **I:** Verification suite (route integration, provider fixtures, 40%→80% coverage gates).
6. **J:** Release gate (`check,lint,test,coverage,dry-run,migrations` + staging smoke for 6 providers).

## 9. Continue Conversation

Paste §1 into a new chat and say what you want next, e.g. “run catalog sync and test fal image” or “start Phase F”.

## 10. Current File Map (82 files)

```
migrations/001_init.sql 002_providers_google_openai.sql 003_providers_all.sql 004_providers_fal_elevenlabs.sql 005_catalog.sql 006_providers_nvidia_perplexity_fireworks_fix.sql
src/adapters/{router.ts, protocol-sse.ts, anthropic-messages/, openai-completions/, openai-responses/, google-generative-ai/}/adapter.ts
src/catalog/{sync.ts, repository.ts, discovery.ts, mapper.ts, defaults.ts, enabled-allowlist.ts}
src/gateway/{resolver.ts}
src/infra/{db.ts (rowToModelDef), encryption.ts}
src/observability/{logger.ts, telemetry.ts}
src/lib/{errors.ts, ratelimit.ts (RATE_LIMIT_WINDOW_MS)}
src/middleware/{auth.ts, gatewayAuth.ts, errorHandler.ts}
src/providers/{registry.ts (CURATED set), quirks.ts, capabilities.ts, contract.ts, types.ts, shared/{runtime.ts, normalization.ts (buildChatCompletionObject), document.ts, sse.ts (buildChatCompletionResponse)}, anthropic/{index.ts, sdk.ts, capabilities.ts, discovery.ts, types.ts}, google/{index.ts, sdk.ts, capabilities.ts}, openai/{index.ts, sdk.ts, capabilities.ts}, third-party/{common.ts, factory.ts, alibaba|...|zai/index.ts, fal/{index.ts, catalog.ts}, elevenlabs/{index.ts, catalog.ts}}}
src/routes/{system/health, v1/{chat.ts, models.ts, responses.ts, images.ts, audio.ts, embeddings.ts, videos.ts, documents.ts}, admin/{providers.ts, credentials.ts, keys.ts, models.ts}}
src/index.ts  wrangler.toml (ENVIRONMENT=production)  package.json (ai + 6 @ai-sdk/*)
tests/{auth.test.ts, ratelimit.test.ts, catalog.test.ts, vision.test.ts, reasoning.test.ts, registry.test.ts, ...} 91 tests
docs/blueprint.md + docs/legacy/blueprint-2026-06.md
```

*Removed:* `src/adapters/sdk.ts` alias, `src/catalog/popular.ts` alias, `src/catalog/resolver.ts` alias, `src/gateway/orchestrator.ts` alias, `src/services/discovery.ts` alias, `src/providers/custom/*` aliases, `src/lib/{db,encryption,logger,telemetry}` aliases, `src/adapters/sse.ts` (renamed to `protocol-sse`), `toOpenAIChatCompletion` duplicate (now `buildChatCompletionObject`/`buildChatCompletionResponse`). *Added:* `catalog/discovery` canonical, `gateway/resolver` canonical, `infra`/`observability` canonical, `factory.ts`, `shared/sse` + `protocol-sse`, `006` migration, `D1-D6` constants and 91 tests.
