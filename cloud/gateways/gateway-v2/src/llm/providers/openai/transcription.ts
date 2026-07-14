import { experimental_transcribe as transcribe } from "ai";
import { mapProviderError } from "../../../core/errors";
import type { TranscriptionRequest, TranscriptionResponse } from "../../../core/types";
import type { HandlerContext } from "../../../core/registry";
import { createOpenAIClient } from "./client";

export async function openaiTranscription(
  request: TranscriptionRequest,
  context: HandlerContext
): Promise<TranscriptionResponse> {
  try {
    const provider = createOpenAIClient(context);
    const result = await transcribe({
      model: provider.transcription(request.model as never),
      audio: new Uint8Array(request.audio),
      abortSignal: context.request.signal,
      providerOptions: {
        openai: {
          language: request.language,
          prompt: request.prompt,
          temperature: request.temperature,
          timestampGranularities: request.timestampGranularities
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
