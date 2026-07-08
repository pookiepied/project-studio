/**
 * Cohere Provider Discovery
 *
 * Calls /v1/models?endpoint= for each capability: chat, embed, rerank.
 * Pricing: null — Cohere bills by search_units/billed_units in the response,
 * not per token. The usage response is tracked at request time; discovery
 * stores null for pricing so the frontend shows "N/A".
 */

import { ProviderDiscovery } from "../base";
import { Model }             from "../../types";
import { logger }            from "../../logger";

const BASE_URL = "https://api.cohere.com/v1";

async function fetchModels(apiKey: string, endpoint: string): Promise<any[]> {
  const response = await fetch(`${BASE_URL}/models?endpoint=${endpoint}&page_size=50`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Client-Name": "studio-gateway",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for endpoint=${endpoint}`);
  const data: any = await response.json();
  return data.models ?? [];
}

export class CohereDiscovery implements ProviderDiscovery {
  name = "cohere";

  constructor(private readonly apiKey: string) {}

  async discoverModels(): Promise<Model[]> {
    try {
      const [chatModels, embedModels, rerankModels] = await Promise.all([
        fetchModels(this.apiKey, "chat").catch(() => []),
        fetchModels(this.apiKey, "embed").catch(() => []),
        fetchModels(this.apiKey, "rerank").catch(() => []),
      ]);

      const models: Model[] = [];
      const seen = new Set<string>();

      const add = (model: any, type: Model["type"], isRerank = false) => {
        const id = model.name as string;
        const key = `${type}:${id}:${isRerank}`;
        if (seen.has(key)) return;
        seen.add(key);

        const lower = id.toLowerCase();
        models.push({
          id:          `cohere:${id}`,
          provider:    "cohere",
          type,
          name:        model.name,
          description: model.description ?? (
            type === "embedding" ? "Cohere embedding model"
            : isRerank           ? "Cohere rerank model"
            : lower.includes("command-a") ? "Cohere Command A — flagship enterprise model"
            : lower.includes("command-r-plus") ? "Cohere Command R+ — RAG-optimised with tool use"
            : lower.includes("command-r") ? "Cohere Command R — efficient RAG model"
            : "Cohere language model"
          ),
          contextWindow: model.context_length   ?? (type === "embedding" ? 512 : 128000),
          maxTokens:     type === "chat" ? (model.context_length ? Math.floor(model.context_length / 4) : 4096) : undefined,
          pricing:       null,
          free:          false,
          capabilities: type === "embedding"
            ? ["embeddings"]
            : isRerank
            ? ["chat", "rerank"]
            : ["chat", "text-generation", "tool-calling", "streaming"],
          modality:      ["text"],
          supportsStreaming:     type === "chat",
          supportsTools:         type === "chat" && !isRerank,
          supportsParallelTools: type === "chat" && !isRerank,
          supportsSystemPrompts: type === "chat",
          supportsVision:        false,
          inputTypes:  ["text"],
          outputTypes: type === "embedding" ? ["embedding"] : ["text"],
        });
      };

      for (const m of chatModels)   add(m, "chat");
      for (const m of embedModels)  add(m, "embedding");
      for (const m of rerankModels) add(m, "chat", true);

      logger.info(`cohere: ${models.length} models`);
      return models;
    } catch (error) {
      logger.error("Cohere discovery failed", error);
      return [];
    }
  }
}
