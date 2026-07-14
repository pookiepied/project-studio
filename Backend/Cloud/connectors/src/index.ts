/// <reference types="@cloudflare/workers-types" />

/**
 * Studio Connectors Worker
 *
 * Owns first-party connected app integrations:
 *   - Composio connected apps and action schemas
 *   - per-user, per-application permissions
 *   - encrypted credential payloads for future direct connectors
 *
 * This worker is intended to be private behind service bindings. Public callers
 * should authenticate through API/AI, which injects x-user-id for user routes.
 */

import { Hono } from "hono";
import type { Env } from "./types";
import { connectionRoutes } from "./routes/connections";
import { internalRoutes } from "./routes/internal";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true, service: "connectors" }));
app.route("/", connectionRoutes);
app.route("/", internalRoutes);

export default {
  fetch: app.fetch.bind(app),
};
