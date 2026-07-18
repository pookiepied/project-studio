import { Capability, type ChatFeatures, type ModelInfo, type ModelPricing, type ReasoningFeatures } from "../core/capabilities";
import type { ProviderId } from "../core/types";
import type {
  RegistryCategory,
  RegistryModel,
  RegistryPricing,
  RegistryReasoning,
  RegistryStatus,
  VerificationLevel
} from "./schema";

const CHECKED_AT = "2026-07-11";
const VERSION = "2026-07-11.curated.1";

export const MANUAL_REGISTRY_VERSION = VERSION;
export const MANUAL_REGISTRY_GENERATED_AT = `${CHECKED_AT}T00:00:00.000Z`;

const SOURCES: Record<ProviderId, string[]> = {
  openai: ["https://developers.openai.com/api/docs/models", "https://platform.openai.com/docs/pricing"],
  google: ["https://ai.google.dev/gemini-api/docs/gemini-3", "https://ai.google.dev/gemini-api/docs/pricing"],
  anthropic: [
    "https://platform.claude.com/docs/en/about-claude/models/overview",
    "https://platform.claude.com/docs/en/about-claude/pricing"
  ],
  groq: ["https://console.groq.com/docs/models"],
  xai: ["https://docs.x.ai/developers/models", "https://docs.x.ai/developers/pricing"],
  deepseek: ["https://api-docs.deepseek.com/quick_start/pricing/"],
  mistral: ["https://docs.mistral.ai/getting-started/models/models_overview/"],
  fal: ["https://fal.ai/docs/platform-apis/v1/models/pricing", "https://fal.ai/models"],
  replicate: ["https://replicate.com/pricing", "https://replicate.com/docs/topics/models/official-models"],
  elevenlabs: ["https://elevenlabs.io/docs/overview/models", "https://elevenlabs.io/pricing/api"],
  openrouter: [
    "https://openrouter.ai/api/v1/models",
    "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
  ],
  alibaba: [
    "https://www.alibabacloud.com/help/en/model-studio/models",
    "https://www.alibabacloud.com/help/en/model-studio/model-pricing"
  ],
  minimax: ["https://platform.minimax.io/docs/guides/text-generation", "https://platform.minimax.io/docs/guides/pricing-paygo"],
  zai: ["https://docs.z.ai/guides/llm/glm-5.2", "https://docs.z.ai/guides/overview/pricing"],
  xiaomi: ["https://mimo.mi.com/docs/en-US/quick-start/summary/model", "https://mimo.mi.com/docs/price/pay-as-you-go"]
};

