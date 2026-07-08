import type { ModelInfo } from "../../../../core/capabilities";
import { createDeepSeekChatModel } from "./metadata";

// Curated seed catalog. The current DeepSeek V4 lineup (verified against
// https://api-docs.deepseek.com/quick_start/pricing as of 2026-07-05) ships two models,
// both with 1M-token context + thinking mode + reasoning_effort support. The legacy
// deepseek-chat / deepseek-reasoner aliases (deprecated 2026/07/24) are retained so
// routing + tests still resolve while DeepSeek's migration completes.
export const DEEPSEEK_SEED_MODELS: ModelInfo[] = [
  createDeepSeekChatModel("deepseek-v4-flash"),
  createDeepSeekChatModel("deepseek-v4-pro"),
  createDeepSeekChatModel("deepseek-chat"),
  createDeepSeekChatModel("deepseek-reasoner")
];
