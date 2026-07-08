/**
 * Alibaba Cloud Provider Discovery
 * Discovers Qwen models from Alibaba Cloud DashScope API
 */

import { ProviderDiscovery } from "../base";
import { Model } from "../../types";
import { logger } from "../../logger";

export class AlibabaDiscovery implements ProviderDiscovery {
  name = "alibaba";
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    // Default to international endpoint, can be overridden
    this.baseUrl = baseUrl || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
  }

  async discoverModels(): Promise<Model[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }

      const data: any = await response.json();
      const models: Model[] = [];

      for (const model of data.data || []) {
        const modelId = model.id;

        // Skip embeddings and image generation — not usable for chat, TTS, or STT
        const isEmbedding = modelId.includes("embed") || modelId.includes("embedding");
        const isImage = modelId.includes("image") || modelId.includes("wanx");
        if (isEmbedding || isImage) continue;

        // STT models (Paraformer) — emit as type "audio" (speech-to-text)
        // Paraformer is Alibaba's ASR model family; accessible via the OpenAI-compatible
        // endpoint at /compatible-mode/v1/audio/transcriptions.
        const isSTT = modelId.startsWith("paraformer");
        if (isSTT) {
          models.push({
            id: `alibaba:${modelId}`,
            provider: "alibaba",
            type: "audio",
            name: this.formatSTTName(modelId),
            description: this.describeSTTModel(modelId),
            free: false,
            pricing: { input: 0.00028, output: 0, currency: "USD" }, // ~$0.28/hour
            capabilities: ["audio-transcription", "speech-to-text"],
            modality: ["audio", "text"],
            architecture: "Paraformer",
            created: model.created || Date.now(),
            supportsStreaming: false,
            inputTypes: ["audio"],
            outputTypes: ["text"],
          });
          continue;
        }

        // TTS models — emit as type "tts"
        const isTTS =
          modelId.includes("tts") ||
          modelId.includes("speech") ||
          modelId === "cosyvoice-v1" ||
          modelId.startsWith("cosyvoice");

        if (isTTS) {
          const isFlash = modelId.includes("flash");
          models.push({
            id: `alibaba:${modelId}`,
            provider: "alibaba",
            type: "tts",
            name: this.formatTTSName(modelId),
            description: this.describeTTSModel(modelId),
            free: false,
            pricing: {
              input: isFlash ? 0.00005 : 0.0001,
              output: 0,
              currency: "USD",
            },
            capabilities: ["text-to-speech", "tts"],
            modality: ["text", "audio"],
            architecture: "Qwen",
            created: model.created || Date.now(),
            supportsStreaming: true,
            inputTypes: ["text"],
            outputTypes: ["audio"],
          });
          continue;
        }

        // Alibaba Cloud primarily has Qwen models
        const isVL = modelId.includes("vl"); // Vision-Language models
        const isCoder = modelId.includes("coder");
        const isMath = modelId.includes("math");

        // Determine capabilities
        const capabilities: string[] = ["chat"];
        const specialFeatures: Array<"thinking" | "reasoning" | "code" | "math" | "creative"> = [];
        
        if (isVL) {
          capabilities.push("vision", "multimodal");
        }
        if (isCoder) {
          capabilities.push("code");
          specialFeatures.push("code");
        }
        if (isMath) {
          capabilities.push("math");
          specialFeatures.push("math");
        }

        models.push({
          id: `alibaba:${modelId}`,
          provider: "alibaba",
          name: `Alibaba ${modelId}`,
          description: model.owned_by ? `${model.owned_by} model on Alibaba Cloud` : `Alibaba ${modelId}`,
          type: isVL ? "multimodal" : "chat",
          maxTokens: 8192,
          contextWindow: model.context_window || 32768,
          pricing: {
            input: 0.0001,
            output: 0.0001,
            currency: "USD"
          },
          free: false,
          capabilities,
          modality: isVL ? ["text", "image"] : ["text"],
          architecture: "Qwen",
          created: model.created || Date.now(),
          supportsVision: isVL,
          supportsTools: !isVL, // VL models don't support function calling on DashScope
          supportsStreaming: true,
          supportsSystemPrompts: true,
          inputTypes: isVL ? ["text", "image"] : ["text"],
          outputTypes: ["text"],
          specialFeatures: specialFeatures.length > 0 ? specialFeatures : undefined
        });
      }

      logger.info(`Alibaba: Discovered ${models.length} models`);
      return models;

    } catch (error) {
      logger.error("Alibaba discovery failed:", error);
      return [];
    }
  }

  private formatSTTName(modelId: string): string {
    const map: Record<string, string> = {
      "paraformer-v2":          "Paraformer v2",
      "paraformer-realtime-v2": "Paraformer Realtime v2",
      "paraformer-8k-v2":       "Paraformer 8kHz v2",
    };
    return map[modelId] ?? `Alibaba ${modelId}`;
  }

  private describeSTTModel(modelId: string): string {
    if (modelId.includes("realtime")) return "Real-time streaming speech recognition — Alibaba Paraformer";
    if (modelId.includes("8k"))       return "8kHz-optimised speech recognition (phone audio) — Alibaba Paraformer";
    return "High-accuracy speech-to-text — Alibaba Paraformer";
  }

  private formatTTSName(modelId: string): string {
    const map: Record<string, string> = {
      "qwen3-tts-flash": "Qwen3-TTS Flash",
      "qwen3-tts": "Qwen3-TTS",
      "qwen3-tts-instruct-flash": "Qwen3-TTS Instruct Flash",
      "qwen3-tts-vd": "Qwen3-TTS Voice Design",
      "qwen3-tts-vc": "Qwen3-TTS Voice Clone",
      "cosyvoice-v1": "CosyVoice v1",
    };
    return map[modelId] ?? `Alibaba ${modelId}`;
  }

  private describeTTSModel(modelId: string): string {
    if (modelId.includes("flash")) return "Fast, low-latency Qwen3 TTS — Alibaba Cloud";
    if (modelId.includes("vd")) return "Voice Design: create voices from text descriptions";
    if (modelId.includes("vc")) return "Voice Clone: clone voices from reference audio";
    if (modelId.includes("instruct")) return "Instruction-controlled Qwen3 speech synthesis";
    if (modelId.startsWith("cosyvoice")) return "CosyVoice multilingual TTS — Alibaba Cloud";
    return "High-quality Qwen3 text-to-speech — Alibaba Cloud";
  }
}