export const MANUAL_MODEL_REGISTRY: RegistryModel[] = [
  // OpenAI direct.
  chat("openai", "gpt-5.6-sol", "GPT-5.6 Sol", "OpenAI", "gpt-5.6", {
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    vision: true,
    promptCaching: true,
    reasoning: ["none", "low", "medium", "high", "xhigh"]
  }),
  chat("openai", "gpt-5.6-terra", "GPT-5.6 Terra", "OpenAI", "gpt-5.6", {
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    vision: true,
    promptCaching: true,
    reasoning: ["none", "low", "medium", "high", "xhigh"]
  }),
  chat("openai", "gpt-5.6-luna", "GPT-5.6 Luna", "OpenAI", "gpt-5.6", {
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    vision: true,
    promptCaching: true,
    reasoning: ["none", "low", "medium", "high", "xhigh"]
  }),
  chat("openai", "gpt-5.5", "GPT-5.5", "OpenAI", "gpt-5.5", {
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    vision: true,
    promptCaching: true,
    reasoning: ["none", "low", "medium", "high", "xhigh"]
  }),
  capability("openai", "gpt-image-2", "GPT Image 2", "OpenAI", "gpt-image", "image.editing", [
    Capability.ImageGenerate,
    Capability.ImageEdit
  ]),
  capability("openai", "gpt-4o-transcribe", "GPT-4o Transcribe", "OpenAI", "gpt-4o-transcribe", "audio.transcription", [
    Capability.Transcription
  ]),
  capability("openai", "gpt-4o-mini-transcribe", "GPT-4o Mini Transcribe", "OpenAI", "gpt-4o-transcribe", "audio.transcription", [
    Capability.Transcription
  ]),
  capability("openai", "gpt-4o-mini-tts", "GPT-4o Mini TTS", "OpenAI", "gpt-4o-tts", "audio.speech", [Capability.Speech]),
  capability("openai", "text-embedding-3-small", "Text Embedding 3 Small", "OpenAI", "text-embedding-3", "embeddings", [
    Capability.Embeddings
  ]),
  capability("openai", "text-embedding-3-large", "Text Embedding 3 Large", "OpenAI", "text-embedding-3", "embeddings", [
    Capability.Embeddings
  ]),

  // Google Gemini API direct.
  chat("google", "gemini-3.5-flash", "Gemini 3.5 Flash", "Google", "gemini-3.5", googleThinking()),
  chat("google", "gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview", "Google", "gemini-3.1", {
    ...googleThinking(),
    status: "preview"
  }),
  chat("google", "gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite", "Google", "gemini-3.1", googleThinking()),
  chat("google", "gemini-2.5-flash", "Gemini 2.5 Flash", "Google", "gemini-2.5", googleThinking()),
  chat("google", "gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite", "Google", "gemini-2.5", googleThinking()),

  // Anthropic direct.
  chat("anthropic", "claude-haiku-4-5", "Claude Haiku 4.5", "Anthropic", "claude-haiku", {
    contextWindow: 200_000,
    maxTokens: 64_000,
    vision: true,
    jsonSchema: false,
    promptCaching: true,
    reasoning: ["none", "low", "medium", "high"],
    reasoningControl: "thinking_budget"
  }),
  chat("anthropic", "claude-sonnet-4-6", "Claude Sonnet 4.6", "Anthropic", "claude-sonnet", anthropicThinking()),
  chat("anthropic", "claude-sonnet-5", "Claude Sonnet 5", "Anthropic", "claude-sonnet", anthropicThinking()),
  chat("anthropic", "claude-opus-4-8", "Claude Opus 4.8", "Anthropic", "claude-opus", anthropicThinking()),
  chat("anthropic", "claude-fable-5", "Claude Fable 5", "Anthropic", "claude-fable", anthropicThinking()),

  // xAI direct.
  chat("xai", "grok-4.5", "Grok 4.5", "xAI", "grok-4", {
    contextWindow: 500_000,
    maxTokens: 128_000,
    vision: true,
    reasoning: ["none", "low", "medium", "high"],
    promptCaching: true
  }),
  chat("xai", "grok-4.3", "Grok 4.3", "xAI", "grok-4", {
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    vision: true,
    reasoning: ["none", "low", "medium", "high"],
    promptCaching: true
  }),

  // DeepSeek direct.
  chat("deepseek", "deepseek-v4-pro", "DeepSeek V4 Pro", "DeepSeek", "deepseek-v4", deepseekThinking()),
  chat("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash", "DeepSeek", "deepseek-v4", deepseekThinking()),

  // Mistral direct.
  chat("mistral", "mistral-medium-3.5", "Mistral Medium 3.5", "Mistral AI", "mistral-medium", {
    contextWindow: 262_144,
    maxTokens: 64_000,
    vision: true,
    reasoning: [],
    reasoningSource: "unknown"
  }),

  // Groq.
  chat("groq", "openai/gpt-oss-20b", "GPT-OSS 20B", "OpenAI", "gpt-oss", groqOss(131_072, 65_536)),
  chat("groq", "openai/gpt-oss-120b", "GPT-OSS 120B", "OpenAI", "gpt-oss", groqOss(131_072, 65_536)),
  chat("groq", "qwen/qwen3-32b", "Qwen3 32B", "Alibaba Qwen", "qwen3", {
    contextWindow: 131_072,
    maxTokens: 40_960,
    vision: false,
    jsonSchema: false,
    reasoning: ["none", "low", "medium", "high"]
  }),
  chat("groq", "qwen/qwen3.6-27b", "Qwen3.6 27B", "Alibaba Qwen", "qwen3.6", {
    contextWindow: 131_072,
    maxTokens: 32_768,
    vision: true,
    jsonSchema: false,
    reasoning: ["none", "low", "medium", "high"]
  }),
  capability("groq", "whisper-large-v3", "Whisper Large V3", "OpenAI", "whisper", "audio.transcription", [
    Capability.Transcription
  ]),
  capability("groq", "whisper-large-v3-turbo", "Whisper Large V3 Turbo", "OpenAI", "whisper", "audio.transcription", [
    Capability.Transcription
  ]),

  // Alibaba Model Studio direct.
  chat("alibaba", "qwen3.7-max", "Qwen3.7 Max", "Alibaba Qwen", "qwen3.7", alibabaChat({ vision: false })),
  chat("alibaba", "qwen3.7-plus", "Qwen3.7 Plus", "Alibaba Qwen", "qwen3.7", alibabaChat({ vision: true })),
  chat("alibaba", "qwen3.6-plus", "Qwen3.6 Plus", "Alibaba Qwen", "qwen3.6", alibabaChat({ vision: true })),
  chat("alibaba", "qwen3.6-flash", "Qwen3.6 Flash", "Alibaba Qwen", "qwen3.6", alibabaChat({ vision: true })),

  // MiniMax, Z.ai, Xiaomi.
  chat("minimax", "MiniMax-M3", "MiniMax M3", "MiniMax", "minimax-m3", {
    contextWindow: 1_048_576,
    maxTokens: 128_000,
    vision: true,
    reasoning: [],
    reasoningSource: "unknown"
  }),
  chat("zai", "glm-5.2", "GLM-5.2", "Z.ai", "glm-5", {
    contextWindow: 1_048_576,
    maxTokens: 128_000,
    vision: false,
    reasoning: ["low", "medium", "high"],
    reasoningControl: "reasoning_effort"
  }),
  chat("xiaomi", "mimo-v2.5", "MiMo V2.5", "Xiaomi", "mimo-v2.5", xiaomiMimo(true)),
  chat("xiaomi", "mimo-v2.5-pro", "MiMo V2.5 Pro", "Xiaomi", "mimo-v2.5", xiaomiMimo(false)),

  // fal.ai.
  capability("fal", "fal-ai/bytedance/seedream/v5/lite/text-to-image", "Seedream 5 Lite Text to Image", "ByteDance", "seedream", "image.generation", [
    Capability.ImageGenerate
  ]),
  capability("fal", "fal-ai/bytedance/seedream/v5/lite/edit", "Seedream 5 Lite Edit", "ByteDance", "seedream", "image.editing", [
    Capability.ImageGenerate,
    Capability.ImageEdit
  ]),
  capability("fal", "bytedance/seedream/v5/pro/edit", "Seedream 5 Pro Edit", "ByteDance", "seedream", "image.editing", [
    Capability.ImageGenerate,
    Capability.ImageEdit
  ]),
  capability("fal", "fal-ai/flux-pro/kontext", "FLUX.1 Kontext Pro", "Black Forest Labs", "flux-kontext", "image.editing", [
    Capability.ImageGenerate,
    Capability.ImageEdit
  ]),
  capability("fal", "fal-ai/flux-pro/v1/fill", "FLUX.1 Fill Pro", "Black Forest Labs", "flux-fill", "image.editing", [
    Capability.ImageGenerate,
    Capability.ImageEdit
  ]),
  capability("fal", "fal-ai/veo3.1", "Veo 3.1", "Google", "veo", "video.generation", [Capability.VideoGenerate]),
  capability("fal", "fal-ai/veo3.1/fast", "Veo 3.1 Fast", "Google", "veo", "video.generation", [Capability.VideoGenerate]),
  capability("fal", "fal-ai/veo3.1/lite", "Veo 3.1 Lite", "Google", "veo", "video.generation", [Capability.VideoGenerate]),
  capability("fal", "bytedance/seedance-2.0/image-to-video", "Seedance 2.0 Image to Video", "ByteDance", "seedance", "video.generation", [
    Capability.VideoGenerate
  ]),
  capability("fal", "fal-ai/wan/v2.7/image-to-video", "Wan 2.7 Image to Video", "Alibaba", "wan", "video.generation", [
    Capability.VideoGenerate
  ]),

  // Replicate.
  capability("replicate", "bytedance/seedream-4.5", "Seedream 4.5", "ByteDance", "seedream", "image.editing", [
    Capability.ImageGenerate,
    Capability.ImageEdit
  ]),
  capability("replicate", "bytedance/seedream-4", "Seedream 4", "ByteDance", "seedream", "image.editing", [
    Capability.ImageGenerate,
    Capability.ImageEdit
  ]),
  capability("replicate", "black-forest-labs/flux-2-flex", "FLUX.2 Flex", "Black Forest Labs", "flux", "image.editing", [
    Capability.ImageGenerate,
    Capability.ImageEdit
  ]),
  capability("replicate", "black-forest-labs/flux-kontext-pro", "FLUX Kontext Pro", "Black Forest Labs", "flux-kontext", "image.editing", [
    Capability.ImageGenerate,
    Capability.ImageEdit
  ]),
  capability("replicate", "black-forest-labs/flux-kontext-max", "FLUX Kontext Max", "Black Forest Labs", "flux-kontext", "image.editing", [
    Capability.ImageGenerate,
    Capability.ImageEdit
  ]),
  capability("replicate", "google/veo-3.1-lite", "Veo 3.1 Lite", "Google", "veo", "video.generation", [Capability.VideoGenerate]),
  capability("replicate", "bytedance/seedance-2.0-fast", "Seedance 2.0 Fast", "ByteDance", "seedance", "video.generation", [
    Capability.VideoGenerate
  ]),
  capability("replicate", "bytedance/seedance-2.0", "Seedance 2.0", "ByteDance", "seedance", "video.generation", [
    Capability.VideoGenerate
  ]),
  capability("replicate", "kwaivgi/kling-v3-video", "Kling v3 Video", "Kuaishou", "kling", "video.generation", [
    Capability.VideoGenerate
  ]),

  // ElevenLabs.
  capability("elevenlabs", "eleven_v3", "Eleven v3", "ElevenLabs", "eleven", "audio.speech", [Capability.Speech]),
  capability("elevenlabs", "eleven_multilingual_v2", "Eleven Multilingual v2", "ElevenLabs", "eleven", "audio.speech", [
    Capability.Speech
  ]),
  capability("elevenlabs", "eleven_flash_v2_5", "Eleven Flash v2.5", "ElevenLabs", "eleven-flash", "audio.speech", [
    Capability.Speech
  ]),
  capability("elevenlabs", "eleven_flash_v2", "Eleven Flash v2", "ElevenLabs", "eleven-flash", "audio.speech", [
    Capability.Speech
  ]),
  capability("elevenlabs", "scribe_v2", "Scribe v2", "ElevenLabs", "scribe", "audio.transcription", [Capability.Transcription]),
  capability("elevenlabs", "scribe_v2_realtime", "Scribe v2 Realtime", "ElevenLabs", "scribe", "audio.transcription", [
    Capability.Transcription
  ]),

  // OpenRouter text/chat only.
  ...openRouterChatModels()
];

