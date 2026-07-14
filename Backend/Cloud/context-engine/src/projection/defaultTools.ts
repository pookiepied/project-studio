import type { StudioToolDescriptor } from "../contracts";

export const EXPAND_TOOL_NAME = "expand_tool";

export function defaultTools(): StudioToolDescriptor[] {
  return [
    {
      name: EXPAND_TOOL_NAME,
      description: "Expand a summarized Studio capability into its executable schema or detailed metadata.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            enum: ["mcp-server", "mcp-tool", "connector", "skill", "agent", "native-tool", "memory-tool", "internal-tool", "all"],
            description: "Capability family to expand.",
          },
          name: { type: "string", description: "Exact capability or tool name to expand." },
          id: { type: "string", description: "Exact capability id to expand." },
          category: { type: "string", description: "Optional category filter." },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          matches: { type: "array" },
        },
      },
      family: "client",
      target: "client",
      location: "cloud",
      capabilityRef: { id: EXPAND_TOOL_NAME, kind: "internal-tool", name: "Expand Tool", scope: "system" },
      policy: { effect: "read", requiresApproval: false },
      route: { kind: "client", action: EXPAND_TOOL_NAME },
    },
    {
      name: "skill_search",
      description: "Search available Studio skills by query and return matching skill summaries.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
      },
      family: "native-cloud",
      target: "mcp-hub",
      location: "cloud",
      capabilityRef: { id: "studio-skill-library-mcp", kind: "mcp-server", name: "Studio Skill Library MCP", scope: "system" },
      policy: { effect: "read", requiresApproval: false },
      route: { kind: "skill-library", action: "skill_search" },
    },
    {
      name: "skill_read",
      description: "Read the instructions for a specific Studio skill.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["skillId"],
        properties: {
          skillId: { type: "string" },
        },
      },
      family: "native-cloud",
      target: "mcp-hub",
      location: "cloud",
      capabilityRef: { id: "studio-skill-library-mcp", kind: "mcp-server", name: "Studio Skill Library MCP", scope: "system" },
      policy: { effect: "read", requiresApproval: false },
      route: { kind: "skill-library", action: "skill_read" },
    },
    {
      name: "spawn_agent",
      description: "Delegate a scoped task to a registered Studio agent.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["agentId", "task"],
        properties: {
          agentId: { type: "string" },
          task: { type: "string" },
          conversationId: { type: "string" },
        },
      },
      family: "native-cloud",
      target: "mcp-hub",
      location: "cloud",
      capabilityRef: { id: "studio-agent-execution-mcp", kind: "mcp-server", name: "Studio Agent Execution MCP", scope: "system" },
      policy: { effect: "write", requiresApproval: false },
      route: { kind: "agent-runtime", action: "spawn_agent" },
    },
    {
      name: "get_agent_status",
      description: "Check the status of a delegated Studio agent execution.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["agentExecutionId"],
        properties: {
          agentExecutionId: { type: "string" },
        },
      },
      family: "native-cloud",
      target: "mcp-hub",
      location: "cloud",
      capabilityRef: { id: "studio-agent-execution-mcp", kind: "mcp-server", name: "Studio Agent Execution MCP", scope: "system" },
      policy: { effect: "read", requiresApproval: false },
      route: { kind: "agent-runtime", action: "get_agent_status" },
    },
  ];
}
