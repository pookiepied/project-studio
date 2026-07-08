import type { ModelInfo } from "../../../../core/capabilities";
import { createZaiChatModel } from "./metadata";

// Static catalog of representative Z.AI (GLM) chat models (general API endpoint, 2026-07-06).
// Kept static for now (Z.AI's /models list carries no capability/pricing hints). Callers may
// still route any other valid Z.AI model id.
export const ZAI_SEED_MODELS: ModelInfo[] = [
  // Text (reasoning-capable)
  createZaiChatModel("glm-5.2"),
  createZaiChatModel("glm-5.1"),
  createZaiChatModel("glm-5-turbo"),
  // Lightweight text tier (free/low-cost, no reasoning_effort)
  createZaiChatModel("glm-4.7-flash"),
  // Multimodal (vision)
  createZaiChatModel("glm-5v-turbo")
];
