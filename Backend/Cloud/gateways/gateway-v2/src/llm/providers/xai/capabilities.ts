import { Capability } from "../../../core/capabilities";

// xAI (Grok) is OpenAI-wire-compatible. Chat sub-features (vision, tools, reasoning,
// JSON schema, streaming) are declared in the central curated registry.
// capabilities. xAI's current chat lineup is multimodal (vision) + tool-calling, with
// reasoning on the -reasoning / grok-4.3 / multi-agent / grok-3-mini variants.
//
// Intentionally NOT declared — xAI does not expose these through a normalized gateway
// capability (mirrors Anthropic's/Google's/Groq's skipped-capability notes):
//   - Image generate / edit           → xAI ships Grok Imagine (grok-imagine-image*), but
//                                        image generation was explicitly excluded from
//                                        this provider's scope (see report). No image.ts.
//   - Embeddings                      → xAI offers no embedding models.
//   - Transcription (STT) / Speech (TTS) → xAI Voice API exists but STT/TTS are out of
//                                        scope for this provider (chat-only mirroring the
//                                        focused capability set).
//   - Rerank                          → xAI offers no reranker.
//   - Video / audio (music) generation → offered (Grok Imagine Video / Voice) but out of scope.
//   - Credits/balance endpoint        → xAI exposes no provider balance API.
//   - Live Search / web grounding     → a server-side agentic tool (Responses API
//                                        web_search / x_search), not a normalized modality;
//                                        out of scope (treated like Groq's compound built-ins).
export const xaiCapabilities = [Capability.Chat];
