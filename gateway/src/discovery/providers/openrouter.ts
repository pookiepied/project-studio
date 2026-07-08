/**
 * OpenRouter Provider Discovery
 *
 * Discovers ALL models from OpenRouter's /models endpoint and classifies them
 * using the canonical taxonomy types (see discovery/taxonomy.ts).
 *
 * OpenRouter returns a rich per-model object including:
 *   - architecture.modality — e.g. "text+image->text", "text->image"
 *   - architecture.reasoning — boolean / string flag for chain-of-thought models
 *   - pricing.prompt / pricing.completion — USD per token (not per M tokens)
 *   - context_length, top_provider.max_completion_tokens
 *
 * Pricing unit: OpenRouter returns USD-per-token; we multiply by 1_000_000
 * to get USD-per-million-tokens to match the rest of our pricing table.
 */

import { ProviderDiscovery } from "../base";
import { GatewayEnv } from "../../env";
import { Model } from "../../types";
import { parseModalityString } from "../taxonomy";
import { logger } from "../../logger";

import { STUDIO_SITE_URL, STUDIO_APP_TITLE } from "../../config/constants";

// ─────────────────────────────────────────────────────────────────────────────
// Discovery class
// ─────────────────────────────────────────────────────────────────────────────

export class OpenRouterDiscovery implements ProviderDiscovery {
  name = "openrouter";
  private readonly baseUrl  = "https://openrouter.ai/api/v1";
  private readonly siteUrl: string;

  constructor(private readonly apiKey: string, env?: GatewayEnv) {
    this.siteUrl = env?.OPENROUTER_SITE_URL ?? STUDIO_SITE_URL;
  }

  async discoverModels(): Promise<Model[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "HTTP-Referer": this.siteUrl,
          "X-Title":      STUDIO_APP_TITLE,
        },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const data: any = await response.json();
      const models: Model[] = [];

      for (const model of data.data || []) {
        const modelId:   string = model.id;
        const modelName: string = model.name || modelId;

        // ── Classify by modality string ──────────────────────────────────────
        // Examples: "text->text", "text+image->text", "text->image", "text->audio"
        const modalityStr: string = model.architecture?.modality ?? "text->text";
        const { type, inputTypes, outputTypes } = parseModalityString(modalityStr);

        // ── Capabilities ─────────────────────────────────────────────────────
        const capabilities: string[] = [];
        switch (type) {
          case "chat":
            capabilities.push("chat", "text-generation");
            break;
          case "multimodal":
            capabilities.push("chat", "vision", "multimodal");
            break;
          case "embedding":
            capabilities.push("embedding", "text-embedding");
            break;
          case "image":
            capabilities.push("image-generation", "text-to-image");
            break;
          case "video":
            capabilities.push("video-generation", "text-to-video");
            break;
          case "audio":
            capabilities.push("audio-transcription", "speech-to-text");
            break;
          case "tts":
            capabilities.push("text-to-speech", "tts");
            break;
        }

        const hasReasoning = !!model.architecture?.reasoning;
        if (hasReasoning) capabilities.push("reasoning", "thinking");

        // ── Modality display array ────────────────────────────────────────────
        const modality = [...new Set([...inputTypes, ...outputTypes])];

        // ── Pricing ──────────────────────────────────────────────────────────
        // OpenRouter returns USD per single token — multiply by 1M for our unit.
        const rawPricing = model.pricing ?? {};
        const inputPricePer1M  = parseFloat(rawPricing.prompt      || "0") * 1_000_000;
        const outputPricePer1M = parseFloat(rawPricing.completion   || "0") * 1_000_000;
        const isFree = modelId.includes(":free") || (inputPricePer1M === 0 && outputPricePer1M === 0);

        // ── Special features ─────────────────────────────────────────────────
        const specialFeatures: Array<"thinking" | "reasoning" | "code" | "math" | "creative"> = [];
        if (hasReasoning) specialFeatures.push("thinking", "reasoning");

        // ── Assemble Model ────────────────────────────────────────────────────
        models.push({
          id:          `openrouter:${modelId}`,
          provider:    "openrouter",
          type,
          name:        modelName,
          description: model.description || `${modelName} via OpenRouter`,
          maxTokens:     model.top_provider?.max_completion_tokens || 4096,
          contextWindow: model.context_length || 8192,
          pricing: {
            input:    inputPricePer1M,
            output:   outputPricePer1M,
            currency: "USD",
          },
          free:        isFree,
          capabilities,
          modality,
          architecture:          model.architecture?.instruct_type || "Unknown",
          created:               model.created || Date.now(),
          supportsVision:        inputTypes.includes("image"),
          supportsTools:         type === "chat" || type === "multimodal",
          supportsParallelTools: type === "chat" || type === "multimodal",
          supportsStreaming:     type !== "embedding" && type !== "image" && type !== "video",
          supportsSystemPrompts: type === "chat" || type === "multimodal",
          inputTypes,
          outputTypes,
          specialFeatures: specialFeatures.length > 0 ? specialFeatures : undefined,
        });
      }

      // Return the full catalogue — every model type OpenRouter offers
      // (chat, multimodal, image, video, audio, tts, embedding).
      // Filtering by type is the frontend's responsibility via modelFilter.ts,
      // not the discovery layer's. Never filter here.
      logger.info(`openrouter: ${models.length} models`);
      return models;
    } catch (error) {
      logger.error("OpenRouter discovery failed:", error);
      return [];
    }
  }
}
