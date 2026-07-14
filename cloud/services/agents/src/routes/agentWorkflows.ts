/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../env";
import { type AgentType, getAgentNamespace } from "../agents/registry";
import { resolveAgentModel } from "../runtime/modelTiers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserAgent {
  id:           string;
  userId:       string;
  name:         string;
  description:  string | null;
  goal:         string;
  agentType:    AgentType;
  triggerType:  "manual" | "cron";
  cronExpr:     string | null;
  toolsAllowed: string[] | null;
  status:       "active" | "paused" | "deleted";
  lastRunAt:    number | null;
  createdAt:    number;
  updatedAt:    number;
}

export interface AgentRun {
  id:          string;
  agentId:     string;
  userId:      string;
  doId:        string | null;
  status:      "queued" | "running" | "completed" | "failed" | "cancelled";
  trigger:     "manual" | "cron";
  result:      string | null;
  error:       string | null;
  startedAt:   number;
  completedAt: number | null;
  durationMs:  number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function mapAgent(r: any): UserAgent {
  return {
    id:           r.id,
    userId:       r.user_id,
    name:         r.name,
    description:  r.description ?? null,
    goal:         r.goal,
    agentType:    r.agent_type,
    triggerType:  r.trigger_type,
    cronExpr:     r.cron_expr ?? null,
    toolsAllowed: r.tools_allowed ? JSON.parse(r.tools_allowed) : null,
    status:       r.status,
    lastRunAt:    r.last_run_at ?? null,
    createdAt:    r.created_at,
    updatedAt:    r.updated_at,
  };
}

function mapRun(r: any): AgentRun {
  const start = r.started_at as number;
  const end   = r.completed_at as number | null;
  return {
    id:          r.id,
    agentId:     r.agent_id,
    userId:      r.user_id,
    doId:        r.do_id ?? null,
    status:      r.status,
    trigger:     r.trigger,
    result:      r.result ?? null,
    error:       r.error ?? null,
    startedAt:   start,
    completedAt: end,
    durationMs:  end ? end - start : null,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function err(message: string, status: number): Response {
  return json({ error: { message, type: "request_error" } }, status);
}

function requireUserId(request: Request): string | null {
  return request.headers.get("X-User-Id");
}

// ---------------------------------------------------------------------------
// GET /v1/agent-workflows
// ---------------------------------------------------------------------------

export async function handleListAgents(request: Request, env: Env): Promise<Response> {
  const userId = requireUserId(request);
  if (!userId) return err("X-User-Id required.", 401);

  const rows = await env.AGENTS_DB
    .prepare(
      "SELECT * FROM user_agents WHERE user_id = ? AND status != 'deleted' " +
      "ORDER BY created_at DESC LIMIT 50"
    )
    .bind(userId)
    .all();

  return json({ agents: (rows.results ?? []).map(mapAgent) });
}

// ---------------------------------------------------------------------------
// POST /v1/agent-workflows
// ---------------------------------------------------------------------------

interface CreateAgentBody {
  name:          string;
  description?:  string;
  goal:          string;
  agentType?:    AgentType;
  triggerType?:  "manual" | "cron";
  cronExpr?:     string;
  toolsAllowed?: string[];
}

export async function handleCreateAgent(request: Request, env: Env): Promise<Response> {
  const userId = requireUserId(request);
  if (!userId) return err("X-User-Id required.", 401);

  let body: CreateAgentBody;
  try { body = await request.json() as CreateAgentBody; }
  catch { return err("Invalid JSON body.", 400); }

  if (!body.name?.trim()) return err('"name" required.', 400);
  if (!body.goal?.trim()) return err('"goal" required.', 400);

  const agentType   = body.agentType   ?? "research";
  const triggerType = body.triggerType ?? "manual";
  const id          = crypto.randomUUID();
  const now         = Date.now();

  await env.AGENTS_DB
    .prepare(
      "INSERT INTO user_agents (id, user_id, name, description, goal, agent_type, trigger_type, cron_expr, tools_allowed, status, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)"
    )
    .bind(
      id, userId, body.name.trim(), body.description ?? null, body.goal.trim(),
      agentType, triggerType, body.cronExpr ?? null,
      body.toolsAllowed ? JSON.stringify(body.toolsAllowed) : null,
      now, now
    )
    .run();

  const row = await env.AGENTS_DB
    .prepare("SELECT * FROM user_agents WHERE id = ?")
    .bind(id)
    .first();

  return json({ agent: mapAgent(row) }, 201);
}

// ---------------------------------------------------------------------------
// PUT /v1/agent-workflows/:id
// ---------------------------------------------------------------------------

interface UpdateAgentBody {
  name?:         string;
  description?:  string | null;
  goal?:         string;
  agentType?:    AgentType;
  triggerType?:  "manual" | "cron";
  cronExpr?:     string | null;
  toolsAllowed?: string[] | null;
  status?:       "active" | "paused";
}

export async function handleUpdateAgent(
  agentId: string, request: Request, env: Env
): Promise<Response> {
  const userId = requireUserId(request);
  if (!userId) return err("X-User-Id required.", 401);
  if (!UUID_RE.test(agentId)) return err("Invalid agent ID.", 400);

  let body: UpdateAgentBody;
  try { body = await request.json() as UpdateAgentBody; }
  catch { return err("Invalid JSON body.", 400); }

  const sets: string[] = ["updated_at = ?"];
  const vals: unknown[] = [Date.now()];

  if (body.name         !== undefined) { sets.push("name = ?");          vals.push(body.name.trim()); }
  if (body.description  !== undefined) { sets.push("description = ?");   vals.push(body.description); }
  if (body.goal         !== undefined) { sets.push("goal = ?");          vals.push(body.goal.trim()); }
  if (body.agentType    !== undefined) { sets.push("agent_type = ?");    vals.push(body.agentType); }
  if (body.triggerType  !== undefined) { sets.push("trigger_type = ?");  vals.push(body.triggerType); }
  if (body.cronExpr     !== undefined) { sets.push("cron_expr = ?");     vals.push(body.cronExpr); }
  if (body.toolsAllowed !== undefined) { sets.push("tools_allowed = ?"); vals.push(body.toolsAllowed ? JSON.stringify(body.toolsAllowed) : null); }
  if (body.status       !== undefined) { sets.push("status = ?");        vals.push(body.status); }

  vals.push(agentId, userId);

  await env.AGENTS_DB
    .prepare(`UPDATE user_agents SET ${sets.join(", ")} WHERE id = ? AND user_id = ? AND status != 'deleted'`)
    .bind(...vals)
    .run();

  const row = await env.AGENTS_DB
    .prepare("SELECT * FROM user_agents WHERE id = ? AND user_id = ?")
    .bind(agentId, userId)
    .first();

  if (!row) return err("Agent not found.", 404);
  return json({ agent: mapAgent(row) });
}

// ---------------------------------------------------------------------------
// DELETE /v1/agent-workflows/:id
// ---------------------------------------------------------------------------

export async function handleDeleteAgent(
  agentId: string, request: Request, env: Env
): Promise<Response> {
  const userId = requireUserId(request);
  if (!userId) return err("X-User-Id required.", 401);
  if (!UUID_RE.test(agentId)) return err("Invalid agent ID.", 400);

  await env.AGENTS_DB
    .prepare("UPDATE user_agents SET status = 'deleted', updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(Date.now(), agentId, userId)
    .run();

  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------------------
// POST /v1/agent-workflows/:id/run
// ---------------------------------------------------------------------------

export async function handleRunAgent(
  agentId: string,
  request: Request,
  env:     Env,
  ctx:     ExecutionContext,
): Promise<Response> {
  const userId = requireUserId(request);
  if (!userId) return err("X-User-Id required.", 401);
  if (!UUID_RE.test(agentId)) return err("Invalid agent ID.", 400);

  // Optional override body: { model?, conversationId?, maxIterations?, tokenBudget? }
  let overrides: {
    model?:          string;
    conversationId?: string;
    maxIterations?:  number;
    tokenBudget?:    number;
  } = {};
  try { overrides = (await request.json()) as typeof overrides; } catch { /* body is optional */ }

  const agent = await env.AGENTS_DB
    .prepare("SELECT * FROM user_agents WHERE id = ? AND user_id = ? AND status != 'deleted'")
    .bind(agentId, userId)
    .first();

  if (!agent) return err("Agent not found.", 404);

  const ns = getAgentNamespace(env, agent.agent_type as string);
  if (!ns) return err(`Unknown agent type: ${agent.agent_type}`, 400);

  const runId = crypto.randomUUID();
  const now   = Date.now();

  // Record the run immediately so callers can poll status.
  await env.AGENTS_DB
    .prepare(
      "INSERT INTO agent_runs (id, agent_id, user_id, do_id, status, trigger, result, error, started_at, completed_at, duration_ms) " +
      "VALUES (?, ?, ?, ?, 'running', 'manual', NULL, NULL, ?, NULL, NULL)"
    )
    .bind(runId, agentId, userId, runId, now)
    .run();

  await env.AGENTS_DB
    .prepare("UPDATE user_agents SET last_run_at = ?, updated_at = ? WHERE id = ?")
    .bind(now, now, agentId)
    .run();

  // Same tier resolution as the ephemeral spawn door (routes/spawn.ts): a tier
  // name, "inherit", or an explicit "provider:model" all funnel through here so
  // both doors pick models the same way.
  const { model, fallback } = resolveAgentModel(overrides.model, env, undefined);

  const config = {
    runId,
    userId,
    model,
    fallbackModel:   fallback,
    systemPrompt:    "", // filled in by the DO sub-class
    messages:        [{ role: "user" as const, content: String(agent.goal) }],
    conversationId:  overrides.conversationId,
    maxIterations:   overrides.maxIterations,
    tokenBudget:     overrides.tokenBudget,
  };

  const stub = ns.get(ns.idFromName(runId));

  // Fire the DO in the background — it runs the full loop and updates D1 when done.
  ctx.waitUntil(
    stub.fetch("https://do/run", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(config),
    })
      .then(async (resp) => {
        const body: any = await resp.json().catch(() => ({}));
        const status = resp.ok ? "completed" : "failed";
        await env.AGENTS_DB
          .prepare(
            "UPDATE agent_runs SET status=?, result=?, error=?, completed_at=?, duration_ms=? WHERE id=?"
          )
          .bind(
            status,
            body.result   ?? null,
            body.error    ?? null,
            Date.now(),
            Date.now() - now,
            runId,
          )
          .run();
      })
      .catch(async (dispatchErr) => {
        await env.AGENTS_DB
          .prepare(
            "UPDATE agent_runs SET status='failed', error=?, completed_at=?, duration_ms=? WHERE id=?"
          )
          .bind(String(dispatchErr), Date.now(), Date.now() - now, runId)
          .run();
      })
  );

  return json({ runId, agentId, status: "running" }, 202);
}

// ---------------------------------------------------------------------------
// GET /v1/agent-workflows/:id/runs
// ---------------------------------------------------------------------------

export async function handleListRuns(
  agentId: string, request: Request, env: Env
): Promise<Response> {
  const userId = requireUserId(request);
  if (!userId) return err("X-User-Id required.", 401);
  if (!UUID_RE.test(agentId)) return err("Invalid agent ID.", 400);

  const limit = Math.min(
    parseInt(new URL(request.url).searchParams.get("limit") ?? "20"),
    50,
  );

  const rows = await env.AGENTS_DB
    .prepare(
      "SELECT * FROM agent_runs WHERE agent_id = ? AND user_id = ? " +
      "ORDER BY started_at DESC LIMIT ?"
    )
    .bind(agentId, userId, limit)
    .all();

  const runs = (rows.results ?? []).map(mapRun);
  return json({ runs });
}
