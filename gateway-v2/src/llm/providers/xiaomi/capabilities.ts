import { Capability } from "../../../core/capabilities";

// Xiaomi MiMo via CF custom provider. Scope for now: text + multimodal (vision) CHAT only.
// Chat sub-features (vision, tools, JSON schema) are declared PER MODEL in ./models.
// Reasoning (MiMo's `thinking: { type: "enabled" | "disabled" }` control) is intentionally NOT
// wired yet — it is a structural toggle, not OpenAI-style reasoning_effort, so it is deferred.
//
// Intentionally NOT surfaced: audio/video generation, embeddings, rerank — MiMo's omni-modal
// line touches these but they are out of scope for this provider.
export const xiaomiCapabilities = [Capability.Chat];
