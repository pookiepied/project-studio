/// <reference types="@cloudflare/workers-types" />

import type { Env } from "../env";
import type { ToolExecResult } from "./types";

/**
 * Typed client for the studio-mcp hub's internal routes (reached via the
 * MCP_TOOLS service binding). The hub is the single catalog + execution router
 * for all cloud tools.
 */

const HUB_BASE = "https://studio-mcp";

// ── Catalog shapes (mirror mcp/src/routes/internal.ts + composio.ts) ─────────

export interface HubConnection {
  id:           string;
  type:         "mcp_local" | "mcp_remote";
  name:         string;
  display_name: string;
  config: {
    url?:       string;
    transport?: string;
    authToken?: string;
    command?:   string;
    args?:      string[];
  };
  active: boolean;
}

export interface HubNativeService {
  id:           string;
  display_name: string;
  tools: Array<{ name: string; description: string; parameters?: unknown }>;
}

export interface HubConnectionsResponse {
  connections: HubConnection[];
  native:      HubNativeService[];
}

export interface HubComposioTool {
  slug:            string;
  name:            string;
  description:     string;
  inputParameters: Record<string, unknown>;
  connectionId:    string;
}

export interface HubComposioResponse {
  tools: HubComposioTool[];
  apps:  Array<{ appName: string; displayName: string; tools: Array<{ name: string; description: string }> }>;
}

// ── Catalog fetchers ────────────────────────────────────────────────────────

export async function fetchHubConnections(env: Env, userId: string): Promise<HubConnectionsResponse> {
  const res = await env.MCP_TOOLS.fetch(
    new Request(`${HUB_BASE}/internal/connections?userId=${encodeURIComponent(userId)}`),
  );
  if (!res.ok) throw new Error(`hub /internal/connections returned HTTP ${res.status}`);
  return res.json<HubConnectionsResponse>();
}

export async function fetchHubComposioTools(env: Env, userId: string): Promise<HubComposioResponse> {
  const res = await env.MCP_TOOLS.fetch(
    new Request(`${HUB_BASE}/internal/tools/composio?userId=${encodeURIComponent(userId)}`),
  );
  if (!res.ok) throw new Error(`hub /internal/tools/composio returned HTTP ${res.status}`);
  return res.json<HubComposioResponse>();
}

// ── Execution proxies ───────────────────────────────────────────────────────

async function hubPost(env: Env, path: string, body: unknown): Promise<ToolExecResult> {
  try {
    const res = await env.MCP_TOOLS.fetch(
      new Request(`${HUB_BASE}${path}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      }),
    );
    const data = await res.json<{ success?: boolean; data?: unknown; error?: string }>();
    if (data.success) return { success: true, data: data.data };
    return { success: false, error: data.error ?? `hub ${path} returned HTTP ${res.status}` };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function hubNativeExecute(env: Env, serviceId: string, toolName: string, toolArgs: unknown): Promise<ToolExecResult> {
  return hubPost(env, "/internal/native/execute", { serviceId, toolName, toolArgs });
}

export function hubComposioExecute(env: Env, slug: string, connectionId: string, entityId: string, args: unknown): Promise<ToolExecResult> {
  return hubPost(env, "/internal/composio/execute", { slug, connectionId, entityId, args });
}

export function hubRemoteExecute(env: Env, url: string, toolName: string, args: unknown, authToken?: string): Promise<ToolExecResult> {
  return hubPost(env, "/internal/remote/execute", { url, authToken, toolName, args });
}
