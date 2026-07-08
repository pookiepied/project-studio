import { Hono } from "hono";
import { Capability } from "../../../core/capabilities";
import { GatewayError, toErrorResponse } from "../../../core/errors";
import { providers } from "../../../core/registry";
import type { EmbeddingsRequest } from "../../../core/types";
import type { GatewayEnv } from "../../../system/infrastructure/cloudflare/env";
import { getServedCatalog } from "../../discovery/catalog";

export const embeddingsRoute = new Hono<{ Bindings: GatewayEnv }>();

embeddingsRoute.post("/", async (c) => {
  try {
    const body = (await c.req.json()) as Partial<EmbeddingsRequest>;
    if (!body.model || typeof body.model !== "string") {
      throw new GatewayError("VALIDATION_ERROR", "Request body must include a model string.");
    }
    if (typeof body.input !== "string" && !Array.isArray(body.input)) {
      throw new GatewayError("VALIDATION_ERROR", "Request body must include input as a string or string array.");
    }

    const catalog = await getServedCatalog(c.env);
    const model = catalog.models.find(
      (candidate) => candidate.id === body.model || candidate.providerModelId === body.model
    );
    if (!model) {
      throw new GatewayError("MODEL_NOT_FOUND", `Model ${body.model} is not registered with the gateway.`);
    }
    if (!model.capabilities.modalities.includes(Capability.Embeddings)) {
      throw new GatewayError("CAPABILITY_NOT_SUPPORTED", `Model ${model.id} does not support embeddings.`);
    }

    const provider = providers.find((candidate) => candidate.id === model.provider);
    if (!provider?.embed) {
      throw new GatewayError("CAPABILITY_NOT_SUPPORTED", `Provider ${model.provider} does not support embeddings.`);
    }

    const response = await provider.embed(
      {
        ...body,
        model: model.providerModelId,
        input: body.input
      },
      {
        env: c.env,
        request: c.req.raw,
        executionCtx: c.executionCtx
      }
    );

    return c.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
});
