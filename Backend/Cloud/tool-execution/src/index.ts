import { Hono } from "hono";
import type { Env } from "./system/env";
import { healthRoute } from "./server/routes/health";
import { executeRoute } from "./server/routes/execute";

const app = new Hono<{ Bindings: Env }>();

app.route("/health", healthRoute);
app.route("/", executeRoute);

export default app;
