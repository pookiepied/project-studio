import type { ModelInfo } from "../../../../core/capabilities";
import type { OpenRouterApiModel } from "./discovery";
import { createOpenRouterModelFromApi } from "./metadata";

// Static fallback used only when live discovery cannot run (no env / no CF creds, e.g. tests)
// or returns empty. A small representative set of text + multimodal chat slugs verified on
// OpenRouter (2026-07-06). Pricing is intentionally absent here → reported as unknown/null
// (honest); live discovery fills in real per-token pricing. Callers may still route any other
// valid OpenRouter slug — these are just the offline-advertised set.
const OPENROUTER_SEED_API_MODELS: OpenRouterApiModel[] = [
  {
    id: "openai/gpt-4o",
    name: "OpenAI: GPT-4o",
    context_length: 128_000,
    architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
    supported_parameters: ["tools", "tool_choice", "structured_outputs", "response_format"]
  },
  {
    id: "anthropic/claude-3.7-sonnet",
    name: "Anthropic: Claude 3.7 Sonnet",
    context_length: 200_000,
    architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
    supported_parameters: ["tools", "tool_choice", "reasoning"]
  },
  {
    id: "google/gemini-2.0-flash-001",
    name: "Google: Gemini 2.0 Flash",
    context_length: 1_000_000,
    architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
    supported_parameters: ["tools", "tool_choice", "structured_outputs"]
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    name: "Meta: Llama 3.3 70B Instruct",
    context_length: 131_072,
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    supported_parameters: ["tools", "tool_choice"]
  },
  {
    id: "deepseek/deepseek-r1",
    name: "DeepSeek: R1",
    context_length: 128_000,
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    supported_parameters: ["reasoning", "include_reasoning"]
  }
];

export const OPENROUTER_SEED_MODELS: ModelInfo[] = OPENROUTER_SEED_API_MODELS.map(
  createOpenRouterModelFromApi
).filter((model): model is ModelInfo => Boolean(model));
