/// <reference types="@cloudflare/workers-types" />

/**
 * Tool-plane types for the agents worker.
 *
 * An agent running in this worker can use tools from four sources — the same
 * reach the main chat agent has:
 *   native    — first-party studio tools + memory, executed by the hub
 *               (studio-mcp /internal/native/execute → studio-mcp-tools / memory)
 *   composio  — 1000+ third-party app actions, executed by the hub
 *   remote_mcp— self-hosted / third-party HTTP MCP servers, executed by the hub
 *   local_mcp — MCP servers on the USER'S machine (studio-harness, computer-use,
 *               blender, …). These cannot run in the cloud; they are deferred to
 *               the desktop via the ClientToolBridge (the same Tauri-relay method
 *               the main agent uses).
 *
 * Cloud sources (native / composio / remote_mcp) all route through the studio-mcp
 * hub, keeping the hub the single execution router and this worker thin.
 */

export type ToolSource = "native" | "composio" | "remote_mcp" | "local_mcp";

export interface NativeRouting {
  kind:      "native";
  serviceId: string; // e.g. "studio-tools", "memory"
  toolName:  string; // native tool name, e.g. "web_search"
}

export interface ComposioRouting {
  kind:         "composio";
  slug:         string; // Composio action slug
  connectionId: string; // connected account id
}

export interface RemoteRouting {
  kind:      "remote_mcp";
  url:       string;
  authToken?: string;
  toolName:  string; // bare tool name on the remote server
}

export interface LocalRouting {
  kind:       "local_mcp";
  serverName: string; // local MCP server name (as registered on the desktop)
  toolName:   string; // bare tool name on that server
}

export type ToolRouting = NativeRouting | ComposioRouting | RemoteRouting | LocalRouting;

/**
 * A single tool available to an agent. `name` is the LLM-facing identifier;
 * `routing` carries the source-specific data the executor needs to run it.
 */
export interface AgentToolDescriptor {
  name:        string;
  description: string;
  parameters:  unknown; // JSON schema
  source:      ToolSource;
  /** True when the tool runs cloud-side (native/composio/remote). Local tools
   *  require a connected ClientToolBridge and are false. */
  cloudExecutable: boolean;
  routing:     ToolRouting;
}

export interface ToolExecResult {
  success: boolean;
  data?:   unknown;
  error?:  string;
}
