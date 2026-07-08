/// <reference types="@cloudflare/workers-types" />

import type { Env } from "../env";
import type { AgentRunConfig } from "../runtime/types";
import { getAgentNamespace, isAgentType } from "../agents/registry";
import { resolveAgentModel } from "../runtime/modelTiers";

/**
 * Ephemeral sub-agent dispatch.
 *
 * This is the door the main chat agent uses via spawn_agent — an agent created
 * mid-conversation, addressed by a fresh runId, with no persisted user_agents
 * row (that path, /v1/agent-workflows, is for user-configured saved agents).
 * Both doors funnel into the same BaseAgentDO runtime.
 *
 * Routes:
 *   POST /agents/{type}/spawn            → start a run, return { runId }
 *   GET  /agents/{type}/{runId}/status   → the DO's AgentState
 *   POST /agents/{type}/{runId}/cancel   → request cancellation
 */

interface SpawnBody {
  task:           string;
  model?:         string;   // tier ("quick"|"balanced"|"deep") | "inherit" | "provider:model"
  inheritModel?:  string;   // caller's current model, used when model="inherit"
  conversationId?: string;  // blackboard scope shared with the main agent
  maxIterations?: number;
  tokenBudget?:   number;
  systemPrompt?:  string;   // optional override; DO falls back to its own SYSTEM_PROMPT
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Handle /agents/* dispatch. Returns null if the path is not an agent route
 * (so the caller can continue matching other routes).
 */
export function handleAgentDispatch(
  pathname: string,
  request:  Request,
  env:      Env,
  ctx:      ExecutionContext,
): Promise<Response> | null {
  const m = pathname.match(/^\/agents\/([^/]+)\/(spawn|[^/]+\/(status|cancel))$/);
  if (!m) return null;

  const type = m[1] ?? "";
  if (!isAgentType(type)) return Promise.resolve(json({ error: `Unknown agent type: ${type}` }, 400));

  if (pathname.endsWith("/spawn") && request.method === "POST") {
    return handleSpawn(type, request, env, ctx);
  }

  const opMatch = pathname.match(/^\/agents\/[^/]+\/([^/]+)\/(status|cancel)$/);
  if (opMatch) {
    const runId = decodeURIComponent(opMatch[1] ?? "");
    const op    = opMatch[2];
    if (op === "status" && request.method === "GET")  return forwardToDO(type, runId, "status", env, "GET");
    if (op === "cancel" && request.method === "POST") return forwardToDO(type, runId, "cancel", env, "POST");
  }

  return Promise.resolve(json({ error: "Not Found" }, 404));
}

async function handleSpawn(
  type:    string,
  request: Request,
  env:     Env,
  ctx:     ExecutionContext,
): Promise<Response> {
  const userId = request.headers.get("X-User-Id") ?? "";
  if (!userId) return json({ error: "X-User-Id required." }, 401);

  let body: SpawnBody;
  try { body = await request.json() as SpawnBody; }
  catch { return json({ error: "Invalid JSON body." }, 400); }

  if (!body.task?.trim()) return json({ error: "'task' is required." }, 400);

  const ns = getAgentNamespace(env, type);
  if (!ns) return json({ error: `No DO namespace for agent type: ${type}` }, 400);

  const { model, fallback } = resolveAgentModel(body.model, env, body.inheritModel);
  const runId = `${type}-${crypto.randomUUID().slice(0, 8)}`;

  const config: AgentRunConfig = {
    runId,
    userId,
    model,
    fallbackModel:  fallback,
    systemPrompt:   body.systemPrompt ?? "",   // DO substitutes its own if empty
    messages:       [{ role: "user", content: body.task }],
    conversationId: body.conversationId,
    maxIterations:  body.maxIterations,
    tokenBudget:    body.tokenBudget,
  };

  const stub = ns.get(ns.idFromName(runId));

  // Fire the DO loop in the background — it runs to completion and updates its
  // own state; the caller polls /status and collects the result.
  ctx.waitUntil(
    stub.fetch(new Request("https://do/run", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(config),
    })).then(() => {}).catch(() => {}),
  );

  return json({ runId, agentType: type, model, status: "running" }, 202);
}

async function forwardToDO(
  type:   string,
  runId:  string,
  op:     "status" | "cancel",
  env:    Env,
  method: "GET" | "POST",
): Promise<Response> {
  const ns = getAgentNamespace(env, type);
  if (!ns) return json({ error: `No DO namespace for agent type: ${type}` }, 400);

  const stub = ns.get(ns.idFromName(runId));
  return stub.fetch(new Request(`https://do/${op}`, { method }));
}
