# Curated Studio Model Registry Research

Verified date: 2026-07-11

This document is the first research pass for replacing Gateway V2 provider discovery and seed catalogs with a handcrafted Studio-owned model registry.

The important rule is:

> Runtime Gateway should read Studio's curated registry only. Provider `/models` endpoints are reference inputs, not source of truth.

No implementation is included here.

## Verification Standard

Sources used:

- Official provider model docs, pricing docs, API docs, and provider model pages.
- OpenRouter's public model API for OpenRouter-specific routes.
- Existing requested names were checked against provider API IDs where possible.

Not yet completed:

- Live API call tests.
- Streaming probes.
- Tool-call probes.
- Tool-call-plus-reasoning probes.
- Structured-output probes.
- Vision/file/audio/video input probes.
- Usage-field and billing-field capture tests.

Until those tests pass, records should be marked `verifiedDocumentationOnly`, not `productionApproved`.

## Registry Direction

Studio should maintain one central registry, separated internally by modality:

- Text and chat
- Image generation
- Image editing
- Video generation
- Speech-to-text
- Text-to-speech
- Audio generation
- Embeddings
- Reranking
- Other specialized models

The same underlying model must be represented separately for each provider route. For example:

- `deepseek-v4-pro` through DeepSeek
- `deepseek/deepseek-v4-pro` through OpenRouter
- DeepSeek V4 Pro through Alibaba Model Studio, if verified as an Alibaba-hosted deployment

Those entries may share a model-family identifier, but pricing, context, features, and endpoint behavior must remain provider-specific.

## Recommended Registry Model

Use category-specific model records rather than one giant object with mostly irrelevant fields.

Shared fields:

- `studioId`
- `provider`
- `providerRoute`
- `canonicalApiModelId`
- `displayName`
- `developer`
- `family`
- `version`
- `status`
- `releaseDate`
- `deprecationDate`
- `regions`
- `sourceAuthority`
- `sourceUrls`
- `lastVerifiedAt`
- `verificationLevel`

Text/chat fields:

- `inputModalities`
- `outputModalities`
- `contextWindowTokens`
- `maxOutputTokens`
- `knowledgeCutoff`
- `endpoints`
- `streaming`
- `tools`
- `parallelTools`
- `structuredOutput`
- `jsonMode`
- `vision`
- `fileInput`
- `pdfInput`
- `audioInput`
- `videoInput`
- `promptCaching`
- `batch`
- `fineTuning`
- `reasoning`
- `pricing`
- `freeAccess`
- `routingAliases`
- `fallbackModelIds`

Media/audio fields should preserve native pricing units, such as image, megapixel, video second, audio hour, character, or hardware/runtime billing.

## Initial Curated Catalog Summary

| Provider | Initial route categories | Include now | Notes |
|---|---|---:|---|
| OpenAI | Text/chat, image, STT, TTS, embeddings | Partial | GPT-5.6/GPT-5.5 verified. Image/STT/TTS/embeddings need separate final selection. |
| Anthropic | Text/vision chat | Yes | Claude API only; no embeddings/audio/image/video. |
| Google Gemini API | Text/multimodal chat | Yes | Keep image/video/live/audio models outside initial Google route. |
| xAI | Text/vision chat | Yes | Direct image/voice not initial priority. |
| DeepSeek | Text chat | Yes | Direct V4 Pro/Flash verified. |
| Mistral | Text chat, embeddings | Needs follow-up | This pass did not deeply verify current Mistral shortlist. |
| Alibaba Model Studio | Text chat | Yes | Native Qwen verified; third-party Alibaba-hosted routes need more precise per-route verification. |
| MiniMax | Text/multimodal chat | Yes | MiniMax-M3 only. |
| Z.ai | Text chat | Yes | GLM-5.2 only. |
| Xiaomi MiMo | Text/multimodal chat | Yes | MiMo-V2.5 and Pro only. |
| Moonshot/Kimi | Text/multimodal chat | OpenRouter plus direct optional | Direct Kimi verified, but not required as direct provider in current Gateway list. |
| Groq | Text chat, STT | Yes | No Groq TTS required. |
| fal.ai | Image, image edit, video | Yes | Endpoint-native pricing required. |
| Replicate | Image, image edit, video | Yes | Version/hash and runtime billing need per-model finalization. |
| ElevenLabs | TTS, STT | Yes | Keep current production models only. |
| OpenRouter | Text/chat only | Yes | Do not include OpenRouter media/audio/embedding routes initially. |

