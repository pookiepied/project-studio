# Studio Gateway

Studio Gateway is Project Studio's cloud model boundary. It presents one stable HTTP contract
while routing provider traffic through Cloudflare AI Gateway.

The Vercel AI SDK is used only as a TypeScript protocol and streaming adapter. This project does
not depend on Vercel AI Gateway, Vercel hosting, Vercel Workflows, OpenAI's agent SDK, or an
Anthropic SDK. Provider keys, routing, analytics, and network transport remain in Cloudflare AI
Gateway.

This service does not implement end-user bring-your-own-key support. The operator configures
provider keys centrally in Cloudflare AI Gateway. Cloudflare calls that stored-key feature BYOK,
but every request handled by this Worker uses the fixed account, gateway, and alias from its
deployment environment.

## Scope

The gateway owns:

- model lookup and model-level capability validation;
- provider selection and Cloudflare AI Gateway routing;
- normalized chat, embeddings, speech, transcription, image, and video APIs;
- normalized text, reasoning, tool-call, usage, completion, and error stream events;
- request IDs, centralized HTTP errors, liveness, readiness, and configuration health.

The gateway does not run the agent loop, execute tools, host MCP servers, persist conversations,
manage credits, or mutate its model catalog at runtime. Those responsibilities belong to the
Project Studio harness and application services.

## Architecture

```text
src/
  app/
    middleware/            Cross-route HTTP middleware
    createGatewayApp.ts    Hono composition root
    errorHandlers.ts       Global not-found and error boundaries
    types.ts               Application binding types
  domain/
    catalog/               Curated model data, pricing, schema, and integrity checks
    contracts/             Transport-independent request and response contracts
    models/                Capabilities and model policies
  features/
    audio/                 Speech and transcription endpoints
    chat/                  Chat endpoint and request parsing
    embeddings/            Embeddings endpoint and request parsing
    health/                Liveness, readiness, and provider status
    images/                Image endpoints, parsing, and response mapping
    models/                Read-only model catalog endpoint
    videos/                Video endpoints, parsing, and response mapping
  platform/
    aiSdk/                 Shared Vercel AI SDK request, response, and stream mapping
    cloudflare/            Worker environment and Cloudflare AI Gateway transport
    encoding/              Runtime encoding helpers
    errors/                Error taxonomy, normalization, and HTTP responses
    http/                  Protocol helpers such as SSE framing
  providers/
    <provider>/            Provider-specific clients, capabilities, and handlers
    registry.ts            Static provider composition
    types.ts               Provider adapter contracts
  index.ts                 Minimal Worker entry point
```

Dependencies point inward:

- `app` composes features and middleware;
- `features` coordinate domain rules, provider handlers, and platform adapters;
- `providers` implement domain-facing operations with the shared AI SDK mapping;
- `platform` owns external runtime and protocol details;
- `domain` contains no route or provider implementation.

Cross-layer imports use the `@/` alias. Relative imports are reserved for files within the same
module. Empty compatibility folders are intentionally not retained.

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Cheap liveness check |
| `GET` | `/health/ready` | Environment and transport readiness |
| `GET` | `/health/providers` | Adapter, catalog, and routing status without paid probes |
| `GET` | `/v1/models` | Curated model catalog and capability metadata |
| `POST` | `/v1/chat/completions` | Chat, vision, reasoning, structured output, and tool calls |
| `POST` | `/v1/embeddings` | Text embeddings |
| `POST` | `/v1/audio/transcriptions` | Speech-to-text |
| `POST` | `/v1/audio/speech` | Text-to-speech |
| `POST` | `/v1/images/generations` | Image generation |
| `POST` | `/v1/images/edits` | Image editing |
| `POST` | `/v1/videos/generations` | Text-to-video and image-to-video |

The aliases `/v1/images/generate` and `/v1/videos/generate` remain available for existing clients.

## Trust Boundary And Authentication

Studio Gateway is a **private** Cloudflare Worker. It has no `workers.dev` subdomain and no custom
route (`workers_dev` and `preview_urls` are disabled in `wrangler.toml`); it is invoked only
through a Cloudflare **service binding** from the public Project Studio API.

