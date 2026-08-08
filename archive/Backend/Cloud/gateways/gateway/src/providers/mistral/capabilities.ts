import { Capability } from "@/domain/models/capabilities";

// Mistral curated scope: direct chat only. Per-model chat sub-features live in the central
// curated registry.
//
// Intentionally NOT declared - Mistral does not expose these as normalized gateway
// capabilities via the official @ai-sdk/mistral package:
//   - Transcription (STT) / Speech (TTS) -> the AI SDK Mistral provider has no audio models.
//   - Image / video generation           -> Mistral offers no image/video models here.
//   - Rerank                             -> no reranker in @ai-sdk/mistral.
//   - Credits/balance endpoint           -> Mistral exposes no provider balance API.
export const mistralCapabilities = [Capability.Chat];
