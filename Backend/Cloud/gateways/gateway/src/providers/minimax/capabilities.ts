import { Capability } from "@/domain/models/capabilities";

// MiniMax via CF custom provider. Scope for now: text + multimodal (vision) CHAT only. Chat
// sub-features (vision, tools, JSON schema) are declared in the central curated registry.
// (MiniMax-M3's `thinking` / `reasoning_split` controls) is intentionally NOT wired yet - it
// is a boolean/structural toggle, not OpenAI-style reasoning_effort, so it is deferred.
//
// Intentionally NOT surfaced: video input/generation, audio (speech), embeddings, rerank -
// MiniMax offers some of these but they are out of scope for this provider.
export const minimaxCapabilities = [Capability.Chat];
