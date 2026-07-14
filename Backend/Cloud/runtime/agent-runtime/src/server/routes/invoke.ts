import { Hono } from "hono";
import type {
  AgentDefinition,
  AgentLimits,
  AgentPermissions,
} from "../../contracts";
import type { Env } from "../../system/env";
import {
  mapAgentLimits,
  narrowLimits,
  narrowPermissions,
  resolveDefinition,
} from "../../engine/config";

/**
 * Invoke a registered agent — directly by a user or as a delegation from a
 * parent runtime (DelegationRequest in contracts). This route resolves the
 * effective definition, narrows any delegated permissions/limits (a child
 * never gets more than its definition grants), maps it to engine inputs, and
 * hands off to the AgentSession DO. The DO owns the durable run.
 */
export const invokeRoute = new Hono<{ Bindings: Env }>();

function session(env: Env, conversationId: string): DurableObjectStub {
  return env.AGENT_SESSION.get(env.AGENT_SESSION.idFromName(conversationId));
}

function authenticatedUserId(request: Request): string | null {
  return request.headers.get("x-user-id") ?? request.headers.get("X-User-ID");
}

invokeRoute.post("/:agentId", async (c) => {
  const userId = authenticatedUserId(c.req.raw);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const agentId = c.req.param("agentId");
  const body = await c.req.json<{
    conversationId: string;
    userId?: string;
    workspaceId?: string;
    task: string;
    /** Scoped context only — never the parent's whole conversation. */
    context?: string;
    modelId?: string;
    idempotencyKey: string;
    /** Inline definition (a parent that holds it, or until Registry lands). */
    definition?: AgentDefinition;
    /** Delegation narrowing — may only reduce the definition's grants. */
    permissions?: Partial<AgentPermissions>;
    limits?: AgentLimits;
    branchId?: string;
    turnId?: string;
  }>();
  if (body.userId && body.userId !== userId) {
    return c.json({ error: "forbidden", message: "Agent user does not match authenticated user." }, 403);
  }
  if (!body.idempotencyKey) {
    return c.json({ error: "invalid_request", message: "idempotencyKey is required." }, 400);
  }

  const definition = await resolveDefinition(c.env.REGISTRY, agentId, userId, body.definition);
  if (!definition) {
    return c.json(
      {
        error: "agent_definition_unavailable",
        message:
          "No agent definition resolved. Studio Registry's /agents endpoint is not implemented yet — supply `definition` inline in the request.",
      },
      424,
    );
  }
  if (definition.id !== agentId) {
    return c.json({ error: "invalid_request", message: "Definition id does not match agentId." }, 400);
  }
  if (!definition.enabled) {
    return c.json({ error: "agent_disabled", message: `Agent ${agentId} is disabled.` }, 409);
  }

  const modelId = body.modelId ?? definition.modelPreference;
  if (!modelId) {
    return c.json({ error: "invalid_request", message: "No model: set modelId or the agent's modelPreference." }, 400);
  }

  const effective: AgentDefinition = {
    ...definition,
    permissions: narrowPermissions(definition.permissions, body.permissions),
  };
  const limits = narrowLimits(
    mapAgentLimits(definition.limits),
    body.limits ? mapAgentLimits(body.limits) : undefined,
  );
  const request = body.context
    ? `${body.task}\n\nScoped context:\n${body.context}`
    : body.task;

  return session(c.env, body.conversationId).fetch("https://session/start", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({
      conversationId: body.conversationId,
      userId,
      workspaceId: body.workspaceId,
      agentId,
      request,
      modelId,
      idempotencyKey: body.idempotencyKey,
      branchId: body.branchId,
      turnId: body.turnId,
      limits,
      agentDefinition: effective,
      runId: crypto.randomUUID(),
    }),
  });
});

// Run state and the structured result, mirroring the other runtimes' surfaces.
invokeRoute.get("/:agentId/:conversationId", (c) => {
  const userId = authenticatedUserId(c.req.raw);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  return session(c.env, c.req.param("conversationId")).fetch("https://session/state", {
    headers: { "x-user-id": userId },
  });
});

invokeRoute.get("/:agentId/:conversationId/result", (c) => {
  const userId = authenticatedUserId(c.req.raw);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  return session(c.env, c.req.param("conversationId")).fetch("https://session/result", {
    headers: { "x-user-id": userId },
  });
});

invokeRoute.get("/:agentId/:conversationId/ws", (c) => {
  const userId = authenticatedUserId(c.req.raw);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const lastSeq = c.req.query("lastSeq") ?? "0";
  const headers = new Headers(c.req.raw.headers);
  headers.set("x-user-id", userId);
  return session(c.env, c.req.param("conversationId")).fetch(
    `https://session/ws?lastSeq=${lastSeq}`,
    new Request(c.req.raw, { headers }),
  );
});

for (const action of ["pause", "resume", "cancel"] as const) {
  invokeRoute.post(`/:agentId/:conversationId/${action}`, async (c) => {
    const userId = authenticatedUserId(c.req.raw);
    if (!userId) return c.json({ error: "unauthorized" }, 401);
    return session(c.env, c.req.param("conversationId")).fetch(`https://session/${action}`, {
      method: "POST",
      body: await c.req.text(),
      headers: { "content-type": "application/json", "x-user-id": userId },
    });
  });
}
