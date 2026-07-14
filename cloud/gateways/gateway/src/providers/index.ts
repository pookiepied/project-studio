/**
 * Provider factory — single source of truth for adapter instantiation.
 *
 * All adapters now use @ai-sdk/* packages internally. SSE parsing, HTTP
 * handling, and per-provider streaming quirks are handled by the SDK;
 * only genuine behavioural differences live in adapter subclasses.
 *
 * Active providers:
 *   Official @ai-sdk packages : openai, anthropic, google, groq, xai, deepseek
 *   Custom (OpenAI-compat)    : openrouter, alibaba, minimax, ollama, lmstudio
 *
 * How to add a new provider:
 *   1. If it has an official @ai-sdk package  → add a one-liner class in adapters/generic.ts
 *   2. If it is OpenAI-compatible             → use OpenAICompatAdapter or write a tiny subclass
 *   3. Add the case to createProvider() below
 *   4. Pricing is KV-based (MODELS_KV, synced via modelSync). Cost is read at tracking time via estimateCostUsd().
 */

import type { GatewayEnv } from "../env";
import type { ProviderAdapter } from "./types";

import { GroqAdapter }          from "./adapters/groq";
import { GoogleAdapter }        from "./adapters/google";
import { AnthropicAdapter }     from "./adapters/anthropic";
import { OpenRouterAdapter }    from "./adapters/openrouter";
import { AlibabaAdapter }       from "./adapters/alibaba";
import { MinimaxAdapter }       from "./adapters/minimax";
import { OllamaAdapter }        from "./adapters/ollama";
import { LMStudioAdapter }      from "./adapters/lmstudio";
import { OpenAIAdapter }        from "./adapters/openai";
import { XAIAdapter }           from "./adapters/xai";
import { DeepSeekAdapter }      from "./adapters/deepseek";
import { MistralAdapter }       from "./adapters/mistral";
import { CohereAdapter }        from "./adapters/cohere";
import { BedrockAdapter }       from "./adapters/bedrock";
import { AzureAdapter }         from "./adapters/azure";
import { OpenAICompatAdapter }  from "./adapters/compat";

import { STUDIO_SITE_URL, STUDIO_APP_TITLE } from "../config/constants";
import { buildGatewayUrl, buildGatewayHeaders } from "./gateway";

export type { ProviderAdapter };

// Re-export new base so callers that import BaseAdapter continue to work
export { BaseAdapter } from "./adapters/base";

// Kept for callers in parse.ts, phase2.ts, and specialists that read base URLs
export const PROVIDER_URLS: Record<string, string> = {
  groq:       "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  openai:     "https://api.openai.com/v1",
  anthropic:  "https://api.anthropic.com/v1",
  google:     "https://generativelanguage.googleapis.com/v1beta/openai",
  xai:        "https://api.x.ai/v1",
  alibaba:    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  deepseek:   "https://api.deepseek.com/v1",
  mistral:    "https://api.mistral.ai/v1",
  cohere:     "https://api.cohere.com/v2",
  minimax:    "https://api.minimax.io/v1",
  // Local inference — value is the default port string; createProvider() calls parseInt on it
  ollama:     "11434",
  lmstudio:   "1234",
};

// ---------------------------------------------------------------------------
// API key resolution
// ---------------------------------------------------------------------------

