import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "./server.js";
import { resolveEnv, resolveProviderConfig } from "../config/env.js";

type Env = Record<string, string | undefined>;

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => {
  return c.json({ ok: true, service: "studio-web-mcp", version: c.env.MCP_SERVER_VERSION ?? "0.1.0" });
});

// MCP Streamable HTTP — stateless, 2026-07-28, single endpoint POST /mcp
// Each request creates a fresh McpServer + transport (no session, no Mcp-Session-Id).
app.all("/mcp", async (c) => {
  // Only POST is primary per spec, but SDK handles GET for SSE if needed.
  // We delegate everything to the transport.
  let env: ReturnType<typeof resolveEnv>;
  try {
    env = resolveEnv(c.env as Record<string, unknown>);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid environment";
    return c.json({ error: { code: "CONFIG_MISSING", message: msg } }, 500);
  }

  const providerConfig = resolveProviderConfig(env);
  const getConfig = () => providerConfig;

  const server = createMcpServer(getConfig);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless per blueprint §2
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(c.req.raw);
    // Close server after handling (stateless). In Workers use waitUntil, in tests just close.
    try {
      const ctx = (c as unknown as { executionCtx?: { waitUntil: (p: Promise<unknown>) => void } }).executionCtx;
      if (ctx?.waitUntil) ctx.waitUntil(server.close().catch(() => {}));
      else void server.close().catch(() => {});
    } catch {
      void server.close().catch(() => {});
    }
    return response;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ error: { code: "INTERNAL", message: message.slice(0, 500) } }, 500);
  }
});

// Fallback
app.notFound((c) => c.json({ error: { code: "MCP_PROTOCOL_ERROR", message: "Not found" } }, 404));

app.onError((err, c) => {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as unknown as { code?: string })?.code ?? "INTERNAL";
  return c.json({ error: { code, message: message.slice(0, 500) } }, 500);
});

export default app;