## Direct Provider Findings

### OpenAI

Sources:

- https://developers.openai.com/api/docs/models/gpt-5.6-sol
- https://developers.openai.com/api/docs/models/gpt-5.6-terra
- https://developers.openai.com/api/docs/models/gpt-5.6-luna
- https://developers.openai.com/api/docs/models/gpt-5.5

Verified API IDs:

- `gpt-5.6`
- `gpt-5.6-sol`
- `gpt-5.6-terra`
- `gpt-5.6-luna`
- `gpt-5.5`
- `gpt-5.5-2026-04-23`

Important details:

- `gpt-5.6` is an alias to `gpt-5.6-sol`.
- Context: 1,050,000 tokens.
- Max output: 128,000 tokens.
- Input/output: text and image input, text output.
- Supports reasoning tokens, streaming, function calling, structured outputs, Batch API, Responses API, Chat Completions, and Realtime.
- GPT-5.6 long-context pricing applies above 272K input tokens.
- GPT-5.6 cache writes are 1.25x uncached input.

Pricing per 1M tokens:

| Model | Input | Cached input | Output |
|---|---:|---:|---:|
| `gpt-5.6-sol` | $5.00 | $0.50 | $30.00 |
| `gpt-5.6-terra` | $2.50 | $0.25 | $15.00 |
| `gpt-5.6-luna` | $1.00 | $0.10 | $6.00 |
| `gpt-5.5` | $5.00 | $0.50 | $30.00 |

Open items:

- Verify exact current OpenAI image model ID for "GPT Image 2".
- Decide whether OpenAI STT, TTS, and embeddings are in initial Gateway scope.

### Anthropic

Sources:

- https://platform.claude.com/docs/en/about-claude/models/overview
- https://platform.claude.com/docs/en/about-claude/pricing

Verified API IDs:

- `claude-fable-5`
- `claude-opus-4-8`
- `claude-sonnet-5`
- `claude-sonnet-4-6`
- `claude-haiku-4-5`
- `claude-haiku-4-5-20251001`

Important details:

- Treat Anthropic as text/vision chat only.
- Current Claude models support text and image input, text output, multilingual usage, vision, tool use, prompt caching, and batch.
- Fable 5, Opus 4.8, and Sonnet 5: 1M context, 128K synchronous max output.
- Haiku 4.5: 200K context, 64K max output.
- Batch beta can support larger output for some models.
- Fable/Opus/Sonnet use adaptive thinking.
- Haiku 4.5 has extended thinking.
- Prompt caching must model cache read and cache write/lifetime behavior separately.

Pricing per 1M tokens:

| Model | Input | Cache read | Output | Notes |
|---|---:|---:|---:|---|
| `claude-fable-5` | $10.00 | $1.00 | $50.00 | |
| `claude-opus-4-8` | $5.00 | $0.50 | $25.00 | |
| `claude-sonnet-5` | $2.00 | $0.20 | $10.00 | Through 2026-08-31 |
| `claude-sonnet-5` | $3.00 | $0.30 | $15.00 | Starting 2026-09-01 |
| `claude-sonnet-4-6` | $3.00 | $0.30 | $15.00 | |
| `claude-haiku-4-5` | $1.00 | $0.10 | $5.00 | |

Other billing:

- Batch API is 50% off input/output.
- US-only inference for Opus 4.6, Sonnet 4.6, and later is 1.1x.

### Google Gemini API

Sources:

- https://ai.google.dev/gemini-api/docs/gemini-3
- https://ai.google.dev/gemini-api/docs/pricing
- https://deepmind.google/models/model-cards/gemini-3-5-flash/

Verified API IDs:

