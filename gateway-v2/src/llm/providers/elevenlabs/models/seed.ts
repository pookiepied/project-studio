import type { ModelInfo } from "../../../../core/capabilities";
import { createElevenLabsSpeechModel, createElevenLabsTranscriptionModel } from "./metadata";

// ElevenLabs' model set is small and stable; the catalog is a curated static seed. Model IDs
// verified against the @ai-sdk/elevenlabs v3 model-id unions (2026-07-05).
export const ELEVENLABS_SEED_MODELS: ModelInfo[] = [
  // Speech (TTS)
  createElevenLabsSpeechModel("eleven_v3"),
  createElevenLabsSpeechModel("eleven_multilingual_v2"),
  createElevenLabsSpeechModel("eleven_flash_v2_5"),
  createElevenLabsSpeechModel("eleven_turbo_v2_5"),
  // Transcription (STT)
  createElevenLabsTranscriptionModel("scribe_v1"),
  createElevenLabsTranscriptionModel("scribe_v2")
];
