import type { McpContext, RegistryMcpRecord, StudioToolDescriptor } from "../contracts";
import type { Env } from "../system/env";

export async function buildMcpContext(env: Env, userId: string, _task: string): Promise<{ context: McpContext[]; tools: StudioToolDescriptor[] }> {
  const response = await env.REGISTRY.fetch("http://registry/mcp", { headers: { "x-user-id": userId } });
  if (!response.ok) throw new Error(`Registry MCP lookup failed (${response.status}).`);
  const { items } = await response.json<{ items: RegistryMcpRecord[] }>();
  const active = items.filter((item) => item.enabled && item.available);
  return {
    context: active.map((item) => ({ ref: item.ref, location: item.location, available: item.available, relevantTools: item.tools.filter((tool) => tool.enabled).map((tool) => tool.name) })),
    tools: active.flatMap((item) => item.tools.filter((tool) => tool.enabled).map((tool) => descriptor(item, tool))),
  };
}

function descriptor(item: RegistryMcpRecord, tool: RegistryMcpRecord["tools"][number]): StudioToolDescriptor {
  const platformManaged = item.origin === "studio" && item.metadata.platformManaged === true;
  const route = item.location === "local"
    ? { kind: "local-relay" as const, serverId: item.ref.id, toolName: tool.name, localRegistrationId: item.localRegistrationId }
    : platformManaged
      ? { kind: "native-cloud" as const, serviceId: item.ref.id, toolName: tool.name }
      : { kind: "remote-mcp" as const, serverId: item.ref.id, toolName: tool.name, endpoint: String(item.metadata.endpoint ?? "") };
  return {
    name: `mcp_${item.ref.id}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64),
    description: tool.description,
    inputSchema: tool.inputSchema,
    family: item.location === "local" ? "native-local" : platformManaged ? "native-cloud" : "user-mcp",
    target: item.location === "local" ? "local-relay" : "mcp-hub",
    location: item.location,
    capabilityRef: item.ref,
    policy: { requiresApproval: tool.permissions?.some((permission) => permission.includes("write") || permission.includes("destructive")) ?? false },
    route,
  };
}
