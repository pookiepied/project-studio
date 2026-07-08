import type { ModelInfo } from "../../../../core/capabilities";
import { createGroqChatModel, createGroqSpeechModel, createGroqTranscriptionModel } from "./metadata";

// Curated Groq lineup, as of 2026-07-05. Groq's OpenAI-compatible /models endpoint IS wired
// for live discovery (see ./discovery.ts); this seed is the fallback when discovery is
// unavailable and the reviewed source of truth for pricing/capabilities.
//
// Verified against https://console.groq.com/docs/models and https://groq.com/pricing.
//
// Safety/guard models (meta-llama/llama-guard-4-12b, meta-llama/llama-prompt-guard-2-*,
// llama-guard-3-8b, openai/gpt-oss-safeguard-20b) are DELIBERATELY EXCLUDED — they are
// internal moderation models, not user-facing chat models (see ./families isGroqGuardModel).
export const GROQ_SEED_MODELS: ModelInfo[] = [
  // ── Chat / text ─────────────────────────────────────────────────────────────
  createGroqChatModel("llama-3.1-8b-instant"),
  createGroqChatModel("llama-3.3-70b-versatile"),
  // Vision-capable multimodal Llama 4 (image input).
  createGroqChatModel("meta-llama/llama-4-scout-17b-16e-instruct"),
  // GPT-OSS reasoning models. gpt-oss-120b additionally has NO parallel tool calls
  // (enforced in ../chat.ts via providerOptions.groq.parallelToolCalls=false).
  createGroqChatModel("openai/gpt-oss-120b"),
  createGroqChatModel("openai/gpt-oss-20b"),
  // Qwen3 reasoning model (on/off reasoning_effort).
  createGroqChatModel("qwen/qwen3-32b"),
  // Agentic system with built-in web-search/code-execution tools.
  createGroqChatModel("groq/compound"),

  // ── Speech-to-text (Whisper) ─────────────────────────────────────────────────
  createGroqTranscriptionModel("whisper-large-v3"),
  createGroqTranscriptionModel("whisper-large-v3-turbo"),

  // ── Text-to-speech (Orpheus / Canopy Labs) ───────────────────────────────────
  createGroqSpeechModel("canopylabs/orpheus-v1-english"),
  createGroqSpeechModel("canopylabs/orpheus-arabic-saudi")
];