interface ChatOptions {
  contextWindow: number;
  maxTokens: number;
  vision: boolean;
  tools?: boolean;
  jsonSchema?: boolean;
  promptCaching?: boolean;
  reasoning: ReasoningFeatures["efforts"];
  reasoningSource?: ReasoningFeatures["source"];
  reasoningConfidence?: ReasoningFeatures["confidence"];
  reasoningControl?: string;
  status?: RegistryStatus;
  inputTypes?: NonNullable<ModelInfo["inputTypes"]>;
  pricing?: RegistryPricing;
}

function chat(
  provider: ProviderId,
  nativeId: string,
  displayName: string,
  developer: string,
  family: string,
  options: ChatOptions
): RegistryModel {
  const reasoning = reasoningFeatures(options.reasoning, options.reasoningSource, options.reasoningConfidence);
  const chatFeatures: ChatFeatures = {
    streaming: true,
    vision: options.vision,
    tools: options.tools ?? true,
    reasoning,
    jsonSchema: options.jsonSchema ?? true,
    promptCaching: options.promptCaching ?? false
  };

  return withRegistry(
    {
      id: `${provider}:${nativeId}`,
      provider,
      providerModelId: nativeId,
      displayName,
      type: options.vision ? "multimodal" : "chat",
      capabilities: { modalities: [Capability.Chat], chat: chatFeatures },
      pricing: legacyPricing(options.pricing ?? pricingFor(provider, "text.chat", `${provider}:${nativeId}`)),
      contextWindow: options.contextWindow,
      maxTokens: options.maxTokens,
      supportsVision: options.vision,
      supportsTools: chatFeatures.tools,
      supportsStreaming: true,
      supportsSystemPrompts: true,
      inputTypes: options.inputTypes ?? (options.vision ? ["text", "image"] : ["text"]),
      outputTypes: ["text"],
      specialFeatures: reasoning.supported ? ["reasoning"] : undefined
    },
    {
      category: "text.chat",
      provider,
      developer,
      family,
      status: options.status ?? "active",
      reasoningControl: options.reasoningControl,
      pricing: options.pricing ?? pricingFor(provider, "text.chat", `${provider}:${nativeId}`)
    }
  );
}