- `gemini-3.5-flash`
- `gemini-3.5-live-translate-preview`
- `gemini-3.1-pro-preview`
- `gemini-3.1-pro-preview-customtools`
- `gemini-3.1-flash-lite`
- `gemini-3-flash-preview`
- `gemini-3.1-flash-image-preview`
- `gemini-3-pro-image-preview`

Initial Studio direct-Google chat shortlist:

- `gemini-3.5-flash`
- `gemini-3.1-pro-preview`
- `gemini-3.1-flash-lite`
- `gemini-3-flash-preview`, if still useful as preview route

Important details:

- Gemini text models generally support 1M input and 64K output.
- Gemini 3.5 Flash model card confirms text, image, audio, and video input with text output.
- Gemini 3 models support multimodal input, dynamic thinking, grounding, context caching, batch/flex/priority tiers.
- Google image-output models should stay out of the initial direct-Google text/chat category.

Pricing per 1M tokens:

| Model | Input | Cached input | Output | Notes |
|---|---:|---:|---:|---|
| `gemini-3.5-flash` | $1.50 | $0.15 | $9.00 | Batch/flex $0.75/$4.50 |
| `gemini-3.1-pro-preview` <=200K | $2.00 | $0.20 | $12.00 | |
| `gemini-3.1-pro-preview` >200K | $4.00 | $0.40 | $18.00 | |
| `gemini-3.1-flash-lite` text/image/video | $0.25 | $0.025 | $1.50 | Audio input $0.50, cache $0.05 |
| `gemini-3-flash-preview` text/image/video | $0.50 | $0.05 | $3.00 | Audio input $1.00, cache $0.10 |

Grounding:

- Gemini 3 Search/Maps grounding: 5,000 prompts/month free, then $14 per 1,000 search queries.

Unverified exact requested names:

- `gemini-3.5` as a bare model ID.
- `gemini-3.5-pro`.

### xAI

Sources:

- https://x.ai/api
- https://docs.x.ai/developers/models
- https://docs.x.ai/developers/pricing

Verified API IDs:

- `grok-4.5`
- `grok-4.3`
- `grok-4.20-multi-agent-0309`
- `grok-4.20-0309-reasoning`
- `grok-4.20-0309-non-reasoning`
- `grok-build-0.1` for Code API

Important details:

- `grok-4.5` supports non-reasoning and reasoning modes, configurable reasoning, agentic tool calling, structured outputs, streaming, function calling, web/X search, code execution, collections/RAG, Remote MCP tools, prompt caching, context compaction, and priority processing.
- `grok-4.2` was not found as an exact current API ID. Use `grok-4.20-*` only if selected intentionally.

Pricing per 1M tokens:

| Model | Context | Input | Cached input | Output |
|---|---:|---:|---:|---:|
| `grok-4.5` | 500K | $2.00 | $0.50 | $6.00 |
| `grok-4.3` | 1M | $1.25 | $0.20 | $2.50 |
| `grok-4.20-*` | 1M | $1.25 | $0.20 | $2.50 |

Other billing:

- Batch discount: 20% for `grok-4.3` and listed `grok-4.20-*`.
- Priority processing: 2x standard rates.
- Web search, X search, and code execution: $5 per 1K calls.
- File attachments: $10 per 1K.
- Collections/file search: $2.50 per 1K.

### DeepSeek

Sources:

- https://api-docs.deepseek.com/quick_start/pricing/

Verified API IDs:

- `deepseek-v4-pro`
- `deepseek-v4-flash`

Important details:

- OpenAI-compatible and Anthropic-compatible endpoints.
- Thinking and non-thinking modes.
- 1M context.
- 384K max output.
- JSON output.
- Tool calls.
- Prefix completion and FIM in non-thinking mode.

Pricing per 1M tokens:

| Model | Cache hit input | Cache miss input | Output |
|---|---:|---:|---:|
| `deepseek-v4-flash` | $0.0028 | $0.14 | $0.28 |
| `deepseek-v4-pro` | $0.003625 | $0.435 | $0.87 |

### Alibaba Cloud Model Studio

Sources:

- https://www.alibabacloud.com/help/en/model-studio/model-pricing
- https://www.alibabacloud.com/help/en/model-studio/models

Verified native Qwen API IDs:

