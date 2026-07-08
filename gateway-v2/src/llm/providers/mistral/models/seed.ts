import type { ModelInfo } from "../../../../core/capabilities";
import { createMistralChatModel, createMistralEmbeddingModel } from "./metadata";

// Curated seed catalog used when discovery has not run (no env) or the live /v1/models call
// returns nothing. Covers the current Mistral lineup families (verified against the
// @ai-sdk/mistral v4 model list as of 2026-07-05): a flagship large, multimodal medium, small,
// a Magistral reasoning model, a Pixtral vision model, a Ministral edge model, the Codestral
// code model, and the mistral-embed embedding model.
export const MISTRAL_SEED_MODELS: ModelInfo[] = [
  createMistralChatModel("mistral-large-latest"),
  createMistralChatModel("mistral-medium-latest"),
  createMistralChatModel("mistral-small-latest"),
  createMistralChatModel("magistral-medium-latest"),
  createMistralChatModel("pixtral-large-latest"),
  createMistralChatModel("ministral-8b-latest"),
  createMistralChatModel("codestral-latest"),
  createMistralEmbeddingModel("mistral-embed")
];
