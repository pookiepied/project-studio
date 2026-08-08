import { Hono } from "hono";
import type { Env } from "./system/env";
import { listSystemMcpServerDefinitions } from "./domains/mcpServers/systemServers";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) =>
  c.json({
    service: "studio-mcp-library",
    status: "ok",
    environment: c.env.ENVIRONMENT,
  }),
);

app.get("/mcp-servers/system", (c) => c.json({ items: listSystemMcpServerDefinitions() }));

export default app;
