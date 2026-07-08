import type { ModelInfo } from "../../../../core/capabilities";
import { createReplicateImageModel, createReplicateVideoModel } from "./metadata";

// Replicate has no simple /models list of runnable models, so the catalog is a curated static
// seed. Model IDs verified against the @ai-sdk/replicate v3 model-id unions (2026-07-05).
// Callers may still route any other valid owner/name(:version) id.
export const REPLICATE_SEED_MODELS: ModelInfo[] = [
  // Image — text-to-image
  createReplicateImageModel("black-forest-labs/flux-schnell"),
  createReplicateImageModel("black-forest-labs/flux-dev"),
  createReplicateImageModel("stability-ai/stable-diffusion-3.5-large"),
  createReplicateImageModel("recraft-ai/recraft-v3"),
  // Image — editing / inpainting / multi-reference (ImageEdit-capable)
  createReplicateImageModel("black-forest-labs/flux-fill-pro"),
  createReplicateImageModel("black-forest-labs/flux-fill-dev"),
  createReplicateImageModel("black-forest-labs/flux-2-pro"),
  // Video generation
  createReplicateVideoModel("minimax/video-01"),
  createReplicateVideoModel("stability-ai/stable-video-diffusion")
];
