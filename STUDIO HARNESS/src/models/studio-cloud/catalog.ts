import {
  DEFAULT_MODEL_NAME,
  DEFAULT_MODEL_PROVIDER,
  type CapabilityState,
  type ModelCapability,
  type ModelDescriptor,
} from "../../contracts/models.js";
import type { StudioModelRecord } from "./client.js";

const SOURCE = "studio-cloud" as const;

/**
 * The capability floor the stable alias advertises before the catalog has been
 * loaded. Chat, streaming, and tool calling are the contract every Studio chat
 * model satisfies and are what the agent loop needs to start; everything else
 * is genuinely undescribed until a catalog record is available.
 */
export const UNDESCRIBED_CAPABILITY: ModelCapability = {
  textGeneration: "supported",
  streaming: "supported",
  reasoning: "unknown",
  toolCalling: "supported",
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

function state(value: boolean | undefined): CapabilityState {
  if (value === undefined) return "unknown";
  return value ? "supported" : "unsupported";
}

function modalityState(
  modalities: readonly string[] | undefined,
  modality: string,
): CapabilityState {
  if (modalities === undefined) return "unknown";
  return modalities.includes(modality) ? "supported" : "unsupported";
}

function limit(value: number | undefined): number | "unknown" {
  return typeof value === "number" && value > 0 ? value : "unknown";
}

/**
 * Normalizes one gateway catalog record into the harness capability contract.
 * A dimension the catalog does not describe stays `"unknown"` rather than
 * being flattened to `"unsupported"`.
 */
export function capabilityFromStudioModel(record: StudioModelRecord): ModelCapability {
  const modalities = record.capabilities?.modalities;
  const chat = record.capabilities?.chat;

  return {
    textGeneration: modalityState(modalities, "chat"),
    streaming: chat === undefined ? "unknown" : state(chat.streaming),
    reasoning: chat === undefined ? "unknown" : state(chat.reasoning?.supported),
    toolCalling: chat === undefined ? "unknown" : state(chat.tools),
    vision: chat === undefined ? "unknown" : state(chat.vision),
    embeddings: modalityState(modalities, "embeddings"),
    reranking: modalityState(modalities, "rerank"),
    imageGeneration: modalityState(modalities, "image.generate"),
    videoGeneration: modalityState(modalities, "video.generate"),
    speechGeneration: modalityState(modalities, "speech"),
    transcription: modalityState(modalities, "transcription"),
    contextWindow: limit(record.contextWindow),
    maxOutputTokens: limit(record.maxTokens),
  };
}

/**
 * Every Studio model is addressed through the single gateway-neutral provider
 * identity, so the gateway's `<provider>:<model>` id becomes the model part of
 * the reference verbatim: the provider prefix is preserved rather than merged
 * away.
 */
export function descriptorFromStudioModel(
  record: StudioModelRecord,
): ModelDescriptor {
  return {
    source: SOURCE,
    provider: DEFAULT_MODEL_PROVIDER,
    model: record.id,
    resolvedModelId: `${DEFAULT_MODEL_PROVIDER}/${record.id}`,
    capability: capabilityFromStudioModel(record),
    operational: true,
  };
}

/**
 * Descriptor for the stable `project-studio/default` alias. Its capabilities
 * come from the catalog entry the alias routes to once that entry is known,
 * and fall back to the documented capability floor before the catalog loads.
 */
export function defaultAliasDescriptor(
  defaultModelRecord: StudioModelRecord | undefined,
): ModelDescriptor {
  return {
    source: SOURCE,
    provider: DEFAULT_MODEL_PROVIDER,
    model: DEFAULT_MODEL_NAME,
    resolvedModelId: `${DEFAULT_MODEL_PROVIDER}/${DEFAULT_MODEL_NAME}`,
    capability:
      defaultModelRecord === undefined
        ? UNDESCRIBED_CAPABILITY
        : capabilityFromStudioModel(defaultModelRecord),
    operational: true,
  };
}
