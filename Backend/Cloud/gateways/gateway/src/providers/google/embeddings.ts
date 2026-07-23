import { embed, embedMany } from "ai";
import { mapProviderError } from "@/platform/errors";
import type { EmbeddingsRequest, EmbeddingsResponse } from "@/domain/contracts";
import type { HandlerContext } from "@/providers/types";
import { createGoogleClient } from "./client";

export async function googleEmbeddings(
  request: EmbeddingsRequest,
  context: HandlerContext
): Promise<EmbeddingsResponse> {
  try {
    const provider = createGoogleClient(context);
    const model = provider.embedding(request.model as never);

    if (Array.isArray(request.input)) {
      const result = await embedMany({
        model,
        values: request.input,
        abortSignal: context.request.signal,
        providerOptions: {
          google: {
            outputDimensionality: request.dimensions
          }
        }
      });

      return {
        object: "list",
        model: request.model,
        data: result.embeddings.map((embedding, index) => ({
          object: "embedding",
          index,
          embedding
        })),
        usage: toEmbeddingUsage(result.usage)
      };
    }

    const result = await embed({
      model,
      value: request.input,
      abortSignal: context.request.signal,
      providerOptions: {
        google: {
          outputDimensionality: request.dimensions
        }
      }
    });

    return {
      object: "list",
      model: request.model,
      data: [{ object: "embedding", index: 0, embedding: result.embedding }],
      usage: toEmbeddingUsage(result.usage)
    };
  } catch (error) {
    throw mapProviderError(error);
  }
}

function toEmbeddingUsage(usage: { tokens?: number } | undefined) {
  const tokens = usage?.tokens ?? 0;
  return {
    prompt_tokens: tokens,
    total_tokens: tokens
  };
}

