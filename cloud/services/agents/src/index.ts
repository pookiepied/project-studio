/// <reference types="@cloudflare/workers-types" />

import type { Env } from "./env";
import {
  handleListAgents,
  handleCreateAgent,
  handleUpdateAgent,
  handleDeleteAgent,
  handleRunAgent,
  handleListRuns,
} from "./routes/agentWorkflows";
import { handleBlackboard } from "./routes/blackboard";
import { handleAgentDispatch } from "./routes/spawn";

export { BlackboardDO } from "./blackboard/BlackboardDO";
export { ResearchAgent } from "./agents/research/index";

// ---------------------------------------------------------------------------
// studio-agents Worker — the sub-agent microservice.
//
// Runs predetermined cloud sub-agents (currently: research) as Durable Objects,
// each an independent ReAct loop. This worker owns:
//   - Spawnable agent DOs (BaseAgentDO subclasses in agents/src/agents/*),
//     addressed per-run via idFromName(runId). The DO IS the checkpoint: its
//     SQLite-backed state persists messages/iteration/tokens across hibernation.
//   - Ephemeral dispatch (routes/spawn.ts): /agents/{type}/spawn|status|cancel —
//     the door the main chat agent uses via spawn_agent.
//   - Persisted workflow CRUD + run history (/v1/agent-workflows) for
//     user-configured saved agents (cron/manual).
//   - The BlackboardDO (per-conversation agent-to-agent shared store), reached
//     by chat via the AGENTS service binding and by sub-agents directly.
//
// Tools come from the studio-mcp hub (a pure registry/router) — native work
// tools (web_search/web_fetch/rag/http_request) live in the studio-mcp-tools
// worker; the agents worker loads them via agents/src/tools/loader.ts.
// ---------------------------------------------------------------------------

// Auth: this worker is internal-only (workers_dev = false).
// All requests arrive via service binding from studio-chat, which is authenticated.
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url    = new URL(request.url);
    const method = request.method;

    // ── Agent workflow CRUD ─────────────────────────────────────────────────
    if (url.pathname === "/v1/agent-workflows") {
      if (method === "GET")  return handleListAgents(request, env);
      if (method === "POST") return handleCreateAgent(request, env);
    }

    const wfMatch = url.pathname.match(/^\/v1\/agent-workflows\/([^/]+)(\/runs|\/run)?$/);
    if (wfMatch) {
      const agentId = decodeURIComponent(wfMatch[1] ?? "");
      const suffix  = wfMatch[2];

      if (!suffix) {
        if (method === "PUT")    return handleUpdateAgent(agentId, request, env);
        if (method === "DELETE") return handleDeleteAgent(agentId, request, env);
      }
      if (suffix === "/run"  && method === "POST") return handleRunAgent(agentId, request, env, _ctx);
      if (suffix === "/runs" && method === "GET")  return handleListRuns(agentId, request, env);
    }

    // ── Ephemeral sub-agent dispatch (spawn/status/cancel) ──────────────────
    const dispatched = handleAgentDispatch(url.pathname, request, env, _ctx);
    if (dispatched) return dispatched;

    // ── Blackboard (agent-to-agent shared store) ────────────────────────────
    if (url.pathname.startsWith("/blackboard/") && method === "POST") {
      return handleBlackboard(url.pathname, request, env);
    }

    // ── Health ──────────────────────────────────────────────────────────────
    if (url.pathname === "/health") {
      return jsonResp({ status: "ok", service: "studio-agents", agents: [] });
    }

    return new Response("Not Found", { status: 404 });
  },
};

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
