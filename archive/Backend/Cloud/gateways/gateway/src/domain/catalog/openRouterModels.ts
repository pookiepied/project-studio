import type { ModelInfo, ReasoningFeatures } from "@/domain/models/capabilities";
import type { RegistryModel } from "./schema";
import { chat } from "./builders";

export function openRouterChatModels(): RegistryModel[] {
  const specs: Array<{
    nativeId: string;
    displayName: string;
    developer: string;
    family: string;
    contextWindow: number;
    maxTokens?: number;
    vision: boolean;
    reasoning: ReasoningFeatures["efforts"];
    jsonSchema?: boolean;
    inputTypes?: NonNullable<ModelInfo["inputTypes"]>;
  }> = [
    { nativeId: "openai/gpt-5.6-sol", displayName: "OpenAI GPT-5.6 Sol", developer: "OpenAI", family: "gpt-5.6", contextWindow: 1_050_000, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "openai/gpt-5.6-sol-pro", displayName: "OpenAI GPT-5.6 Sol Pro", developer: "OpenAI", family: "gpt-5.6", contextWindow: 1_050_000, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "openai/gpt-5.6-terra", displayName: "OpenAI GPT-5.6 Terra", developer: "OpenAI", family: "gpt-5.6", contextWindow: 1_050_000, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "openai/gpt-5.6-terra-pro", displayName: "OpenAI GPT-5.6 Terra Pro", developer: "OpenAI", family: "gpt-5.6", contextWindow: 1_050_000, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "openai/gpt-5.6-luna", displayName: "OpenAI GPT-5.6 Luna", developer: "OpenAI", family: "gpt-5.6", contextWindow: 1_050_000, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "openai/gpt-5.6-luna-pro", displayName: "OpenAI GPT-5.6 Luna Pro", developer: "OpenAI", family: "gpt-5.6", contextWindow: 1_050_000, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "openai/gpt-5.5", displayName: "OpenAI GPT-5.5", developer: "OpenAI", family: "gpt-5.5", contextWindow: 1_050_000, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "openai/gpt-5.5-pro", displayName: "OpenAI GPT-5.5 Pro", developer: "OpenAI", family: "gpt-5.5", contextWindow: 1_050_000, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "openai/gpt-5.4", displayName: "OpenAI GPT-5.4", developer: "OpenAI", family: "gpt-5.4", contextWindow: 1_050_000, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "openai/gpt-5.4-pro", displayName: "OpenAI GPT-5.4 Pro", developer: "OpenAI", family: "gpt-5.4", contextWindow: 1_050_000, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "openai/gpt-5.4-mini", displayName: "OpenAI GPT-5.4 Mini", developer: "OpenAI", family: "gpt-5.4", contextWindow: 400_000, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "openai/gpt-5.4-nano", displayName: "OpenAI GPT-5.4 Nano", developer: "OpenAI", family: "gpt-5.4", contextWindow: 400_000, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "qwen/qwen3.7-plus", displayName: "Qwen3.7 Plus", developer: "Alibaba Qwen", family: "qwen3.7", contextWindow: 1_000_000, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "qwen/qwen3.7-max", displayName: "Qwen3.7 Max", developer: "Alibaba Qwen", family: "qwen3.7", contextWindow: 1_000_000, vision: false, reasoning: ["low", "medium", "high"] },
    { nativeId: "qwen/qwen3.6-flash", displayName: "Qwen3.6 Flash", developer: "Alibaba Qwen", family: "qwen3.6", contextWindow: 1_000_000, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "anthropic/claude-haiku-4.5", displayName: "Claude Haiku 4.5", developer: "Anthropic", family: "claude-haiku", contextWindow: 200_000, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "anthropic/claude-sonnet-4.6", displayName: "Claude Sonnet 4.6", developer: "Anthropic", family: "claude-sonnet", contextWindow: 1_000_000, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "anthropic/claude-sonnet-5", displayName: "Claude Sonnet 5", developer: "Anthropic", family: "claude-sonnet", contextWindow: 1_000_000, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "anthropic/claude-opus-4.8", displayName: "Claude Opus 4.8", developer: "Anthropic", family: "claude-opus", contextWindow: 1_000_000, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "anthropic/claude-opus-4.8-fast", displayName: "Claude Opus 4.8 Fast", developer: "Anthropic", family: "claude-opus", contextWindow: 1_000_000, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "anthropic/claude-fable-5", displayName: "Claude Fable 5", developer: "Anthropic", family: "claude-fable", contextWindow: 1_000_000, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "deepseek/deepseek-v4-pro", displayName: "DeepSeek V4 Pro", developer: "DeepSeek", family: "deepseek-v4", contextWindow: 1_048_576, vision: false, reasoning: ["low", "medium", "high"] },
    { nativeId: "deepseek/deepseek-v4-flash", displayName: "DeepSeek V4 Flash", developer: "DeepSeek", family: "deepseek-v4", contextWindow: 1_048_576, vision: false, reasoning: ["low", "medium", "high"] },
    { nativeId: "google/gemini-3.5-flash", displayName: "Gemini 3.5 Flash", developer: "Google", family: "gemini-3.5", contextWindow: 1_048_576, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "google/gemini-3.1-pro-preview", displayName: "Gemini 3.1 Pro Preview", developer: "Google", family: "gemini-3.1", contextWindow: 1_048_576, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "google/gemini-3.1-flash-lite", displayName: "Gemini 3.1 Flash Lite", developer: "Google", family: "gemini-3.1", contextWindow: 1_048_576, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "minimax/minimax-m3", displayName: "MiniMax M3", developer: "MiniMax", family: "minimax-m3", contextWindow: 1_048_576, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "moonshotai/kimi-k2.6", displayName: "Kimi K2.6", developer: "Moonshot AI", family: "kimi-k2", contextWindow: 262_144, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "moonshotai/kimi-k2.7-code", displayName: "Kimi K2.7 Code", developer: "Moonshot AI", family: "kimi-k2", contextWindow: 262_144, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "poolside/laguna-xs-2.1", displayName: "Laguna XS 2.1", developer: "Poolside", family: "laguna", contextWindow: 262_144, maxTokens: 32_768, vision: false, reasoning: ["low", "medium", "high"], jsonSchema: false },
    { nativeId: "poolside/laguna-xs-2.1:free", displayName: "Laguna XS 2.1 Free", developer: "Poolside", family: "laguna", contextWindow: 262_144, maxTokens: 32_768, vision: false, reasoning: ["low", "medium", "high"], jsonSchema: false },
    { nativeId: "poolside/laguna-m.1", displayName: "Laguna M.1", developer: "Poolside", family: "laguna", contextWindow: 262_144, maxTokens: 32_768, vision: false, reasoning: ["low", "medium", "high"], jsonSchema: false },
    { nativeId: "poolside/laguna-m.1:free", displayName: "Laguna M.1 Free", developer: "Poolside", family: "laguna", contextWindow: 262_144, maxTokens: 32_768, vision: false, reasoning: ["low", "medium", "high"], jsonSchema: false },
    { nativeId: "x-ai/grok-4.5", displayName: "Grok 4.5", developer: "xAI", family: "grok-4", contextWindow: 500_000, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "x-ai/grok-4.3", displayName: "Grok 4.3", developer: "xAI", family: "grok-4", contextWindow: 1_000_000, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "xiaomi/mimo-v2.5", displayName: "MiMo V2.5", developer: "Xiaomi", family: "mimo-v2.5", contextWindow: 1_048_576, vision: true, reasoning: ["low", "medium", "high"] },
    { nativeId: "xiaomi/mimo-v2.5-pro", displayName: "MiMo V2.5 Pro", developer: "Xiaomi", family: "mimo-v2.5", contextWindow: 1_048_576, vision: false, reasoning: ["low", "medium", "high"] },
    { nativeId: "z-ai/glm-5.2", displayName: "GLM 5.2", developer: "Z.ai", family: "glm-5", contextWindow: 1_048_576, vision: false, reasoning: ["low", "medium", "high"] },
    { nativeId: "openai/gpt-oss-20b:free", displayName: "GPT-OSS 20B Free", developer: "OpenAI", family: "gpt-oss", contextWindow: 131_072, maxTokens: 32_768, vision: false, reasoning: ["low", "medium", "high"] },
    { nativeId: "openai/gpt-oss-120b:free", displayName: "GPT-OSS 120B Free", developer: "OpenAI", family: "gpt-oss", contextWindow: 131_072, maxTokens: 131_072, vision: false, reasoning: ["low", "medium", "high"], jsonSchema: false },
    { nativeId: "cohere/north-mini-code:free", displayName: "North Mini Code Free", developer: "Cohere", family: "north", contextWindow: 256_000, maxTokens: 64_000, vision: false, reasoning: ["low", "medium", "high"], jsonSchema: false },
    { nativeId: "nvidia/nemotron-3-super-120b-a12b:free", displayName: "Nemotron 3 Super Free", developer: "NVIDIA", family: "nemotron-3", contextWindow: 262_144, maxTokens: 262_144, vision: false, reasoning: ["low", "medium", "high"] },
    { nativeId: "tencent/hy3:free", displayName: "Hy3 Free", developer: "Tencent", family: "hy3", contextWindow: 262_144, maxTokens: 262_144, vision: false, reasoning: ["low", "medium", "high"] },
    { nativeId: "nvidia/nemotron-3-ultra-550b-a55b:free", displayName: "Nemotron 3 Ultra Free", developer: "NVIDIA", family: "nemotron-3", contextWindow: 1_000_000, maxTokens: 65_536, vision: false, reasoning: ["low", "medium", "high"], jsonSchema: false },
    { nativeId: "google/gemma-4-31b-it:free", displayName: "Gemma 4 31B IT Free", developer: "Google", family: "gemma-4", contextWindow: 262_144, maxTokens: 8_192, vision: true, reasoning: ["low", "medium", "high"], inputTypes: ["text", "image", "video"] }
  ];

  return specs.map((spec) =>
    chat("openrouter", spec.nativeId, spec.displayName, spec.developer, spec.family, {
      contextWindow: spec.contextWindow,
      maxTokens: spec.maxTokens ?? 128_000,
      vision: spec.vision,
      jsonSchema: spec.jsonSchema,
      inputTypes: spec.inputTypes,
      reasoning: spec.reasoning,
      reasoningSource: "static-reviewed"
    })
  );
}
