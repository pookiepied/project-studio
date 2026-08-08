import type {
  AgentContext,
  CapabilitySummary,
  ConnectorContext,
  ContextPackage,
  McpContext,
  ProviderNeutralMessage,
  ProviderNeutralMessagePart,
  ProviderNeutralResource,
  ProviderNeutralToolSchema,
  ResolvedContextResource,
  SendableSection,
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
  const defaultNames = new Set(input.defaultTools.map((tool) => tool.name));
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
    ...input.tools.filter((tool) => !defaultNames.has(tool.name)).map((tool) => toolSummary(tool, tool.family === "connector" ? "connector" : "mcp-tool")),
  ];

  return uniqueById(summaries).sort(compareCapability);
}

export function buildSendableContext(context: Omit<ContextPackage, "sendable">): ContextPackage["sendable"] {
  const sections = buildSendableSections(context);
  const stablePrefixSections = ["capability_catalog", "default_tools"];
  const dynamicSections = ["memory_references", "model_transcript", "context_references", "resolved_resources", "current_message"];
  return {
    format: "studio.context.projection.v1",
    sections,
    modelInput: buildProviderNeutralModelInput(context, sections, stablePrefixSections, dynamicSections),
    toolNames: context.tools.map((tool) => tool.name).sort(),
    defaultToolNames: context.defaultTools.map((tool) => tool.name).sort(),
    discoveryToolName: "discover_tools",
    resolveToolName: "resolve_tool",
    expansionToolName: "discover_tools",
    serialization: {
      stablePrefixSections,
      dynamicSections,
      deterministic: true,
    },
  };
}

function buildSendableSections(context: Omit<ContextPackage, "sendable">): SendableSection[] {
  return [
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
      content: context.defaultTools.map((tool) => toolSchema(tool)),
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
      id: "memory_references",
      stability: "dynamic",
      content: context.user.memoryReferences.map((memory) => ({
        id: memory.id,
        category: memory.category,
        summary: memory.summary ?? memory.content.slice(0, 240),
        score: memory.score,
        source: memory.source,
        updatedAt: memory.updatedAt,
      })),
    },
    {
      id: "model_transcript",
      stability: "dynamic",
      content: context.conversation.relevantHistory,
    },
    {
      id: "context_references",
      stability: "dynamic",
      content: context.conversation.contextReferences,
    },
    {
      id: "resolved_resources",
      stability: "dynamic",
      content: context.conversation.resolvedResources,
    },
    {
      id: "current_message",
      stability: "dynamic",
      content: context.conversation.currentMessage,
    },
  ];
}

function buildProviderNeutralModelInput(
  context: Omit<ContextPackage, "sendable">,
  sections: SendableSection[],
  stablePrefixSectionIds: string[],
  dynamicSectionIds: string[],
): ContextPackage["sendable"]["modelInput"] {
  const byId = new Map(sections.map((section) => [section.id, section]));
  const messages: ProviderNeutralMessage[] = [];
  const addContextText = (sectionId: string, text: string, stability: ProviderNeutralMessage["stability"]) => {
    if (text.trim().length === 0) return;
    messages.push({
      id: `context:${sectionId}`,
      role: "system",
      channel: "context",
      stability,
      sourceSectionId: sectionId,
      parts: [{ kind: "text", text, source: sectionId }],
    });
  };

  addContextText("capability_catalog", compactJson(byId.get("capability_catalog")?.content), "stable");
  addContextText("user_profile", compactJson(byId.get("user_profile")?.content), "semi-stable");
  addContextText("recent_memory", compactJson(byId.get("recent_memory")?.content), "semi-stable");
  addContextText("memory_references", compactJson(byId.get("memory_references")?.content), "dynamic");
  addContextText("context_references", compactJson(byId.get("context_references")?.content), "dynamic");

  for (const resource of context.conversation.resolvedResources) {
    const parts = resourceParts(resource);
    if (parts.length === 0) continue;
    messages.push({
      id: `resource:${resource.id}`,
      role: "system",
      channel: "context",
      stability: "dynamic",
      sourceSectionId: "resolved_resources",
      parts,
    });
  }

  for (const [index, turn] of context.conversation.relevantHistory.entries()) {
    messages.push({
      id: `transcript:${index}`,
      role: turn.role,
      channel: "transcript",
      stability: "dynamic",
      sourceSectionId: "model_transcript",
      createdAt: turn.createdAt,
      parts: [{ kind: "text", text: turn.content, source: "model_transcript" }],
    });
  }

  messages.push({
    id: "current:user-message",
    role: "user",
    channel: "current_input",
    stability: "dynamic",
    sourceSectionId: "current_message",
    parts: [{ kind: "text", text: context.conversation.currentMessage, source: "current_message" }],
  });

  return {
    format: "studio.model-input.v1",
    generatedAt: context.contextEngine.assembledAt,
    messages,
    tools: context.defaultTools.map((tool) => toolSchema(tool)),
    resources: context.conversation.resolvedResources.map(resourceSummary),
    cachePlan: {
      stablePrefixSectionIds,
      semiStableSectionIds: ["user_profile", "recent_memory"],
      dynamicSectionIds,
      currentTurnSectionIds: ["current_message"],
    },
    loweringHints: {
      images: "reference-only",
      files: "reference-only",
      artifacts: "summary-or-text",
      toolSchemas: "materialized-defaults-only",
    },
  };
}

function resourceParts(resource: ResolvedContextResource): ProviderNeutralMessagePart[] {
  if (resource.modelVisibility === "omit") return [];
  const common = {
    title: resource.title,
    contentType: resource.contentType,
    summary: resource.summary,
  };
  const reference =
    resource.kind === "artifact"
      ? { kind: "artifact_ref" as const, artifactId: resource.id, title: resource.title, family: resource.family, type: resource.type, status: resource.status, summary: resource.summary }
      : { kind: "attachment_ref" as const, attachmentId: resource.id, ...common };

  if (resource.content?.format === "text" && resource.modelVisibility === "include") {
    return [
      reference,
      { kind: "text", text: resource.content.text, source: resource.id, truncated: resource.content.truncated },
    ];
  }
  if (resource.inlineMode === "image") return [{ kind: "image_ref", resourceId: resource.id, title: resource.title, contentType: resource.contentType }];
  if (resource.inlineMode === "file") return [{ kind: "file_ref", resourceId: resource.id, title: resource.title, contentType: resource.contentType }];
  return [reference];
}

function resourceSummary(resource: ResolvedContextResource): ProviderNeutralResource {
  return {
    id: resource.id,
    kind: resource.kind,
    title: resource.title,
    contentType: resource.contentType,
    status: resource.status,
    family: resource.family,
    type: resource.type,
    modelVisibility: resource.modelVisibility,
    inlineMode: resource.inlineMode,
    hasInlineText: resource.content?.format === "text",
  };
}

function toolSchema(tool: StudioToolDescriptor): ProviderNeutralToolSchema {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    policy: tool.policy,
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

function compactJson(input: unknown): string {
  if (input === undefined || input === null) return "";
  if (typeof input === "string") return input;
  if (Array.isArray(input) && input.length === 0) return "";
  if (typeof input === "object" && Object.keys(input as Record<string, unknown>).length === 0) return "";
  return JSON.stringify(input);
}
