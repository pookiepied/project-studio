import { Capability, type ModelInfo } from "../../../../core/capabilities";
import { getElevenLabsModelPricing } from "./pricing";

function baseModel(
  id: string,
  type: NonNullable<ModelInfo["type"]>,
  modalities: Capability[],
  inputTypes: NonNullable<ModelInfo["inputTypes"]>,
  outputTypes: NonNullable<ModelInfo["outputTypes"]>
): ModelInfo {
  return {
    id: providerModelId(id),
    provider: "elevenlabs",
    providerModelId: id,
    displayName: id,
    type,
    capabilities: { modalities },
    pricing: getElevenLabsModelPricing(),
    inputTypes,
    outputTypes
  };
}

export function createElevenLabsSpeechModel(id: string): ModelInfo {
  return baseModel(id, "tts", [Capability.Speech], ["text"], ["audio"]);
}

export function createElevenLabsTranscriptionModel(id: string): ModelInfo {
  return baseModel(id, "audio", [Capability.Transcription], ["audio"], ["text"]);
}

function providerModelId(id: string): string {
  return id.includes(":") ? id : `elevenlabs:${id}`;
}
