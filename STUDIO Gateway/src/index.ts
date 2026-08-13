/**
 * Studio Gateway - Cloudflare Workers entry
 * Hono app, D1, encrypted credentials, OpenAI-compatible gateway.
 */

import { Hono } from "hono";
import { healthRoute } from "./routes/system/health.ts";
import { modelsRoute } from "./routes/v1/models.ts";
import { chatRoute } from "./routes/v1/chat.ts";
import { responsesRoute } from "./routes/v1/responses.ts";
import { imagesRoute } from "./routes/v1/images.ts";
import { audioRoute } from "./routes/v1/audio.ts";
import { embeddingsRoute } from "./routes/v1/embeddings.ts";
import { adminProvidersRoute } from "./routes/admin/providers.ts";
import { adminCredentialsRoute } from "./routes/admin/credentials.ts";
import { adminKeysRoute } from "./routes/admin/keys.ts";
import { adminModelsRoute } from "./routes/admin/models.ts";
import { errorHandler } from "./middleware/errorHandler.ts";
import { runDiscovery } from "./services/discovery.ts";
import { requireAdmin } from "./middleware/auth.ts";

export interface Env {
  DB: D1Database;
  CREDENTIAL_ENCRYPTION_KEY?: string;
  ADMIN_TOKEN?: string;
  ENVIRONMENT?: string;
  GATEWAY_BASE_URL?: string;
}

const app = new Hono<{ Bindings: Env }>();

// System
app.route("/", healthRoute);

// v1 OpenAI-compatible (unified URL: Gateway.example.com/v1)
app.route("/v1", modelsRoute);
app.route("/v1", chatRoute);
app.route("/v1", responsesRoute);
app.route("/v1", imagesRoute);
app.route("/v1", audioRoute);
app.route("/v1", embeddingsRoute);

// Admin (no UI yet, curl-able, x-admin-token if ADMIN_TOKEN set)
app.route("/admin", adminProvidersRoute);
app.route("/admin", adminCredentialsRoute);
app.route("/admin", adminKeysRoute);
app.route("/admin", adminModelsRoute);

// Discovery trigger (admin) — live mode (credential'd providers)
app.post("/admin/discovery/run", async (c) => {
  requireAdmin(c as never);
  const result = await runDiscovery(c.env.DB, c.env);
  return c.json(result);
});

// Catalog sync (admin) — first-party models.dev full ingest, gated layers
app.post("/admin/catalog/sync", async (c) => {
  requireAdmin(c as never);
  const { syncCatalog } = await import("./catalog/sync.ts");
  const result = await syncCatalog(c.env.DB);
  return c.json(result);
});

// Global error handler
app.onError((err, c) => errorHandler(err as Error, c as never));

// Cron every 6h
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runDiscovery(env.DB, env));
  },
};
