import type { ProviderModule } from "../../../core/registry";
import { elevenlabsCapabilities } from "./capabilities";
import { elevenlabsSpeech } from "./speech";
import { elevenlabsTranscription } from "./transcription";
import { listElevenLabsModels } from "./models";

// ElevenLabs (audio provider): speech (TTS) and transcription (STT) via the official
// @ai-sdk/elevenlabs package over CF AI Gateway.
export const elevenlabsProvider: ProviderModule = {
  id: "elevenlabs",
  capabilities: elevenlabsCapabilities,
  models: listElevenLabsModels,
  speak: elevenlabsSpeech,
  transcribe: elevenlabsTranscription
};
