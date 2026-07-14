import { Capability } from "../../../core/capabilities";

// DeepSeek is OpenAI-wire-compatible. Chat sub-features (vision, tools, reasoning, JSON
// schema, streaming) are declared in the central curated registry.
// The current DeepSeek V4 lineup supports tools + reasoning (thinking mode) + JSON
// output; it is text-only (no vision).
//
// Intentionally NOT declared — DeepSeek does not expose these as normalized gateway
// capabilities (mirrors xAI's/Groq's skipped-capability notes):
//   - Image generate / edit           → DeepSeek offers no image models.
//   - Embeddings                      → DeepSeek offers no embedding models.
//   - Transcription (STT) / Speech (TTS) → DeepSeek offers no audio models.
//   - Rerank                          → DeepSeek offers no reranker.
//   - Video / audio (music) generation → not offered.
//   - Credits/balance endpoint        → DeepSeek exposes no provider balance API.
export const deepseekCapabilities = [Capability.Chat];
