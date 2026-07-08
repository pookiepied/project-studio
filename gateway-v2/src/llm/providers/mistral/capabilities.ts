import { Capability } from "../../../core/capabilities";

// Mistral is OpenAI-wire-compatible. Chat sub-features (vision on Pixtral / recent
// medium+small, tools, reasoning on Magistral, JSON schema, streaming) are declared PER
// MODEL in ./models, not as separate capabilities.
//
// Intentionally NOT declared — Mistral does not expose these as normalized gateway
// capabilities via the official @ai-sdk/mistral package:
//   - Transcription (STT) / Speech (TTS) → the AI SDK Mistral provider has no audio models.
//   - Image / video generation           → Mistral offers no image/video models here.
//   - Rerank                             → no reranker in @ai-sdk/mistral.
//   - Credits/balance endpoint           → Mistral exposes no provider balance API.
export const mistralCapabilities = [Capability.Chat, Capability.Embeddings];
