/**
 * OpenAI Chat Completions adapter
 * Protocol: openai-completions
 * Endpoint: POST {baseUrl}/v1/chat/completions , GET {baseUrl}/v1/models
 * Auth: Authorization: Bearer {apiKey}
 * All OpenAI-compatible providers use this (OpenAI, DeepSeek, Groq, etc.)
 *
 * Discovery: live `GET /v1/models` fallback only. Primary tagging is via
 * `catalog/sync.ts` → `mapModelsDevToDefinition` (models.dev). Heuristics below
 * are best-effort for providers without catalog entry (e.g. custom/self-hosted).
 */

import type { Adapter } from "../../providers/registry.ts";
import type { ModelDefinition } from "../../providers/types.ts";

interface OpenAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

interface OpenAIModelsResponse {
  object: string;
  data: OpenAIModel[];
}

export const openAICompletionsAdapter: Adapter = {
  protocol: "openai-completions",

  async discover(apiKey: string, baseUrl: string): Promise<ModelDefinition[]> {
    const clean = baseUrl.replace(/\/$/, "");
    const url = clean.endsWith("/v1") ? clean + "/models" : clean + "/v1/models";
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI list models failed ${res.status}: ${text}`);
    }
    const data = (await res.json()) as OpenAIModelsResponse;
    // Fallback heuristic only — catalog mapper is primary; keep in sync with `sdk.ts:mapModelsDevToDefinition` categories
    const models: ModelDefinition[] = (data.data ?? []).map((m) => {
      const idLower = m.id.toLowerCase();
      let category: ModelDefinition["category"] = "text";
      let inputModalities: ModelDefinition["inputModalities"] = ["text"];
      let outputModalities: ModelDefinition["outputModalities"] = ["text"];
      if (idLower.includes("embedding") || idLower.includes("embed")) {
        category = "embedding";
        inputModalities = ["text"];
        outputModalities = ["text"];
      } else if (idLower.includes("dall-e") || idLower.includes("image") || idLower.includes("flux") || idLower.includes("stable-diffusion") || idLower.includes("sdxl")) {
        category = "image";
        inputModalities = ["text"];
        outputModalities = ["image"];
      } else if (idLower.includes("whisper") || idLower.includes("transcribe") || idLower.includes("stt")) {
        category = "transcription";
        inputModalities = ["audio"];
        outputModalities = ["text"];
      } else if (idLower.includes("tts") || idLower.includes("speech") || idLower.includes("elevenlabs") || idLower.includes("audio")) {
        category = "speech";
        inputModalities = ["text"];
        outputModalities = ["audio"];
      } else if (idLower.includes("rerank") || idLower.includes("reranker")) {
        category = "rerank";
        inputModalities = ["text"];
        outputModalities = ["text"];
      } else if (idLower.includes("video") || idLower.includes("veo") || idLower.includes("sora") || idLower.includes("kling")) {
        category = "video";
        inputModalities = ["text"];
        outputModalities = ["video"];
      }
      const isVision = idLower.includes("vision") || idLower.includes("gpt-4o") || idLower.includes("4o") || idLower.includes("vl") || idLower.includes("vision");
      const isReasoning = idLower.includes("o1") || idLower.includes("o3") || idLower.includes("reasoning") || idLower.includes("thinking") || idLower.includes("r1") || idLower.includes("qwq");
      return {
        id: m.id,
        providerId: "",
        displayName: m.id,
        category,
        inputModalities,
        outputModalities,
        contextWindow: null,
        maxOutputTokens: null,
        supportsTools: category === "text",
        supportsParallelTools: category === "text",
        supportsVision: isVision,
        supportsReasoning: isReasoning,
        reasoning: isReasoning ? { type: "dynamic" as const, levels: ["low", "medium", "high"] } : null,
        pricing: null,
        releaseDate: m.created ? new Date(m.created * 1000).toISOString() : null,
        raw: m,
      };
    });
    return models;
  },

  async chat(apiKey: string, baseUrl: string, body: unknown, signal: AbortSignal): Promise<Response> {
    const clean = baseUrl.replace(/\/$/, "");
    const url = clean.endsWith("/v1") ? clean + "/chat/completions" : clean + "/v1/chat/completions";
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
    // Passthrough status/headers/body directly - SSE or JSON
    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    });
  },
};
