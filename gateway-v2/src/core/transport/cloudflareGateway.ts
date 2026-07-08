import type { GatewayEnv } from "../../system/infrastructure/cloudflare/env";

export interface TransportConfig {
  baseURL: string;
  headers: Record<string, string>;
  fetch: typeof fetch;
}

const PROVIDER_SLUGS: Record<string, string> = {
  openai: "openai",
  google: "google-ai-studio",
  anthropic: "anthropic",
  groq: "groq",
  // xAI is listed as "xAI" on the providers index but CF's native slug IS "grok"
  // (the per-provider doc lives at .../providers/grok/). Confirmed:
  // https://developers.cloudflare.com/ai-gateway/usage/providers/grok/
  xai: "grok",
  // DeepSeek's native slug is "deepseek". Confirmed:
  // https://developers.cloudflare.com/ai-gateway/usage/providers/deepseek/
  deepseek: "deepseek",
  // Mistral / Fal / Replicate / ElevenLabs native slugs are all the plain provider name.
  // Confirmed: https://developers.cloudflare.com/ai-gateway/usage/providers/{mistral,fal,replicate,elevenlabs}/
  mistral: "mistral",
  fal: "fal",
  replicate: "replicate",
  elevenlabs: "elevenlabs",
  // OpenRouter's native slug is "openrouter". CF proxies `.../openrouter/<path>` →
  // `https://openrouter.ai/api/v1/<path>` (the `/api/v1` is baked into the slug), so a bare
  // `.../openrouter` baseURL resolves to `/chat/completions`, `/models` and `/credits`
  // correctly — no base-path entry needed. OpenRouter authenticates with a Bearer
  // `Authorization` header (OpenAI family), already stripped by stripProviderAuthorization.
  // Confirmed: https://developers.cloudflare.com/ai-gateway/usage/providers/openrouter/
  openrouter: "openrouter",
  // Alibaba Model Studio (Qwen) has NO CF-native slug — it is reached through a CF CUSTOM
  // provider, whose slug carries the mandatory `custom-` prefix. Create the custom provider in
  // the CF dashboard named "alibaba" with base_url
  // `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` (international / Singapore). CF
  // then proxies `.../custom-alibaba/<path>` → `<base_url>/<path>`, so the bare baseURL
  // resolves to `/chat/completions`. DashScope authenticates with Bearer `Authorization`
  // (stripped below). NOTE: custom-provider auth (stored key vs inline) is being verified live.
  // Confirmed mechanism: https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/
  alibaba: "custom-alibaba",
  // MiniMax has NO CF-native slug — reached through a CF CUSTOM provider named "minimax" with
  // base_url `https://api.minimax.io/v1` (global endpoint). CF proxies
  // `.../custom-minimax/<path>` → `<base_url>/<path>`, so the bare baseURL resolves to
  // `/chat/completions`. MiniMax authenticates with a Bearer `Authorization` header (OpenAI
  // family), already stripped by stripProviderAuthorization below.
  // Confirmed: https://platform.minimax.io/docs/api-reference/text-openai-api
  minimax: "custom-minimax",
  // Z.AI (GLM) has NO CF-native slug — reached through a CF CUSTOM provider named "zai" with
  // base_url `https://api.z.ai/api/paas/v4` (general endpoint, not the coding-plan-only
  // `/api/coding/paas/v4`). CF proxies `.../custom-zai/<path>` → `<base_url>/<path>`, so the
  // bare baseURL resolves to `/chat/completions`. Z.AI authenticates with a Bearer
  // `Authorization` header, already stripped by stripProviderAuthorization below.
  // Confirmed: https://docs.z.ai/guides/overview/quick-start
  zai: "custom-zai",
  // Xiaomi MiMo has NO CF-native slug — reached through a CF CUSTOM provider named "xiaomi"
  // with base_url `https://api.xiaomimimo.com/v1`. CF proxies `.../custom-xiaomi/<path>` →
  // `<base_url>/<path>`, so the bare baseURL resolves to `/chat/completions`. MiMo accepts
  // either `api-key` or Bearer `Authorization`; we use `Authorization` (OpenAI family),
  // already stripped by stripProviderAuthorization below.
  // Confirmed: https://mimo.mi.com/docs/en-US/api/chat/openai-api
  xiaomi: "custom-xiaomi"
};

