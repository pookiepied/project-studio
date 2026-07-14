import type {
  AgentContext,
  CapabilitySummary,
  ConnectorContext,
  ContextPackage,
  McpContext,
  SkillContext,
  StudioToolDescriptor,
} from "../contracts";

export function buildCapabilityCatalog(input: {
  mcp: McpContext[];
  connectors: ConnectorContext[];
  skills: SkillContext[];
  agents: AgentContext[];
  tools: StudioToolDescriptor[];
  defaultTools: StudioToolDescriptor[];
}): CapabilitySummary[] {
  const summaries: CapabilitySummary[] = [
    ...input.defaultTools.map((tool) => toolSummary(tool, "internal-tool")),
    ...input.mcp.map(mcpSummary),
    ...input.mcp.flatMap((server) => server.relevantTools.map((toolName) => ({
      id: `${server.ref.id}:${toolName}`,
      type: "mcp-tool" as const,
      name: toolName,
      toolName: `mcp_${server.ref.id}_${toolName}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64),
      parentId: server.ref.id,
      description: `Tool exposed by ${server.ref.name}.`,
      availability: server.available ? "available" as const : "unavailable" as const,
      scope: server.ref.scope ?? "system" as const,
      source: "registry",
      expandable: true,
      executable: server.available,
    }))),
    ...input.connectors.map(connectorSummary),
    ...input.skills.map(skillSummary),
    ...input.agents.map(agentSummary),
    ...input.tools.map((tool) => toolSummary(tool, tool.family === "connector" ? "connector" : "mcp-tool")),
  ];

  return uniqueById(summaries).sort(compareCapability);
}

export function buildSendableContext(context: Omit<ContextPackage, "sendable">): ContextPackage["sendable"] {
  return {
    format: "studio.context.projection.v1",
    sections: [
      {
        id: "capability_catalog",
        stability: "stable",
        content: context.capabilityCatalog.map(({ id, type, name, description, availability, scope, source, expandable, executable, toolName, parentId }) => ({
          id,
          type,
          name,
          description,
          availability,
          scope,
          source,
          expandable,
          executable,
          toolName,
          parentId,
        })),
      },
      {
        id: "default_tools",
        stability: "stable",
        content: context.defaultTools.map((tool) => ({ name: tool.name, description: tool.description })),
      },
      {
        id: "user_profile",
        stability: "semi-stable",
        content: stableRecord(context.user.userProfile),
      },
      {
        id: "recent_memory",
        stability: "semi-stable",
        content: [...context.user.recentMemory].sort(),
      },
      {
        id: "conversation_history",
        stability: "dynamic",
        content: context.conversation.relevantHistory,
      },
      {
        id: "current_message",
        stability: "dynamic",
        content: context.conversation.currentMessage,
      },
    ],
    toolNames: context.tools.map((tool) => tool.name).sort(),
    defaultToolNames: context.defaultTools.map((tool) => tool.name).sort(),
    expansionToolName: "expand_tool",
    serialization: {
      stablePrefixSections: ["capability_catalog", "default_tools"],
      dynamicSections: ["conversation_history", "current_message"],
      deterministic: true,
    },
  };
}

function mcpSummary(item: McpContext): CapabilitySummary {
  return {
    id: item.ref.id,
    type: "mcp-server",
    name: item.ref.name,
    description: `${item.ref.name} MCP server.`,
    availability: item.available ? "available" : "unavailable",
    scope: item.ref.scope ?? "system",
    source: item.location,
    expandable: true,
    executable: item.available,
  };
}

function connectorSummary(item: ConnectorContext): CapabilitySummary {
  return {
    id: item.ref.id,
    type: "connector",
    name: item.ref.name,
    description: `${item.ref.name} connector.`,
    availability: item.authenticated ? "available" : "disconnected",
    scope: "user",
    source: "connectors",
    expandable: true,
    executable: item.authenticated,
  };
}

function skillSummary(item: SkillContext): CapabilitySummary {
  return {
    id: item.ref.id,
    type: "skill",
    name: item.ref.name,
    description: item.summary,
    availability: "available",
    scope: item.ref.scope ?? "system",
    source: "skill-library",
    expandable: true,
    executable: false,
  };
}

function agentSummary(item: AgentContext): CapabilitySummary {
  return {
    id: item.ref.id,
    type: "agent",
    name: item.ref.name,
    description: item.description,
    availability: item.delegatable ? "available" : "disabled",
    scope: item.ref.scope ?? "system",
    source: item.location,
    expandable: true,
    executable: item.delegatable,
  };
}

function toolSummary(tool: StudioToolDescriptor, type: CapabilitySummary["type"]): CapabilitySummary {
  return {
    id: `${tool.capabilityRef.id}:${tool.name}`,
    type,
    name: tool.name,
    toolName: tool.name,
    parentId: tool.capabilityRef.id,
    description: tool.description,
    availability: "available",
    scope: tool.capabilityRef.scope ?? "system",
    source: tool.family ?? "native-cloud",
    expandable: true,
    executable: true,
  };
}

function uniqueById(items: CapabilitySummary[]): CapabilitySummary[] {
  const seen = new Map<string, CapabilitySummary>();
  for (const item of items) seen.set(`${item.type}:${item.id}:${item.name}`, item);
  return [...seen.values()];
}

function compareCapability(a: CapabilitySummary, b: CapabilitySummary): number {
  return `${a.type}:${a.name}:${a.id}`.localeCompare(`${b.type}:${b.name}:${b.id}`);
}

function stableRecord(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)));
}
