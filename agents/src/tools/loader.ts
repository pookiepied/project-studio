/// <reference types="@cloudflare/workers-types" />

import type { Env } from "../env";
import type { AgentToolDescriptor } from "./types";
import { fetchHubConnections, fetchHubComposioTools } from "./hubClient";

/**
 * Build the full tool catalog available to an agent for a given user.
 *
 * Pulls from the studio-mcp hub:
 *   - native services (studio-tools, memory) → native descriptors
 *   - mcp_remote connections                 → remote_mcp descriptors
 *   - mcp_local connections                  → local_mcp descriptors (executed
 *                                              via the desktop ClientToolBridge)
 *   - Composio actions                       → composio descriptors
 *
 * Local + remote MCP tool *schemas* live in KV manifests (mcp_manifest:{name}),
 * written by the desktop when a server is registered — same source the main
 * chat agent reads from.
 */

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

function safeServer(name: string): string {
  return name.replace(/-/g, "_");
}

async function readManifest(env: Env, serverName: string): Promise<ManifestTool[]> {
  const raw = await env.MCP_KV.get(`mcp_manifest:${serverName}`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ManifestFile;
    return Array.isArray(parsed.tools) ? parsed.tools : [];
  } catch {
    return [];
  }
}

export interface LoadToolsOptions {
  /** When provided, only these local MCP servers are included (running set). */
  runningLocalServers?: string[];
}

export async function loadAgentTools(
  env:     Env,
  userId:  string,
  options: LoadToolsOptions = {},
): Promise<AgentToolDescriptor[]> {
  const descriptors: AgentToolDescriptor[] = [];

  // ── Hub: connections (local/remote) + native services ─────────────────────
  const { connections, native } = await fetchHubConnections(env, userId).catch(() => ({
    connections: [],
    native:      [],
  }));

  // Native services (studio-tools, memory) — names used as-is, no prefix.
  for (const svc of native) {
    for (const t of svc.tools ?? []) {
      if (!t.name || !t.description) continue;
      descriptors.push({
        name:            t.name,
        description:     t.description,
        parameters:      t.parameters ?? { type: "object", properties: {} },
        source:          "native",
        cloudExecutable: true,
        routing:         { kind: "native", serviceId: svc.id, toolName: t.name },
      });
    }
  }

  // External connections — mcp_remote (cloud-executable) + mcp_local (bridge).
  const runningSet = options.runningLocalServers ? new Set(options.runningLocalServers) : null;

  for (const conn of connections) {
    if (conn.type === "mcp_local" && runningSet && !runningSet.has(conn.name)) continue;

    const manifestTools = await readManifest(env, conn.name);
    if (manifestTools.length === 0) continue;

    for (const t of manifestTools) {
      if (!t.name || !t.description) continue;
      const schema   = (t.inputSchema ?? t.parameters ?? { type: "object", properties: {} });
      const toolName = `mcp_${safeServer(conn.name)}__${t.name}`;

      if (conn.type === "mcp_remote" && conn.config.url) {
        descriptors.push({
          name:            toolName,
          description:     t.description,
          parameters:      schema,
          source:          "remote_mcp",
          cloudExecutable: true,
          routing:         { kind: "remote_mcp", url: conn.config.url, authToken: conn.config.authToken, toolName: t.name },
        });
      } else if (conn.type === "mcp_local") {
        descriptors.push({
          name:            toolName,
          description:     t.description,
          parameters:      schema,
          source:          "local_mcp",
          cloudExecutable: false,
          routing:         { kind: "local_mcp", serverName: conn.name, toolName: t.name },
        });
      }
    }
  }

  // ── Hub: Composio actions ─────────────────────────────────────────────────
  const composio = await fetchHubComposioTools(env, userId).catch(() => ({ tools: [], apps: [] }));
  for (const t of composio.tools) {
    if (!t.name || !t.slug || !t.connectionId) continue;
    descriptors.push({
      name:            t.name,
      description:     t.description,
      parameters:      t.inputParameters ?? { type: "object", properties: {} },
      source:          "composio",
      cloudExecutable: true,
      routing:         { kind: "composio", slug: t.slug, connectionId: t.connectionId },
    });
  }

  return descriptors;
}
