import { Capability, type ModelInfo } from "../../../../core/capabilities";
import { getReplicateModelPricing } from "./pricing";
import { supportsReplicateImageEdit } from "./families";

function baseModel(
  id: string,
  type: NonNullable<ModelInfo["type"]>,
  modalities: Capability[],
  inputTypes: NonNullable<ModelInfo["inputTypes"]>,
  outputTypes: NonNullable<ModelInfo["outputTypes"]>
): ModelInfo {
  return {
    id: providerModelId(id),
    provider: "replicate",
    providerModelId: id,
    displayName: id,
    type,
    capabilities: { modalities },
    pricing: getReplicateModelPricing(),
    inputTypes,
    outputTypes
  };
}

export function createReplicateImageModel(id: string): ModelInfo {
  const supportsEdit = supportsReplicateImageEdit(id);
  return baseModel(
    id,
    "image",
    supportsEdit ? [Capability.ImageGenerate, Capability.ImageEdit] : [Capability.ImageGenerate],
    supportsEdit ? ["text", "image"] : ["text"],
    ["image"]
  );
}

export function createReplicateVideoModel(id: string): ModelInfo {
  return baseModel(id, "video", [Capability.VideoGenerate], ["text", "image"], ["video"]);
}

function providerModelId(id: string): string {
  // Replicate ids are owner/name(:version) and already namespaced; prefix with the provider
  // id for the gateway catalog. A leading "replicate:" is not double-applied.
  return id.startsWith("replicate:") ? id : `replicate:${id}`;
}
