/**
 * Local-model usage reporting.
 *
 * Local inference (LM Studio / Ollama) runs on the user's machine, so the cloud
 * never sees it. After each local completion we POST a usage record to the
 * backend (/local/chat/save) so local requests appear in the Activity Dashboard
 * alongside cloud usage.
 *
 * Local has no monetary cost — the logical tag is provider="local" (set on the
 * backend) with the engine in `source` and the model name in `model`. Token
 * counts and latency are included when the daemon/Ollama response provides them.
 *
 * Fire-and-forget: never throws, never blocks the chat response.
 */

import { apiClient } from "../../utils/api";
import { logger } from "@/core/logging/logger";
import { extractLocalModelName } from "./daemonService";

export type LocalEngine = "lmstudio" | "ollama" | "local";

/** OpenAI-style usage block returned by LM Studio / Ollama completions. */
export interface LocalUsage {
  prompt_tokens?:     number;
  completion_tokens?: number;
  total_tokens?:      number;
}

/** Derive the engine from a prefixed model id (lmstudio: / ollama: / local:). */
export function engineFromModel(model: string): LocalEngine {
  if (model.startsWith("ollama:"))   return "ollama";
  if (model.startsWith("lmstudio:")) return "lmstudio";
  return "local";
}

/**
 * Report one local completion to the backend telemetry pipeline.
 *
 * @param model     Model id as the user selected it (may carry a prefix).
 * @param startedAt Date.now() captured just before the local request began.
 * @param usage     Usage block from the daemon/Ollama response, if present.
 * @param engine    Explicit engine override (e.g. the Ollama-direct path);
 *                  otherwise derived from the model prefix.
 */
export function reportLocalUsage(opts: {
  model:      string;
  startedAt:  number;
  usage?:     LocalUsage | null;
  engine?:    LocalEngine;
}): void {
  const { model, startedAt, usage, engine } = opts;

  const body = {
    model:        extractLocalModelName(model),
    engine:       engine ?? engineFromModel(model),
    inputTokens:  usage?.prompt_tokens,
    outputTokens: usage?.completion_tokens,
    totalTokens:  usage?.total_tokens,
    latencyMs:    Date.now() - startedAt,
    messages:     [] as unknown[],   // backend requires a messages[]; content is not persisted
  };

  // Fire-and-forget — telemetry must never affect the chat UX.
  void apiClient
    .post("/local/chat/save", body)
    .catch((err) => logger.warn("localUsage", "Failed to report local usage", err));
}
