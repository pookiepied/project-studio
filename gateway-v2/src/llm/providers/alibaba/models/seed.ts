import type { ModelInfo } from "../../../../core/capabilities";
import { createAlibabaChatModel } from "./metadata";

// Static catalog of representative Qwen chat models on Alibaba Model Studio (international /
// Singapore, 2026-07-06). Kept static for now (DashScope's /models list is noisy and carries
// no capability/pricing hints). Callers may still route any other valid DashScope model id.
export const ALIBABA_SEED_MODELS: ModelInfo[] = [
  // Text
  createAlibabaChatModel("qwen-max"),
  createAlibabaChatModel("qwen-plus"),
  createAlibabaChatModel("qwen-turbo"),
  // Multimodal (vision)
  createAlibabaChatModel("qwen-vl-max"),
  createAlibabaChatModel("qwen-vl-plus")
];
