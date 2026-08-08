import type { ProviderId } from "@/domain/contracts";
import type { RegistryPricing } from "./schema";
import { CHECKED_AT, SOURCES } from "./metadata";

export function verifiedPricingFor(modelId: string): RegistryPricing | undefined {
  const overrides: Record<string, RegistryPricing> = {
    "openai:gpt-5.6-sol": tokenPricing("openai", {
      input: 5,
      output: 30,
      cachedInput: 0.5,
      cacheWrite: 6.25,
      notes: "Verified from OpenAI API pricing and GPT-5.6 model docs. Cache write is 1.25x input; cache read is 90% discounted."
    }),
    "openai:gpt-5.6-terra": tokenPricing("openai", {
      input: 2.5,
      output: 15,
      cachedInput: 0.25,
      cacheWrite: 3.125,
      notes: "Verified from OpenAI API pricing and GPT-5.6 model docs. Cache write is 1.25x input; cache read is 90% discounted."
    }),
    "openai:gpt-5.6-luna": tokenPricing("openai", {
      input: 1,
      output: 6,
      cachedInput: 0.1,
      cacheWrite: 1.25,
      notes: "Verified from OpenAI API pricing and GPT-5.6 model docs. Cache write is 1.25x input; cache read is 90% discounted."
    }),
    "openai:gpt-5.5": tokenPricing("openai", {
      input: 5,
      output: 22.5,
      cachedInput: 0.5,
      notes: "Verified from OpenAI API pricing for the long-context GPT-5.5 tier used by this registry record."
    }),
    "openai:gpt-image-2": {
      kind: "image",
      status: "verified",
      currency: "USD",
      billingUnit: "one_million_tokens",
      price: null,
      tiers: [
        { name: "text_input", unit: "one_million_tokens", price: 5, currency: "USD" },
        { name: "text_cached_input", unit: "one_million_tokens", price: 1.25, currency: "USD" },
        { name: "image_input", unit: "one_million_tokens", price: 8, currency: "USD" },
        { name: "image_cached_input", unit: "one_million_tokens", price: 2, currency: "USD" },
        { name: "image_output", unit: "one_million_tokens", price: 30, currency: "USD" }
      ],
      dependsOn: ["resolution", "quality"],
      sourceUrls: SOURCES.openai,
      verifiedAt: CHECKED_AT,
      notes: "Verified from OpenAI API image generation pricing. Cost is token-metered by text/image input and image output, not a flat per-image price."
    },
    "openai:text-embedding-3-small": embeddingPricing("openai", 0.02, "Verified from OpenAI embedding model pricing."),
    "openai:text-embedding-3-large": embeddingPricing("openai", 0.13, "Verified from OpenAI embedding model pricing."),
    "google:gemini-3.5-flash": tokenPricing("google", {
      input: 1.5,
      output: 9,
      cachedInput: 0.15,
      notes: "Verified from Gemini Developer API pricing. Output includes thinking tokens."
    }),
    "google:gemini-3.1-pro-preview": tokenPricing("google", {
    input: 2,
    output: 12,
    cachedInput: 0.2,
    longContext: [
      { name: "over_200k_tokens_input", unit: "one_million_tokens", price: 4, currency: "USD", appliesWhen: "input tokens > 200k" },
      { name: "over_200k_tokens_output", unit: "one_million_tokens", price: 18, currency: "USD", appliesWhen: "input tokens > 200k" }
    ],
    notes: "Verified from Gemini 3 developer guide. Listed base tier is under 200k tokens; long-context tiers are preserved separately."
  }),
    "google:gemini-3.1-flash-lite": tokenPricing("google", {
    input: 0.25,
    output: 1.5,
    cachedInput: 0.025,
    notes: "Verified from Gemini 3 developer guide. Audio input has a separate price not flattened into token text pricing."
  }),
    "google:gemini-2.5-flash": tokenPricing("google", {
    input: 0.45,
    output: 2.7,
    cachedInput: 0.045,
    notes: "Verified from Gemini Developer API pricing. Audio input has a separate price not flattened into token text pricing."
  }),
    "google:gemini-2.5-flash-lite": tokenPricing("google", {
    input: 0.1,
    output: 0.4,
    cachedInput: 0.01,
    notes: "Verified from Gemini Developer API pricing. Audio input has a separate price not flattened into token text pricing."
  }),
    "anthropic:claude-sonnet-4-6": tokenPricing("anthropic", {
    input: 3,
    output: 15,
    cachedInput: 0.3,
    cacheWrite: 3.75,
    notes: "Verified from Anthropic Claude pricing."
  }),
    "anthropic:claude-haiku-4-5": tokenPricing("anthropic", {
    input: 1,
    output: 5,
    cachedInput: 0.1,
    cacheWrite: 1.25,
    notes: "Verified from Anthropic Claude pricing."
  }),
    "anthropic:claude-sonnet-5": tokenPricing("anthropic", {
    input: 2,
    output: 10,
    cachedInput: 0.2,
    cacheWrite: 2.5,
    longContext: [
      { name: "standard_after_2026_08_31_input", unit: "one_million_tokens", price: 3, currency: "USD", appliesWhen: "starting 2026-09-01" },
      { name: "standard_after_2026_08_31_cache_write_5m", unit: "one_million_tokens", price: 3.75, currency: "USD", appliesWhen: "starting 2026-09-01" },
      { name: "standard_after_2026_08_31_cache_read", unit: "one_million_tokens", price: 0.3, currency: "USD", appliesWhen: "starting 2026-09-01" },
      { name: "standard_after_2026_08_31_output", unit: "one_million_tokens", price: 15, currency: "USD", appliesWhen: "starting 2026-09-01" }
    ],
    notes: "Verified from Anthropic pricing. Current introductory pricing applies through 2026-08-31; standard pricing is preserved as dated tiers."
  }),
    "anthropic:claude-opus-4-8": tokenPricing("anthropic", {
    input: 5,
    output: 25,
    cachedInput: 0.5,
    cacheWrite: 6.25,
    notes: "Verified from Anthropic Claude pricing."
  }),
    "anthropic:claude-fable-5": tokenPricing("anthropic", {
    input: 10,
    output: 50,
    cachedInput: 1,
    cacheWrite: 12.5,
    notes: "Verified from Anthropic Claude pricing."
  }),
    "xai:grok-4.5": tokenPricing("xai", {
    input: 2,
    output: 6,
    cachedInput: 0.5,
    notes: "Verified from xAI Grok 4.5 API model docs."
  }),
    "deepseek:deepseek-v4-pro": tokenPricing("deepseek", {
    input: 0.435,
    output: 0.87,
    cachedInput: 0.003625,
    notes: "Verified from DeepSeek Models & Pricing. inputPerMillion is cache-miss input; cachedInputPerMillion is cache-hit input."
  }),
    "deepseek:deepseek-v4-flash": tokenPricing("deepseek", {
    input: 0.14,
    output: 0.28,
    cachedInput: 0.0028,
    notes: "Verified from DeepSeek Models & Pricing. inputPerMillion is cache-miss input; cachedInputPerMillion is cache-hit input."
  }),
    "groq:openai/gpt-oss-20b": tokenPricing("groq", {
    input: 0.075,
    output: 0.3,
    notes: "Verified from Groq supported models pricing."
  }),
    "groq:openai/gpt-oss-120b": tokenPricing("groq", {
    input: 0.15,
    output: 0.6,
    notes: "Verified from Groq supported models pricing."
  }),
    "groq:qwen/qwen3-32b": tokenPricing("groq", {
    input: 0.29,
    output: 0.59,
    notes: "Verified from Groq supported models pricing."
  }),
    "groq:qwen/qwen3.6-27b": tokenPricing("groq", {
    input: 0.6,
    output: 3,
    notes: "Verified from Groq supported models pricing."
  }),
    "groq:whisper-large-v3": audioPricing("groq", 0.111, "audio_hour", "Verified from Groq supported models pricing."),
    "groq:whisper-large-v3-turbo": audioPricing("groq", 0.04, "audio_hour", "Verified from Groq supported models pricing."),
    "openrouter:openai/gpt-5.6-sol": tokenPricing("openrouter", {
    input: 5,
    output: 30,
    cachedInput: 0.5,
    cacheWrite: 6.25,
    notes: "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
  }),
    ...openRouterVerifiedPricing()
  };
  return overrides[modelId];
}

