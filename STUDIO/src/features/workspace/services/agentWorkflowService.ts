import { apiManager } from "@/core/network/apiManager";
import { createHeaders } from "@/lib/api";

export type AgentType    = "omni" | "coding";
export type TriggerType  = "manual" | "cron";
export type AgentStatus  = "active" | "paused" | "deleted";
export type RunStatus    = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface UserAgent {
  id:           string;
  userId:       string;
  name:         string;
  description:  string | null;
  goal:         string;
  agentType:    AgentType;
  triggerType:  TriggerType;
  cronExpr:     string | null;
  toolsAllowed: string[] | null;
  status:       AgentStatus;
  lastRunAt:    number | null;
  createdAt:    number;
  updatedAt:    number;
}

export interface AgentRun {
  id:          string;
  agentId:     string;
  userId:      string;
  doId:        string | null;
  status:      RunStatus;
  trigger:     TriggerType;
  result:      string | null;
  error:       string | null;
  startedAt:   number;
  completedAt: number | null;
  durationMs:  number | null;
}

export interface CreateAgentDraft {
  name:          string;
  description?:  string;
  goal:          string;
  agentType?:    AgentType;
  triggerType?:  TriggerType;
  cronExpr?:     string;
  toolsAllowed?: string[];
}

export interface UpdateAgentPatch {
  name?:         string;
  description?:  string | null;
  goal?:         string;
  agentType?:    AgentType;
  triggerType?:  TriggerType;
  cronExpr?:     string | null;
  toolsAllowed?: string[] | null;
  status?:       "active" | "paused";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getBase(): Promise<string> {
  const endpoints = await apiManager.getEndpoints();
  return endpoints.models.replace(/\/models$/, "");
}

async function headers(userId: string, json = true): Promise<Record<string, string>> {
  const h = await createHeaders(json) as Record<string, string>;
  h["X-User-Id"] = userId;
  return h;
}

// ---------------------------------------------------------------------------
// Agent CRUD
// ---------------------------------------------------------------------------

export async function listAgents(userId: string): Promise<UserAgent[]> {
  const base = await getBase();
  const res  = await fetch(`${base}/agent-workflows`, { headers: await headers(userId, false) });
  if (!res.ok) throw new Error(`List agents failed (${res.status})`);
  const data = await res.json() as { agents: UserAgent[] };
  return data.agents;
}

export async function createAgent(userId: string, draft: CreateAgentDraft): Promise<UserAgent> {
  const base = await getBase();
  const res  = await fetch(`${base}/agent-workflows`, {
    method:  "POST",
    headers: await headers(userId),
    body:    JSON.stringify(draft),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg);
  }
  const data = await res.json() as { agent: UserAgent };
  return data.agent;
}

export async function deleteAgent(userId: string, agentId: string): Promise<void> {
  const base = await getBase();
  const res  = await fetch(`${base}/agent-workflows/${encodeURIComponent(agentId)}`, {
    method:  "DELETE",
    headers: await headers(userId, false),
  });
  if (res.status !== 204 && !res.ok) throw new Error(`Delete failed (${res.status})`);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export async function runAgent(userId: string, agentId: string): Promise<AgentRun> {
  const base = await getBase();
  const res  = await fetch(`${base}/agent-workflows/${encodeURIComponent(agentId)}/run`, {
    method:  "POST",
    headers: await headers(userId, false),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg);
  }
  const data = await res.json() as { run: AgentRun };
  return data.run;
}

export async function listRuns(userId: string, agentId: string, limit = 10): Promise<AgentRun[]> {
  const base = await getBase();
  const res  = await fetch(
    `${base}/agent-workflows/${encodeURIComponent(agentId)}/runs?limit=${limit}`,
    { headers: await headers(userId, false) }
  );
  if (!res.ok) throw new Error(`List runs failed (${res.status})`);
  const data = await res.json() as { runs: AgentRun[] };
  return data.runs;
}
