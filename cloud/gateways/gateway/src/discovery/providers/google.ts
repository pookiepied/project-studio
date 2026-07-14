/**
 * Google Provider Discovery
 * Discovers Google Gemini models from their API
 */

import { ProviderDiscovery } from "../base";
import { Model } from "../../types";
import { logger } from "../../logger";

interface GoogleModel {
  name: string;
  displayName: string;
  description: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  supportedGenerationMethods: string[];
}

export class GoogleDiscovery implements ProviderDiscovery {
  name = "google";
  private apiKey: string;
  private baseUrl = "https://generativelanguage.googleapis.com/v1beta";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async discoverModels(): Promise<Model[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models?key=${this.apiKey}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }

      const data: { models: GoogleModel[] } = await response.json();
      const models: Model[] = [];
      
      for (const model of data.models) {
        const modelId = model.name.replace("models/", "");
        const displayName = model.displayName || modelId;
        const methods = model.supportedGenerationMethods || [];
        
        // Categorize by supported methods
        const hasGenerateContent = methods.includes("generateContent");
        const hasEmbedContent = methods.includes("embedContent");
        const hasPredict = methods.includes("predict");
        const hasPredictLongRunning = methods.includes("predictLongRunning");
        const hasBidiGenerateContent = methods.includes("bidiGenerateContent");
        
        // Determine model type and capabilities
        let type: Model["type"] = "chat";
        const capabilities: string[] = [];
        const modality: string[] = ["text"];
        let supportsVision = false;
        let inputTypes: Array<"text" | "image" | "audio" | "video"> = ["text"];
        let outputTypes: Array<"text" | "image" | "audio" | "video"> = ["text"];
        
        // Embedding models
        if (hasEmbedContent) {
          type = "embedding";
          capabilities.push("embedding", "text-embedding");
          outputTypes = ["text"];
        }
        // Image generation (Imagen)
        else if (hasPredict && modelId.includes("imagen")) {
          type = "image";
          capabilities.push("image-generation", "text-to-image");
          modality.push("image");
          outputTypes = ["image"];
        }
        // Video generation (Veo)
        else if (hasPredictLongRunning && modelId.includes("veo")) {
          type = "video";
          capabilities.push("video-generation", "text-to-video");
          modality.push("video");
          outputTypes = ["video"];
        }
        // TTS models
        else if (modelId.includes("tts")) {
          type = "tts";
          capabilities.push("text-to-speech", "tts");
          modality.push("audio");
          outputTypes = ["audio"];
        }
        // Native audio models
        else if (hasBidiGenerateContent || modelId.includes("native-audio")) {
          type = "multimodal";
          capabilities.push("chat", "audio", "multimodal");
          modality.push("audio");
          supportsVision = false;
          inputTypes = ["text", "audio"];
        }
        // Chat/Vision models (Gemini, Gemma)
        else if (hasGenerateContent) {
          // Check if it's a vision model (most Gemini models support vision)
          const isGemini = modelId.includes("gemini");
          const isGemma = modelId.includes("gemma");
          const isNano = modelId.includes("nano");
          
          if (isGemini && !isNano && !modelId.includes("embedding")) {
            type = "multimodal";
            capabilities.push("chat", "vision", "multimodal");
            modality.push("image");
            supportsVision = true;
            inputTypes = ["text", "image"];
          } else {
            type = "chat";
            capabilities.push("chat");
          }
        }
        // AQA and other special models
        else {
          type = "chat";
          capabilities.push("chat");
        }
        
        // Determine if free
        const isFree = modelId.includes("flash") || modelId.includes("lite") || modelId.includes("gemma");
        
        models.push({
          id: `google:${modelId}`,
          provider: "google",
          name: displayName,
          description: model.description || `Google ${displayName}`,
          type,
          maxTokens: model.outputTokenLimit || 8192,
          contextWindow: model.inputTokenLimit || 1048576,
          pricing: isFree ? {
            input: 0,
            output: 0,
            currency: "USD"
          } : {
            input: 0.075,
            output: 0.30,
            currency: "USD"
          },
          free: isFree,
          capabilities,
          modality,
          architecture: "Gemini",
          created: Date.now(),
          supportsVision,
          supportsTools: hasGenerateContent,
          supportsStreaming: hasGenerateContent || hasBidiGenerateContent,
          supportsSystemPrompts: hasGenerateContent,
          inputTypes,
          outputTypes
        });
      }
      
      logger.info(`Google: Discovered ${models.length} models`);
      return models;
      
    } catch (error) {
      logger.error("Google discovery failed:", error);
      return [];
    }
  }
}
