import { experimental_generateSpeech as generateSpeech } from "ai";
import { mapProviderError } from "../../../core/errors";
import type { SpeechRequest, SpeechResponse } from "../../../core/types";
import type { HandlerContext } from "../../../core/registry";
import { createFalClient } from "./client";

export async function falSpeech(request: SpeechRequest, context: HandlerContext): Promise<SpeechResponse> {
  try {
    const provider = createFalClient(context);
    const result = await generateSpeech({
      model: provider.speech(request.model as never),
      text: request.input,
      voice: request.voice,
      outputFormat: request.responseFormat ?? request.response_format,
      speed: request.speed,
      language: request.language,
      abortSignal: context.request.signal
    });

    return {
      audio: toArrayBuffer(result.audio.uint8Array),
      mediaType: result.audio.mediaType
    };
  } catch (error) {
    throw mapProviderError(error);
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
