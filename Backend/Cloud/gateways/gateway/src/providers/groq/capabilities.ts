import { Capability } from "@/domain/models/capabilities";

// Groq's capability set is WIDER than Anthropic's: it serves chat (with per-model tools,
// vision, and reasoning sub-features), plus Whisper speech-to-text and Orpheus text-to-speech.
// Chat sub-features (vision, tools, reasoning, JSON schema) are declared per-model in the central curated registry.
//
// Intentionally NOT declared - Groq does not offer these, so no handler file exists for them
// and the provider simply lacks the capability (mirrors Anthropic's/Google's skipped notes):
//   - Embeddings                      -> Groq offers no embedding models.
//   - Image generate / edit           -> Groq offers no image models.
//   - Rerank                          -> Groq offers no reranker.
//   - Video / audio (music) generation -> not offered.
//   - Credits/balance endpoint        -> Groq exposes no provider balance API.
export const groqCapabilities = [Capability.Chat, Capability.Transcription];