- `qwen3.7-max`
- `qwen3.7-plus`
- `qwen3.6-flash`
- `qwen3.6-plus`
- `qwen3.6-max-preview`

Important details:

- Use exact lowercase Alibaba model slugs.
- Model Studio supports text-generation API routes.
- Thinking/non-thinking behavior varies by model.
- Context cache discounts and batch discounts exist on some models.
- Pricing is regional and context-tiered.

Selected pricing examples:

| Model | Region/tier | Input | Output |
|---|---|---:|---:|
| `qwen3.7-max` | Global/US list | $1.65 | $4.951 |
| `qwen3.7-plus` | Singapore, up to 256K | $0.40 | $1.60 |
| `qwen3.6-flash` | Singapore, up to 256K | $0.25 | $1.50 |
| `qwen3.6-flash` | Singapore, 256K-1M | $1.00 | $4.00 |

Open items:

- Verify Alibaba-hosted third-party deployments for DeepSeek V4 Pro/Flash, GLM-5.2, Kimi-K2.7-Code, and Xiaomi MiMo-V2.5-Pro separately. Do not copy direct-provider behavior into Alibaba deployment records.

### MiniMax

Sources:

- https://platform.minimax.io/docs/guides/pricing-paygo
- https://platform.minimax.io/docs/guides/text-generation

Verified API ID:

- `MiniMax-M3`

Important details:

- OpenAI-compatible and Anthropic-compatible APIs.
- Text, image, and video input.
- 1M context.
- Agentic reasoning.
- Tool use.
- Coding.
- Interleaved thinking.

Pricing per 1M tokens:

| Tier | Context | Input | Prompt-cache read | Output |
|---|---|---:|---:|---:|
| Standard | <=512K | $0.30 | $0.06 | $1.20 |
| Standard | >512K | $0.60 | $0.12 | $2.40 |
| Priority | Any | 1.5x | 1.5x | 1.5x |

### Z.ai

Sources:

- https://docs.z.ai/guides/overview/pricing
- https://docs.z.ai/guides/llm/glm-5.2
- https://docs.z.ai/api-reference/llm/chat-completion

Verified API ID:

- `glm-5.2`

Important details:

- Text model for coding and long-horizon agent tasks.
- 1M context.
- 128K max output.
- Streaming.
- Tool use.
- Reasoning controls.

Pricing per 1M tokens:

| Model | Input | Cached input | Output |
|---|---:|---:|---:|
| `glm-5.2` | $1.40 | $0.26 | $4.40 |

### Xiaomi MiMo

Sources:

- https://mimo.mi.com/docs/price/pay-as-you-go
- https://mimo.mi.com/docs/en-US/quick-start/summary/model
- https://mimo.mi.com/docs/en-US/quick-start/summary/first-api-call

Verified API IDs:

- `mimo-v2.5`
- `mimo-v2.5-pro`

Important details:

- OpenAI-compatible and Anthropic-compatible APIs.
- `mimo-v2.5-pro`: text, thinking, streaming, function calling, structured output, web search, 1M context, 128K max output.
- `mimo-v2.5`: full-modal understanding plus same core API features.

Pricing per 1M tokens:

| Model | Cache hit input | Cache miss input | Output |
|---|---:|---:|---:|
| `mimo-v2.5` | $0.0028 | $0.14 | $0.28 |
| `mimo-v2.5-pro` | $0.0036 | $0.435 | $0.87 |

### Moonshot/Kimi

Sources:

- https://platform.kimi.ai/docs/pricing/chat-k27-code
- https://platform.kimi.ai/docs/pricing/chat-k26
- https://platform.kimi.ai/docs/models

Verified API IDs:

- `kimi-k2.7-code`
- `kimi-k2.7-code-highspeed`
- `kimi-k2.6`

Important details:

- OpenAI-compatible API.
- 256K context.
- Multimodal input.
- Tool calls.
- JSON mode.
- Partial mode.
- Automatic context caching.
- K2.7 Code requires thinking mode.

Pricing per 1M tokens:

