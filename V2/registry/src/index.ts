import { Hono } from "hono";
import type { Env } from "./system/env";
import { healthRoute } from "./server/routes/health";
import { connectorsRoute } from "./server/routes/connectors";
import { mcpRoute } from "./server/routes/mcp";
import { skillsRoute } from "./server/routes/skills";
import { agentsRoute } from "./server/routes/agents";
import { syncRoute } from "./server/routes/sync";

const app = new Hono<{ Bindings: Env }>();

app.route("/health", healthRoute);
app.route("/connectors", connectorsRoute);
app.route("/mcp", mcpRoute);
app.route("/skills", skillsRoute);
app.route("/agents", agentsRoute);
app.route("/sync", syncRoute);

export default app;
