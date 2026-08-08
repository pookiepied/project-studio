import type { CapabilitySummary, SourceHealth, StudioToolDescriptor, ToolPoolScope } from "../contracts";
import type { Env } from "../system/env";

interface RegistryListResponse<T> {
  items?: T[];
}

interface RegistryResource {
  id: string;
  name?: string;
  slug?: string;
  description?: string;
  ownerType?: "system" | "user";
  status?: string;
  version?: string;
  metadata?: Record<string, unknown>;
  tools?: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    annotations?: Record<string, unknown>;
    enabled?: boolean;
  }>;
}

export interface RegistryInventory {
  summaries: CapabilitySummary[];
  tools: StudioToolDescriptor[];
  health: SourceHealth;
}

export async function loadRegistryInventory(env: Env, scope: ToolPoolScope): Promise<RegistryInventory> {
  const [skills, agents, mcp] = await Promise.all([
    fetchRegistryList<RegistryResource>(env.REGISTRY, "/skills", scope.userId),
    fetchRegistryList<RegistryResource>(env.REGISTRY, "/agents", scope.userId),
    fetchRegistryList<RegistryResource>(env.REGISTRY, "/mcp-servers", scope.userId),
  ]);

  const summaries: CapabilitySummary[] = [];
  const tools: StudioToolDescriptor[] = [];

  for (const skill of skills) {
    summaries.push(summaryFor(skill, "skill", "skill-library", "skills", false));
  }
  tools.push(...skillTools());

  for (const agent of agents) {
    summaries.push(summaryFor(agent, "agent", "agent-library", "agents", false));
  }
  tools.push(...agentTools());

  for (const server of mcp) {
    summaries.push(summaryFor(server, "mcp-server", "registry", "mcp", true));
    for (const tool of server.tools ?? []) {
      if (tool.enabled === false) continue;
      const toolName = namespacedToolName(server.slug ?? server.id, tool.name);
      summaries.push({
        id: `${server.id}:${tool.name}`,
        type: "mcp-tool",
        name: tool.name,
        description: tool.description ?? `Tool ${tool.name} from ${server.name ?? server.id}.`,
        availability: server.status === "active" ? "available" : "disabled",
        scope: server.ownerType ?? "system",
        source: server.name ?? server.id,
        expandable: true,
        executable: true,
        version: server.version,
        category: "mcp",
        tags: ["mcp", server.slug ?? server.id],
        toolName,
        parentId: server.id,
        tier: "summary",
        eligibility: "eligible",
        conflict: { canonicalName: toolName, strategy: "unchanged" },
      });
      tools.push({
        name: toolName,
        description: tool.description ?? `Execute ${tool.name} on ${server.name ?? server.id}.`,
        inputSchema: tool.inputSchema ?? { type: "object", additionalProperties: true },
        outputSchema: tool.outputSchema,
        annotations: tool.annotations,
        family: server.ownerType === "user" ? "user-mcp" : "native-cloud",
        target: "mcp-hub",
        location: "cloud",
        capabilityRef: { id: server.id, kind: "mcp-server", name: server.name ?? server.id, scope: server.ownerType ?? "system" },
        policy: { effect: "read", requiresApproval: false },
        route: {
          kind: "remote-mcp",
          serverId: server.id,
          toolName: tool.name,
          endpoint: typeof server.metadata?.endpoint === "string" ? server.metadata.endpoint : "service-binding://studio-mcp",
        },
      });
    }
  }

  return {
    summaries,
    tools,
    health: { source: "registry", status: "available", checkedAt: new Date().toISOString() },
  };
}

async function fetchRegistryList<T>(registry: Fetcher, path: string, userId: string): Promise<T[]> {
  const response = await registry.fetch(new Request(`https://registry.internal${path}`, {
    headers: { "X-User-ID": userId },
  }));
  if (!response.ok) return [];
  const body = await response.json<RegistryListResponse<T>>();
  return body.items ?? [];
}

function summaryFor(resource: RegistryResource, type: CapabilitySummary["type"], source: string, category: string, executable: boolean): CapabilitySummary {
  return {
    id: resource.id,
    type,
    name: resource.name ?? resource.slug ?? resource.id,
    description: resource.description ?? "",
    availability: resource.status === "active" ? "available" : "disabled",
    scope: resource.ownerType ?? "system",
    source,
    expandable: true,
    executable,
    version: resource.version,
    category,
    tags: [category, resource.slug ?? resource.id],
    tier: "summary",
    eligibility: "eligible",
    conflict: { canonicalName: resource.slug ?? resource.id, strategy: "unchanged" },
  };
}

function skillTools(): StudioToolDescriptor[] {
  return [
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
        properties: { skillId: { type: "string" } },
      },
      family: "native-cloud",
      target: "mcp-hub",
      location: "cloud",
      capabilityRef: { id: "studio-skill-library-mcp", kind: "mcp-server", name: "Studio Skill Library MCP", scope: "system" },
      policy: { effect: "read", requiresApproval: false },
      route: { kind: "skill-library", action: "skill_read" },
    },
  ];
}

function agentTools(): StudioToolDescriptor[] {
  return [
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
        properties: { agentExecutionId: { type: "string" } },
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

function namespacedToolName(serverSlug: string, toolName: string): string {
  const safeServer = serverSlug.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const safeTool = toolName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${safeServer}_${safeTool}`;
}
