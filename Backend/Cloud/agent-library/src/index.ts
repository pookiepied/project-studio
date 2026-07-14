import { Hono } from "hono";
import type { Env } from "./system/env";
import { listSystemAgentDefinitions } from "./domains/agents/systemDefinitions";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) =>
  c.json({
    service: "studio-cloud-agent-library",
    status: "ok",
    environment: c.env.ENVIRONMENT,
  }),
);

app.get("/agents/system", (c) => c.json({ items: listSystemAgentDefinitions() }));

export default app;
