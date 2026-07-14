/**
 * Tool system type definitions.
 *
 * executionTarget controls where a tool's execute() method runs:
 *   - "cloud"      : executed directly inside the Cloudflare Worker
 *   - "local"      : dispatched to the local engine (Claude Code CLI) via interrupt-resume
 *   - "mcp"        : dispatched to an MCP server subprocess on the local machine via interrupt-resume
 *   - "remote_mcp" : executed via HTTP JSON-RPC in the Worker
 *   - "client"     : dispatched to the STUDIO frontend (e.g. task_write)
 *
 * group classifies a tool by capability domain — used for discovery, routing, and filtering.
 *
 * tier controls default LLM visibility:
 *   - 1 : always included in the baseline tool set (core reasoning, memory, retrieval)
 *   - 2 : hidden by default; surfaced only after the LLM calls expand_tools
 */

export type ExecutionTarget = "cloud" | "local" | "mcp" | "remote_mcp" | "client";
export type ToolGroup = "agentic" | "client" | "retrieval" | "generation" | "network" | "environment" | "local" | "mcp";
export type ToolTier = 1 | 2;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: any;
}

export interface ToolResult {
  success: boolean;
  result?: any;
  error?: string;
}

/**
 * Location and platform context derived from the inbound request.
 * Populated from Cloudflare Workers request.cf metadata at route entry.
 */
export interface UserContext {
  userId?: string;    // Verified user ID from JWT sub claim (e.g. "user_<uuid>")
  timezone?: string;  // IANA timezone, e.g. "America/New_York"
  city?: string;      // City name from IP geolocation
  country?: string;   // ISO 3166-1 alpha-2 country code
  platform?: string;  // "desktop" | "web" | "discord" | "api"
}

/**
 * Runtime context passed alongside tool arguments.
 * Carries API keys and other per-request configuration that tools need
 * but that should not come from the LLM's tool call arguments.
 */
export interface ToolContext {
  apiKeys?: {
    tavily?: string;
  };
  mcpKv?: KVNamespace;
  userContext?: UserContext;
}

export type ToolExecutor = (args: any, context?: ToolContext) => Promise<ToolResult>;

/**
 * Full tool interface — every registered tool must satisfy this shape.
 */
export interface Tool extends ToolDefinition {
  executionTarget: ExecutionTarget;
  execute: ToolExecutor;
  toDefinition: () => ToolDefinition;
  toLLMDefinition: () => LLMToolDefinition;
}

/**
 * OpenAI-compatible function definition sent to the LLM.
 */
export interface LLMToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: any;
    strict?: boolean;
  };
}