| Model | Cache hit input | Cache miss input | Output |
|---|---:|---:|---:|
| `kimi-k2.7-code` | $0.19 | $0.95 | $4.00 |
| `kimi-k2.7-code-highspeed` | $0.38 | $1.90 | $8.00 |
| `kimi-k2.6` | $0.16 | $0.95 | $4.00 |

## Media, Audio, and Groq Findings

### Groq

Sources:

- https://console.groq.com/docs/models

Verified text model IDs:

- `openai/gpt-oss-120b`
- `openai/gpt-oss-20b`
- `qwen/qwen3-32b`
- `qwen/qwen3.6-27b`

Verified STT IDs:

- `whisper-large-v3`
- `whisper-large-v3-turbo`

Text pricing and limits:

| Model | Status | Context | Max completion | Speed | Input | Output |
|---|---|---:|---:|---:|---:|---:|
| `openai/gpt-oss-120b` | Production | 131,072 | 65,536 | ~500 t/s | $0.15/M | $0.60/M |
| `openai/gpt-oss-20b` | Production | 131,072 | 65,536 | ~1000 t/s | $0.075/M | $0.30/M |
| `qwen/qwen3-32b` | Preview | 131,072 | 40,960 | ~400 t/s | $0.29/M | $0.59/M |
| `qwen/qwen3.6-27b` | Preview | 131,072 | 32,768 | ~500 t/s | $0.60/M | $3.00/M |

STT pricing and limits:

| Model | Price | Max file |
|---|---:|---:|
| `whisper-large-v3` | $0.111/hour | 100MB |
| `whisper-large-v3-turbo` | $0.04/hour | Needs live verification |

Rejected exact-name variants:

- `gpt-oss-120b`
- `gpt-oss-20b`
- `qwen3-32b`
- `qwen3.6-27b`
- `whisper-v3`
- `whisper-large-v3-large`

Use the exact Groq API IDs above.

### fal.ai

Sources:

- https://fal.ai/docs/platform-apis/v1/models/pricing
- https://fal.ai/models/bytedance/seedream/v5/lite/text-to-image
- https://fal.ai/models/bytedance/seedream/v5/lite/edit
- https://fal.ai/models/bytedance/seedream/v5/pro/edit
- https://fal.ai/models/fal-ai/flux-pro/kontext
- https://fal.ai/models/fal-ai/flux-pro/v1/fill
- https://fal.ai/models/fal-ai/veo3.1
- https://fal.ai/models/fal-ai/veo3.1/lite
- https://fal.ai/models/bytedance/seedance-2.0/image-to-video
- https://fal.ai/models/fal-ai/wan/v2.7/image-to-video

Billing model:

- Endpoint-specific pay-per-use.
- Most model APIs are output-based.
- Authenticated pricing API exists at `https://api.fal.ai/v1/models/pricing?endpoint_id=...`.

Initial image/edit candidates:

| Endpoint | Category | Pricing | Notes |
|---|---|---:|---|
| `fal-ai/bytedance/seedream/v5/lite/text-to-image` | Image generation | $0.035/image | Up to about 9MP, batch-capable |
| `fal-ai/bytedance/seedream/v5/lite/edit` | Image edit | $0.035/image | Multi-image edit, up to 10 references |
| `bytedance/seedream/v5/pro/edit` | Image edit premium | $0.0675+ | Region-precise editing; input-image adders |
| `fal-ai/flux-pro/kontext` | Image edit | $0.04/image | Natural-language edit |
| `fal-ai/flux-pro/v1/fill` | Inpaint/outpaint | $0.05/MP | Rounded up |

Initial video candidates:

| Endpoint | Category | Pricing | Notes |
|---|---|---:|---|
| `fal-ai/veo3.1` | Video | $0.20-$0.60/s | Resolution/audio dependent |
| `fal-ai/veo3.1/image-to-video` | Video | $0.20-$0.60/s | Resolution/audio dependent |
| `fal-ai/veo3.1/fast` | Video | $0.10-$0.35/s | Fast variant |
| `fal-ai/veo3.1/lite` | Video | $0.03-$0.08/s | Budget variant |
| `bytedance/seedance-2.0/image-to-video` | Video | $0.3034-$0.682/s | Native audio, references |
| `fal-ai/wan/v2.7/image-to-video` | Video budget | $0.10-$0.15/s | Input video duration may also bill |

