import { experimental_generateVideo as generateVideo } from "ai";
import { mapProviderError } from "../../../core/errors";
import type { VideoGenerationRequest, VideoGenerationResponse } from "../../../core/types";
import type { HandlerContext } from "../../../core/registry";
import { createFalClient } from "./client";

// Video generation is distinct from image generation: it uses the AI SDK's
// experimental_generateVideo (which polls Fal's queue internally and returns the finished
// clip bytes), and it supports an optional still `image` input for image-to-video. Output is
// returned pass-through — the gateway never stores it (GATEWAY_GUIDE §2).
export async function falVideo(
  request: VideoGenerationRequest,
  context: HandlerContext
): Promise<VideoGenerationResponse> {
  try {
    const provider = createFalClient(context);
    const result = await generateVideo({
      model: provider.video(request.model as never),
      prompt: toVideoPrompt(request),
      n: request.n,
      aspectRatio: request.aspectRatio ?? request.aspect_ratio,
      resolution: request.resolution as `${number}x${number}` | undefined,
      duration: request.duration,
      fps: request.fps,
      seed: request.seed,
      generateAudio: request.generateAudio ?? request.generate_audio,
      abortSignal: context.request.signal
    } as never);

    const items = result.videos.map((video) => ({
      bytes: toArrayBuffer(video.uint8Array),
      base64: video.base64,
      mediaType: video.mediaType
    }));

    return {
      media: {
        ...items[0],
        items,
        usage: result.providerMetadata
      }
    };
  } catch (error) {
    throw mapProviderError(error);
  }
}

function toVideoPrompt(request: VideoGenerationRequest) {
  if (!request.image) {
    return request.prompt;
  }

  return {
    image: normalizeImageInput(request.image),
    text: request.prompt
  };
}

function normalizeImageInput(image: string): Uint8Array | URL {
  if (/^https?:\/\//i.test(image)) {
    return new URL(image);
  }

  const dataUrlMatch = /^data:[^;,]*;base64,(.+)$/i.exec(image);
  const base64 = dataUrlMatch ? dataUrlMatch[1] : image;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
