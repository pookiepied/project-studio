/**
 * xAI Provider Discovery
 *
 * Uses the live /v1/models endpoint. xAI returns model IDs but does NOT
 * return pricing. Pricing is applied via PRICING_TABLE below.
 *
 * Pricing: USD per 1 000 000 tokens (as of May 2026)
 *   https://x.ai/api#pricing
 */

import { ProviderDiscovery } from "../base";
import { Model } from "../../types";
import { logger } from "../../logger";

// ─────────────────────────────────────────────────────────────────────────────
// Static pricing table
// ─────────────────────────────────────────────────────────────────────────────

/** USD per 1M tokens. Matched longest-first to avoid short-prefix clashes. */
const PRICING_TABLE: Array<{ match: string; input: number; output: number }> = [
  { match: "grok-3-mini-fast",  input: 0.60,  output: 4.00  },
  { match: "grok-3-mini",       input: 0.30,  output: 0.50  },
  { match: "grok-3-fast",       input: 5.00,  output: 25.00 },
  { match: "grok-3",            input: 3.00,  output: 15.00 },
  { match: "grok-2-vision",     input: 2.00,  output: 10.00 },
  { match: "grok-2-mini",       input: 0.20,  output: 0.40  },
  { match: "grok-2",            input: 2.00,  output: 10.00 },
  { match: "grok-vision-beta",  input: 5.00,  output: 15.00 },
  { match: "grok-beta",         input: 5.00,  output: 15.00 },
];

function lookupPricing(id: string): { input: number; output: number } {
  const lower = id.toLowerCase();
  for (const row of PRICING_TABLE) {
    if (lower.includes(row.match)) return { input: row.input, output: row.output };
  }
  return { input: 3.00, output: 15.00 }; // conservative default for new Grok models
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovery class
// ─────────────────────────────────────────────────────────────────────────────

export class XAIDiscovery implements ProviderDiscovery {
  name = "xai";
  private readonly baseUrl = "https://api.x.ai/v1";

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
        const isVision     = lower.includes("vision");
        const isReasoning  = lower.includes("mini"); // grok-3-mini has explicit reasoning budget
        const pricing      = lookupPricing(id);

        models.push({
          id:          `xai:${id}`,
          provider:    "xai",
          type:        isVision ? "multimodal" : "chat",
          name:        model.name || id,
          description: isVision
            ? "xAI Grok vision-language model"
            : "xAI Grok language model",
          maxTokens:     model.max_tokens ?? 131072,
          contextWindow: model.context_length ?? 131072,
          pricing:     { ...pricing, currency: "USD" },
          free:        false,
          capabilities: isVision
            ? ["chat", "vision", "multimodal", "tool-calling"]
            : isReasoning
            ? ["chat", "text-generation", "reasoning", "tool-calling"]
            : ["chat", "text-generation", "tool-calling"],
          modality:    isVision ? ["text", "image"] : ["text"],
          architecture: "Grok",
          created:     model.created ?? undefined,
          supportsVision:        isVision,
          supportsTools:         true,
          supportsParallelTools: true,
          supportsStreaming:     true,
          supportsSystemPrompts: true,
          inputTypes:  isVision ? ["text", "image"] : ["text"],
          outputTypes: ["text"],
          ...(isReasoning ? { specialFeatures: ["reasoning" as const] } : {}),
        });
      }

      logger.info(`xai: ${models.length} models`);
      return models;
    } catch (error) {
      logger.error("xAI discovery failed", error);
      return [];
    }
  }
}
