/**
 * POST /v1/embeddings
 *
 * Multi-provider text embedding endpoint following the OpenAI embedding API shape.
 * Model format: "provider:modelId" (e.g. "openai:text-embedding-3-large").
 *
 * Supported providers (all via @ai-sdk/*):
 *   openai    — text-embedding-3-small, text-embedding-3-large, ada-002
 *   google    — text-embedding-004
 *   mistral   — mistral-embed
 *   cohere    — embed-v4.0, embed-multilingual-v3.0
 *   bedrock   — amazon.titan-embed-text-v2:0, cohere.embed-english-v3
 */

import type { GatewayEnv } from "../env";
import { parseModelId }    from "../utils/modelParser";
import { createErrorResponse } from "../middleware/response";
import { addCORSHeaders }  from "../middleware/cors";
import { logger }          from "../logger";
import { recordUsage }     from "../tracking";
import { isModalityEnabled } from "../utils/providerUtils";

import { createOpenAI }         from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral }        from "@ai-sdk/mistral";
import { createCohere }         from "@ai-sdk/cohere";
import { createAmazonBedrock }  from "@ai-sdk/amazon-bedrock";
import { embed, embedMany }     from "ai";

interface EmbedRequest {
  model:       string;
  input:       string | string[];
  dimensions?: number;
  encoding_format?: "float" | "base64";
}

export async function handleEmbeddings(
  request:    Request,
  env:        GatewayEnv,
  ctx?:       ExecutionContext,
): Promise<Response> {
  const requestStart = Date.now();
  const userId = request.headers.get("x-user-id") ?? undefined;

  let body: EmbedRequest;
  try {
    body = await request.json() as EmbedRequest;
  } catch {
    return addCORSHeaders(createErrorResponse("Invalid JSON body", 400, "invalid_request_error"));
  }

  const { model, input, dimensions } = body;
  if (!model || input == null) {
    return addCORSHeaders(createErrorResponse("'model' and 'input' are required", 400, "invalid_request_error"));
  }

  let provider: string;
  let modelId:  string;
  try {
    const parsed = parseModelId(model);
    provider = parsed.provider;
    modelId  = parsed.modelId;
  } catch {
    return addCORSHeaders(createErrorResponse(
      "Invalid model format — use 'provider:model' (e.g. 'openai:text-embedding-3-large')",
      400, "invalid_request_error",
    ));
  }

  if (!isModalityEnabled(provider, "embedding", env)) {
    return addCORSHeaders(createErrorResponse(
      `Embedding not enabled for provider '${provider}'`,
      400, "invalid_request_error",
    ));
  }

  try {
    const texts  = Array.isArray(input) ? input : [input];
    const result = await embedTexts(provider, modelId, texts, dimensions, env);

    const response: Record<string, unknown> = {
      object: "list",
      model,
      data: result.embeddings.map((embedding, index) => ({
        object: "embedding",
        index,
        embedding,
      })),
      usage: {
        prompt_tokens: result.usage?.tokens ?? texts.join("").length,
        total_tokens:  result.usage?.tokens ?? texts.join("").length,
      },
    };

    recordUsage({
      env, ctx,
      userId,
      provider,
      model,
      capturedUsage: result.usage ? { prompt_tokens: result.usage.tokens, completion_tokens: 0, total_tokens: result.usage.tokens } : null,
      requestStart,
      requestType:   "embedding",
      status:        "success",
    });

    return addCORSHeaders(new Response(JSON.stringify(response), {
      status:  200,
      headers: { "Content-Type": "application/json" },
    }));
  } catch (error) {
    logger.error("Embedding error", { provider, model, error });
    recordUsage({ env, ctx, userId: undefined, provider, model, capturedUsage: null, requestStart, requestType: "embedding", status: "error" });
    const msg = error instanceof Error ? error.message : String(error);
    return addCORSHeaders(createErrorResponse(`Embedding failed: ${msg}`, 500, "api_error"));
  }
}

async function embedTexts(
  provider:   string,
  modelId:    string,
  texts:      string[],
  dimensions: number | undefined,
  env:        GatewayEnv,
): Promise<{ embeddings: number[][]; usage?: { tokens: number } }> {
  switch (provider) {
    case "openai": {
      const p     = createOpenAI({ apiKey: env.OPENAI_API_KEY ?? "" });
      const model = p.textEmbeddingModel(modelId);
      if (texts.length === 1) {
        const r = await embed({ model, value: texts[0] });
        return { embeddings: [r.embedding], usage: r.usage };
      }
      const r = await embedMany({ model, values: texts });
      return { embeddings: r.embeddings, usage: r.usage };
    }

    case "google": {
      const p     = createGoogleGenerativeAI({ apiKey: env.GOOGLE_AI_API_KEY ?? "" });
      const model = p.textEmbeddingModel(modelId);
      if (texts.length === 1) {
        const r = await embed({ model, value: texts[0] });
        return { embeddings: [r.embedding], usage: r.usage };
      }
      const r = await embedMany({ model, values: texts });
      return { embeddings: r.embeddings, usage: r.usage };
    }

    case "mistral": {
      const p     = createMistral({ apiKey: env.MISTRAL_API_KEY ?? "" });
      const model = p.textEmbeddingModel(modelId);
      if (texts.length === 1) {
        const r = await embed({ model, value: texts[0] });
        return { embeddings: [r.embedding], usage: r.usage };
      }
      const r = await embedMany({ model, values: texts });
      return { embeddings: r.embeddings, usage: r.usage };
    }

    case "cohere": {
      const p     = createCohere({ apiKey: env.COHERE_API_KEY ?? "" });
      const model = p.textEmbeddingModel(modelId);
      if (texts.length === 1) {
        const r = await embed({ model, value: texts[0] });
        return { embeddings: [r.embedding], usage: r.usage };
      }
      const r = await embedMany({ model, values: texts });
      return { embeddings: r.embeddings, usage: r.usage };
    }

    case "bedrock": {
      const p = createAmazonBedrock({
        region:          env.AWS_REGION          ?? "us-east-1",
        accessKeyId:     env.AWS_ACCESS_KEY_ID   ?? "",
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY ?? "",
      });
      const model = p.textEmbeddingModel(modelId);
      if (texts.length === 1) {
        const r = await embed({ model, value: texts[0] });
        return { embeddings: [r.embedding], usage: r.usage };
      }
      const r = await embedMany({ model, values: texts });
      return { embeddings: r.embeddings, usage: r.usage };
    }

    default:
      throw new Error(`Embedding not supported for provider '${provider}'. Supported: openai, google, mistral, cohere, bedrock.`);
  }
}
