import type { CapabilitySummary, RuntimeConsumer, StudioToolDescriptor } from "../contracts";
import type { Env } from "../system/env";

export interface ToolPoolProjection {
  format: "studio.tool-pool.projection.v1";
  generatedAt: string;
  defaultTools: StudioToolDescriptor[];
  summaries: CapabilitySummary[];
}

export interface ToolPoolScope {
  userId: string;
  workspaceId?: string;
  conversationId?: string;
  agentId?: string;
  task?: string;
  consumer: RuntimeConsumer;
}

export async function readToolPoolProjection(env: Env, scope: ToolPoolScope): Promise<ToolPoolProjection> {
  const response = await env.TOOL_POOL.fetch(new Request("https://tool-pool.internal/projection", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-ID": scope.userId,
    },
    body: JSON.stringify(scope),
  }));
  if (!response.ok) throw new Error(`Tool Pool projection failed (${response.status}).`);
  return response.json<ToolPoolProjection>();
}

export async function discoverTools(env: Env, body: ToolPoolScope & Record<string, unknown>): Promise<unknown> {
  const response = await env.TOOL_POOL.fetch(new Request("https://tool-pool.internal/discover", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-ID": body.userId,
    },
    body: JSON.stringify(body),
  }));
  if (!response.ok) throw new Error(`Tool Pool discovery failed (${response.status}).`);
  return response.json();
}

