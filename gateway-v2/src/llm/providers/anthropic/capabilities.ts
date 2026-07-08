import { Capability } from "../../../core/capabilities";

// Anthropic (Claude) is a chat-only provider in this gateway. Chat sub-features
// (vision, tools, reasoning/extended-thinking, prompt caching) are declared
// per-model in ./models, not as separate capabilities.
//
// Intentionally NOT declared — Anthropic does not offer these, so no handler file
// exists for them and the provider simply lacks the capability (mirrors Google's
// skipped-TTS note):
//   - Embeddings      → Anthropic has none (they direct users to Voyage AI, a
//                       different provider — deliberately not added here).
//   - Transcription (STT) / Speech (TTS) → not offered.
//   - Image generate / edit              → not offered.
//   - Rerank, Video, Audio generation    → not offered.
//   - Credits/balance endpoint           → Anthropic exposes no balance API.
export const anthropicCapabilities = [Capability.Chat];