function capability(
  provider: ProviderId,
  nativeId: string,
  displayName: string,
  developer: string,
  family: string,
  category: RegistryCategory,
  modalities: Capability[],
  pricing?: RegistryPricing
): RegistryModel {
  const inputTypes: NonNullable<ModelInfo["inputTypes"]> = modalities.includes(Capability.Transcription)
    ? ["audio"]
    : modalities.includes(Capability.Speech)
      ? ["text"]
      : modalities.includes(Capability.ImageEdit)
        ? ["text", "image"]
        : modalities.includes(Capability.VideoGenerate)
          ? ["text", "image"]
          : modalities.includes(Capability.Embeddings)
            ? ["text"]
            : ["text"];
  const outputTypes: NonNullable<ModelInfo["outputTypes"]> = modalities.includes(Capability.Transcription)
    ? ["text"]
    : modalities.includes(Capability.Speech)
      ? ["audio"]
      : modalities.includes(Capability.Embeddings)
        ? ["embedding"]
        : modalities.includes(Capability.VideoGenerate)
          ? ["video"]
          : ["image"];

  return withRegistry(
    {
      id: `${provider}:${nativeId}`,
      provider,
      providerModelId: nativeId,
      displayName,
      type: modelType(category),
      capabilities: { modalities },
      pricing: legacyPricing(pricing ?? pricingFor(provider, category, `${provider}:${nativeId}`)),
      inputTypes,
      outputTypes
    },
    { category, provider, developer, family, status: "active", pricing: pricing ?? pricingFor(provider, category, `${provider}:${nativeId}`) }
  );
}

