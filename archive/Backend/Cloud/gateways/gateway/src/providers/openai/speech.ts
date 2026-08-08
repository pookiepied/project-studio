import { experimental_generateSpeech as generateSpeech } from "ai";
import { mapProviderError } from "@/platform/errors";
import type { SpeechRequest, SpeechResponse } from "@/domain/contracts";
import type { HandlerContext } from "@/providers/types";
import { createOpenAIClient } from "./client";

export async function openaiSpeech(request: SpeechRequest, context: HandlerContext): Promise<SpeechResponse> {
  try {
    const provider = createOpenAIClient(context);
    const outputFormat = request.responseFormat ?? request.response_format ?? "mp3";
    const result = await generateSpeech({
      model: provider.speech(request.model as never),
      text: request.input,
      voice: request.voice,
      outputFormat,
      instructions: request.instructions,
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
