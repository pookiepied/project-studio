import * as v from "valibot";

import { StudioError } from "./errors.js";

export const modelSourceSchema = v.picklist([
  "local",
  "studio-cloud",
  "test",
]);

export type ModelSource = v.InferOutput<typeof modelSourceSchema>;

export const modelReferenceSchema = v.object({
  source: modelSourceSchema,
  provider: v.pipe(v.string(), v.minLength(1)),
  model: v.pipe(v.string(), v.minLength(1)),
});

export type ModelReference = v.InferOutput<typeof modelReferenceSchema>;

/**
 * "unknown" means the dimension has not been described yet, distinct from a
 * confirmed "unsupported". Numeric limits use "unknown" rather than 0 for the
 * same reason.
 */
export type CapabilityState = "supported" | "unsupported" | "unknown";

export interface ModelCapability {
  readonly textGeneration: CapabilityState;
  readonly streaming: CapabilityState;
  readonly reasoning: CapabilityState;
  readonly toolCalling: CapabilityState;
  readonly vision: CapabilityState;
  readonly embeddings: CapabilityState;
  readonly reranking: CapabilityState;
  readonly imageGeneration: CapabilityState;
  readonly videoGeneration: CapabilityState;
  readonly speechGeneration: CapabilityState;
  readonly transcription: CapabilityState;
  readonly contextWindow: number | "unknown";
  readonly maxOutputTokens: number | "unknown";
}

export interface ModelDescriptor {
  readonly source: ModelSource;
  readonly provider: string;
  readonly model: string;
  readonly resolvedModelId: string;
  readonly capability: ModelCapability;
  readonly operational: boolean;
}

export interface ModelProviderAdapter {
  readonly source: ModelSource;
  readonly operational: boolean;
  register(): void;
  resolve(reference: ModelReference): ModelDescriptor;
  listModels(): readonly ModelDescriptor[];
}

export interface ModelProviderPort {
  resolve(reference: ModelReference): string;
  resolveDescriptor(reference: ModelReference): ModelDescriptor;
  listModels(): readonly ModelDescriptor[];
  validate(reference: ModelReference): void;
}

/**
 * Stable, gateway-neutral identity for the studio agent's model. It carries
 * no source/provider/implementation detail so switching model sources never
 * requires editing the agent definition.
 */
export const DEFAULT_MODEL_PROVIDER = "project-studio";
export const DEFAULT_MODEL_NAME = "default";
export const STUDIO_MODEL_ID = `${DEFAULT_MODEL_PROVIDER}/${DEFAULT_MODEL_NAME}`;

export function defaultModelReference(source: ModelSource): ModelReference {
  return {
    source,
    provider: DEFAULT_MODEL_PROVIDER,
    model: DEFAULT_MODEL_NAME,
  };
}

/**
 * A model source was selected that cannot start: missing configuration, an
 * unknown source, or an invalid value. Never retryable — the process must be
 * reconfigured.
 */
export class ProviderConfigurationError extends StudioError {
  readonly domain = "models" as const;

  constructor(message: string) {
    super("configuration", message);
    this.name = "ProviderConfigurationError";
  }
}

/**
 * A model reference could not be resolved to a descriptor. Raised instead of
 * substituting a different source, provider, or model.
 */
export class ModelResolutionError extends StudioError {
  readonly domain = "models" as const;

  constructor(message: string) {
    super("resolution", message);
    this.name = "ModelResolutionError";
  }
}
