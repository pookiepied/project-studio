import { Hono } from "hono";
import { proxyPath, proxyTo } from "./proxy";
import type { Env } from "./system/env";
import { ApiError, errorResponse, requireUserId } from "./system/http";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({
  ok: true,
  service: "studio-api",
  environment: c.env.ENVIRONMENT,
  routes: {
    cloud: true,
    local: "reserved",
  },
}));

app.use("*", async (c, next) => {
  if (c.req.path === "/health") return next();
  requireUserId(c.req.raw);
  return next();
});

app.all("/cloud/runs", (c) => proxyTo(c.env, "EXECUTION_RUNTIME", c.req.raw, "/runs"));
app.all("/cloud/runs/*", (c) => proxyPath(c.env, "EXECUTION_RUNTIME", c.req.raw, "/cloud/runs", "/runs"));

app.all("/cloud/plans", (c) => proxyTo(c.env, "PLANNER_RUNTIME", c.req.raw, "/plans"));
app.all("/cloud/plans/*", (c) => proxyPath(c.env, "PLANNER_RUNTIME", c.req.raw, "/cloud/plans", "/plans"));

app.all("/cloud/agents/*", (c) => proxyPath(c.env, "AGENT_RUNTIME", c.req.raw, "/cloud/agents", "/invoke"));

for (const [publicPrefix, dataPrefix] of [
  ["/cloud/conversations", "/conversations"],
  ["/cloud/transcripts", "/transcripts"],
  ["/cloud/uploads", "/uploads"],
  ["/cloud/artifacts", "/artifacts"],
  ["/cloud/objects", "/objects"],
  ["/cloud/plans-data", "/plans"],
] as const) {
  app.all(publicPrefix, (c) => proxyTo(c.env, "DATA", c.req.raw, dataPrefix));
  app.all(`${publicPrefix}/*`, (c) => proxyPath(c.env, "DATA", c.req.raw, publicPrefix, dataPrefix));
}

app.all("/cloud/models", (c) => proxyTo(c.env, "GATEWAY", c.req.raw, "/v1/models"));
app.all("/cloud/models/*", (c) => proxyPath(c.env, "GATEWAY", c.req.raw, "/cloud/models", "/v1/models"));

app.all("/admin/gateway", (c) => proxyTo(c.env, "GATEWAY", c.req.raw, "/management/registry"));
app.all("/admin/gateway/*", (c) => proxyPath(c.env, "GATEWAY", c.req.raw, "/admin/gateway", "/management/registry"));

app.all("/local/*", (c) => c.json({
  error: {
    code: "local_not_implemented",
    message: "The local Studio bridge namespace is reserved but not implemented in the cloud API worker yet.",
  },
}, 501));

app.all("/bridge/*", (c) => c.json({
  error: {
    code: "bridge_not_implemented",
    message: "The Studio bridge namespace is reserved for the future local runtime.",
  },
}, 501));

app.notFound((c) => c.json({ error: { code: "not_found", message: "Route not found." } }, 404));

app.onError((error, _c) => errorResponse(error));

export default app;
