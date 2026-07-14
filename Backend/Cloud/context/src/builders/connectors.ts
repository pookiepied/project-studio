import type { ConnectorAppRecord, ConnectorContext, ConnectorToolRecord, StudioToolDescriptor } from "../contracts";
import type { Env } from "../system/env";

export async function buildConnectorContext(env: Env, userId: string, _task: string): Promise<{ context: ConnectorContext[]; tools: StudioToolDescriptor[] }> {
  const response = await env.CONNECTORS.fetch(`http://connectors/internal/tools/composio?userId=${encodeURIComponent(userId)}`);
  if (!response.ok) throw new Error(`Connectors tool lookup failed (${response.status}).`);
  const { tools: connectorTools = [], apps = [] } = await response.json<{ tools?: ConnectorToolRecord[]; apps?: ConnectorAppRecord[] }>();

  const context = apps.map((app) => ({
    ref: { id: app.appName, kind: "connector", name: app.displayName, scope: "user" as const },
    authenticated: true,
    relevantTools: app.tools.map((tool) => tool.name),
  }));

  const tools = connectorTools.map((tool): StudioToolDescriptor => ({
    name: tool.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64),
    description: tool.description,
    inputSchema: tool.inputParameters,
    family: "connector",
    target: "mcp-hub",
    location: "cloud",
    capabilityRef: { id: tool.appKey, kind: "connector", name: tool.displayName, scope: "user" },
    policy: { requiresApproval: false },
    route: { kind: "connector", slug: tool.slug, connectionId: tool.connectionId, entityId: tool.entityId },
  }));

  return { context, tools };
}
