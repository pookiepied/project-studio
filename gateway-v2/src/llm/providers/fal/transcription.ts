import { experimental_transcribe as transcribe } from "ai";
import { mapProviderError } from "../../../core/errors";
import type { TranscriptionRequest, TranscriptionResponse } from "../../../core/types";
import type { HandlerContext } from "../../../core/registry";
import { createFalClient } from "./client";

export async function falTranscription(
  request: TranscriptionRequest,
  context: HandlerContext
): Promise<TranscriptionResponse> {
  try {
    const provider = createFalClient(context);
    const result = await transcribe({
      model: provider.transcription(request.model as never),
      audio: new Uint8Array(request.audio),
      abortSignal: context.request.signal
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
