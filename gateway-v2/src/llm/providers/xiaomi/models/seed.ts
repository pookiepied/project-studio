import type { ModelInfo } from "../../../../core/capabilities";
import { createXiaomiChatModel } from "./metadata";

// Static catalog of representative Xiaomi MiMo chat models (2026-07-06). MiMo-V2 was
// deprecated 2026-06-30 in favor of V2.5, so only the V2.5 line is seeded. Kept static for now
// (MiMo's /models list carries no capability/pricing hints). Callers may still route any
// other valid MiMo model id.
export const XIAOMI_SEED_MODELS: ModelInfo[] = [
  createXiaomiChatModel("mimo-v2.5-pro"),
  createXiaomiChatModel("mimo-v2.5")
];