### Replicate

Sources:

- https://replicate.com/pricing
- https://replicate.com/docs/topics/models/official-models
- https://replicate.com/bytedance/seedream-4.5/readme
- https://replicate.com/bytedance/seedream-4
- https://replicate.com/black-forest-labs/flux-2-flex
- https://replicate.com/black-forest-labs/flux-kontext-pro
- https://replicate.com/google/veo-3.1-lite
- https://replicate.com/bytedance/seedance-2.0-fast
- https://replicate.com/bytedance/seedance-2.0
- https://replicate.com/kwaivgi/kling-v3-video

Billing model:

- Public models often bill by hardware/runtime.
- Official/proprietary models may bill by image, video second, token, or other native units.
- Registry must store model owner, version hash, input schema, output schema, cold-start behavior, hardware, pricing, prediction status, webhook support, and streaming support.

Initial candidates:

| Model | Category | Pricing | Notes |
|---|---|---:|---|
| `bytedance/seedream-4.5` | Image gen/edit | $0.04/output image | Upgraded image model |
| `bytedance/seedream-4` | Image gen/edit | $0.03/output image | Unified T2I/edit, up to 4K |
| `black-forest-labs/flux-2-flex` | Image gen/edit | $0.06/input-image MP | Reference/edit support |
| `black-forest-labs/flux-kontext-pro` | Image edit | Needs per-page finalization | Production edit route |
| `black-forest-labs/flux-kontext-max` | Image edit | Needs per-page finalization | Production edit route |
| `google/veo-3.1-lite` | Video | $0.05/s 720p, $0.08/s 1080p | Text/image-to-video with audio |
| `bytedance/seedance-2.0-fast` | Video | $0.08/s | Multimodal video with native audio |
| `bytedance/seedance-2.0` | Video | Per-second; exact row not captured | Needs exact price verification |
| `kwaivgi/kling-v3-video` | Video | Per-second; exact row not captured | Needs exact price verification |

### ElevenLabs

Sources:

- https://elevenlabs.io/docs/overview/models
- https://elevenlabs.io/pricing/api

Billing model:

- API usage is billed in USD, not consumer credits.

Initial TTS candidates:

| Model | Category | Pricing | Notes |
|---|---|---:|---|
| `eleven_v3` | TTS quality | $0.10/1K chars | Expressive, 70+ languages, 5K chars/request |
| `eleven_multilingual_v2` | TTS long-form | $0.10/1K chars | 29 languages, 10K chars/request |
| `eleven_flash_v2_5` | TTS low-latency | $0.05/1K chars | ~75ms, 32 languages, 40K chars/request |
| `eleven_flash_v2` | TTS English low-latency | $0.05/1K chars | English, 30K chars/request |

Initial STT candidates:

| Model | Category | Pricing | Notes |
|---|---|---:|---|
| `scribe_v2` | STT batch | $0.22/hour | 90+ languages, diarization, word timestamps, audio tagging |
| `scribe_v2_realtime` | STT realtime | $0.39/hour | 90+ languages, WebSocket, about 150ms |

Rejected/deprioritized:

- `scribe_v1`: outclassed by `scribe_v2`.
- `eleven_turbo_v2_5` and `eleven_turbo_v2`: ElevenLabs recommends Flash replacements.

## OpenRouter Findings

Sources:

- https://openrouter.ai/api/v1/models
- https://openrouter.ai/docs/guides/overview/models
- https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties
- https://openrouter.ai/models

OpenRouter registry rule:

- Include text/chat routes only.
- Do not copy direct-provider pricing into OpenRouter records.
- Preserve OpenRouter slugs, pricing, provider routing behavior, quantization, free route status, and OpenRouter metadata.

Verified OpenRouter slugs:

