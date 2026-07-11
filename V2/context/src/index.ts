import { Hono } from "hono";
import type { Env } from "./system/env";
import { healthRoute } from "./server/routes/health";
import { contextRoute } from "./server/routes/context";

const app = new Hono<{ Bindings: Env }>();

app.route("/health", healthRoute);
app.route("/context", contextRoute);

export default app;
