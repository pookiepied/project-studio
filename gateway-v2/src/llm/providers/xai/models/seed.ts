import type { ModelInfo } from "../../../../core/capabilities";
import { createXaiChatModel } from "./metadata";

// Curated seed catalog. The current Grok chat lineup (verified against
// https://docs.x.ai/docs/models as of 2026-07-05) ships four grok-4.x models, all priced
// $1.25 in / $2.50 out per 1M tokens with a 1M-token context window. grok-3-mini is
// retained as the text-only reasoning reference model (legacy but still listed by xAI's
// model capabilities) so capability gating (vision → text-only reject) has a real model
// to exercise — the current priced lineup is uniformly vision-capable.
export const XAI_SEED_MODELS: ModelInfo[] = [
  createXaiChatModel("grok-4.3"),
  createXaiChatModel("grok-4.20-0309-reasoning"),
  createXaiChatModel("grok-4.20-0309-non-reasoning"),
  createXaiChatModel("grok-4.20-multi-agent-0309"),
  createXaiChatModel("grok-3-mini")
];
