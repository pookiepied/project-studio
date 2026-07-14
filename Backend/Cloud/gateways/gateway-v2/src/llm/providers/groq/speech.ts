import { getTransport } from "../../../core/transport";
import { mapProviderError, GatewayError } from "../../../core/errors";
import type { SpeechRequest, SpeechResponse } from "../../../core/types";
import type { HandlerContext } from "../../../core/registry";

// Groq TTS (Orpheus / Canopy Labs). Unlike STT, @ai-sdk/groq v3 does NOT expose a `.speech()`
// model, so — rather than hack a core contract — TTS goes out as a raw request through the
// SAME Cloudflare AI Gateway transport used everywhere else (BYOK key injected by CF, the
// provider's Bearer Authorization header stripped). Groq's `/audio/speech` endpoint is
// OpenAI-wire-compatible and returns audio bytes, which we pass straight back (no storage).
const AUDIO_MEDIA_TYPES: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  opus: "audio/opus",
  ogg: "audio/ogg"
};

export async function groqSpeech(request: SpeechRequest, context: HandlerContext): Promise<SpeechResponse> {
  try {
    const transport = getTransport("groq", context.env);
    // Orpheus defaults to WAV output.
    const format = (request.responseFormat ?? request.response_format ?? "wav").toLowerCase();

    const response = await transport.fetch(`${transport.baseURL}/audio/speech`, {
      method: "POST",
      headers: {
        ...transport.headers,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: request.model,
        input: request.input,
        voice: request.voice,
        response_format: format,
        speed: request.speed
      }),
      signal: context.request.signal
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new GatewayError(
        "PROVIDER_UNAVAILABLE",
        `Groq speech synthesis failed with HTTP ${response.status}.${detail ? ` ${detail}` : ""}`
      );
    }

    const audio = await response.arrayBuffer();
    return {
      audio,
      mediaType: response.headers.get("content-type") ?? AUDIO_MEDIA_TYPES[format] ?? "audio/wav"
    };
  } catch (error) {
    throw mapProviderError(error);
  }
}
