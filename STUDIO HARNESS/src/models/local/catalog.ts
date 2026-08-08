import type { Api, Model } from "@earendil-works/pi-ai";

import {
  DEFAULT_MODEL_NAME,
  DEFAULT_MODEL_PROVIDER,
  type CapabilityState,
  type ModelCapability,
  type ModelDescriptor,
} from "../../contracts/models.js";

const SOURCE = "local" as const;

function limit(value: number | undefined): number | "unknown" {
  return typeof value === "number" && value > 0 ? value : "unknown";
}

/**
 * Maps one Pi model onto the harness capability contract.
 *
 * Pi's model records describe language models, so the media dimensions are
 * genuinely unsupported rather than undescribed — image and speech generation
 * live in a separate Pi collection. Tool calling is the honest exception: Pi's
 * model record carries no tool-calling flag, so it stays `"unknown"` instead of
 * being guessed from the provider.
 */
export function capabilityFromPiModel(model: Model<Api>): ModelCapability {
  const vision: CapabilityState = model.input.includes("image")
    ? "supported"
    : "unsupported";

  return {
    textGeneration: "supported",
    streaming: "supported",
    reasoning: model.reasoning ? "supported" : "unsupported",
    toolCalling: "unknown",
    vision,
    embeddings: "unsupported",
    reranking: "unsupported",
    imageGeneration: "unsupported",
    videoGeneration: "unsupported",
    speechGeneration: "unsupported",
    transcription: "unsupported",
    contextWindow: limit(model.contextWindow),
    maxOutputTokens: limit(model.maxTokens),
  };
}

/**
 * A local model keeps its own `<provider>/<model>` identity in the model field,
 * so the provider that owns the credential stays visible to the product. Local
 * and Studio catalogs never merge, and the id makes clear which one a model
 * came from.
 */
export function descriptorFromPiModel(model: Model<Api>): ModelDescriptor {
  const qualified = `${model.provider}/${model.id}`;
  return {
    source: SOURCE,
    provider: DEFAULT_MODEL_PROVIDER,
    model: qualified,
    resolvedModelId: `${DEFAULT_MODEL_PROVIDER}/${qualified}`,
    capability: capabilityFromPiModel(model),
    operational: true,
  };
}

/**
 * Descriptor for the stable `project-studio/default` alias. Its capabilities
 * are the target model's, because the alias is that model.
 */
export function defaultAliasDescriptor(
  target: Model<Api> | undefined,
): ModelDescriptor {
  return {
    source: SOURCE,
    provider: DEFAULT_MODEL_PROVIDER,
    model: DEFAULT_MODEL_NAME,
    resolvedModelId: `${DEFAULT_MODEL_PROVIDER}/${DEFAULT_MODEL_NAME}`,
    capability:
      target === undefined
        ? UNDESCRIBED_CAPABILITY
        : capabilityFromPiModel(target),
    operational: target !== undefined,
  };
}

/**
 * Capability floor used only when the configured target model cannot be found,
 * which is a misconfiguration the adapter reports separately.
 */
export const UNDESCRIBED_CAPABILITY: ModelCapability = {
  textGeneration: "supported",
  streaming: "supported",
  reasoning: "unknown",
  toolCalling: "unknown",
  vision: "unknown",
  embeddings: "unknown",
  reranking: "unknown",
  imageGeneration: "unknown",
  videoGeneration: "unknown",
  speechGeneration: "unknown",
  transcription: "unknown",
  contextWindow: "unknown",
  maxOutputTokens: "unknown",
};
