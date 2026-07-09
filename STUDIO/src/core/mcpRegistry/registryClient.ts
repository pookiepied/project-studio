import { apiManager } from "@/core/network/apiManager";
import { tokenManager } from "@/utils/tokenManager";
import { logger } from "@/core/logging/logger";

/**
 * A single installed MCP server as returned by the backend.
 */
export interface McpServer {
  id: string;
  name: string;
  displayName: string;
  enabled: boolean;
  config: Record<string, unknown>;
  version: string | null;
  type: "local" | "remote";
  endpointUrl: string | null;
  installedAt: string;
  updatedAt: string;
}

/**
 * A catalog entry from the MCP registry.
 */
export interface McpCatalogEntry {
  name: string;
  displayName: string;
  description: string;
  version: string;
  author?: string;
  tags?: string[];
}

/**
 * Payload for installing a new server.
 */
export interface InstallServerPayload {
  name: string;
  displayName: string;
  type?: "local" | "remote";
  endpointUrl?: string;
  config?: Record<string, unknown>;
  version?: string;
  manifest?: {
    tools: { name: string; description: string; parameters?: unknown }[];
  };
}

async function getMcpBase(): Promise<string> {
  const endpoints = await apiManager.getEndpoints();
  return endpoints.mcp;
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await tokenManager.getAccessToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const base = await getMcpBase();
    if (!base) return { success: false, error: "MCP API not configured." };

    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        ...(await authHeaders()),
        ...options.headers,
      },
    });

    if (!response.ok) {
      let msg = `HTTP ${response.status}`;
      try {
        const body = await response.json() as any;
        msg = body?.error?.message ?? body?.message ?? msg;
      } catch { /* keep default */ }
      return { success: false, error: msg };
    }

    const data = await response.json() as T;
    return { success: true, data };
  } catch (e: any) {
    logger.error("mcpService", "Request failed", e);
    return { success: false, error: e?.message ?? "Network error" };
  }
}

export const mcpService = {
  /** List all MCP servers installed for the current user. */
  async listServers(): Promise<{ success: true; servers: McpServer[] } | { success: false; error: string }> {
    const result = await request<{ servers: McpServer[] }>("/servers");
    if (!result.success) return result;
    return { success: true, servers: result.data.servers };
  },

  /** Install a new MCP server. */
  async installServer(
    payload: InstallServerPayload
  ): Promise<{ success: true; name: string } | { success: false; error: string }> {
    const result = await request<{ installed: boolean; name: string }>("/servers", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!result.success) return result;
    return { success: true, name: result.data.name };
  },

  /** Uninstall an MCP server by name. */
  async uninstallServer(
    name: string
  ): Promise<{ success: true } | { success: false; error: string }> {
    const result = await request<{ uninstalled: boolean }>(`/servers/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
    if (!result.success) return result;
    return { success: true };
  },

  /** Enable or disable a server, or update its config. */
  async updateServer(
    name: string,
    patch: { enabled?: boolean; config?: Record<string, unknown> }
  ): Promise<{ success: true } | { success: false; error: string }> {
    const result = await request<{ updated: boolean }>(`/servers/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (!result.success) return result;
    return { success: true };
  },

  /**
   * Push the live tool manifest (fetched from the running subprocess) to the
   * backend KV so the AI worker can discover and call these tools at request time.
   */
  async syncManifest(
    name: string,
    tools: { name: string; description: string; inputSchema?: unknown }[]
  ): Promise<{ success: true } | { success: false; error: string }> {
    const result = await request<{ updated: boolean }>(`/servers/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify({ manifest: { tools } }),
    });
    if (!result.success) return result;
    return { success: true };
  },

  /** Browse the MCP server registry/catalog. */
  async getCatalog(): Promise<{ success: true; catalog: McpCatalogEntry[] } | { success: false; error: string }> {
    const result = await request<{ catalog: McpCatalogEntry[] }>("/catalog");
    if (!result.success) return result;
    return { success: true, catalog: result.data.catalog };
  },

  /** Fetch manifest from a remote MCP server and sync to backend KV. */
  async syncRemoteManifest(
    name: string
  ): Promise<{ success: true; toolCount: number } | { success: false; error: string }> {
    const result = await request<{ synced: boolean; toolCount: number }>(
      `/servers/${encodeURIComponent(name)}/sync`,
      { method: "POST" }
    );
    if (!result.success) return result;
    return { success: true, toolCount: result.data.toolCount };
  },
};