function openRouterVerifiedPricing(): Record<string, RegistryPricing> {
  const specs: Array<[string, number, number, number | null, number | null]> = [
    ["openai/gpt-5.6-sol-pro", 5, 30, 0.5, 6.25],
    ["openai/gpt-5.6-terra", 2.5, 15, 0.25, 3.125],
    ["openai/gpt-5.6-terra-pro", 2.5, 15, 0.25, 3.125],
    ["openai/gpt-5.6-luna", 1, 6, 0.1, 1.25],
    ["openai/gpt-5.6-luna-pro", 1, 6, 0.1, 1.25],
    ["openai/gpt-5.5", 5, 30, 0.5, null],
    ["openai/gpt-5.5-pro", 30, 180, null, null],
    ["openai/gpt-5.4", 2.5, 15, 0.25, null],
    ["openai/gpt-5.4-pro", 30, 180, null, null],
    ["openai/gpt-5.4-mini", 0.75, 4.5, 0.075, null],
    ["openai/gpt-5.4-nano", 0.2, 1.25, 0.02, null],
    ["qwen/qwen3.7-plus", 0.32, 1.28, 0.064, 0.4],
    ["qwen/qwen3.7-max", 1.25, 3.75, 0.25, 1.5625],
    ["qwen/qwen3.6-flash", 0.1875, 1.125, null, 0.234375],
    ["anthropic/claude-haiku-4.5", 1, 5, 0.1, 1.25],
    ["anthropic/claude-sonnet-4.6", 3, 15, 0.3, 3.75],
    ["anthropic/claude-sonnet-5", 2, 10, 0.2, 2.5],
    ["anthropic/claude-opus-4.8", 5, 25, 0.5, 6.25],
    ["anthropic/claude-opus-4.8-fast", 10, 50, 1, 12.5],
    ["anthropic/claude-fable-5", 10, 50, 1, 12.5],
    ["deepseek/deepseek-v4-pro", 0.435, 0.87, 0.003625, null],
    ["deepseek/deepseek-v4-flash", 0.077, 0.154, 0.0154, null],
    ["google/gemini-3.5-flash", 1.5, 9, 0.15, 0.08333333333333334],
    ["google/gemini-3.1-pro-preview", 2, 12, 0.2, 0.375],
    ["google/gemini-3.1-flash-lite", 0.25, 1.5, 0.025, 0.08333333333333334],
    ["minimax/minimax-m3", 0.3, 1.2, 0.06, null],
    ["moonshotai/kimi-k2.6", 0.66, 3.41, 0.15, null],
    ["moonshotai/kimi-k2.7-code", 0.72, 3.5, 0.15, null],
    ["poolside/laguna-xs-2.1", 0.06, 0.12, 0.03, null],
    ["poolside/laguna-xs-2.1:free", 0, 0, null, null],
    ["poolside/laguna-m.1", 0.2, 0.4, 0.1, null],
    ["poolside/laguna-m.1:free", 0, 0, null, null],
    ["openai/gpt-oss-20b:free", 0, 0, null, null],
    ["openai/gpt-oss-120b:free", 0, 0, null, null],
    ["cohere/north-mini-code:free", 0, 0, null, null],
    ["nvidia/nemotron-3-super-120b-a12b:free", 0, 0, null, null],
    ["tencent/hy3:free", 0, 0, null, null],
    ["nvidia/nemotron-3-ultra-550b-a55b:free", 0, 0, null, null],
    ["google/gemma-4-31b-it:free", 0, 0, null, null],
    ["x-ai/grok-4.5", 2, 6, 0.5, null],
    ["x-ai/grok-4.3", 1.25, 2.5, 0.2, null],
    ["xiaomi/mimo-v2.5", 0.105, 0.28, 0.028, null],
    ["xiaomi/mimo-v2.5-pro", 0.435, 0.87, 0.0036, null],
    ["z-ai/glm-5.2", 0.35, 1.1, 0.065, null]
  ];

  return Object.fromEntries(
    specs.map(([nativeId, input, output, cachedInput, cacheWrite]) => [
      `openrouter:${nativeId}`,
      tokenPricing("openrouter", {
        input,
        output,
        cachedInput,
        cacheWrite,
        notes: "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      })
    ])
  );
}

function tokenPricing(
  provider: ProviderId,
  options: {
    input: number;
    output: number;
    cachedInput?: number | null;
    cacheWrite?: number | null;
    longContext?: RegistryPricing["longContext"];
    notes: string;
  }
): RegistryPricing {
  return {
    kind: "token",
    status: "verified",
    currency: "USD",
    billingUnit: "one_million_tokens",
    inputPerMillion: options.input,
    cachedInputPerMillion: options.cachedInput ?? null,
    cacheWritePerMillion: options.cacheWrite ?? null,
    outputPerMillion: options.output,
    batchInputPerMillion: null,
    batchOutputPerMillion: null,
    longContext: options.longContext,
    reasoningTokens: "unknown",
    sourceUrls: SOURCES[provider],
    verifiedAt: CHECKED_AT,
    notes: options.notes
  };
}

function embeddingPricing(provider: ProviderId, input: number, notes: string): RegistryPricing {
  return {
    kind: "embedding",
    status: "verified",
    currency: "USD",
    billingUnit: "one_million_tokens",
    inputPerMillion: input,
    outputPerMillion: null,
    sourceUrls: SOURCES[provider],
    verifiedAt: CHECKED_AT,
    notes
  };
}

function audioPricing(provider: ProviderId, price: number, billingUnit: RegistryPricing["billingUnit"], notes: string): RegistryPricing {
  return {
    kind: "audio",
    status: "verified",
    currency: "USD",
    billingUnit,
    price,
    sourceUrls: SOURCES[provider],
    verifiedAt: CHECKED_AT,
    notes
  };
}
