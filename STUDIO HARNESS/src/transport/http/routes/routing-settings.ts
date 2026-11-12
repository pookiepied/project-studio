import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ADMISSION_SCOPES } from "../../../admission/scopes.js";
import { WalkingRouteError, type WalkingRoutes } from "../../../gateway/maps/walking.js";
import { observeOperation } from "../../../observability/operation.js";
import { requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";

export function createRoutingSettingsRoutes(routes: Pick<WalkingRoutes, "hasKey" | "setKey" | "clearKey">): Hono<AdmissionEnv> {
  const app = new Hono<AdmissionEnv>();
  app.use("*", requireAdmissionScope(ADMISSION_SCOPES.PROVIDER_MANAGEMENT));
  app.get("/", async (context) => {
    try {
      return context.json({ configured: await routes.hasKey() });
    } catch {
      return context.json({ error: "The routing key status could not be read from the secure store." }, 503);
    }
  });
  app.put("/key", bodyLimit({
    maxSize: 4096,
    onError: (context) => context.json({ error: "The routing key is too large." }, 413),
  }), async (context) => {
    const body: unknown = await context.req.json().catch(() => null);
    if (typeof body !== "object" || body === null || !("apiKey" in body) || typeof body.apiKey !== "string") {
      return context.json({ error: "Enter an openrouteservice API key." }, 400);
    }
    const key = body.apiKey;
    try {
      await observeOperation("request", "map.routing.key", () => routes.setKey(key), { action: "save" });
      return context.body(null, 204);
    } catch (error) {
      return error instanceof WalkingRouteError
        ? context.json({ error: error.message }, 400)
        : context.json({ error: "The routing key could not be saved in the secure store." }, 503);
    }
  });
  app.delete("/key", async (context) => {
    try {
      await observeOperation("request", "map.routing.key", () => routes.clearKey(), { action: "remove" });
      return context.body(null, 204);
    } catch {
      return context.json({ error: "The routing key could not be removed from the secure store." }, 503);
    }
  });
  return app;
}
