import { ServiceBindingMCPTool } from "./ServiceBindingMCPTool";
import type { McpServerSummary } from "../discovery/loadMcpTools";
import { STUDIO_MEMORY_TOOLS, MemoryToolDef } from "./memorySchemas";

/**
 * STUDIO built-in MCP servers.
 *
 * These are always-on system servers available to every user — no D1 install
 * required. Tools are created at request time and injected alongside the user's
 * own MCP tools.
 *
 * Adding a new built-in server: add an entry to BUILTIN_SERVERS below.
 * The bindingKey must match an env field of type Fetcher in Env.
 */

// ─── Registry ─────────────────────────────────────────────────────────────────

interface BuiltinServerDef {
  serverName:  string;
  displayName: string;
  bindingKey:  string;
  tools:       MemoryToolDef[];
}

const BUILTIN_SERVERS: BuiltinServerDef[] = [
  {
    serverName:  "studio-memory",
    displayName: "STUDIO Memory",
    bindingKey:  "MEMORY",
    tools:       STUDIO_MEMORY_TOOLS,
  },
];

// ─── Loader ───────────────────────────────────────────────────────────────────

export interface BuiltinMcpResult {
  tools:   ServiceBindingMCPTool[];
  servers: McpServerSummary[];
}

/**
 * Returns always-on built-in MCP tools for the current request.
 * Only includes servers whose binding is present in the environment.
 *
 * Call this alongside loadMcpTools() in preload — results are merged.
 */
export function loadBuiltinMcpTools(env: Record<string, unknown>): BuiltinMcpResult {
  const tools:   ServiceBindingMCPTool[] = [];
  const servers: McpServerSummary[]      = [];

  for (const def of BUILTIN_SERVERS) {
    if (!env[def.bindingKey]) continue; // binding not wired — skip silently

    const serverTools: ServiceBindingMCPTool[] = def.tools.map(
      (t) => new ServiceBindingMCPTool(def.serverName, t.name, t.description, t.schema, def.bindingKey, t.tier ?? 2)
    );

    tools.push(...serverTools);
    servers.push({
      serverName:  def.serverName,
      displayName: def.displayName,
      type:        "remote",
      tools:       serverTools.map((t) => ({ name: t.name, description: t.description })),
    });
  }

  return { tools, servers };
}
