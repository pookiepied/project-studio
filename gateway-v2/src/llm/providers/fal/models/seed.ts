import type { ModelInfo } from "../../../../core/capabilities";
import {
  createFalImageModel,
  createFalSpeechModel,
  createFalTranscriptionModel,
  createFalVideoModel
} from "./metadata";

// Fal has no OpenAI-style /models list endpoint, so the catalog is a curated static seed of
// representative models across each capability. Model IDs verified against the @ai-sdk/fal v3
// model-id unions (2026-07-05). Callers may still route any other valid fal-ai/* id — these
// are the discoverable/advertised set.
export const FAL_SEED_MODELS: ModelInfo[] = [
  // Image — text-to-image
  createFalImageModel("fal-ai/flux/dev"),
  createFalImageModel("fal-ai/flux/schnell"),
  createFalImageModel("fal-ai/qwen-image"),
  createFalImageModel("fal-ai/recraft/v3/text-to-image"),
  // Image — editing / image-to-image (ImageEdit-capable)
  createFalImageModel("fal-ai/flux-pro/kontext/max"),
  createFalImageModel("fal-ai/flux/dev/image-to-image"),
  createFalImageModel("fal-ai/flux-lora/inpainting"),
  // Video generation
  createFalVideoModel("luma-ray-2"),
  createFalVideoModel("minimax-video-01"),
  createFalVideoModel("hunyuan-video"),
  // Speech (TTS)
  createFalSpeechModel("fal-ai/minimax/speech-02-hd"),
  // Transcription (STT)
  createFalTranscriptionModel("wizper")
];
