import { experimental_generateSpeech as generateSpeech } from "ai";
import { mapProviderError } from "@/platform/errors";
import type { SpeechRequest, SpeechResponse } from "@/domain/contracts";
import type { HandlerContext } from "@/providers/types";
import { createElevenLabsClient } from "./client";

export async function elevenlabsSpeech(request: SpeechRequest, context: HandlerContext): Promise<SpeechResponse> {
  try {
    const provider = createElevenLabsClient(context);
    // ElevenLabs voices are library voice IDs (e.g. "21m00Tcm4TlvDq8ikWAM"). The gateway
    // passes the caller's voice through; the audio route supplies a default when omitted.
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
