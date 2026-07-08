import type { ModelPricing } from "../../../../core/capabilities";

// ElevenLabs bills by characters (TTS) and audio minutes (STT), not tokens, and exposes no
// machine-readable per-model price list — so pricing is reported as unknown rather than
// invented (GATEWAY_GUIDE §6 "pricing honesty").
export const UNKNOWN_ELEVENLABS_PRICE: ModelPricing = {
  inputPerMillionUsd: null,
  outputPerMillionUsd: null,
  source: "unknown",
  note: "ElevenLabs bills per-character (TTS) / per-minute (STT); not a token-priced model."
};

export function getElevenLabsModelPricing(): ModelPricing {
  return UNKNOWN_ELEVENLABS_PRICE;
}
