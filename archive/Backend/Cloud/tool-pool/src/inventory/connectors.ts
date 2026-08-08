import type { CapabilitySummary, SourceHealth, StudioToolDescriptor, ToolPoolScope } from "../contracts";
import type { Env } from "../system/env";

interface ConnectorToolsResponse {
  tools?: Array<{
    slug: string;
    name: string;
    description: string;
    inputParameters: Record<string, unknown>;
    connectionId: string;
    entityId: string;
    appKey: string;
    displayName: string;
  }>;
}

export interface ConnectorInventory {
  summaries: CapabilitySummary[];
  tools: StudioToolDescriptor[];
  health: SourceHealth;
}

export async function loadConnectorInventory(env: Env, scope: ToolPoolScope): Promise<ConnectorInventory> {
  const response = await env.CONNECTORS.fetch(new Request(`https://connectors.internal/internal/tools/composio?userId=${encodeURIComponent(scope.userId)}`, {
    headers: { "X-User-ID": scope.userId },
  }));
  if (!response.ok) return {
    summaries: [],
    tools: [],
    health: { source: "connectors", status: "degraded", checkedAt: new Date().toISOString(), detail: `HTTP ${response.status}` },
  };
  const body = await response.json<ConnectorToolsResponse>();
  const tools = (body.tools ?? []).map((tool): StudioToolDescriptor => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputParameters ?? { type: "object", additionalProperties: true },
    family: "connector",
    target: "mcp-hub",
    location: "cloud",
    capabilityRef: { id: `${tool.appKey}:${tool.slug}`, kind: "connector", name: tool.displayName, scope: "user" },
    policy: { effect: "read", requiresApproval: false },
    route: {
      kind: "connector",
      slug: tool.slug,
      connectionId: tool.connectionId,
      entityId: tool.entityId,
    },
  }));
  return {
    tools,
    summaries: tools.map((tool): CapabilitySummary => ({
      id: `${tool.capabilityRef.id}:${tool.name}`,
      type: "connector",
      name: tool.name,
      description: tool.description,
      availability: "available",
      scope: "user",
      source: tool.capabilityRef.name,
      expandable: true,
      executable: true,
      category: "connector",
      tags: ["connector", tool.capabilityRef.name],
      toolName: tool.name,
      parentId: tool.capabilityRef.id,
      tier: "summary",
      eligibility: "eligible",
      conflict: { canonicalName: tool.name, strategy: "unchanged" },
    })),
    health: { source: "connectors", status: "available", checkedAt: new Date().toISOString() },
  };
}
