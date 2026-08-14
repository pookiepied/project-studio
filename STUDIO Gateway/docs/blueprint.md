# Studio Gateway — Blueprint (current)

> **Supersedes `legacy/blueprint-2026-06.md`.** Canonical resume is `../FOLLOWUP.md`.

## Goals
- Unified URL `Gateway.example.com/v1` OpenAI-compatible: `POST /v1/chat/completions`, `/v1/responses`, `/v1/images/generations`, `/v1/audio/{speech,transcriptions}`, `/v1/embeddings`, `/v1/videos/generations`, `/v1/documents/preprocess`, `GET /v1/models` (+ `GET /v1/models/:id`)
- D1 stores providers, encrypted credentials, models, gateway keys. Worker decrypts via `CREDENTIAL_ENCRYPTION_KEY` (AES-GCM). Gateway only serves `exposed=1` + `providers.enabled=1` + `models.enabled=1`
- Catalog-first: `models.dev` 184 providers via `catalog/sync.ts` + `catalog/repository.ts` single writer (preserves `exposed`/`enabled`); admin gates `enabled` (popular loud 20) → `exposed` (production). Live discovery `catalog/discovery.ts` 6h cron complements catalog.
- One provider home per provider: `src/providers/anthropic`, `google`, `openai`, `third-party/<id>` (17 generic via `factory.ts` + `fal`/`elevenlabs` specialized) each own SDK + capabilities + catalog; `providers/quirks.ts` is single OpenAI-compatible patch table

## Runtime
- Transport: `src/adapters/*/adapter.ts` transparent protocol adapters (fetch passthrough) for discovery & fallbacks
- Router: `src/adapters/router.ts` routes `protocol → adapter` (deprecated `withProviderQuirk` now no-op); `src/catalog/mapper.ts` maps `models.dev` → `ModelDefinition`
- Protocol SSE: `src/adapters/protocol-sse.ts` translates Anthropic/Google SSE → OpenAI SSE; `src/providers/shared/sse.ts` bridges AI SDK `streamText` → OpenAI SSE with `crypto.randomUUID()` stable IDs
- AI SDK primary: `src/providers/anthropic|google|openai/sdk.ts` and `src/providers/third-party/common.ts` use `ai` + `@ai-sdk/*` (`generateText`/`streamText`/`generateImage`/`embed`/`generateSpeech`/`transcribe`); quirks applied once before SDK via `applyQuirk` in `common.ts`
- Registry: `src/providers/registry.ts` `getProviderRuntime(providerId, protocol)` — `firstParty 5` + `thirdPartyLoaders 17` static map + generic fallback for unknown catalog providers (only unknown, curated loader failures throw 500 with `providerError`)
- Shared helpers: `src/providers/shared/runtime.ts` (reasoning `REASONING_BUDGET_MIN/MAX`, `BUDGET_SUPPORTED_PROVIDERS`, `normalizeMessagesForSDK`), `normalization.ts` (`buildChatCompletionObject`), `document.ts` (`DOCUMENT_*` constants), `src/gateway/resolver.ts` (model/provider resolution, `parseReasoning` with budget validation, `needsVisionFallback` with `VISION_BLOCK_TYPES`)

## Catalog vs Live
- Mode A `POST /admin/catalog/sync` + daily cron `0 3 * * *` — `catalog/sync.ts` 184 providers → `catalog/repository.ts` upsert (preserves `providers.enabled` operator-owned, `models.exposed/enabled` preserved)
- Mode B `catalog/discovery.ts` + 6h cron `0 */6 * * *` — live `GET /v1/models` per credential + static fallbacks `third-party/fal|elevenlabs` → same `catalog/repository.ts`

## Structure
```
src/
  adapters/{router.ts, protocol-sse.ts, anthropic-messages/, openai-completions/, openai-responses/, google-generative-ai/}
  catalog/{sync.ts, repository.ts, discovery.ts, mapper.ts, defaults.ts, enabled-allowlist.ts}
  gateway/{resolver.ts}
  infra/{db.ts (rowToModelDef), encryption.ts}
  observability/{logger.ts (redacts x-admin-token), telemetry.ts}
  lib/{errors.ts (AppError, rateLimited, conflict), ratelimit.ts (RATE_LIMIT_WINDOW_MS, per-key cleanup, X-RateLimit headers)}
  middleware/{auth.ts (requireGatewayBearer, requireAdmin timingSafeEqual), gatewayAuth.ts (authorizeGateway), errorHandler.ts}
  providers/
    contract.ts, capabilities.ts, types.ts, quirks.ts, registry.ts
    shared/{runtime.ts, normalization.ts (buildChatCompletionObject), document.ts, sse.ts (buildChatCompletionResponse)}
    anthropic/{index.ts, sdk.ts, capabilities.ts, discovery.ts, types.ts}
    google/{index.ts, sdk.ts, capabilities.ts}
    openai/{index.ts, sdk.ts, capabilities.ts}
    third-party/{common.ts, factory.ts, alibaba|...|zai/index.ts (5 lines via factory), fal/{index.ts, catalog.ts}, elevenlabs/{index.ts, catalog.ts}}
  routes/{system/health.ts, v1/{chat.ts, models.ts, responses.ts, images.ts, audio.ts, embeddings.ts, videos.ts, documents.ts}, admin/{providers.ts, credentials.ts, keys.ts, models.ts}}
  index.ts  wrangler.toml (crons: 6h live + daily catalog, ENVIRONMENT=production default)
migrations/001_init.sql 002_providers_google_openai.sql 003_providers_all.sql 004_providers_fal_elevenlabs.sql 005_catalog.sql 006_providers_nvidia_perplexity_fireworks_fix.sql
tests/{auth.test.ts, ratelimit.test.ts, catalog.test.ts, vision.test.ts, reasoning.test.ts, registry.test.ts, ...} 91 tests
```

## Flow
Same as FOLLOWUP.md §5. Admin gating isolated from gateway proxy; `authorizeGateway` sets `X-RateLimit-*` + `Retry-After` and `last_used_at` per `RATE_LIMIT_WINDOW_MS`.
