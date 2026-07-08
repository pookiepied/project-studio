import { Hono } from "hono";
import { GatewayError, toErrorResponse } from "../../../core/errors";
import { providers } from "../../../core/registry";
import { assertChatRequestAllowed, assertValidChatBody, normalizeChatRequest } from "../../../core/validation";
import { getServedCatalog } from "../../discovery/catalog";
import type { GatewayEnv } from "../../../system/infrastructure/cloudflare/env";

export const chatRoute = new Hono<{ Bindings: GatewayEnv }>();

chatRoute.post("/", async (c) => {
  try {
    const rawBody = await c.req.json();
    assertValidChatBody(rawBody);
    const body = normalizeChatRequest(rawBody);

    const catalog = await getServedCatalog(c.env);
    const model = catalog.models.find(
      (candidate) => candidate.id === body.model || candidate.providerModelId === body.model
    );
    if (!model) {
      throw new GatewayError("MODEL_NOT_FOUND", `Model ${body.model} is not registered with the gateway.`);
    }

    const provider = providers.find((candidate) => candidate.id === model.provider);
    if (!provider?.chat) {
      throw new GatewayError("CAPABILITY_NOT_SUPPORTED", `Provider ${model.provider} does not support chat.`);
    }

    assertChatRequestAllowed(body, model);
    const response = await provider.chat(
      {
        ...body,
        model: model.providerModelId
      },
      {
      env: c.env,
      request: c.req.raw,
      executionCtx: c.executionCtx
      }
    );

    return response instanceof Response ? response : c.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
});
