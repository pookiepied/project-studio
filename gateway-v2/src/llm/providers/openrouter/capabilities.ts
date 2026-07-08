import { Capability } from "../../../core/capabilities";

// OpenRouter is an aggregator exposing 400+ models across every modality. By deliberate scope
// (per project decision) the gateway surfaces ONLY its text + multimodal (vision) CHAT models,
// plus its credits/balance endpoint. Chat sub-features (vision, tools, JSON schema, reasoning)
// are declared PER MODEL in ./models from OpenRouter's live /models metadata, never blanket.
//
// Intentionally NOT surfaced right now (OpenRouter offers them, but they are out of scope):
//   - Image generate / edit   → OpenRouter image models are excluded in discovery.
//   - Video generation        → excluded in discovery.
//   - Audio (TTS/STT)         → excluded in discovery.
//   - Embeddings              → OpenRouter has a separate embeddings surface; excluded.
//   - Rerank                  → not offered.
//
// Credits IS surfaced: unlike most providers, OpenRouter exposes a real balance endpoint
// (GET /credits → total_credits / total_usage), which powers the credits handler.
export const openrouterCapabilities = [Capability.Chat, Capability.Credits];
