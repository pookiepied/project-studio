/**
 * OpenAI Responses adapter
 * Protocol: openai-responses
 * Endpoint: POST {baseUrl}/v1/responses
 * Auth: Authorization: Bearer {apiKey}
 * Used for gpt-5/o-series with reasoning effort, instructions vs messages separation
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
    return (data.data ?? [])
      .filter((m) => m.id.includes("gpt-5") || m.id.includes("o1") || m.id.includes("o3") || m.id.includes("responses"))
      .map((m) => ({
        id: m.id,
        providerId: "",
        displayName: m.id,
        category: "text" as const,
        inputModalities: ["text"] as const,
        outputModalities: ["text"] as const,
        contextWindow: null,
        maxOutputTokens: null,
        supportsTools: true,
        supportsParallelTools: true,
        supportsVision: true,
        supportsReasoning: true,
        reasoning: { type: "dynamic" as const, levels: ["low", "medium", "high", "xhigh", "max"] },
        pricing: null,
        releaseDate: m.created ? new Date(m.created * 1000).toISOString() : null,
        raw: m,
      }));
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
