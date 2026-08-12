/**
 * Anthropic adapter - discovery + chat proxy
 * Discovery: GET /v1/models with pagination, maps to ModelDefinition with comprehensive tags
 * Chat: POST /v1/messages -> stream SSE, translate from/to OpenAI-compatible
 */

import type { Adapter } from "../registry.ts";
import type { ModelDefinition } from "../types.ts";
import { ANTHROPIC_PRICING, inferReasoningType, type AnthropicModelInfo } from "./types.ts";

const ANTHROPIC_VERSION = "2023-06-01";

export const anthropicProvider: Adapter = {
  protocol: "anthropic-messages",

  async discover(apiKey: string, baseUrl: string): Promise<ModelDefinition[]> {
    const all: AnthropicModelInfo[] = [];
    let after: string | undefined;
    for (let i = 0; i < 10; i++) {
      const url = new URL(baseUrl.replace(/\/$/, "") + "/v1/models");
      url.searchParams.set("limit", "100");
      if (after) url.searchParams.set("after_id", after);
      const res = await fetch(url.toString(), {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Anthropic list models failed ${res.status}: ${text}`);
      }
      const data = (await res.json()) as { data: AnthropicModelInfo[]; has_more: boolean; last_id?: string };
      all.push(...data.data);
      if (!data.has_more || !data.last_id) break;
      after = data.last_id;
    }
    return all.map((m) => toModelDefinition(m));
  },

  async chat(apiKey: string, baseUrl: string, body: unknown, signal: AbortSignal): Promise<Response> {
    const url = baseUrl.replace(/\/$/, "") + "/v1/messages";
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    });
  },
};

function toModelDefinition(m: AnthropicModelInfo): ModelDefinition {
  const pricing = ANTHROPIC_PRICING[m.id] ?? null;
  const reasoning = inferReasoningType(m.capabilities);
  const isVision = m.capabilities?.image_input.supported ?? true;
  const supportsTools = true;
  const hasPdf = m.capabilities?.pdf_input.supported ?? false;
  const inputModalities: ModelDefinition["inputModalities"] = ["text"];
  if (isVision) inputModalities.push("image");
  if (hasPdf) {
    // PDF document input - raw keeps pdf_input flag
  }
  return {
    id: m.id,
    providerId: "anthropic",
    displayName: m.display_name,
    description: undefined,
    category: "text",
    inputModalities,
    outputModalities: ["text"],
    contextWindow: m.max_input_tokens,
    maxOutputTokens: m.max_tokens,
    supportsTools,
    supportsParallelTools: true,
    supportsVision: isVision,
    supportsReasoning: reasoning.type !== "none",
    reasoning: reasoning.type === "none" ? null : { type: reasoning.type, levels: reasoning.levels },
    pricing: pricing ? { input: pricing.input, output: pricing.output, cacheRead: pricing.cacheRead ?? null, cacheWrite: pricing.cacheWrite ?? null } : null,
    releaseDate: m.created_at,
    raw: m,
  };
}