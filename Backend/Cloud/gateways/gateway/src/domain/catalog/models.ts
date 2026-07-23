import type { RegistryModel } from "./schema";
import { Capability } from "@/domain/models/capabilities";
import {
  capability,
  chat
} from "./builders";
import {
  alibabaChat,
  anthropicThinking,
  deepseekThinking,
  googleThinking,
  groqOss,
  xiaomiMimo
} from "./presets";
import { openRouterChatModels } from "./openRouterModels";

export { MANUAL_REGISTRY_GENERATED_AT, MANUAL_REGISTRY_VERSION } from "./metadata";

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
