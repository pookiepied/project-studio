import { Capability } from "@/domain/models/capabilities";

// Z.AI (GLM) via CF custom provider. Scope for now: text + multimodal (vision) CHAT only.
// Chat sub-features (vision, tools, reasoning, JSON schema) are declared in the central curated registry.
// enough to wire directly (see the central curated registry), unlike Alibaba/MiniMax/Xiaomi's
// structurally different thinking toggles.
//
// Intentionally NOT surfaced: image generation (glm-image), video generation (cogvideox-3),
// embeddings, rerank - Z.AI offers these but they are out of scope for this provider.
export const zaiCapabilities = [Capability.Chat];
