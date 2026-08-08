import type { Model } from "@/core/models";
import { getAIMode } from "@/core/config/autoMode";
import { safeGetContextWindow, safeIsVisionModel } from "@/core/network/fallbackService";
import { getClaudeContextWindowTokens } from "@/cliBridges";
import type { AutoRoutedInfo } from "@/types/chat";
import { DEFAULT_MAX_CONTEXT_TOKENS } from "./constants";

const VIRTUAL_ROUTING_MODELS = new Set(["auto", "fast", "standard", "advanced"]);

export function resolveContextLimit({
  modelId,
  models,
  autoRoutedModel,
}: {
  modelId: string;
  models: Model[];
  autoRoutedModel: AutoRoutedInfo | null;
}): number {
  try {
    const normalizedModelId = getAIMode(modelId)?.modelId ?? modelId;
    if (/^(claude-|sonnet$|opus$|haiku$|fable$)/i.test(normalizedModelId)) {
      return getClaudeContextWindowTokens(normalizedModelId);
    }
    if (!models.length) return DEFAULT_MAX_CONTEXT_TOKENS;

    if (VIRTUAL_ROUTING_MODELS.has(normalizedModelId)) {
      const resolved = autoRoutedModel?.model;
      if (resolved) return Math.floor(safeGetContextWindow(models, resolved) * 0.75);
      return 200_000;
    }

    const detectedLimit = safeGetContextWindow(models, normalizedModelId);
    if (detectedLimit > DEFAULT_MAX_CONTEXT_TOKENS) return Math.floor(detectedLimit * 0.75);
    if (/^(openrouter:|openai:|anthropic:|google:|groq:)/i.test(normalizedModelId)) {
      return 200_000;
    }
    return Math.floor(detectedLimit * 0.75);
  } catch {
    return DEFAULT_MAX_CONTEXT_TOKENS;
  }
}

export function supportsVisionForModel(models: Model[], modelId: string): boolean {
  return models.length > 0
    ? safeIsVisionModel(models, modelId)
    : /vision|llava|moondream|gpt-4o|claude-3|gemini.*vision/i.test(modelId);
}
