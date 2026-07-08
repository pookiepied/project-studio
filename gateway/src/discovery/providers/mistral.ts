/**
 * Mistral Provider Discovery
 *
 * Uses the live /v1/models endpoint. Mistral returns model IDs with capability
 * metadata. Pricing is N/A — Mistral does not return costs in the API response
 * and pricing changes frequently; the KV discovery record stores null.
 */

import { ProviderDiscovery } from "../base";
import { Model }             from "../../types";
import { logger }            from "../../logger";

const BASE_URL = "https://api.mistral.ai/v1";

function describeModel(id: string): string {
  const lower = id.toLowerCase();
  if (lower.includes("large"))   return "Mistral Large — top-tier reasoning and instruction following";
  if (lower.includes("medium"))  return "Mistral Medium — balanced performance and cost";
  if (lower.includes("small"))   return "Mistral Small — fast and cost-efficient";
  if (lower.includes("codestral")) return "Codestral — code generation and completion specialist";
  if (lower.includes("embed"))   return "Mistral Embed — text embedding model";
  if (lower.includes("mixtral")) return "Mixtral — sparse mixture-of-experts language model";
  if (lower.includes("nemo"))    return "Mistral NeMo — 12B collaborative model";
  if (lower.includes("devstral")) return "Devstral — agentic coding model";
  return "Mistral language model";
}

export class MistralDiscovery implements ProviderDiscovery {
  name = "mistral";

  constructor(private readonly apiKey: string) {}

  async discoverModels(): Promise<Model[]> {
    try {
      const response = await fetch(`${BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const data: any = await response.json();
      const models: Model[] = [];

      for (const model of data.data ?? []) {
        const id: string = model.id;
        const lower      = id.toLowerCase();

        const isEmbed    = lower.includes("embed");
        const isCoder    = lower.includes("codestral") || lower.includes("devstral");
        const isModerated = lower.includes("moderation");

        if (isModerated) continue;

        models.push({
          id:          `mistral:${id}`,
          provider:    "mistral",
          type:        isEmbed ? "embedding" : "chat",
          name:        model.name || id,
          description: describeModel(id),
          maxTokens:   isEmbed ? undefined : (model.max_context_length ? Math.floor(model.max_context_length / 4) : 8192),
          contextWindow: model.max_context_length ?? (isEmbed ? 8192 : 131072),
          pricing:     null,
          free:        false,
          capabilities: isEmbed
            ? ["embeddings"]
            : isCoder
            ? ["chat", "code", "completion", "tool-calling", "streaming"]
            : ["chat", "text-generation", "tool-calling", "streaming"],
          modality:    ["text"],
          supportsStreaming:     !isEmbed,
          supportsTools:         !isEmbed && !isCoder,
          supportsParallelTools: !isEmbed,
          supportsSystemPrompts: !isEmbed,
          supportsVision:        false,
          inputTypes:  ["text"],
          outputTypes: isEmbed ? ["embedding"] : ["text"],
        });
      }

      logger.info(`mistral: ${models.length} models`);
      return models;
    } catch (error) {
      logger.error("Mistral discovery failed", error);
      return [];
    }
  }
}
