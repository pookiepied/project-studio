import { Capability } from "@/domain/models/capabilities";

// ElevenLabs is an audio provider. The official @ai-sdk/elevenlabs package exposes speech
// (TTS) and transcription (STT). Which model does which is declared in the central curated registry.
//
// Intentionally NOT declared - the @ai-sdk/elevenlabs package has no chat / embeddings /
// image / video / rerank / credits model factories.
export const elevenlabsCapabilities = [Capability.Speech, Capability.Transcription];
