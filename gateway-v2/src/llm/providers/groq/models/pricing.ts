import type { ModelPricing } from "../../../../core/capabilities";

// USD per 1,000,000 tokens for CHAT models. As of 2026-07-05.
// Source: https://groq.com/pricing (and https://console.groq.com/docs/models). Groq's
// /openai/v1/models endpoint does NOT return pricing, so chat prices are maintained as
// clearly-marked static constants and must be re-verified during pricing reviews.
const STATIC_PRICING_NOTE = "Static Groq pricing (per 1M tokens) as of 2026-07-05; verify during pricing reviews.";

export const UNKNOWN_GROQ_PRICE: ModelPricing = {
  inputPerMillionUsd: null,
  outputPerMillionUsd: null,
  source: "unknown",
  note: "Groq /models does not include pricing; no reviewed static price for this model."
};

// NOTE (flagged for review): the ModelPricing contract expresses price as per-1M-tokens
// (input/output). Groq's Whisper STT is billed per-hour-transcribed and Orpheus TTS is
// billed per-1M-characters — units the token-based ModelPricing shape cannot represent.
// Rather than hack the core contract, these carry null token prices with the real unit
// price stated in `note`, so the number is never misrepresented as per-token.
export const WHISPER_LARGE_V3_PRICE: ModelPricing = audioPrice("Whisper Large v3 STT: $0.111 per hour of audio transcribed (as of 2026-07-05).");
export const WHISPER_LARGE_V3_TURBO_PRICE: ModelPricing = audioPrice("Whisper Large v3 Turbo STT: $0.04 per hour of audio transcribed (as of 2026-07-05).");
export const ORPHEUS_ENGLISH_PRICE: ModelPricing = audioPrice("Orpheus English TTS: $22.00 per 1M characters (as of 2026-07-05).");
export const ORPHEUS_ARABIC_PRICE: ModelPricing = audioPrice("Orpheus Arabic (Saudi) TTS: $40.00 per 1M characters (as of 2026-07-05).");

const STATIC_PRICING: Record<string, ModelPricing> = {
  "llama-3.1-8b-instant": staticPrice(0.05, 0.08),
  "llama-3.3-70b-versatile": staticPrice(0.59, 0.79),
  "meta-llama/llama-4-scout-17b-16e-instruct": staticPrice(0.11, 0.34),
  "openai/gpt-oss-120b": staticPrice(0.15, 0.6),
  "openai/gpt-oss-20b": staticPrice(0.075, 0.3),
  "qwen/qwen3-32b": staticPrice(0.29, 0.59),
  "qwen/qwen3.6-27b": staticPrice(0.6, 3),
  // Audio models — token fields null; real per-hour / per-char price lives in the note.
  "whisper-large-v3": WHISPER_LARGE_V3_PRICE,
  "whisper-large-v3-turbo": WHISPER_LARGE_V3_TURBO_PRICE,
  "canopylabs/orpheus-v1-english": ORPHEUS_ENGLISH_PRICE,
  "canopylabs/orpheus-arabic-saudi": ORPHEUS_ARABIC_PRICE
};

function staticPrice(inputPerMillionUsd: number, outputPerMillionUsd: number): ModelPricing {
  return { inputPerMillionUsd, outputPerMillionUsd, source: "static", note: STATIC_PRICING_NOTE };
}

function audioPrice(note: string): ModelPricing {
  return { inputPerMillionUsd: null, outputPerMillionUsd: null, source: "static", note };
}

export function getGroqModelPricing(modelId: string): ModelPricing {
  return STATIC_PRICING[modelId] ?? UNKNOWN_GROQ_PRICE;
}
