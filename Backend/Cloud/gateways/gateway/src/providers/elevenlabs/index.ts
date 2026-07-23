import type { ProviderModule } from "@/providers/types";
import { elevenlabsCapabilities } from "./capabilities";
import { elevenlabsSpeech } from "./speech";
import { elevenlabsTranscription } from "./transcription";

// ElevenLabs (audio provider): speech (TTS) and transcription (STT) via the official
// @ai-sdk/elevenlabs package over CF AI Gateway.
export const elevenlabsProvider: ProviderModule = {
  id: "elevenlabs",
  capabilities: elevenlabsCapabilities,
  speak: elevenlabsSpeech,
  transcribe: elevenlabsTranscription
};
