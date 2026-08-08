import { generateImage } from "ai";
import { mapProviderError } from "@/platform/errors";
import type { ImageEditRequest, ImageGenerationRequest, MediaResponse } from "@/domain/contracts";
import type { HandlerContext } from "@/providers/types";
import { createGoogleClient } from "./client";

export async function googleImage(
  request: ImageGenerationRequest | ImageEditRequest,
  context: HandlerContext
): Promise<MediaResponse> {
  try {
    const provider = createGoogleClient(context);
    const result = await generateImage({
      model: provider.image(request.model as never),
      prompt: toImagePrompt(request),
      n: request.n,
      size: request.size as `${number}x${number}` | undefined,
      abortSignal: context.request.signal,
      providerOptions: {
        google: {
          imageConfig: {
            aspectRatio: aspectRatioFromSize(request.size),
            imageSize: googleImageSize(request.size)
          }
        }
      }
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

function aspectRatioFromSize(size: string | undefined) {
  if (!size || !size.includes("x")) return undefined;
  const [width, height] = size.split("x").map(Number);
  if (!width || !height) return undefined;
  if (width === height) return "1:1";
  if (width > height) return "16:9";
  return "9:16";
}

function googleImageSize(size: string | undefined) {
  if (!size) return undefined;
  const [width] = size.split("x").map(Number);
  if (width >= 3500) return "4K";
  if (width >= 1500) return "2K";
  if (width >= 900) return "1K";
  return "512";
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
