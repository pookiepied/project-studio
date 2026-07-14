import { Env } from "../env";
import { ChatRequest } from "../server/types";
import { createErrorResponse } from "@gateway/middleware/response";
import { getModelSyncService } from "@gateway/services/modelSync";
import { parseModelId } from "@gateway/utils/modelParser";
import { PROVIDER_URLS } from "@gateway/providers";
import { createRouter, Router } from "../server/router";
import type { RouterDecision } from "../server/router";
import { logger } from "../logger";

export interface ParsedRequest {
  body: ChatRequest;
  provider: string;
  modelId: string;
  isLocalProvider: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  modelType: string;
  apiKey: string;
  apiBaseUrl: string;
  autoRouter: Router | null;
  autoRouterDecision: RouterDecision | null;
  reasoningBudget?: number;
}

const LOCAL_PROVIDERS = new Set(["ollama", "lmstudio", "local"]);

export async function parseRequest(
  request: Request,
  env: Env,
): Promise<ParsedRequest | Response> {
  let body: ChatRequest;
  try {
    body = await request.json() as ChatRequest;
  } catch {
    return createErrorResponse("Invalid JSON body.", 400, "invalid_request_error", request);
  }

  if (!body.model) {
    return createErrorResponse("Missing required field: model.", 400, "invalid_request_error", request);
  }

  if (!body.messages || body.messages.length === 0) {
    return createErrorResponse("Missing required field: messages.", 400, "invalid_request_error", request);
  }

  let autoRouter: Router | null = null;
  let autoRouterDecision: RouterDecision | null = null;

  if (body.model === "auto") {
    autoRouter = createRouter(env.MODELS_KV, env.GATEWAY, env);
    autoRouterDecision = await autoRouter.decide({ messages: body.messages });
    body = { ...body, model: autoRouterDecision.model };
  }

  let provider: string;
  let modelId: string;
  try {
    ({ provider, modelId } = parseModelId(body.model));
  } catch {
    return createErrorResponse(
      `Invalid model format: "${body.model}". Expected "provider:model-id".`,
      400,
      "invalid_request_error",
      request,
    );
  }

  const isLocalProvider = LOCAL_PROVIDERS.has(provider);

  // For non-local providers, gateway owns the API key — chat never sends it as BYOK.
  // LOCAL_API_KEY is the only key chat needs to forward (for local/ollama inference).
  const apiKey = provider === "local"
    ? (env.LOCAL_API_KEY ?? "")
    : "";

  const apiBaseUrl = provider === "local"
    ? (env.LOCAL_BASE_URL ?? "")
    : (PROVIDER_URLS[provider] ?? "");

  let supportsTools = true;
  let supportsVision = false;
  let modelType = "chat";

  try {
    const cached = await getModelSyncService().getCachedModels(env);
    if (cached) {
      const found = cached.models.find(m => m.id === body.model);
      if (found) {
        supportsTools  = found.supportsTools  ?? true;
        supportsVision = found.supportsVision ?? false;
        modelType      = found.type ?? "chat";
      }
    }
  } catch (err) {
    logger.warn("parseRequest: could not load model capabilities from cache", { error: String(err) });
  }

  const reasoningBudget = typeof body.reasoning_budget === "number"
    ? body.reasoning_budget
    : undefined;

  return {
    body,
    provider,
    modelId,
    isLocalProvider,
    supportsTools,
    supportsVision,
    modelType,
    apiKey,
    apiBaseUrl,
    autoRouter,
    autoRouterDecision,
    reasoningBudget,
  };
}