function withRegistry(
  model: ModelInfo & { provider: ProviderId },
  meta: {
    category: RegistryCategory;
    provider: ProviderId;
    developer: string;
    family: string;
    status: RegistryStatus;
    reasoningControl?: string;
    pricing: RegistryPricing;
  }
): RegistryModel {
  const registryReasoning = registryReasoningForModel(model, meta.reasoningControl);
  return {
    ...model,
    registry: {
      category: meta.category,
      status: meta.status,
      developer: meta.developer,
      family: meta.family,
      version: model.providerModelId,
      supportedRegions: [],
      endpoints: endpointsFor(model.capabilities.modalities),
      aliases: [model.providerModelId],
      fallbackModelIds: [],
      verificationLevel: "verifiedDocumentationOnly" satisfies VerificationLevel,
      source: {
        authority: "studio-curated",
        checkedAt: CHECKED_AT,
        urls: SOURCES[meta.provider]
      },
      pricing: meta.pricing,
      reasoning: registryReasoning,
      freeAccess: {
        isFree: model.id.endsWith(":free") || model.providerModelId.endsWith(":free"),
        freeType: model.id.endsWith(":free") || model.providerModelId.endsWith(":free") ? "separate_route" : undefined,
        isPromotional: false
      }
    }
  };
}

