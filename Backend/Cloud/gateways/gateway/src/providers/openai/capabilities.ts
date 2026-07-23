import { Capability } from "@/domain/models/capabilities";

export const openaiCapabilities = [
  Capability.Chat,
  Capability.Embeddings,
  Capability.Transcription,
  Capability.Speech,
  Capability.ImageGenerate,
  Capability.ImageEdit
];