export function getApiKey(env: GatewayEnv, provider: string): string | undefined {
  const keyMap: Record<string, string | undefined> = {
    groq:       env.GROQ_API_KEY,
    openrouter: env.OPENROUTER_API_KEY,
    openai:     env.OPENAI_API_KEY,
    anthropic:  env.ANTHROPIC_API_KEY,
    google:     env.GOOGLE_AI_API_KEY,
    xai:        env.XAI_API_KEY,
    alibaba:    env.ALIBABA_API_KEY,
    deepseek:   env.DEEPSEEK_API_KEY,
    mistral:    env.MISTRAL_API_KEY,
    cohere:     env.COHERE_API_KEY,
    minimax:    env.MINIMAX_API_KEY,
    // Azure: uses AZURE_API_KEY (single key for the resource endpoint)
    azure:      env.AZURE_API_KEY,
    // Bedrock: no single "API key" — uses bearer token or IAM credentials.
    // Return a placeholder so callers treat it as "configured".
    bedrock: (
      env.AWS_BEARER_TOKEN_BEDROCK ||
      (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY ? env.AWS_ACCESS_KEY_ID : undefined)
    ),
  };
  return keyMap[provider];
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

export function createProvider(
  provider: string,
  apiKey:   string,
  baseUrl?: string,
  env?:     GatewayEnv,
): ProviderAdapter {
  // Route through Cloudflare AI Gateway when configured.
  // Returns null for providers not in the gateway's supported list.
  const gatewayUrl = (env?.CF_AI_GATEWAY_ACCOUNT_ID && env?.CF_AI_GATEWAY_NAME)
    ? buildGatewayUrl(provider, env.CF_AI_GATEWAY_ACCOUNT_ID, env.CF_AI_GATEWAY_NAME)
    : null;

  // Auth header for gateways with "Authenticated gateway" enabled.
  // Sent alongside the provider's own Authorization header.
  const gatewayHeaders = gatewayUrl
    ? buildGatewayHeaders(env?.CF_AI_GATEWAY_TOKEN)
    : undefined;

  switch (provider) {
    case "openai":     return new OpenAIAdapter(apiKey,    gatewayUrl ?? undefined, gatewayHeaders);
    case "anthropic":  return new AnthropicAdapter(apiKey, gatewayUrl ?? undefined, gatewayHeaders);
    case "google":     return new GoogleAdapter(apiKey,    gatewayUrl ?? undefined, gatewayHeaders);
    case "groq":       return new GroqAdapter(apiKey,      gatewayUrl ?? undefined, gatewayHeaders);
    case "xai":        return new XAIAdapter(apiKey,       gatewayUrl ?? undefined, gatewayHeaders);
    case "deepseek":   return new DeepSeekAdapter(apiKey,  gatewayUrl ?? undefined, gatewayHeaders);
    case "mistral":    return new MistralAdapter(apiKey,   gatewayUrl ?? undefined, gatewayHeaders);
    case "cohere":     return new CohereAdapter(apiKey);

    case "bedrock": {
      return new BedrockAdapter({
        bearerToken:     env?.AWS_BEARER_TOKEN_BEDROCK,
        region:          env?.AWS_REGION,
        accessKeyId:     env?.AWS_ACCESS_KEY_ID,
        secretAccessKey: env?.AWS_SECRET_ACCESS_KEY,
      });
    }

    case "azure": {
      const resourceName = env?.AZURE_RESOURCE_NAME ?? "";
      const apiVersion   = env?.AZURE_OPENAI_API_VERSION ?? "2025-01-01-preview";
      let deploymentMap: Record<string, string> = {};
      try {
        if (env?.AZURE_DEPLOYMENTS) {
          deploymentMap = JSON.parse(env.AZURE_DEPLOYMENTS);
        }
      } catch {
        // malformed — use empty map, Azure will error on unknown deployment
      }
      return new AzureAdapter(resourceName, apiKey, apiVersion, deploymentMap);
    }

    case "openrouter":
      return new OpenRouterAdapter(
        apiKey,
        gatewayUrl ?? undefined,
        env?.OPENROUTER_SITE_URL ?? STUDIO_SITE_URL,
        STUDIO_APP_TITLE,
        gatewayHeaders,
      );

    case "alibaba":  return new AlibabaAdapter(apiKey);
    case "minimax":  return new MinimaxAdapter(apiKey);

    // Local inference — port extracted from model ID (e.g. "local:ollama:11434:llama3")
    case "ollama": {
      const port = baseUrl ? parseInt(baseUrl, 10) : 11434;
      return new OllamaAdapter(isNaN(port) ? 11434 : port);
    }
    case "lmstudio": {
      const port = baseUrl ? parseInt(baseUrl, 10) : 1234;
      return new LMStudioAdapter(isNaN(port) ? 1234 : port);
    }

    // Fallback: any OpenAI-compatible provider with a base URL
    default:
      if (baseUrl) return new OpenAICompatAdapter(provider, apiKey, baseUrl);
      throw new Error(`[provider] Unknown provider "${provider}" and no baseUrl provided`);
  }
}
