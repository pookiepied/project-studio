import { generateImage } from "ai";
import { mapProviderError } from "../../../core/errors";
import type { ImageEditRequest, ImageGenerationRequest, MediaResponse } from "../../../core/types";
import type { HandlerContext } from "../../../core/registry";
import { createOpenAIClient } from "./client";

export async function openaiImage(
  request: ImageGenerationRequest | ImageEditRequest,
  context: HandlerContext
): Promise<MediaResponse> {
  try {
    const provider = createOpenAIClient(context);
    const outputFormat = request.outputFormat ?? request.output_format;
    const result = await generateImage({
      model: provider.image(request.model as never),
      prompt: toImagePrompt(request),
      n: request.n,
      size: request.size as `${number}x${number}` | undefined,
      abortSignal: context.request.signal,
      providerOptions: {
        openai: {
          quality: request.quality,
          background: request.background,
          outputFormat,
          outputCompression: request.outputCompression ?? request.output_compression,
          user: request.user,
          inputFidelity: "images" in request ? request.inputFidelity ?? request.input_fidelity : undefined
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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

