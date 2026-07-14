import { experimental_transcribe as transcribe } from "ai";
import { mapProviderError } from "../../../core/errors";
import type { TranscriptionRequest, TranscriptionResponse } from "../../../core/types";
import type { HandlerContext } from "../../../core/registry";
import { createGroqClient } from "./client";

// Groq Whisper STT. Audio is limited to ~25 minutes per request (Groq docs); requests over
// that are rejected upstream by Groq and surfaced through mapProviderError. Mirrors
// openai/transcription.ts — @ai-sdk/groq exposes `.transcription(modelId)`.
export async function groqTranscription(
  request: TranscriptionRequest,
  context: HandlerContext
): Promise<TranscriptionResponse> {
  try {
    const provider = createGroqClient(context);
    const result = await transcribe({
      model: provider.transcription(request.model as never),
      audio: new Uint8Array(request.audio),
      abortSignal: context.request.signal,
      providerOptions: {
        groq: {
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
