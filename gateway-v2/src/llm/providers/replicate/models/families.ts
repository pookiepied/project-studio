// Which Replicate image models accept an input image (editing / inpainting / fill /
// multi-reference) vs. pure text-to-image. Declared per model so ImageEdit is advertised only
// where Replicate actually consumes source `images`. Substrings verified against the
// @ai-sdk/replicate v3 ReplicateImageModelId list (2026-07-05).
const EDIT_MARKERS = ["flux-fill", "flux-2", "inpaint", "controlnet", "img2img", "/edit", "instruct"];

export function supportsReplicateImageEdit(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return EDIT_MARKERS.some((marker) => id.includes(marker));
}
