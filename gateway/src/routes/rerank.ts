/**
 * POST /v1/rerank
 *
 * Multi-provider reranking endpoint.
 * Model format: "provider:modelId" (e.g. "cohere:rerank-v3.5").
 *
 * Supported providers:
 *   cohere    — rerank-v3.5 via @ai-sdk/cohere SDK
 *   bedrock   — amazon.rerank-v1:0 via @ai-sdk/amazon-bedrock SDK
 *   openrouter — POST /api/v1/rerank (raw HTTP)
 */

import type { GatewayEnv }      from "../env";
import { parseModelId }         from "../utils/modelParser";
import { createErrorResponse }  from "../middleware/response";
import { addCORSHeaders }       from "../middleware/cors";
import { logger }               from "../logger";
import { recordUsage }          from "../tracking";
import { isModalityEnabled }    from "../utils/providerUtils";

import { createCohere }        from "@ai-sdk/cohere";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { rerank }              from "ai";

import { STUDIO_SITE_URL, STUDIO_APP_TITLE } from "../config/constants";

interface RerankRequest {
  model:             string;
  query:             string;
  documents:         string[];
  top_n?:            number;
  return_documents?: boolean;
}

interface RerankResult {
  index:           number;
  relevance_score: number;
  document?:       string;
}

export async function handleRerank(
  request: Request,
  env:     GatewayEnv,
  ctx?:    ExecutionContext,
): Promise<Response> {
  const requestStart = Date.now();
  const userId = request.headers.get("x-user-id") ?? undefined;
  let body: RerankRequest;
  try {
    body = await request.json() as RerankRequest;
  } catch {
    return addCORSHeaders(createErrorResponse("Invalid JSON body", 400, "invalid_request_error"));
  }

  const { model, query, documents, top_n, return_documents = false } = body;

  if (!model || !query || !Array.isArray(documents) || documents.length === 0) {
    return addCORSHeaders(createErrorResponse(
      "'model', 'query', and non-empty 'documents' are required",
      400, "invalid_request_error",
    ));
  }

  let provider: string;
  let modelId:  string;
  try {
    const parsed = parseModelId(model);
    provider = parsed.provider;
    modelId  = parsed.modelId;
  } catch {
    return addCORSHeaders(createErrorResponse(
      "Invalid model format — use 'provider:model' (e.g. 'cohere:rerank-v3.5')",
      400, "invalid_request_error",
    ));
  }

  if (!isModalityEnabled(provider, "rerank", env)) {
    return addCORSHeaders(createErrorResponse(
      `Reranking not enabled for provider '${provider}'`,
      400, "invalid_request_error",
    ));
  }

  try {
    const results = await rerankDocuments(provider, modelId, query, documents, top_n, env);

    const response = {
      results: return_documents
        ? results.map(r => ({ ...r, document: documents[r.index] }))
        : results,
      model,
      meta: { api_version: { version: "1" } },
    };

    recordUsage({ env, ctx, userId, provider, model, capturedUsage: null, requestStart, requestType: "embedding", status: "success" });
    return addCORSHeaders(new Response(JSON.stringify(response), {
      status:  200,
      headers: { "Content-Type": "application/json" },
    }));
  } catch (error) {
    logger.error("Rerank error", { provider, model, error });
    recordUsage({ env, ctx, userId, provider, model, capturedUsage: null, requestStart, requestType: "embedding", status: "error" });
    const msg = error instanceof Error ? error.message : String(error);
    return addCORSHeaders(createErrorResponse(`Rerank failed: ${msg.slice(0, 200)}`, 500, "api_error"));
  }
}

async function rerankDocuments(
  provider:  string,
  modelId:   string,
  query:     string,
  documents: string[],
  topN:      number | undefined,
  env:       GatewayEnv,
): Promise<RerankResult[]> {
  switch (provider) {
    case "cohere": {
      const c     = createCohere({ apiKey: env.COHERE_API_KEY ?? "" });
      const model = c.reranking(modelId);
      const result = await rerank({
        model,
        documents,
        query,
        ...(topN ? { topN } : {}),
      });
      return result.ranking.map(item => ({
        index:           item.originalIndex,
        relevance_score: item.score,
      }));
    }

    case "bedrock": {
      const p = createAmazonBedrock({
        region:          env.AWS_REGION          ?? "us-east-1",
        accessKeyId:     env.AWS_ACCESS_KEY_ID   ?? "",
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY ?? "",
      });
      const model = p.reranking(modelId);
      const result = await rerank({
        model,
        documents,
        query,
        ...(topN ? { topN } : {}),
      });
      return result.ranking.map(item => ({
        index:           item.originalIndex,
        relevance_score: item.score,
      }));
    }

    case "openrouter": {
      if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not configured");
      const resp = await fetch("https://openrouter.ai/api/v1/rerank", {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer":  env.OPENROUTER_SITE_URL ?? STUDIO_SITE_URL,
          "X-Title":       STUDIO_APP_TITLE,
        },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          model:    modelId,
          query,
          documents,
          ...(topN ? { top_n: topN } : {}),
        }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`OpenRouter rerank error (${resp.status}): ${text.slice(0, 300)}`);
      }
      const data: any = await resp.json();
      return (data.results ?? []).map((r: any) => ({
        index:           r.index,
        relevance_score: r.relevance_score,
      }));
    }

    default:
      throw new Error(`Reranking not supported for provider '${provider}'. Supported: cohere, bedrock, openrouter.`);
  }
}