function openRouterChatModels(): RegistryModel[] {
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

function googleThinking(): ChatOptions {
  return {
    contextWindow: 1_048_576,
    maxTokens: 64_000,
    vision: true,
    inputTypes: ["text", "image", "audio", "video"],
    reasoning: ["none", "minimal", "low", "medium", "high"],
    reasoningControl: "thinkingConfig"
  };
}

// Modern Claude lineup (Sonnet 4.6, Sonnet 5, Opus 4.8, Fable 5): adaptive thinking controlled
// by the `effort` parameter (manual budget_tokens returns 400 on these). See anthropic/chat.ts.
function anthropicThinking(): ChatOptions {
  return {
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    vision: true,
    jsonSchema: false,
    promptCaching: true,
    reasoning: ["none", "low", "medium", "high", "xhigh"],
    reasoningControl: "effort"
  };
}

function deepseekThinking(): ChatOptions {
  return {
    contextWindow: 1_048_576,
    maxTokens: 384_000,
    vision: false,
    reasoning: ["none", "low", "medium", "high", "xhigh"],
    promptCaching: true
  };
}

function groqOss(contextWindow: number, maxTokens: number): ChatOptions {
  return {
    contextWindow,
    maxTokens,
    vision: false,
    reasoning: ["low", "medium", "high"]
  };
}

function alibabaChat(overrides: Partial<ChatOptions>): ChatOptions {
  return {
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    vision: false,
    reasoning: [],
    reasoningSource: "unknown",
    ...overrides
  };
}

function xiaomiMimo(vision: boolean): ChatOptions {
  return {
    contextWindow: 1_048_576,
    maxTokens: 128_000,
    vision,
    reasoning: [],
    reasoningSource: "unknown"
  };
}

function reasoningFeatures(
  efforts: ReasoningFeatures["efforts"],
  source: ReasoningFeatures["source"] = "official-docs",
  confidence: ReasoningFeatures["confidence"] = "exact"
): ReasoningFeatures {
  return efforts.length
    ? {
        supported: true,
        efforts,
        defaultEffort: efforts.includes("medium") ? "medium" : efforts[0],
        source,
        confidence
      }
    : {
        supported: false,
        efforts: [],
        source,
        confidence: source === "unknown" ? "unknown" : confidence
      };
}

function registryReasoningForModel(model: ModelInfo, reasoningControl?: string): RegistryReasoning | undefined {
  const reasoning = model.capabilities.chat?.reasoning;
  if (!reasoning) return undefined;
  return {
    supported: reasoning.supported,
    alwaysOn: reasoning.supported && !reasoning.efforts.includes("none"),
    canDisable: reasoning.efforts.includes("none"),
    effortValues: reasoning.efforts,
    returnsReasoningContent: "unknown",
    reasoningTokensVisible: "unknown",
    reasoningTokensBillable: reasoning.supported ? "unknown" : false,
    worksWithTools: model.capabilities.chat?.tools ? "unknown" : false,
    worksWhileStreaming: model.capabilities.chat?.streaming ? "unknown" : false,
    requiresReasoningStateAfterTools: "unknown",
    reducesOutputBudget: "unknown",
    providerSpecificControls: reasoningControl ? [reasoningControl] : reasoning.supported ? ["reasoning_effort"] : []
  };
}

function endpointsFor(modalities: Capability[]): string[] {
  return modalities.map((capability) => {
    switch (capability) {
      case Capability.Chat:
        return "chat";
      case Capability.Embeddings:
        return "embeddings";
      case Capability.Transcription:
        return "audio.transcriptions";
      case Capability.Speech:
        return "audio.speech";
      case Capability.ImageGenerate:
        return "images.generations";
      case Capability.ImageEdit:
        return "images.edits";
      case Capability.VideoGenerate:
        return "videos.generations";
      case Capability.AudioGenerate:
        return "audio.generations";
      case Capability.Rerank:
        return "rerank";
      case Capability.Credits:
        return "credits";
    }
  });
}

function modelType(category: RegistryCategory): NonNullable<ModelInfo["type"]> {
  if (category === "embeddings") return "embedding";
  if (category === "audio.speech") return "tts";
  if (category === "audio.transcription") return "audio";
  if (category === "video.generation") return "video";
  if (category === "image.generation" || category === "image.editing") return "image";
  return "chat";
}

function legacyPricing(pricing: RegistryPricing): ModelPricing {
  if (pricing.kind === "token" || pricing.kind === "embedding") {
    return {
      inputPerMillionUsd: pricing.inputPerMillion ?? null,
      outputPerMillionUsd: pricing.outputPerMillion ?? null,
      source: pricing.status === "verified" ? "static" : "unknown",
      note: pricing.notes
    };
  }
  return {
    inputPerMillionUsd: null,
    outputPerMillionUsd: null,
    source: "unknown",
    note: pricing.notes
  };
}

function pricingFor(provider: ProviderId, category: RegistryCategory, modelId?: string): RegistryPricing {
  const override = modelId ? verifiedPricingFor(modelId) : undefined;
  if (override) return override;
  const sourceUrls = SOURCES[provider];
  if (category === "text.chat") {
    return {
      kind: "token",
      status: "unknown",
      currency: "USD",
      billingUnit: "one_million_tokens",
      inputPerMillion: null,
      cachedInputPerMillion: null,
      cacheWritePerMillion: null,
      outputPerMillion: null,
      batchInputPerMillion: null,
      batchOutputPerMillion: null,
      reasoningTokens: "unknown",
      sourceUrls,
      verifiedAt: null,
      notes: "N/A until this exact provider route is verified from official pricing or tested billing data."
    };
  }
  if (category === "embeddings") {
    return {
      kind: "embedding",
      status: "unknown",
      currency: "USD",
      billingUnit: "one_million_tokens",
      inputPerMillion: null,
      outputPerMillion: null,
      sourceUrls,
      verifiedAt: null,
      notes: "Embedding pricing is token based; this exact route price is not verified in the curated registry yet."
    };
  }
  if (category === "image.generation" || category === "image.editing") {
    return {
      kind: "image",
      status: provider === "replicate" || provider === "fal" ? "provider_variable" : "unknown",
      currency: "USD",
      billingUnit: provider === "replicate" ? "prediction" : "image",
      price: null,
      dependsOn: provider === "replicate" || provider === "fal"
        ? ["resolution", "quality", "provider_route", "hardware"]
        : ["resolution", "quality"],
      sourceUrls,
      verifiedAt: null,
      notes: "Image pricing must preserve native units such as image, megapixel, generation, prediction, or compute seconds."
    };
  }
  if (category === "video.generation") {
    return {
      kind: "video",
      status: provider === "replicate" || provider === "fal" ? "provider_variable" : "unknown",
      currency: "USD",
      billingUnit: provider === "replicate" ? "prediction" : "video_second",
      price: null,
      dependsOn: ["duration", "resolution", "fps", "quality", "provider_route", "hardware"],
      sourceUrls,
      verifiedAt: null,
      notes: "Video pricing may depend on duration, resolution, frame rate, quality, route, and runtime hardware."
    };
  }
  if (category === "audio.speech") {
    return {
      kind: "audio",
      status: "unknown",
      currency: "USD",
      billingUnit: provider === "elevenlabs" ? "character" : "audio_minute",
      price: null,
      sourceUrls,
      verifiedAt: null,
      notes: "Speech pricing must preserve provider units such as character, credit, minute, or generation."
    };
  }
  if (category === "audio.transcription") {
    return {
      kind: "audio",
      status: "unknown",
      currency: "USD",
      billingUnit: provider === "groq" ? "audio_hour" : "audio_minute",
      price: null,
      sourceUrls,
      verifiedAt: null,
      notes: "Transcription pricing is duration based for most supported providers."
    };
  }
  return {
    kind: "custom",
    status: "not_applicable",
    currency: "USD",
    billingUnit: "not_applicable",
    price: null,
    sourceUrls,
    verifiedAt: null
  };
}

function verifiedPricingFor(modelId: string): RegistryPricing | undefined {
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
