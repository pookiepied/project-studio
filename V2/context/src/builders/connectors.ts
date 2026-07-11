import type { ConnectorContext, RegistryConnectorRecord, StudioToolDescriptor } from "@studio/v2-contracts";
import type { Env } from "../system/env";

export async function buildConnectorContext(env: Env, userId: string, _task: string): Promise<{ context: ConnectorContext[]; tools: StudioToolDescriptor[] }> {
  const response = await env.REGISTRY.fetch("http://registry/connectors", { headers: { "x-user-id": userId } });
  if (!response.ok) throw new Error(`Registry connector lookup failed (${response.status}).`);
  const { items } = await response.json<{ items: RegistryConnectorRecord[] }>();
  const active = items.filter((item) => item.enabled && item.available && item.authenticated);
  const context = active.map((item) => ({ ref: item.ref, authenticated: item.authenticated, relevantTools: item.tools.filter((tool) => tool.enabled).map((tool) => tool.name) }));
  const tools = active.flatMap((item) => item.tools.filter((tool) => tool.enabled).map((tool): StudioToolDescriptor => ({
    name: `connector_${item.ref.id}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64),
    description: tool.description, inputSchema: tool.inputSchema, family: "connector", target: "mcp-hub", location: "cloud", capabilityRef: item.ref,
    route: { kind: "connector", slug: tool.name, connectionId: String(item.metadata.connectionId ?? item.ref.id), entityId: userId },
  })));
  return { context, tools };
}
