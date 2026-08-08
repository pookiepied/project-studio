import { Hono } from "hono";
import type { Context } from "hono";
import { requireModel } from "@/domain/catalog/resolveModel";
import type { ImageEditRequest, ImageGenerationRequest } from "@/domain/contracts";
import { Capability } from "@/domain/models/capabilities";
import type { GatewayEnv } from "@/platform/cloudflare/environment";
import { GatewayError } from "@/platform/errors";
import { getProvider } from "@/providers/registry";
import { parseImageEditRequest, parseImageGenerationRequest } from "./request";
import { toImageResponse } from "./response";

export const imagesRoute = new Hono<{ Bindings: GatewayEnv }>();

imagesRoute.post("/generations", handleImageGeneration);
imagesRoute.post("/generate", handleImageGeneration);
imagesRoute.post("/edits", async (c) => {
  const body = await parseImageEditRequest(c.req.raw);
  const response = await callImageProvider(c, body, Capability.ImageEdit);
  return c.json(toImageResponse(response, body.responseFormat ?? body.response_format));
});

async function handleImageGeneration(c: Context<{ Bindings: GatewayEnv }>) {
  const body = await parseImageGenerationRequest(c.req.raw);
  const response = await callImageProvider(c, body, Capability.ImageGenerate);
  return c.json(toImageResponse(response, body.responseFormat ?? body.response_format));
}

async function callImageProvider(
  c: Context<{ Bindings: GatewayEnv }>,
  body: ImageGenerationRequest | ImageEditRequest,
  capability: Capability
) {
  const model = requireModel(body.model, capability);
  const provider = getProvider(model.provider);
  if (!provider?.image) {
    throw new GatewayError("CAPABILITY_NOT_SUPPORTED", `Provider ${model.provider} does not support images.`);
  }
  return provider.image(
    { ...body, model: model.providerModelId },
    { env: c.env, request: c.req.raw, executionCtx: c.executionCtx }
  );
}
