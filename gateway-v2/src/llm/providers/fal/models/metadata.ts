import { Capability, type ModelInfo } from "../../../../core/capabilities";
import { getFalModelPricing } from "./pricing";
import { supportsFalImageEdit } from "./families";

function baseModel(
  id: string,
  type: NonNullable<ModelInfo["type"]>,
  modalities: Capability[],
  inputTypes: NonNullable<ModelInfo["inputTypes"]>,
  outputTypes: NonNullable<ModelInfo["outputTypes"]>
): ModelInfo {
  return {
    id: providerModelId(id),
    provider: "fal",
    providerModelId: id,
    displayName: id,
    type,
    capabilities: { modalities },
    pricing: getFalModelPricing(),
    inputTypes,
    outputTypes
  };
}

// An image model advertises ImageEdit as well as ImageGenerate iff it accepts a source image
// (image-to-image / inpainting / Kontext). Edit-capable models take ["text","image"] input.
export function createFalImageModel(id: string): ModelInfo {
  const supportsEdit = supportsFalImageEdit(id);
  return baseModel(
    id,
    "image",
    supportsEdit ? [Capability.ImageGenerate, Capability.ImageEdit] : [Capability.ImageGenerate],
    supportsEdit ? ["text", "image"] : ["text"],
    ["image"]
  );
}

export function createFalVideoModel(id: string): ModelInfo {
  // Video models accept an optional still image (image-to-video), so text + image input.
  return baseModel(id, "video", [Capability.VideoGenerate], ["text", "image"], ["video"]);
}

export function createFalSpeechModel(id: string): ModelInfo {
  return baseModel(id, "tts", [Capability.Speech], ["text"], ["audio"]);
}

export function createFalTranscriptionModel(id: string): ModelInfo {
  return baseModel(id, "audio", [Capability.Transcription], ["audio"], ["text"]);
}

function providerModelId(id: string): string {
  return id.includes(":") ? id : `fal:${id}`;
}
