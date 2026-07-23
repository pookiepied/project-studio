import { Hono } from "hono";
import type { Context } from "hono";
import { requireModel } from "@/domain/catalog/resolveModel";
import { Capability } from "@/domain/models/capabilities";
import type { GatewayEnv } from "@/platform/cloudflare/environment";
import { GatewayError } from "@/platform/errors";
import { getProvider } from "@/providers/registry";
import { parseVideoGenerationRequest } from "./request";
import { toVideoResponse } from "./response";

export const videoRoute = new Hono<{ Bindings: GatewayEnv }>();

videoRoute.post("/generations", handleVideoGeneration);
videoRoute.post("/generate", handleVideoGeneration);

async function handleVideoGeneration(c: Context<{ Bindings: GatewayEnv }>) {
  const body = await parseVideoGenerationRequest(c.req.raw);
  const model = requireModel(body.model, Capability.VideoGenerate);
  const provider = getProvider(model.provider);
  if (!provider?.video) {
    throw new GatewayError("CAPABILITY_NOT_SUPPORTED", `Provider ${model.provider} does not support video generation.`);
  }

  const response = await provider.video(
    { ...body, model: model.providerModelId },
    { env: c.env, request: c.req.raw, executionCtx: c.executionCtx }
  );
  return c.json(toVideoResponse(response));
}
