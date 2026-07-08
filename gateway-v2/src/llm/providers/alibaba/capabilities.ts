import { Capability } from "../../../core/capabilities";

// Alibaba Model Studio (DashScope) via CF custom provider. Scope for now: text + multimodal
// (vision) CHAT only. Chat sub-features (vision, tools, JSON schema) are declared PER MODEL in
// ./models. Reasoning (Qwen "thinking" / QwQ) is intentionally NOT wired yet — DashScope uses
// an `enable_thinking` control rather than OpenAI-style reasoning_effort, so it is deferred.
//
// Intentionally NOT surfaced: image (wanx), video, audio (ASR/TTS), embeddings, rerank —
// DashScope offers them but they are out of scope for this provider.
export const alibabaCapabilities = [Capability.Chat];