const PROVIDER_API_BASE_PATHS: Record<string, string> = {
  google: "/v1beta",
  // Cloudflare's native Anthropic endpoint proxies the real Anthropic API 1:1, so the
  // full path is `/anthropic/v1/messages`. The @ai-sdk/anthropic client appends `/messages`
  // to its baseURL, so the baseURL must carry the `/v1` segment.
  // Confirmed: https://developers.cloudflare.com/ai-gateway/usage/providers/anthropic/
  anthropic: "/v1",
  // Mistral's CF slug proxies `.../mistral/<path>` → `https://api.mistral.ai/<path>` (the `/v1`
  // is NOT baked into the slug). The @ai-sdk/mistral client default baseURL is
  // `https://api.mistral.ai/v1` and appends `/chat/completions` / `/embeddings`, so the baseURL
  // must carry the `/v1` segment. Mistral authenticates with a Bearer `Authorization` header,
  // already stripped by stripProviderAuthorization below.
  // Confirmed: https://developers.cloudflare.com/ai-gateway/usage/providers/mistral/
  mistral: "/v1"
  // NOTE: Fal, Replicate and ElevenLabs need NO base-path entry.
  //   • Fal:        `.../fal/<path>`        → `https://fal.run/<path>`;         client appends `/<modelId>`.
  //   • Replicate:  `.../replicate/<path>`  → `https://api.replicate.com/v1/<path>`; client appends `/models/.../predictions`.
  //   • ElevenLabs: `.../elevenlabs/<path>` → `https://api.elevenlabs.io/<path>`; client appends `/v1/...`.
  // Fal/Replicate authenticate with `Authorization`; ElevenLabs with `xi-api-key` — both stripped below.
  // NOTE: Groq needs NO base-path entry. Groq's native API base is `/openai/v1`, but
  // Cloudflare's `groq` slug already proxies `.../grok/<path>` → `https://api.groq.com/openai/v1/<path>`.
  // The @ai-sdk/groq client appends `/chat/completions` (and `/audio/transcriptions`), so a bare
  // `.../groq` baseURL resolves to the correct Groq path. Groq authenticates with a Bearer
  // `Authorization` header, which is already stripped by stripProviderAuthorization below.
  // Confirmed: https://developers.cloudflare.com/ai-gateway/usage/providers/groq/

  // NOTE: xAI needs NO base-path entry either. xAI's native API base is
  // `https://api.x.ai/v1`, and Cloudflare's `grok` slug replaces that verbatim — so
  // `.../grok/<path>` → `https://api.x.ai/v1/<path>`. The @ai-sdk/xai client default
  // baseURL is `https://api.x.ai/v1`, and the SDK appends `/chat/completions` (and
  // `/models`), so a bare `.../grok` baseURL resolves to the correct xAI path.
  // xAI authenticates with a Bearer `Authorization` header (same family as OpenAI/Groq),
  // which is already stripped by stripProviderAuthorization below.
  // Confirmed: https://developers.cloudflare.com/ai-gateway/usage/providers/grok/

  // NOTE: DeepSeek needs NO base-path entry. DeepSeek's native API base (OpenAI format)
  // is `https://api.deepseek.com` (no `/v1`), and Cloudflare's `deepseek` slug replaces
  // that verbatim — so `.../deepseek/<path>` → `https://api.deepseek.com/<path>`. The
  // @ai-sdk/deepseek client default baseURL is `https://api.deepseek.com`, and the SDK
  // appends `/chat/completions` (and `/models`), so a bare `.../deepseek` baseURL
  // resolves to the correct DeepSeek path. DeepSeek authenticates with a Bearer
  // `Authorization` header (same family as OpenAI/Groq/xAI), already stripped by
  // stripProviderAuthorization below.
  // Confirmed: https://developers.cloudflare.com/ai-gateway/usage/providers/deepseek/
};

export function cloudflareGatewayTransport(provider: string, env: GatewayEnv): TransportConfig {
  if (!env.CF_ACCOUNT_ID) {
    throw new Error("CF_ACCOUNT_ID is required for Cloudflare AI Gateway transport.");
  }
  if (!env.CF_AIG_TOKEN) {
    throw new Error("CF_AIG_TOKEN is required for Cloudflare AI Gateway transport.");
  }

  const gatewayName = env.CF_AIG_GATEWAY_NAME || "studio-gateway";
  const alias = env.CF_AIG_BYOK_ALIAS || "production";
  const providerSlug = PROVIDER_SLUGS[provider] ?? provider;
  const apiBasePath = PROVIDER_API_BASE_PATHS[provider] ?? "";

  return {
    baseURL: `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${gatewayName}/${providerSlug}${apiBasePath}`,
    headers: {
      "cf-aig-authorization": `Bearer ${env.CF_AIG_TOKEN}`,
      "cf-aig-byok-alias": alias
    },
    fetch
  };
}

export function stripProviderAuthorization(headers: Headers): Headers {
  const sanitized = new Headers(headers);
  sanitized.delete("authorization");
  sanitized.delete("Authorization");
  sanitized.delete("x-goog-api-key");
  sanitized.delete("X-Goog-Api-Key");
  // Anthropic authenticates with `x-api-key`. Under CF AI Gateway BYOK the real key is
  // injected by Cloudflare, so the provider's own key header must never leave the worker.
  sanitized.delete("x-api-key");
  sanitized.delete("X-Api-Key");
  // ElevenLabs authenticates with `xi-api-key`. Under CF AI Gateway BYOK the real key is
  // injected by Cloudflare, so the provider's own key header must never leave the worker.
  sanitized.delete("xi-api-key");
  sanitized.delete("Xi-Api-Key");
  return sanitized;
}

export function withCloudflareGatewayFetch(innerFetch: typeof fetch = fetch): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const sanitizedHeaders = stripProviderAuthorization(headers);

    const nextInit: RequestInit = {
      ...init,
      headers: sanitizedHeaders
    };

    return innerFetch(input, nextInit);
  }) as typeof fetch;
}
