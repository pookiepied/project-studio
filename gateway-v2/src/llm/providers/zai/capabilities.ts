import { Capability } from "../../../core/capabilities";

// Z.AI (GLM) via CF custom provider. Scope for now: text + multimodal (vision) CHAT only.
// Chat sub-features (vision, tools, reasoning, JSON schema) are declared PER MODEL in
// ./models. GLM-5.x's `reasoning_effort` parameter matches the OpenAI convention closely
// enough to wire directly (see ./models/families.ts), unlike Alibaba/MiniMax/Xiaomi's
// structurally different thinking toggles.
//
// Intentionally NOT surfaced: image generation (glm-image), video generation (cogvideox-3),
// embeddings, rerank — Z.AI offers these but they are out of scope for this provider.
export const zaiCapabilities = [Capability.Chat];