The **public API owns end-user authentication**. This worker performs no inbound end-user auth of
its own and must not trust arbitrary public identity headers. Propagating trusted user identity
from the API into the gateway is deferred until the API proxy contract is implemented.

The chat `user` field is an opaque provider abuse-tracking identifier that the gateway forwards
as-is; it is not a trust decision made by the gateway.

The gateway does hold the operator's Cloudflare AI Gateway credential (`CF_AIG_TOKEN`) and strips
provider authorization headers before forwarding, so callers can neither submit a provider key nor
choose a key alias. No response, log, or error message contains that credential, a provider key, or
a raw upstream error body.

## Providers

There are 15 provider adapters and 109 curated models. Every provider operation uses the Vercel
AI SDK core. Ten providers use a provider-specific `@ai-sdk` package; five OpenAI-compatible
providers use `@ai-sdk/openai-compatible`.

| Provider | SDK adapter | Cloudflare route | Models | Exposed operations |
| --- | --- | --- | ---: | --- |
| OpenAI | `@ai-sdk/openai` | `openai` | 10 | Chat, embeddings, STT, TTS, image generate/edit |
| Google | `@ai-sdk/google` | `google-ai-studio` | 5 | Chat; embedding and image handlers have no catalog models |
| Anthropic | `@ai-sdk/anthropic` | `anthropic` | 5 | Chat |
| Groq | `@ai-sdk/groq` | `groq` | 6 | Chat, STT |
| xAI | `@ai-sdk/xai` | `grok` | 2 | Chat |
| DeepSeek | `@ai-sdk/deepseek` | `deepseek` | 2 | Chat |
| Mistral | `@ai-sdk/mistral` | `mistral` | 1 | Chat |
| Fal | `@ai-sdk/fal` | `fal` | 10 | Image generate/edit, video |
| Replicate | `@ai-sdk/replicate` | `replicate` | 9 | Image generate/edit, video |
| ElevenLabs | `@ai-sdk/elevenlabs` | `elevenlabs` | 6 | STT, TTS |
| OpenRouter | `@ai-sdk/openai-compatible` | `openrouter` | 45 | Chat |
| Alibaba | `@ai-sdk/openai-compatible` | `custom-alibaba` | 4 | Chat |
| MiniMax | `@ai-sdk/openai-compatible` | `custom-minimax` | 1 | Chat |
| Z.AI | `@ai-sdk/openai-compatible` | `custom-zai` | 1 | Chat |
| Xiaomi | `@ai-sdk/openai-compatible` | `custom-xiaomi` | 2 | Chat |

Chat features are model-level rather than provider-wide. The fractions below mean
`models with feature / chat models`.

| Provider | Streaming | Vision | Tools | Reasoning | JSON schema | Prompt caching |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| OpenAI | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 |
| Google | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 0/5 |
| Anthropic | 5/5 | 5/5 | 5/5 | 5/5 | 0/5 | 5/5 |
| Groq | 4/4 | 1/4 | 4/4 | 4/4 | 2/4 | 0/4 |
| xAI | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| DeepSeek | 2/2 | 0/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| Mistral | 1/1 | 1/1 | 1/1 | 0/1 | 1/1 | 0/1 |
| OpenRouter | 45/45 | 30/45 | 45/45 | 45/45 | 38/45 | 0/45 |
| Alibaba | 4/4 | 3/4 | 4/4 | 0/4 | 4/4 | 0/4 |
| MiniMax | 1/1 | 1/1 | 1/1 | 0/1 | 1/1 | 0/1 |
| Z.AI | 1/1 | 0/1 | 1/1 | 1/1 | 1/1 | 0/1 |
| Xiaomi | 2/2 | 1/2 | 2/2 | 0/2 | 2/2 | 0/2 |

No provider currently exposes reranking or audio/music generation. Media generation is
non-streaming. `/health/providers` distinguishes implemented `adapterCapabilities` from
catalog-backed `capabilities`.

