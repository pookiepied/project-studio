import { experimental_transcribe as transcribe } from "ai";
import { mapProviderError } from "@/platform/errors";
import type { TranscriptionRequest, TranscriptionResponse } from "@/domain/contracts";
import type { HandlerContext } from "@/providers/types";
import { createElevenLabsClient } from "./client";

export async function elevenlabsTranscription(
  request: TranscriptionRequest,
  context: HandlerContext
): Promise<TranscriptionResponse> {
  try {
    const provider = createElevenLabsClient(context);
    const result = await transcribe({
      model: provider.transcription(request.model as never),
      audio: new Uint8Array(request.audio),
      abortSignal: context.request.signal,
      providerOptions: {
        elevenlabs: {
          languageCode: request.language
        }
      }
    });

    return {
      text: result.text,
      language: result.language,
      duration: result.durationInSeconds,
      segments: result.segments
    };
  } catch (error) {
    throw mapProviderError(error);
  }
}
