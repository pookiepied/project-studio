import { Capability } from "../../../core/capabilities";

// Fal AI is a media provider (no chat). The official @ai-sdk/fal package exposes image
// (generation + editing), video generation, speech (TTS) and transcription (STT). Which
// capability a given model has is declared PER MODEL in ./models (a text-to-image model is
// not an editing model; a video model is neither).
//
// Intentionally NOT declared — the @ai-sdk/fal package has no chat / embeddings / rerank /
// credits model factories, so those are not normalized gateway capabilities for Fal.
export const falCapabilities = [
  Capability.ImageGenerate,
  Capability.ImageEdit,
  Capability.VideoGenerate,
  Capability.Speech,
  Capability.Transcription
];
