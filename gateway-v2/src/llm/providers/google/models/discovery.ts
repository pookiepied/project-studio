import { getTransport } from "../../../../core/transport";
import type { GatewayEnv } from "../../../../system/infrastructure/cloudflare/env";
import type { GoogleDiscoveredModel } from "./metadata";

interface GoogleModelsResponse {
  models?: GoogleDiscoveredModel[];
}

export async function discoverGoogleModels(context: {
  env: GatewayEnv;
  fetch?: typeof fetch;
}): Promise<GoogleDiscoveredModel[]> {
  const transport = getTransport("google", context.env, context.fetch);
  const response = await transport.fetch(`${transport.baseURL}/models`, {
    headers: transport.headers
  });

  if (!response.ok) {
    throw new Error(`Google model discovery failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as GoogleModelsResponse;
  return body.models ?? [];
}

