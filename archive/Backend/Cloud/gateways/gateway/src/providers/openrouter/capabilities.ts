import { Capability } from "@/domain/models/capabilities";

// OpenRouter is an aggregator exposing 400+ models across every modality. By deliberate scope
// (per project decision) the gateway surfaces ONLY its text + multimodal (vision) CHAT models,
// Chat sub-features (vision, tools, JSON schema, reasoning)
// are declared in the central curated registry.
//
// Intentionally NOT surfaced right now (OpenRouter offers them, but they are out of scope):
//   - Image generate / edit   -> OpenRouter image models are excluded from the curated OpenRouter scope.
//   - Video generation        -> excluded from the curated OpenRouter scope.
//   - Audio (TTS/STT)         -> excluded from the curated OpenRouter scope.
//   - Embeddings              -> OpenRouter has a separate embeddings surface; excluded.
//   - Rerank                  -> not offered.
//
export const openrouterCapabilities = [Capability.Chat];
