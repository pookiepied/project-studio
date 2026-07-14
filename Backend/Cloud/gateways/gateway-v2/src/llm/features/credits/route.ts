import { Hono } from "hono";
import { GatewayError, toErrorResponse } from "../../../core/errors";
import { providers } from "../../../core/registry";
import type { GatewayEnv } from "../../../system/infrastructure/cloudflare/env";

// Exposes provider balance/credit endpoints for the providers that offer one (currently only
// OpenRouter — most providers have no balance API). GET /v1/credits/:provider → CreditsSnapshot.
export const creditsRoute = new Hono<{ Bindings: GatewayEnv }>();

creditsRoute.get("/:provider", async (c) => {
  try {
    const providerId = c.req.param("provider");
    const provider = providers.find((candidate) => candidate.id === providerId);
    if (!provider) {
      throw new GatewayError("VALIDATION_ERROR", `Provider ${providerId} is not registered with the gateway.`);
    }
    if (!provider.credits) {
      throw new GatewayError(
        "CAPABILITY_NOT_SUPPORTED",
        `Provider ${providerId} does not expose a credits/balance endpoint.`
      );
    }

    const snapshot = await provider.credits({
      env: c.env,
      request: c.req.raw,
      executionCtx: c.executionCtx
    });

    return c.json(snapshot);
  } catch (error) {
    return toErrorResponse(error);
  }
});