| Family | Slugs | Context | Modality | Pricing |
|---|---|---:|---|---|
| GPT-5.6 | `openai/gpt-5.6-sol`, `openai/gpt-5.6-sol-pro`, `openai/gpt-5.6-terra`, `openai/gpt-5.6-terra-pro`, `openai/gpt-5.6-luna`, `openai/gpt-5.6-luna-pro` | 1,050,000 | text+image+file -> text | Luna $1/$6M, Terra $2.50/$15M, Sol $5/$30M |
| GPT-5.5 | `openai/gpt-5.5`, `openai/gpt-5.5-pro` | 1,050,000 | text+image+file -> text | $5/$30M, Pro $30/$180M |
| GPT-5.4 | `openai/gpt-5.4`, `openai/gpt-5.4-pro`, `openai/gpt-5.4-mini`, `openai/gpt-5.4-nano` | 400K-1.05M | text+image+file -> text | Nano $0.20/$1.25M, Mini $0.75/$4.50M, Base $2.50/$15M, Pro $30/$180M |
| Qwen3.7 | `qwen/qwen3.7-plus`, `qwen/qwen3.7-max` | 1,000,000 | Plus text+image -> text; Max text -> text | Plus $0.32/$1.28M, Max $1.25/$3.75M |
| Qwen3.6 | `qwen/qwen3.6-flash`, `qwen/qwen3.6-35b-a3b`, `qwen/qwen3.6-max-preview`, `qwen/qwen3.6-27b`, `qwen/qwen3.6-plus` | 262K-1M | Mostly multimodal -> text | $0.14-$1.04M input, $1-$6.24M output |
| Claude | `anthropic/claude-haiku-4.5`, `anthropic/claude-sonnet-4.6`, `anthropic/claude-sonnet-5`, `anthropic/claude-opus-4.8`, `anthropic/claude-opus-4.8-fast`, `anthropic/claude-fable-5` | 200K-1M | text+image+file -> text | Haiku $1/$5M, Sonnet 4.6 $3/$15M, Sonnet 5 $2/$10M, Opus 4.8 $5/$25M, Opus Fast/Fable $10/$50M |
| DeepSeek V4 | `deepseek/deepseek-v4-pro`, `deepseek/deepseek-v4-flash` | 1,048,576 | text -> text | Pro $0.435/$0.87M, Flash $0.084/$0.168M |
| Gemini | `google/gemini-3.5-flash`, `google/gemini-3.1-flash-lite`, `google/gemini-3.1-pro-preview`, `google/gemini-3-flash-preview` | about 1M | multimodal -> text | 3.5 Flash $1.50/$9M, 3.1 Lite $0.25/$1.50M, 3.1 Pro $2/$12M, 3 Flash Preview $0.50/$3M |
| MiniMax | `minimax/minimax-m3` | 1,048,576 | text+image+video -> text | $0.30/$1.20M |
| Moonshot/Kimi | `moonshotai/kimi-k2.6`, `moonshotai/kimi-k2.7-code` | 262,144 | text+image -> text | K2.6 $0.66/$3.41M, K2.7 Code $0.72/$3.49M |
| Poolside | `poolside/laguna-xs-2.1`, `poolside/laguna-xs-2.1:free`, `poolside/laguna-m.1`, `poolside/laguna-m.1:free` | 262,144 | text -> text | XS $0.06/$0.12M, M.1 $0.20/$0.40M, free variants $0 |
| xAI | `x-ai/grok-4.5`, `x-ai/grok-4.3` | 500K/1M | text+image+file -> text | 4.5 $2/$6M, 4.3 $1.25/$2.50M |
| xAI near-match | `x-ai/grok-4.20`, `x-ai/grok-4.20-multi-agent` | 2M | text+image+file -> text | $1.25/$2.50M |
| Xiaomi | `xiaomi/mimo-v2.5`, `xiaomi/mimo-v2.5-pro` | 1,048,576 | Base multimodal -> text; Pro text -> text | Base $0.105/$0.28M, Pro $0.435/$0.87M |
| Z.ai | `z-ai/glm-5.2` | 1,048,576 | text -> text | $0.42/$1.32M |

OpenRouter entries to exclude from text/chat registry:

- `openai/gpt-5.4-image-2`
- `google/gemini-3-pro-image`
- `google/gemini-3-pro-image-preview`
- `google/gemini-3.1-flash-image`
- `google/gemini-3.1-flash-image-preview`
- `google/gemini-3.1-flash-lite-image`

