import { getTransport } from "../../../../core/transport";
import type { GatewayEnv } from "../../../../system/infrastructure/cloudflare/env";

// OpenRouter exposes a rich, live models endpoint (unlike Fal/Replicate). Each entry carries
// real pricing (per-token USD strings), context window, input/output modalities and a
// supported_parameters list — enough to build accurate ModelInfo without a static price table.
//
// Confirmed endpoints (as of 2026-07-06):
//   - Native:              https://openrouter.ai/api/v1/models
//   - Through CF Gateway:  https://gateway.ai.cloudflare.com/v1/{acct}/{gw}/openrouter/models
export interface OpenRouterApiModel {
  id: string;
  name?: string;
  created?: number;
  context_length?: number;
  max_completion_tokens?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
    image?: string;
    request?: string;
  };
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    modality?: string;
  };
  supported_parameters?: string[];
}

interface OpenRouterModelsResponse {
  data?: OpenRouterApiModel[];
}

export async function discoverOpenRouterModels(context: {
  env: GatewayEnv;
  fetch?: typeof fetch;
}): Promise<OpenRouterApiModel[]> {
  const transport = getTransport("openrouter", context.env, context.fetch);
  const response = await transport.fetch(`${transport.baseURL}/models`, {
    headers: transport.headers
  });

  if (!response.ok) {
    throw new Error(`OpenRouter model discovery failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as OpenRouterModelsResponse;
  return body.data ?? [];
}
