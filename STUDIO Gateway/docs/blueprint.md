# Studio Gateway - Blueprint

One provider at a time. Anthropic first.

## Goals

- Unified URL `Gateway.example.com/v1` OpenAI-compatible (`/v1/chat/completions`, `/v1/models`)
- D1 stores providers, encrypted credentials, models, gateway keys. Worker decrypts in memory via `CREDENTIAL_ENCRYPTION_KEY` (Worker Secret, AES-GCM)
- Discovery (cron 6h) populates admin dashboard with every field possible; exposing is separate admin toggle (`exposed` flag). `GET /v1/models` only returns `exposed=1`
- Comprehensive tagging per model: category (text/image/embedding/audio/speech/transcription/video/rerank), input/output modalities, context_window, max_output_tokens, pricing in/out/cache, supports_tools, supports_parallel_tools, supports_vision, supports_reasoning, reasoning_type (none/dynamic/selected) + reasoning_levels (low/medium/high/xhigh/max/ultra etc), releaseDate, raw_json preserved

## Adapters

4 distinct protocols: `openai-completions`, `openai-responses`, `anthropic-messages`, `google-generative-ai`. Each in `src/providers/<id>/` with `adapter.ts` + `discovery.ts`. `src/providers/registry.ts` maps `protocol -> Adapter`. New provider = add folder + entry in `providerDefinitions`.

## Providers a-z final (regular global only, no cn variants)

alibaba (qwen), anthropic, cerebras, deepseek, fireworks, google, groq, huggingface, minimax, mistral (compat), moonshot (kimi), openai, openrouter, together, xai, zai, xiaomi, plus generic `custom` for 302.ai etc.

Enterprise excluded: bedrock, azure, vertex.

## Structure

```
src/
  lib/         errors, logger, db, encryption, ratelimit, telemetry  # centralized, imported everywhere
  providers/
    types.ts   ModelDefinition, ReasoningConfig, categories
    registry.ts
    anthropic/ adapter.ts, discovery.ts (static snapshot from docs + live GET /v1/models)
    openai/    stub
  routes/
    system/    health, ready
    v1/        chat, models
    admin/     providers, credentials, keys
  services/    discovery.ts (cron), model-filter
  middleware/  auth, errorHandler
migrations/  001_init.sql
```

System routes separate from v1/admin.

## Flow

Admin: `PUT /admin/providers/anthropic/credential {apiKey}` -> encrypt -> D1. `POST /admin/keys {name}` -> `sk-gw_...` hash stored, plain returned once. `PATCH /admin/providers/anthropic/models/claude-sonnet-4-5 {exposed:true}`.

Consumer: `POST /v1/chat/completions` Bearer `sk-gw_*` -> verify hash -> ratelimit -> find exposed model -> decrypt provider key -> adapter.chat -> stream.

Discovery: `POST /admin/discovery/run` or cron -> for each enabled provider with credential -> adapter.discover -> upsert models preserving `exposed`.

## Next

1. Test anthropic discovery with real key, seed D1, verify tags (tool, vision, reasoning dynamic/selected)
2. Implement OpenAI adapter second, then Google
3. Add fal/elevenlabs for image/audio categories when needed, each extends same ModelDefinition categories
