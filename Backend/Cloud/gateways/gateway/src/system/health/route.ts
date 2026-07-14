import { Hono } from "hono";
import { providers } from "../../core/registry";
import type { GatewayEnv } from "../infrastructure/cloudflare/env";

const startedAt = Date.now();

export const healthRoute = new Hono<{ Bindings: GatewayEnv }>();

healthRoute.get("/", (c) =>
  c.json({
    ok: true,
    version: "0.1.0",
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    providers: providers.map((provider) => ({
      id: provider.id,
      capabilities: provider.capabilities
    })),
    cfAiGateway: {
      configured: Boolean(c.env.CF_ACCOUNT_ID && c.env.CF_AIG_TOKEN),
      gateway: c.env.CF_AIG_GATEWAY_NAME || "studio-gateway",
      byokAlias: c.env.CF_AIG_BYOK_ALIAS || "production"
    }
  })
);
