import { Hono } from "hono";
import type { Env } from "./system/env";
import { cacheRoute } from "./server/routes/cache";
import { expandToolRoute } from "./server/routes/expandTool";
import { healthRoute } from "./server/routes/health";
import { contextRoute } from "./server/routes/context";

const app = new Hono<{ Bindings: Env }>();

app.route("/health", healthRoute);
app.route("/context", contextRoute);
app.route("/context-engine", contextRoute);
app.route("/expand-tool", expandToolRoute);
app.route("/cache", cacheRoute);

export default app;
