import type { McpContext, RegistryMcpRecord, StudioToolDescriptor } from "../contracts";
import type { Env } from "../system/env";

export async function buildMcpContext(env: Env, userId: string, _task: string): Promise<{ context: McpContext[]; tools: StudioToolDescriptor[] }> {
  const response = await env.REGISTRY.fetch("http://registry/mcp", { headers: { "x-user-id": userId } });
  if (!response.ok) throw new Error(`Registry MCP lookup failed (${response.status}).`);
  const { items } = await response.json<{ items: RegistryMcpRecord[] }>();
  const active = items.filter((item) => item.status === "active");
  return {
    context: active.map((item) => ({ ref: refFor(item), location: "cloud", available: true, relevantTools: item.tools.filter((tool) => tool.enabled).map((tool) => tool.name) })),
    tools: active.flatMap((item) => item.tools.filter((tool) => tool.enabled).map((tool) => descriptor(item, tool))),
  };
}

function descriptor(item: RegistryMcpRecord, tool: RegistryMcpRecord["tools"][number]): StudioToolDescriptor {
  const platformManaged = item.origin === "studio" && item.metadata.platformManaged === true;
  const route = platformManaged
    ? { kind: "native-cloud" as const, serviceId: item.id, toolName: tool.name }
    : { kind: "remote-mcp" as const, serverId: item.id, toolName: tool.name, endpoint: String(item.endpointRef ?? item.metadata.endpoint ?? "") };
  const effect = readEffect(tool.metadata?.effect);
  return {
    name: `mcp_${item.id}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64),
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    annotations: tool.annotations,
    family: platformManaged ? "native-cloud" : "user-mcp",
    target: "mcp-hub",
    location: "cloud",
    capabilityRef: refFor(item),
    policy: {
      effect,
      requiresApproval: effect === "write" || effect === "destructive" || (tool.permissions?.some((permission) => permission.includes("write") || permission.includes("destructive")) ?? false),
    },
    route,
  };
}

function refFor(item: RegistryMcpRecord) {
  return { id: item.id, kind: "mcp-server", name: item.name, scope: item.ownerType };
}

function readEffect(value: unknown): StudioToolDescriptor["policy"]["effect"] {
  return value === "read" || value === "write" || value === "destructive" || value === "none" ? value : undefined;
}
