// Which Fal image models accept an input image (i.e. support editing / image-to-image /
// inpainting), as opposed to pure text-to-image generation. Declared per model so the gateway
// advertises Capability.ImageEdit only where Fal actually accepts source `images`.
// Model-id substrings verified against the @ai-sdk/fal v3 FalImageModelId list (2026-07-05).
const EDIT_MARKERS = [
  "image-to-image",
  "inpainting",
  "kontext",
  "redux",
  "differential-diffusion",
  "rf-inversion",
  "eraser",
  "object-removal",
  "background/remove",
  "reimagine",
  "product-shot",
  "tryon",
  "omnigen",
  "/edit",
  "character/remix"
];

export function supportsFalImageEdit(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return EDIT_MARKERS.some((marker) => id.includes(marker));
}