OpenRouter unverified/name mismatches:

- Exact `x-ai/grok-4.2` was not found; OpenRouter lists `x-ai/grok-4.20` and `x-ai/grok-4.20-multi-agent`.
- Generic `deepseek/deepseek-v4` was not found; only Pro and Flash.
- Generic `qwen/qwen3.7` was not found; only Plus and Max.
- Gemini `3.0`, `3.2`, `3.3`, and `3.4` text/chat models were not found.
- GPT-5.6 variants beyond Luna/Terra/Sol and Pro variants were not found.

## Reasoning Registry Notes

Reasoning must be represented with more structure than a boolean:

- `supported`
- `alwaysOn`
- `canDisable`
- `effortValues`
- `returnsReasoningContent`
- `reasoningTokensVisible`
- `reasoningTokensBillable`
- `worksWithTools`
- `worksWhileStreaming`
- `requiresReasoningStateAfterTools`
- `reducesOutputBudget`
- `providerSpecificControls`

Documentation suggests reasoning support for:

- OpenAI GPT-5.5/GPT-5.6
- Anthropic Claude Fable/Opus/Sonnet/Haiku, with adaptive or extended thinking differences
- Google Gemini 3/3.5 family, with dynamic thinking
- xAI Grok 4.5/4.3/4.20 variants
- DeepSeek V4 Pro/Flash
- MiniMax-M3
- Z.ai GLM-5.2
- Xiaomi MiMo-V2.5/Pro
- Kimi K2.7 Code
- OpenRouter routes where `reasoning`/`reasoning_effort` are listed in supported parameters

Live testing is still required before enabling `reasoning + tools` production routing.

## Free Model Notes

Known verified free-route examples:

- `poolside/laguna-xs-2.1:free`
- `poolside/laguna-m.1:free`

Registry fields should distinguish:

- `isFree`
- `freeType`
- `freeQuota`
- `freeQuotaUnit`
- `freeUntil`
- `freeRateLimits`
- `requiresPaymentMethod`
- `isPromotional`

Do not infer free status from zero price alone.

## Rejected Or Deferred Models

| Model/name | Reason |
|---|---|
| Older OpenAI chat models | User asked to focus direct OpenAI on GPT-5.5 and GPT-5.6. |
| OpenRouter media/audio/embedding models | Initial OpenRouter scope is text/chat only. |
| Mistral through OpenRouter | Direct Mistral integration is preferred initially. |
| Google direct image/video/live-audio models | Outside initial Google integration. |
| xAI direct image/voice APIs | Not initial priority. |
| Alibaba image/video/audio/embedding/rerank models | Outside initial Alibaba scope. |
| MiniMax speech/image/music/video products | Outside initial MiniMax direct scope. |
| fal.ai 3D models | Explicitly excluded from initial implementation. |
| ElevenLabs legacy `scribe_v1` | Deprioritized in favor of `scribe_v2`. |
| ElevenLabs Turbo TTS models | Deprioritized in favor of Flash replacements. |
| Replicate/fal catalog mirrors | We should curate strong models, not mirror entire catalogs. |

## Required Live Validation Before Production

Before a model is marked `productionApproved`, run tests for:

1. Model ID is callable.
2. Model is not deprecated.
3. Context and output limits match docs.
4. Streaming works.
5. Tool calling works.
6. Tool calling with reasoning works when advertised.
7. Multiple/parallel tool calls work when advertised.
8. Structured output works.
9. Vision/file/audio/video input works when advertised.
10. Usage fields are captured.
11. Reasoning tokens are reported and billed as documented.
12. Prompt cache fields are reported.
13. Pricing source is current.
14. Provider-specific errors are normalized.
15. Verification date is recorded.

When docs and live API behavior disagree, preserve both findings and prioritize tested API behavior for runtime implementation.

## Next Doc To Create

Recommended next artifact:

`01-REGISTRY-SCHEMA-DESIGN.md`

It should define:

- Category-specific TypeScript interfaces.
- Validation rules.
- Import/export JSON format.
- Status lifecycle.
- Source/verification model.
- Runtime lookup shape.
- Admin edit workflow.
- Diff format for optional provider discovery helpers.
