/**
 * Groq Provider Discovery
 * Discovers all Groq models (chat + audio) from their API
 */

import { ProviderDiscovery } from "../base";
import { Model } from "../../types";
import { logger } from "../../logger";

export class GroqDiscovery implements ProviderDiscovery {
  name = "groq";
  private apiKey: string;
  private baseUrl = "https://api.groq.com/openai/v1";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
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

      for (const model of data.data) {
        const modelId = model.id;
        
        // Categorize by model name patterns
        const isWhisper = modelId.includes("whisper");
        const isLlama = modelId.includes("llama");
        const isMixtral = modelId.includes("mixtral");
        const isGemma = modelId.includes("gemma");

        // Groq tool calling support (per console.groq.com/docs/tool-use/overview):
        // Supported: llama-*, mixtral-*, openai/gpt-oss-*, qwen/*, groq/compound*
        // Not supported: whisper (audio), orpheus (TTS), prompt-guard (safety), safeguard (safety)
        const isAudioOrSafety = isWhisper
          || modelId.includes("orpheus")
          || modelId.includes("prompt-guard")
          || modelId.includes("safeguard");
        const supportsTools = !isAudioOrSafety;

        // openai/gpt-oss-120b does NOT support parallel tool calls (Groq docs).
        const supportsParallelTools = !modelId.includes("gpt-oss-120b");

        // Skip internal safety models from the UI
        if (modelId.includes("prompt-guard") || modelId.includes("safeguard")) {
          continue;
        }

        if (isWhisper) {
          // Audio transcription model
          models.push({
            id: `groq:${modelId}`,
            provider: "groq",
            name: `Groq ${modelId}`,
            description: "Audio transcription via Whisper",
            type: "audio",
            maxTokens: 448,
            contextWindow: 25 * 60 * 1000, // 25 minutes in ms
            pricing: {
              input: 0.0001,
              output: 0,
              currency: "USD"
            },
            free: false,
            capabilities: ["audio-transcription", "speech-to-text"],
            modality: ["audio", "text"],
            architecture: "Whisper",
            created: Date.now(),
            supportsStreaming: false,
            inputTypes: ["audio"],
            outputTypes: ["text"]
          });
        } else if (modelId.includes("orpheus")) {
          // TTS model
          models.push({
            id: `groq:${modelId}`,
            provider: "groq",
            name: `Groq ${modelId}`,
            description: "Text-to-speech synthesis — Groq",
            type: "tts",
            maxTokens: 4096,
            contextWindow: 4096,
            pricing: {
              input: 0.015,
              output: 0.015,
              currency: "USD"
            },
            free: false,
            capabilities: ["text-to-speech", "tts"],
            modality: ["text", "audio"],
            architecture: "TTS",
            created: Date.now(),
            supportsStreaming: true,
            inputTypes: ["text"],
            outputTypes: ["audio"]
          });
        } else {
          // Chat model
          models.push({
            id: `groq:${modelId}`,
            provider: "groq",
            name: `Groq ${modelId}`,
            description: model.owned_by ? `${model.owned_by} model on Groq` : `Groq ${modelId}`,
            type: "chat",
            maxTokens: 8192,
            contextWindow: model.context_window || 32768,
            pricing: {
              input: 0.0001,
              output: 0.0001,
              currency: "USD"
            },
            free: false,
            capabilities: ["chat", "completion"],
            modality: ["text"],
            architecture: isLlama ? "Llama" : isMixtral ? "Mixtral" : isGemma ? "Gemma" : "Unknown",
            created: model.created || Date.now(),
            supportsTools: supportsTools,
            supportsParallelTools: supportsTools ? supportsParallelTools : undefined,
            supportsStreaming: true,
            supportsSystemPrompts: true,
            inputTypes: ["text"],
            outputTypes: ["text"]
          });
        }
      }

      logger.info(`Groq: Discovered ${models.length} models`);
      return models;

    } catch (error) {
      logger.error("Groq discovery failed:", error);
      return [];
    }
  }
}
