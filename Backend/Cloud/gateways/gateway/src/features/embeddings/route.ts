import { Hono } from "hono";
import { requireModel } from "@/domain/catalog/resolveModel";
import { Capability } from "@/domain/models/capabilities";
import type { GatewayEnv } from "@/platform/cloudflare/environment";
import { GatewayError } from "@/platform/errors";
import { getProvider } from "@/providers/registry";
import { parseEmbeddingsRequest } from "./request";

export const embeddingsRoute = new Hono<{ Bindings: GatewayEnv }>();

embeddingsRoute.post("/", async (c) => {
  const body = await parseEmbeddingsRequest(c.req.raw);
  const model = requireModel(body.model, Capability.Embeddings);
  const provider = getProvider(model.provider);
  if (!provider?.embed) {
    throw new GatewayError("CAPABILITY_NOT_SUPPORTED", `Provider ${model.provider} does not support embeddings.`);
  }

  const response = await provider.embed(
    { ...body, model: model.providerModelId },
    { env: c.env, request: c.req.raw, executionCtx: c.executionCtx }
  );
  return c.json(response);
});
