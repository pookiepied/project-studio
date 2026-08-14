/**
 * Catalog mapper — models.dev → ModelDefinition.
 * Extracted from adapters/sdk.ts to keep adapter router protocol-only.
 */

import type { ModelDefinition } from "../providers/types.ts";

export function mapModelsDevToDefinition(providerId: string, modelId: string, m: {
  name: string; description?: string; family?: string; modalities: { input: string[]; output: string[] };
  limit: { context: number; output?: number }; cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
  tool_call: boolean; reasoning: boolean; reasoning_options?: Array<{ type: string }>;
  attachment?: boolean; release_date?: string; open_weights?: boolean; knowledge?: string;
  lab?: string;
}): ModelDefinition {
  const cats: Record<string, ModelDefinition["category"]> = {
    image: "image", video: "video", audio: "audio",
  };
  const idLower = `${modelId} ${m.name}`.toLowerCase();
  let category: ModelDefinition["category"] = "text";
  const out = m.modalities.output;
  if (idLower.includes("embedding") || idLower.includes("embed")) category = "embedding";
  else if (out.includes("image") && !out.includes("text")) category = cats.image;
  else if (out.includes("video")) category = cats.video;
  else if (out.includes("audio") && !out.includes("text")) category = "speech";
  else if (m.modalities.input.includes("audio") && out.includes("text")) category = "transcription";
  // text + image/video hybrid stays text (gateway treats as vision-capable text)
  const hasBudgetReasoning = m.reasoning_options?.some((o) => o.type === "budget_tokens") ?? false;
  const reasoning = m.reasoning
    ? { type: hasBudgetReasoning ? "selected" as const : "dynamic" as const, levels: ["low", "medium", "high"] }
    : null;
  return {
    id: modelId,
    providerId,
    displayName: m.name,
    description: m.description,
    category,
    inputModalities: m.modalities.input as ModelDefinition["inputModalities"],
    outputModalities: m.modalities.output as ModelDefinition["outputModalities"],
    contextWindow: m.limit.context ?? null,
    maxOutputTokens: m.limit.output ?? null,
    supportsTools: m.tool_call,
    // models.dev does not publish a parallel-tool capability. Do not claim it.
    supportsParallelTools: false,
    supportsVision: m.modalities.input.includes("image"),
    supportsReasoning: m.reasoning,
    reasoning,
    pricing: m.cost ? { input: m.cost.input ?? null, output: m.cost.output ?? null, cacheRead: m.cost.cache_read ?? null, cacheWrite: m.cost.cache_write ?? null } : null,
    releaseDate: m.release_date ?? null,
    family: m.family ?? null,
    lab: m.lab ?? null,
    openWeights: m.open_weights ?? false,
    knowledgeCutoff: m.knowledge ?? null,
    catalogSource: "models.dev",
    raw: m,
  };
}
