/**
 * OpenAI Responses adapter
 * Protocol: openai-responses
 * Endpoint: POST {baseUrl}/v1/responses
 * Auth: Authorization: Bearer {apiKey}
 * Handles `POST /v1/responses` for any provider that speaks responses protocol.
 * Discovery is now catalog-driven; live filter is passthrough (do not drop non-gpt-5).
 */

import type { Adapter } from "../../providers/registry.ts";
import type { ModelDefinition } from "../../providers/types.ts";

export const openAIResponsesAdapter: Adapter = {
  protocol: "openai-responses",

  async discover(apiKey: string, baseUrl: string): Promise<ModelDefinition[]> {
    // Responses uses same model list as completions
    const clean = baseUrl.replace(/\/$/, "");
    const url = clean.endsWith("/v1") ? clean + "/models" : clean + "/v1/models";
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI list models failed ${res.status}: ${text}`);
    }
    const data = (await res.json()) as { data: Array<{ id: string; created: number; owned_by: string }> };
    // No id filter — catalog provides full metadata; passthrough all models and tag via heuristic fallback
    return (data.data ?? []).map((m) => {
      const idLower = m.id.toLowerCase();
      const isVision = idLower.includes("vision") || idLower.includes("gpt-4o") || idLower.includes("4o") || idLower.includes("vl");
      const isReasoning = idLower.includes("o1") || idLower.includes("o3") || idLower.includes("gpt-5") || idLower.includes("reasoning");
      return {
        id: m.id,
        providerId: "",
        displayName: m.id,
        category: "text" as const,
        inputModalities: isVision ? (["text", "image"] as const) : (["text"] as const),
        outputModalities: ["text"] as const,
        contextWindow: null,
        maxOutputTokens: null,
        supportsTools: true,
        supportsParallelTools: false,
        supportsVision: isVision,
        supportsReasoning: isReasoning,
        reasoning: isReasoning ? ({ type: "dynamic" as const, levels: ["low", "medium", "high", "xhigh", "max"] } as const) : null,
        pricing: null,
        releaseDate: m.created ? new Date(m.created * 1000).toISOString() : null,
        raw: m,
      };
    });
  },

  async chat(apiKey: string, baseUrl: string, body: unknown, signal: AbortSignal): Promise<Response> {
    const clean = baseUrl.replace(/\/$/, "");
    const url = clean.endsWith("/v1") ? clean + "/responses" : clean + "/v1/responses";
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
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
