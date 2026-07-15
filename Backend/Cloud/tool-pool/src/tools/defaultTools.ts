import type { StudioToolDescriptor } from "../contracts";

export const DISCOVER_TOOLS_NAME = "discover_tools";
export const RESOLVE_TOOL_NAME = "resolve_tool";

export function defaultTools(): StudioToolDescriptor[] {
  return [
    {
      name: DISCOVER_TOOLS_NAME,
      description: "Search Studio's available callable capabilities and return compact tool summaries.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "Natural language search query." },
          type: {
            type: "string",
            enum: ["mcp-server", "mcp-tool", "connector", "skill", "agent", "native-tool", "memory-tool", "internal-tool", "all"],
          },
          category: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 50 },
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
      capabilityRef: { id: DISCOVER_TOOLS_NAME, kind: "internal-tool", name: "Discover Tools", scope: "system" },
      policy: { effect: "read", requiresApproval: false },
      route: { kind: "client", action: DISCOVER_TOOLS_NAME },
    },
    {
      name: RESOLVE_TOOL_NAME,
      description: "Resolve a discovered Studio capability into its full executable tool schema.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: {
            type: "string",
            enum: ["mcp-server", "mcp-tool", "connector", "skill", "agent", "native-tool", "memory-tool", "internal-tool"],
          },
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
      capabilityRef: { id: RESOLVE_TOOL_NAME, kind: "internal-tool", name: "Resolve Tool", scope: "system" },
      policy: { effect: "read", requiresApproval: false },
      route: { kind: "client", action: RESOLVE_TOOL_NAME },
    },
  ];
}

