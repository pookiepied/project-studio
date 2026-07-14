import { Hono } from "hono";
import { agentsRoute } from "./domains/agents/routes";
import { mcpServersRoute } from "./domains/mcpServers/routes";
import { skillsRoute } from "./domains/skills/routes";
import { handleError } from "./errors/handler";
import { healthRoute } from "./health/routes";
import type { AppBindings } from "./system/app";
import { loggingMiddleware } from "./system/logging";

const app = new Hono<AppBindings>();

app.use("*", loggingMiddleware);
app.route("/health", healthRoute);
app.route("/skills", skillsRoute);
app.route("/mcp", mcpServersRoute);
app.route("/mcp-servers", mcpServersRoute);
app.route("/agents", agentsRoute);
app.onError(handleError);

export default app;
