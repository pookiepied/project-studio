import { Hono } from "hono";
import { routes } from "./server/routes";
import type { Env } from "./system/env";

const app = new Hono<{ Bindings: Env }>();

app.route("/", routes);
app.onError((error, c) => {
  const message = error instanceof Error ? error.message : "internal_error";
  const status = message === "forbidden" ? 403 : message.includes("X-User-ID") ? 401 : 500;
  return c.json({ error: message }, status);
});

export default app;

