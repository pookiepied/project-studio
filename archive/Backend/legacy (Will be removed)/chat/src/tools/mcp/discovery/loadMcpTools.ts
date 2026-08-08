import { DynamicMCPTool } from "./DynamicMCPTool";
import { RemoteMCPTool } from "../remote/RemoteMCPTool";
import { NativeMCPTool } from "../native/NativeMCPTool";
import { logger } from "../../../logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManifestTool {
  name:        string;
  description: string;
  parameters?: unknown;
  inputSchema?: unknown;
}

interface ManifestFile {
  tools: ManifestTool[];
  version?: string;
}

interface HubConnection {
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

interface HubNativeService {
  id:           string;
  display_name: string;
  tools: Array<{ name: string; description: string; parameters?: unknown }>;
}

interface HubConnectionsResponse {
  connections: HubConnection[];
  native:      HubNativeService[];
}

export interface McpServerSummary {
  serverName:  string;
  displayName: string;
  type:        "local" | "remote" | "native";
  tools:       Array<{ name: string; description: string }>;
}

// ---------------------------------------------------------------------------
// loadMcpTools
//
// Fetches mcp_local and mcp_remote connections from the MCP hub, then pairs
// each with its tool manifest from KV. Native services (memory, youtube-
// transcript) are returned directly by the hub with their schemas.
//
// Composio tools are loaded separately in preload.ts via
// /internal/tools/composio — this function does NOT handle composio.
// ---------------------------------------------------------------------------

export async function loadMcpTools(
  userId:         string,
  mcp:            Fetcher,
  mcpKv:          KVNamespace,
  runningServers?: string[],
): Promise<{ tools: (DynamicMCPTool | RemoteMCPTool | NativeMCPTool)[]; servers: McpServerSummary[] }> {
  const empty = { tools: [], servers: [] };

  // 1. Ask hub for connections + native services
  let data: HubConnectionsResponse;
  try {
    const res = await mcp.fetch(
      new Request(`https://studio-mcp/internal/connections?userId=${encodeURIComponent(userId)}`)
    );
    if (!res.ok) {
      logger.warn("loadMcpTools: hub /internal/connections returned error", { status: res.status });
      return empty;
    }
    data = await res.json<HubConnectionsResponse>();
  } catch (err) {
    logger.warn("loadMcpTools: failed to reach hub", { userId, err });
    return empty;
  }

  const { connections = [], native = [] } = data;
  const tools:   (DynamicMCPTool | RemoteMCPTool | NativeMCPTool)[] = [];
  const servers: McpServerSummary[] = [];

  // 2. External connections — mcp_local and mcp_remote
  const filtered = connections.filter((c) => {
    if (c.type !== "mcp_local") return true;
    if (!runningServers)        return true;
    return new Set(runningServers).has(c.name);
  });

  // Fetch all KV manifests in parallel
  const manifestJsons = await Promise.all(
    filtered.map((c) => mcpKv.get(`mcp_manifest:${c.name}`))
  );

  for (let i = 0; i < filtered.length; i++) {
    const conn         = filtered[i];
    const manifestJson = manifestJsons[i];

    if (!manifestJson) {
      logger.warn("loadMcpTools: no manifest for connection", { name: conn.name });
      continue;
    }

    let manifest: ManifestFile;
    try { manifest = JSON.parse(manifestJson); }
    catch {
      logger.warn("loadMcpTools: invalid manifest JSON", { name: conn.name });
      continue;
    }
    if (!Array.isArray(manifest.tools) || manifest.tools.length === 0) continue;

    const isRemote   = conn.type === "mcp_remote";
    const serverName = conn.name;
    const serverTools: Array<{ name: string; description: string }> = [];

    for (const t of manifest.tools) {
      if (!t.name || !t.description) continue;
      const schema    = (t.inputSchema ?? t.parameters ?? {}) as Record<string, unknown>;
      const safeServ  = serverName.replace(/-/g, "_");
      const toolName  = `mcp_${safeServ}__${t.name}`;

      if (isRemote && conn.config.url) {
        tools.push(new RemoteMCPTool(serverName, t.name, t.description, schema, conn.config.url, conn.config.authToken));
      } else {
        tools.push(new DynamicMCPTool(serverName, t.name, t.description, schema));
      }
      serverTools.push({ name: toolName, description: t.description });
    }

    if (serverTools.length > 0) {
      servers.push({
        serverName,
        displayName: conn.display_name,
        type:        isRemote ? "remote" : "local",
        tools:       serverTools,
      });
    }
  }

  // 3. Native services (memory, youtube-transcript)
  for (const svc of native) {
    if (!svc.tools?.length) continue;
    const serverTools: Array<{ name: string; description: string }> = [];

    for (const t of svc.tools) {
      if (!t.name || !t.description) continue;
      tools.push(new NativeMCPTool(svc.id, t.name, t.description, t.parameters));
      serverTools.push({ name: t.name, description: t.description });
    }

    if (serverTools.length > 0) {
      servers.push({
        serverName:  svc.id,
        displayName: svc.display_name,
        type:        "native",
        tools:       serverTools,
      });
    }
  }

  logger.info("loadMcpTools: complete", {
    userId,
    serverCount: servers.length,
    toolCount:   tools.length,
  });
  return { tools, servers };
}
