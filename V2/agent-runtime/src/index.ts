import { Hono } from "hono";
import type { Env } from "./system/env";
import { healthRoute } from "./server/routes/health";
import { invokeRoute } from "./server/routes/invoke";

const app = new Hono<{ Bindings: Env }>();

app.route("/health", healthRoute);
app.route("/invoke", invokeRoute);

export default app;
