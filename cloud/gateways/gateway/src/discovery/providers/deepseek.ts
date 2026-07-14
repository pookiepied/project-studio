/**
 * DeepSeek Provider Discovery
 *
 * Uses the live /v1/models endpoint. DeepSeek returns model IDs but does NOT
 * return pricing. Pricing is applied via PRICING_TABLE below.
 *
 * DeepSeek V3 / R1 use a mixture-of-experts architecture and are priced
 * significantly below most Western equivalents.
 *
 * Pricing: USD per 1 000 000 tokens (as of May 2026, off-peak rates)
 *   https://platform.deepseek.com/docs/pricing
 */

import { ProviderDiscovery } from "../base";
import { Model } from "../../types";
import { logger } from "../../logger";

// ─────────────────────────────────────────────────────────────────────────────
// Static pricing table
// ─────────────────────────────────────────────────────────────────────────────

const PRICING_TABLE: Array<{ match: string; input: number; output: number }> = [
  // R1 reasoning series
  { match: "deepseek-r1",       input: 0.55,  output: 2.19  },
  { match: "deepseek-reasoner", input: 0.55,  output: 2.19  },
  // V3 / chat
  { match: "deepseek-chat",     input: 0.14,  output: 0.28  },
  { match: "deepseek-v3",       input: 0.14,  output: 0.28  },
  // Coder
  { match: "deepseek-coder",    input: 0.14,  output: 0.28  },
];

function lookupPricing(id: string): { input: number; output: number } {
  const lower = id.toLowerCase();
  for (const row of PRICING_TABLE) {
    if (lower.includes(row.match)) return { input: row.input, output: row.output };
  }
  return { input: 0.27, output: 1.10 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovery class
// ─────────────────────────────────────────────────────────────────────────────

export class DeepSeekDiscovery implements ProviderDiscovery {
  name = "deepseek";
  private readonly baseUrl = "https://api.deepseek.com/v1";

  constructor(private readonly apiKey: string) {}

  async discoverModels(): Promise<Model[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const data: any = await response.json();
      const models: Model[] = [];

      for (const model of data.data ?? []) {
        const id: string   = model.id;
        const lower        = id.toLowerCase();
        const isReasoner   = lower.includes("reasoner") || lower.includes("r1");
        const isCoder      = lower.includes("coder");
        const pricing      = lookupPricing(id);

        models.push({
          id:          `deepseek:${id}`,
          provider:    "deepseek",
          type:        "chat",
          name:        model.name || id,
          description: isReasoner
            ? "DeepSeek R1 — open-source reasoning model with chain-of-thought"
            : isCoder
            ? "DeepSeek Coder — code generation and completion specialist"
            : "DeepSeek V3 — mixture-of-experts language model",
          maxTokens:     isReasoner ? 32768 : 8192,
          contextWindow: 65536,
          pricing:     { ...pricing, currency: "USD" },
          free:        false,
          capabilities: isReasoner
            ? ["chat", "reasoning", "math", "code", "tool-calling"]
            : isCoder
            ? ["chat", "code", "completion", "tool-calling"]
            : ["chat", "text-generation", "code", "tool-calling"],
          modality:    ["text"],
          architecture: "DeepSeek",
          created:     model.created ?? undefined,
          supportsStreaming:     true,
          supportsTools:         !isReasoner, // R1 does not support function calling
          supportsSystemPrompts: true,
          inputTypes:  ["text"],
          outputTypes: ["text"],
          ...(isReasoner ? { specialFeatures: ["reasoning" as const, "math" as const, "code" as const] } : {}),
          ...(isCoder    ? { specialFeatures: ["code" as const] } : {}),
        });
      }

      logger.info(`deepseek: ${models.length} models`);
      return models;
    } catch (error) {
      logger.error("DeepSeek discovery failed", error);
      return [];
    }
  }
}
