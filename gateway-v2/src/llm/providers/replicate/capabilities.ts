import { Capability } from "../../../core/capabilities";

// Replicate is a media provider (no chat). The official @ai-sdk/replicate package exposes
// image (generation + editing/inpainting) and video generation. Which capability a given
// model has is declared PER MODEL in ./models.
//
// Intentionally NOT declared — the @ai-sdk/replicate package has no speech / transcription /
// chat / embeddings / credits model factories, so those are not gateway capabilities here.
export const replicateCapabilities = [Capability.ImageGenerate, Capability.ImageEdit, Capability.VideoGenerate];
