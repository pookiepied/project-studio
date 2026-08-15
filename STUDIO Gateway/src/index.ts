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
import { videosRoute } from "./routes/v1/videos.ts";
import { documentsRoute } from "./routes/v1/documents.ts";
import { adminProvidersRoute } from "./routes/admin/providers.ts";
import { adminCredentialsRoute } from "./routes/admin/credentials.ts";
import { adminKeysRoute } from "./routes/admin/keys.ts";
import { adminModelsRoute } from "./routes/admin/models.ts";
import { adminAnalyticsRoute } from "./routes/admin/analytics.ts";
import { errorHandler } from "./middleware/errorHandler.ts";
import { runDiscovery } from "./catalog/discovery.ts";
import { requireAdmin } from "./middleware/auth.ts";
import { finalizeRequestTelemetry, getRequestTelemetry, startRequestTelemetry } from "./observability/request.ts";

export interface Env {
  DB: D1Database;
  CREDENTIAL_ENCRYPTION_KEY?: string;
  ADMIN_TOKEN?: string;
  ENVIRONMENT?: string;
  GATEWAY_BASE_URL?: string;
  UI_ORIGIN?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  const origin = c.req.header("Origin");
  const allowedOrigin = c.env.UI_ORIGIN ?? (c.env.ENVIRONMENT === "development" ? origin ?? "*" : undefined);
  if (allowedOrigin) {
    c.header("Access-Control-Allow-Origin", allowedOrigin);
    c.header("Access-Control-Allow-Headers", "authorization, content-type, x-admin-token, x-gateway-application");
    c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
    c.header("Access-Control-Expose-Headers", "X-Request-ID, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset");
    c.header("Vary", "Origin");
  }
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  return next();
});

app.use("/v1/*", async (c, next) => {
  const state = startRequestTelemetry(c as never);
  if (c.req.method === "POST") {
    try {
      const body = await c.req.raw.clone().json() as Record<string, unknown>;
      state.modelId = typeof body.model === "string" ? body.model : undefined;
      state.stream = body.stream === true;
      state.reasoningUsed = Boolean(body.reasoning || body.reasoning_effort || body.thinking);
    } catch {
      // Multipart and malformed bodies are handled by their route.
    }
  }
  try {
    await next();
  } catch (error) {
    state.statusCode = error instanceof Error && "status" in error ? Number((error as Error & { status?: number }).status) : 500;
    state.errorMessage = error instanceof Error ? error.message : "Request failed";
    state.errorCode = error instanceof Error && "code" in error ? String((error as Error & { code?: string }).code ?? "INTERNAL_ERROR") : "INTERNAL_ERROR";
    throw error;
  } finally {
    const response = c.res.clone();
    const task = finalizeRequestTelemetry(c.env.DB, state, response);
    try { c.executionCtx.waitUntil(task); } catch { void task; }
  }
});

// System
app.route("/", healthRoute);

// v1 OpenAI-compatible (unified URL: Gateway.example.com/v1)
app.route("/v1", modelsRoute);
app.route("/v1", chatRoute);
app.route("/v1", responsesRoute);
app.route("/v1", imagesRoute);
app.route("/v1", audioRoute);
app.route("/v1", embeddingsRoute);
app.route("/v1", videosRoute);
app.route("/v1", documentsRoute);

// Admin (no UI yet, curl-able, x-admin-token if ADMIN_TOKEN set)
app.route("/admin", adminProvidersRoute);
app.route("/admin", adminCredentialsRoute);
app.route("/admin", adminKeysRoute);
app.route("/admin", adminModelsRoute);
app.route("/admin", adminAnalyticsRoute);

// Discovery trigger (admin) — live mode (credential'd providers)
app.post("/admin/discovery/run", async (c) => {
  requireAdmin(c as never);
  const result = await runDiscovery(c.env.DB, c.env);
  return c.json(result);
});

app.post("/admin/providers/:id/sync", async (c) => {
  requireAdmin(c as never);
  const result = await runDiscovery(c.env.DB, c.env, c.req.param("id"));
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
app.onError((err, c) => {
  const response = errorHandler(err as Error, c as never);
  const state = getRequestTelemetry(c as never);
  if (state) response.headers.set("X-Request-ID", state.requestId);
  return response;
});

// Cron every 6h
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === "0 3 * * *") {
      const { syncCatalog } = await import("./catalog/sync.ts");
      ctx.waitUntil(syncCatalog(env.DB).catch((error) => console.error("catalog cron failed", error)));
      return;
    }
    ctx.waitUntil(runDiscovery(env.DB, env).catch((error) => console.error("discovery cron failed", error)));
  },
};
