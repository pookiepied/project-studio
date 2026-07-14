import { Hono } from "hono";
import type { Env } from "../../system/env";

/**
 * Plan lifecycle surface. Each conversation maps to one PlannerSession DO
 * (idFromName(conversationId)); the DO owns the durable planning run and
 * serves the WebSocket view. These routes are a thin authenticated proxy —
 * identical in spirit to the execution runtime's /runs surface, because both
 * ride the same engine.
 */
export const plansRoute = new Hono<{ Bindings: Env }>();

function session(env: Env, conversationId: string): DurableObjectStub {
  return env.PLANNER_SESSION.get(env.PLANNER_SESSION.idFromName(conversationId));
}

function forward(env: Env, conversationId: string, path: string, init?: RequestInit) {
  return session(env, conversationId).fetch(`https://session${path}`, init);
}

function authenticatedUserId(request: Request): string | null {
  return request.headers.get("x-user-id") ?? request.headers.get("X-User-ID");
}

// Start a planning run. Body: { conversationId, goal, modelId, idempotencyKey }.
plansRoute.post("/", async (c) => {
  const userId = authenticatedUserId(c.req.raw);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json<{
    conversationId: string;
    userId?: string;
    workspaceId?: string;
    agentId?: string;
    goal: string;
    modelId: string;
    idempotencyKey: string;
    branchId?: string;
    turnId?: string;
  }>();
  if (body.userId && body.userId !== userId) {
    return c.json({ error: "forbidden", message: "Plan user does not match authenticated user." }, 403);
  }
  // The engine speaks `request`; for the planner that is the goal.
  return forward(c.env, body.conversationId, "/start", {
    method: "POST",
    body: JSON.stringify({
      conversationId: body.conversationId,
      userId,
      workspaceId: body.workspaceId,
      agentId: body.agentId,
      request: body.goal,
      modelId: body.modelId,
      idempotencyKey: body.idempotencyKey,
      branchId: body.branchId,
      turnId: body.turnId,
      runId: crypto.randomUUID(),
    }),
    headers: { "content-type": "application/json", "x-user-id": userId },
  });
});

plansRoute.get("/:conversationId", (c) => {
  const userId = authenticatedUserId(c.req.raw);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  return forward(c.env, c.req.param("conversationId"), "/state", {
    headers: { "x-user-id": userId },
  });
});

// The structured Plan, once the run has produced one.
plansRoute.get("/:conversationId/plan", (c) => {
  const userId = authenticatedUserId(c.req.raw);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  return forward(c.env, c.req.param("conversationId"), "/plan", {
    headers: { "x-user-id": userId },
  });
});

plansRoute.get("/:conversationId/ws", (c) => {
  const userId = authenticatedUserId(c.req.raw);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const lastSeq = c.req.query("lastSeq") ?? "0";
  return session(c.env, c.req.param("conversationId")).fetch(
    `https://session/ws?lastSeq=${lastSeq}`,
    withUserHeader(c.req.raw, userId),
  );
});

// Control commands may carry { expectedVersion } for compare-and-swap.
for (const action of ["pause", "resume", "cancel"] as const) {
  plansRoute.post(`/:conversationId/${action}`, async (c) => {
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
