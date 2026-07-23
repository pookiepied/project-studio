import type { EmbeddingsRequest } from "@/domain/contracts";
import { GatewayError } from "@/platform/errors";

export async function parseEmbeddingsRequest(request: Request): Promise<EmbeddingsRequest> {
  const body = (await request.json()) as Partial<EmbeddingsRequest>;
  if (!body.model || typeof body.model !== "string") {
    throw new GatewayError("VALIDATION_ERROR", "Request body must include a model string.");
  }
  if (typeof body.input !== "string" && !Array.isArray(body.input)) {
    throw new GatewayError("VALIDATION_ERROR", "Request body must include input as a string or string array.");
  }
  return { ...body, model: body.model, input: body.input };
}
