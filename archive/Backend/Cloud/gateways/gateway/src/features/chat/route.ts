import { Hono } from "hono";
import { requireModel } from "@/domain/catalog/resolveModel";
import { GatewayError } from "@/platform/errors";
import { getProvider } from "@/providers/registry";
import { assertChatRequestAllowed } from "@/domain/models/chatPolicy";
import { assertValidChatBody, normalizeChatRequest } from "./request";
import type { GatewayEnv } from "@/platform/cloudflare/environment";

export const chatRoute = new Hono<{ Bindings: GatewayEnv }>();

chatRoute.post("/", async (c) => {
  const rawBody = await c.req.json();
  assertValidChatBody(rawBody);
  const body = normalizeChatRequest(rawBody);

  const model = requireModel(body.model);
  const provider = getProvider(model.provider);
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
});
