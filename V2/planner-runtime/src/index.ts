import { Hono } from "hono";
import type { Env } from "./system/env";
import { healthRoute } from "./server/routes/health";
import { plansRoute } from "./server/routes/plans";

const app = new Hono<{ Bindings: Env }>();

app.route("/health", healthRoute);
app.route("/plans", plansRoute);

export default app;
