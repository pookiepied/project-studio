import { Hono } from "hono";
import type { Env } from "./system/env";
import { healthRoute } from "./server/routes/health";
import { runsRoute } from "./server/routes/runs";

export { ExecutionSession } from "./state/ExecutionSession";

const app = new Hono<{ Bindings: Env }>();

app.route("/health", healthRoute);
app.route("/runs", runsRoute);

export default app;
