import { Hono } from "hono";
import type { Env } from "../../system/env";

/**
 * Run lifecycle surface (ARCHITECTURE.md §7). Each conversation maps to one
 * ExecutionSession DO (idFromName(conversationId)); the DO owns authoritative
 * state, prevents duplicate execution, and serves the WebSocket view.
 */
export const runsRoute = new Hono<{ Bindings: Env }>();

function session(env: Env, conversationId: string): DurableObjectStub {
  return env.EXECUTION_SESSION.get(env.EXECUTION_SESSION.idFromName(conversationId));
}

function forward(env: Env, conversationId: string, path: string, init?: RequestInit) {
  return session(env, conversationId).fetch(`https://session${path}`, init);
}

function authenticatedUserId(request: Request): string | null {
  return request.headers.get("x-user-id") ?? request.headers.get("X-User-ID");
}

runsRoute.post("/", async (c) => {
  const userId = authenticatedUserId(c.req.raw);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json<{
    conversationId: string;
    userId?: string;
    workspaceId?: string;
    agentId?: string;
    request: string;
    modelId: string;
    /** Required: duplicate sends with the same key return the same run. */
    idempotencyKey: string;
    branchId?: string;
    turnId?: string;
  }>();
  if (body.userId && body.userId !== userId) {
    return c.json({ error: "forbidden", message: "Run user does not match authenticated user." }, 403);
  }
  return forward(c.env, body.conversationId, "/start", {
    method: "POST",
    body: JSON.stringify({ ...body, userId, runId: crypto.randomUUID() }),
    headers: { "content-type": "application/json", "x-user-id": userId },
  });
});

runsRoute.get("/:conversationId", (c) => {
  const userId = authenticatedUserId(c.req.raw);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  return forward(c.env, c.req.param("conversationId"), "/state", {
    headers: { "x-user-id": userId },
  });
});

runsRoute.get("/:conversationId/ws", (c) => {
  const userId = authenticatedUserId(c.req.raw);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const lastSeq = c.req.query("lastSeq") ?? "0";
  return session(c.env, c.req.param("conversationId")).fetch(
    `https://session/ws?lastSeq=${lastSeq}`,
    withUserHeader(c.req.raw, userId),
  );
});

// The frontend resolves permission requests here — the runtime only
// listens and enforces. Body: { approved: boolean, resolvedBy?: string }.
runsRoute.post("/:conversationId/approvals/:approvalId/resolve", async (c) =>
  {
    const userId = authenticatedUserId(c.req.raw);
    if (!userId) return c.json({ error: "unauthorized" }, 401);
    return forward(
      c.env,
      c.req.param("conversationId"),
      `/approvals/${c.req.param("approvalId")}/resolve`,
      {
        method: "POST",
        body: await c.req.text(),
        headers: { "content-type": "application/json", "x-user-id": userId },
      },
    );
  });

runsRoute.post("/:conversationId/external-tools/:toolCallId/resolve", async (c) => {
  const userId = authenticatedUserId(c.req.raw);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  return forward(c.env, c.req.param("conversationId"), `/external-tools/${c.req.param("toolCallId")}/resolve`, {
    method: "POST", body: await c.req.text(), headers: { "content-type": "application/json", "x-user-id": userId },
  });
});

for (const path of ["tools/execute", "tools/execute/batch"] as const) {
  runsRoute.post(`/:conversationId/${path}`, async (c) => {
    const userId = authenticatedUserId(c.req.raw);
    if (!userId) return c.json({ error: "unauthorized" }, 401);
    return forward(c.env, c.req.param("conversationId"), `/${path}`, {
      method: "POST",
      body: await c.req.text(),
      headers: { "content-type": "application/json", "x-user-id": userId },
    });
  });
}

runsRoute.post("/:conversationId/client-actions/:toolCallId/resolve", async (c) => {
  const userId = authenticatedUserId(c.req.raw);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  return forward(c.env, c.req.param("conversationId"), `/client-actions/${c.req.param("toolCallId")}/resolve`, {
    method: "POST", body: await c.req.text(), headers: { "content-type": "application/json", "x-user-id": userId },
  });
});

// Control commands may carry { expectedVersion } for compare-and-swap:
// a command built against an older run version is rejected as stale.
for (const action of ["pause", "resume", "cancel"] as const) {
  runsRoute.post(`/:conversationId/${action}`, async (c) => {
    const userId = authenticatedUserId(c.req.raw);
    if (!userId) return c.json({ error: "unauthorized" }, 401);
    return forward(c.env, c.req.param("conversationId"), `/${action}`, {
      method: "POST",
      body: await c.req.text(),
      headers: { "content-type": "application/json", "x-user-id": userId },
    });
  });
}

function withUserHeader(request: Request, userId: string): Request {
  const headers = new Headers(request.headers);
  headers.set("x-user-id", userId);
  return new Request(request, { headers });
}
