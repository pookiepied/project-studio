/**
 * OpenAI Provider Discovery
 * Discovers OpenAI models (chat, image generation, TTS, embeddings)
 */

import { ProviderDiscovery } from "../base";
import { Model } from "../../types";
import { logger } from "../../logger";

export class OpenAIDiscovery implements ProviderDiscovery {
  name = "openai";
  private apiKey: string;
  private baseUrl = "https://api.openai.com/v1";

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
        const isGPT = modelId.includes("gpt");
        const isDalle = modelId.includes("dall-e");
        const isTTS = modelId.includes("tts");
        const isWhisper = modelId.includes("whisper");
        const isEmbedding = modelId.includes("embedding");

        if (isDalle) {
          // Image generation model
          models.push({
            id: `openai:${modelId}`,
            provider: "openai",
            name: `OpenAI ${modelId}`,
            description: "Image generation via DALL-E",
            type: "image",
            maxTokens: 4000,
            contextWindow: 4000,
            pricing: {
              input: 0.02,
              output: 0.02,
              currency: "USD"
            },
            free: false,
            capabilities: ["image-generation", "text-to-image"],
            modality: ["text", "image"],
            architecture: "DALL-E",
            created: model.created || Date.now(),
            supportsStreaming: false,
            inputTypes: ["text"],
            outputTypes: ["image"]
          });
        } else if (isTTS) {
          // Text-to-speech model
          models.push({
            id: `openai:${modelId}`,
            provider: "openai",
            name: `OpenAI ${modelId}`,
            description: "Text-to-speech synthesis",
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
            created: model.created || Date.now(),
            supportsStreaming: true,
            inputTypes: ["text"],
            outputTypes: ["audio"]
          });
        } else if (isWhisper) {
          // Audio transcription model
          models.push({
            id: `openai:${modelId}`,
            provider: "openai",
            name: `OpenAI ${modelId}`,
            description: "Audio transcription via Whisper",
            type: "audio",
            maxTokens: 448,
            contextWindow: 25 * 60 * 1000,
            pricing: {
              input: 0.006,
              output: 0,
              currency: "USD"
            },
            free: false,
            capabilities: ["audio-transcription", "speech-to-text"],
            modality: ["audio", "text"],
            architecture: "Whisper",
            created: model.created || Date.now(),
            supportsStreaming: false,
            inputTypes: ["audio"],
            outputTypes: ["text"]
          });
        } else if (isEmbedding) {
          // Embedding model
          models.push({
            id: `openai:${modelId}`,
            provider: "openai",
            name: `OpenAI ${modelId}`,
            description: "Text embedding model",
            type: "embedding",
            maxTokens: 8191,
            contextWindow: 8191,
            pricing: {
              input: 0.0001,
              output: 0,
              currency: "USD"
            },
            free: false,
            capabilities: ["embedding", "text-embedding"],
            modality: ["text"],
            architecture: "Embedding",
            created: model.created || Date.now(),
            supportsStreaming: false,
            inputTypes: ["text"],
            outputTypes: ["text"]
          });
        } else if (isGPT) {
          // Chat model
          const isVision = modelId.includes("vision") || modelId.includes("gpt-4");
          
          models.push({
            id: `openai:${modelId}`,
            provider: "openai",
            name: `OpenAI ${modelId}`,
            description: model.owned_by ? `${model.owned_by} model` : `OpenAI ${modelId}`,
            type: isVision ? "multimodal" : "chat",
            maxTokens: 4096,
            contextWindow: 128000,
            pricing: {
              input: 0.01,
              output: 0.03,
              currency: "USD"
            },
            free: false,
            capabilities: isVision ? ["chat", "vision", "multimodal"] : ["chat"],
            modality: isVision ? ["text", "image"] : ["text"],
            architecture: "GPT",
            created: model.created || Date.now(),
            supportsVision: isVision,
            supportsTools: true,
            supportsStreaming: true,
            supportsSystemPrompts: true,
            inputTypes: isVision ? ["text", "image"] : ["text"],
            outputTypes: ["text"]
          });
        }
      }

      logger.info(`OpenAI: Discovered ${models.length} models`);
      return models;

    } catch (error) {
      logger.error("OpenAI discovery failed:", error);
      return [];
    }
  }

}
