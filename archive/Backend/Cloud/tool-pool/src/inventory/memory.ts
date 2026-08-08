import type { CapabilitySummary, SourceHealth, StudioToolDescriptor, ToolPoolScope } from "../contracts";

type MemoryInventory = {
  summaries: CapabilitySummary[];
  tools: StudioToolDescriptor[];
  health: SourceHealth;
};

const MEMORY_TOOLS: Array<{
  name: string;
  description: string;
  operation: string;
  effect: "read" | "write" | "destructive";
  inputSchema: Record<string, unknown>;
}> = [
  {
    name: "memory_recall",
    description: "Search user-scoped Studio memory for relevant facts, preferences, and prior context.",
    operation: "recall",
    effect: "read",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
    },
  },
  {
    name: "memory_write",
    description: "Store a new user-scoped memory when the user clearly wants Studio to remember it.",
    operation: "write",
    effect: "write",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["content"],
      properties: {
        content: { type: "string" },
        category: { type: "string", enum: ["preference", "profile", "project", "task", "other"] },
        source: { type: "string" },
      },
    },
  },
  {
    name: "memory_update",
    description: "Update an existing user-scoped memory by identifier.",
    operation: "update",
    effect: "write",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["memoryId", "content"],
      properties: {
        memoryId: { type: "string" },
        content: { type: "string" },
      },
    },
  },
  {
    name: "memory_delete",
    description: "Delete an existing user-scoped memory by identifier.",
    operation: "delete",
    effect: "destructive",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["memoryId"],
      properties: {
        memoryId: { type: "string" },
      },
    },
  },
];

export function loadMemoryInventory(scope: ToolPoolScope): MemoryInventory {
  const tools = MEMORY_TOOLS.map((tool): StudioToolDescriptor => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: {
      type: "object",
      additionalProperties: true,
    },
    annotations: {
      category: "memory",
      userScoped: true,
    },
    family: "memory",
    target: "mcp-hub",
    location: "cloud",
    capabilityRef: {
      id: "studio-memory",
      kind: "memory",
      name: "Studio Memory",
      scope: "user",
    },
    policy: {
      effect: tool.effect,
      requiresApproval: tool.effect !== "read",
    },
    route: {
      kind: "memory",
      operation: tool.operation,
      location: "cloud",
    },
  }));

  return {
    tools,
    summaries: tools.map((tool): CapabilitySummary => ({
      id: tool.name,
      type: "memory-tool",
      name: tool.name,
      description: tool.description,
      availability: scope.userId ? "available" : "unauthorized",
      scope: "user",
      source: "tool-pool",
      expandable: true,
      executable: true,
      category: "memory",
      tags: ["memory", `effect:${tool.policy.effect ?? "none"}`],
      toolName: tool.name,
      parentId: "studio-memory",
      tier: "summary",
      eligibility: "eligible",
      conflict: { canonicalName: tool.name, strategy: "unchanged" },
    })),
    health: {
      source: "tool-pool",
      status: "available",
      checkedAt: new Date().toISOString(),
      detail: "Memory tools are declared as routed capabilities; live memory service health is checked during execution.",
    },
  };
}