## Model Catalog

`GET /v1/models` is the canonical model list. Catalog code is separated by concern:

- `models.ts` composes the curated model records;
- `openRouterModels.ts` contains the larger OpenRouter chat list;
- `builders.ts` builds normalized registry records;
- `presets.ts` contains reusable family capability presets;
- `pricing.ts` contains category-level pricing policy;
- `reviewedPricing.ts` contains reviewed model-specific pricing records;
- `metadata.ts` stores source URLs and catalog version metadata;
- `schema.ts` defines the detailed registry contract;
- `integrity.ts` rejects duplicate IDs and invalid records at startup;
- `resolveModel.ts` performs route-facing model lookup and capability checks.

The catalog is static by design. Updating it is a reviewed code change, not an unauthenticated
runtime administration operation.

## Tools And Streaming

The gateway accepts OpenAI-compatible tool definitions and returns normalized tool calls. It does
not execute a tool. The Flue/Pi harness owns the agent loop, MCP dispatch, tool execution,
retries, and continuation after tool results.

To continue a conversation after tool results, a chat request replays the previous assistant turn
with `toolCalls` (id, name, JSON-encoded arguments, in original order) and follows it with `tool`
messages carrying `toolCallId` and `toolName`. Both fields are optional, so a single-turn client is
unaffected.

Streaming responses use server-sent events:

| Event | Meaning |
| --- | --- |
| `stream.started` | The provider/model stream was accepted |
| `content` | Compatibility text delta |
| `model.message.delta` | Studio text delta |
| `reasoning` | Compatibility reasoning delta |
| `model.reasoning.delta` | Studio reasoning delta |
| `tool_call` | Compatibility immediate tool call |
| `model.tool_call.completed` | Completed normalized tool call |
| `usage` and `model.usage` | Token, cache, and reasoning usage |
| `model.completed` | Provider finish result, including `finishReason` |
| `tool_calls` | Compatibility aggregate tool-call list |
| `stream.error` | Normalized terminal stream failure |
| `stream.completed` | Gateway stream closed |

Each stream ends with `data: [DONE]`.

## Errors

Every route uses the same error boundary and response shape:

```json
{
  "error": {
    "code": "MODEL_NOT_FOUND",
    "message": "Model example is not registered with the gateway.",
    "request_id": "..."
  }
}
```

`x-request-id` contains the same identifier. Known failures are categorized as validation,
capability, model, route, configuration, rate-limit, timeout, unavailable, or internal errors.
Raw provider error bodies are not exposed to clients.

## Configuration

`wrangler.toml` contains the deployment defaults:

- `ENVIRONMENT`
- `CF_ACCOUNT_ID`
- `CF_AIG_GATEWAY_NAME`
- `CF_AIG_BYOK_ALIAS`

`CF_AIG_TOKEN` is a Worker secret and is never committed:

```bash
npx wrangler secret put CF_AIG_TOKEN
```

For local development, create a non-committed `.dev.vars` file:

```dotenv
CF_AIG_TOKEN=your-cloudflare-ai-gateway-token
```

Provider credentials remain centrally managed in Cloudflare AI Gateway. The Worker strips
provider authorization headers before forwarding so placeholder SDK credentials cannot bypass
the gateway. Callers cannot submit a provider key or choose a key alias. Custom providers must use
the slugs defined in
`src/platform/cloudflare/aiGateway/providerRoutes.ts`.

## Development

```bash
npm install
npm run build
npm test
npm run dev
```

Tests use mocked provider SDKs. No real network call, Cloudflare account, or provider credential is
involved.

To add a model, update `src/domain/catalog` and add focused catalog or route coverage. To add a
provider, create `src/providers/<provider>`, declare its capabilities, register it in
`src/providers/registry.ts`, map its Cloudflare route, add catalog records, and test both routing
and unsupported-capability behavior.

Cloudflare AI Gateway supplies the initial provider telemetry. OpenTelemetry export remains a
future harness-wide concern so traces can share one context across the UI, agent runtime, tools,
MCP, and this gateway.
