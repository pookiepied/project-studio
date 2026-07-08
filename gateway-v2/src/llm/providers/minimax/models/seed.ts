import type { ModelInfo } from "../../../../core/capabilities";
import { createMinimaxChatModel } from "./metadata";

// Static catalog of representative MiniMax chat models (global endpoint, 2026-07-06). Kept
// static for now (MiniMax's /models list carries no capability/pricing hints). Callers may
// still route any other valid MiniMax model id.
export const MINIMAX_SEED_MODELS: ModelInfo[] = [
  // Multimodal (vision) — the only MiniMax line with documented image/video input.
  createMinimaxChatModel("MiniMax-M3"),
  // Text-only
  createMinimaxChatModel("MiniMax-M2.7"),
  createMinimaxChatModel("MiniMax-M2.7-highspeed"),
  createMinimaxChatModel("MiniMax-M2.5"),
  createMinimaxChatModel("MiniMax-M2.5-highspeed"),
  createMinimaxChatModel("MiniMax-M2.1"),
  createMinimaxChatModel("MiniMax-M2")
];
