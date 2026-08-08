import type { VideoGenerationRequest } from "@/domain/contracts";
import { GatewayError } from "@/platform/errors";

export async function parseVideoGenerationRequest(request: Request): Promise<VideoGenerationRequest> {
  const body = (await request.json()) as Partial<VideoGenerationRequest>;
  if (!body.model || typeof body.model !== "string") {
    throw new GatewayError("VALIDATION_ERROR", "Request body must include a model string.");
  }
  if (body.prompt !== undefined && typeof body.prompt !== "string") {
    throw new GatewayError("VALIDATION_ERROR", "prompt, when provided, must be a string.");
  }
  if (body.image !== undefined && typeof body.image !== "string") {
    throw new GatewayError("VALIDATION_ERROR", "image, when provided, must be a base64, data URL, or HTTP URL string.");
  }
  if (!body.prompt && !body.image) {
    throw new GatewayError("VALIDATION_ERROR", "Request must include a prompt or an image.");
  }
  return { ...body, model: body.model };
}
