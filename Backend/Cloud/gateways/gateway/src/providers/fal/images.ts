import { generateImage } from "ai";
import { mapProviderError } from "@/platform/errors";
import type { ImageEditRequest, ImageGenerationRequest, MediaResponse } from "@/domain/contracts";
import type { HandlerContext } from "@/providers/types";
import { createFalClient } from "./client";

// Handles BOTH image generation and image editing. Editing is "slightly different" only in
// its input: an edit request carries source `images` (and an optional `mask`), which the AI
// SDK forwards to Fal's image-to-image / inpainting / Kontext models as a prompt object.
// The route has already confirmed (via the model's declared modalities) that an editing model
// was selected for an edit request, so this handler stays generation/edit-agnostic.
export async function falImage(
  request: ImageGenerationRequest | ImageEditRequest,
  context: HandlerContext
): Promise<MediaResponse> {
  try {
    const provider = createFalClient(context);
    const result = await generateImage({
      model: provider.image(request.model as never),
      prompt: toImagePrompt(request),
      n: request.n,
      size: request.size as `${number}x${number}` | undefined,
      abortSignal: context.request.signal
    });

    const items = result.images.map((image) => ({
      bytes: toArrayBuffer(image.uint8Array),
      base64: image.base64,
      mediaType: image.mediaType
    }));

    return {
      ...items[0],
      items,
      usage: result.usage
    };
  } catch (error) {
    throw mapProviderError(error);
  }
}

function toImagePrompt(request: ImageGenerationRequest | ImageEditRequest) {
  if (!("images" in request)) {
    return request.prompt;
  }

  return {
    text: request.prompt,
    images: request.images.map((image) => new Uint8Array(image)),
    mask: request.mask ? new Uint8Array(request.mask) : undefined
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
