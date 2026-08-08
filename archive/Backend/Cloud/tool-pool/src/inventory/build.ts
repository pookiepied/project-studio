import type { CapabilitySummary, SourceHealth, StudioToolDescriptor, ToolDiscoveryRequest, ToolDiscoveryResponse, ToolPoolProjection, ToolPoolScope, ToolResolveRequest, ToolResolveResponse } from "../contracts";
import type { Env } from "../system/env";
import { defaultTools } from "../tools/defaultTools";
import { loadConnectorInventory } from "./connectors";
import { loadMemoryInventory } from "./memory";
import { loadRegistryInventory } from "./registry";

export async function buildProjection(env: Env, scope: ToolPoolScope): Promise<ToolPoolProjection> {
  const defaults = defaultTools();
  const [registryInventory, connectorInventory] = await Promise.all([
    safeInventory("registry", () => loadRegistryInventory(env, scope)),
    safeInventory("connectors", () => loadConnectorInventory(env, scope)),
  ]);
  const memoryInventory = loadMemoryInventory(scope);
  const summaries = applyEligibility(scope, applyConflictMetadata([
    ...defaults.map((tool) => summaryFromTool(tool, "internal-tool", "tool-pool", "default")),
    ...registryInventory.summaries,
    ...connectorInventory.summaries,
    ...memoryInventory.summaries,
    ...registryInventory.tools.map((tool) => summaryFromTool(tool, capabilityTypeForTool(tool), "tool-pool", "summary")),
    ...connectorInventory.tools.map((tool) => summaryFromTool(tool, capabilityTypeForTool(tool), "tool-pool", "summary")),
    ...memoryInventory.tools.map((tool) => summaryFromTool(tool, capabilityTypeForTool(tool), "tool-pool", "summary")),
  ]));
  return {
    format: "studio.tool-pool.projection.v1",
    scope,
    generatedAt: new Date().toISOString(),
    sourceHealth: [
      { source: "tool-pool", status: "available", checkedAt: new Date().toISOString() },
      registryInventory.health,
      connectorInventory.health,
      memoryInventory.health,
    ],
    defaultTools: defaults,
    summaries: dedupeSummaries(summaries),
  };
}

export async function discoverTools(env: Env, request: ToolDiscoveryRequest): Promise<ToolDiscoveryResponse> {
  const projection = await buildProjection(env, request);
  const query = request.query?.toLowerCase().trim();
  const limit = boundedLimit(request.limit, 20);
  const matches = projection.summaries
    .filter((summary) => !request.type || request.type === "all" || summary.type === request.type)
    .filter((summary) => !request.id || summary.id === request.id || summary.parentId === request.id)
    .filter((summary) => !request.name || summary.name === request.name || summary.toolName === request.name)
    .filter((summary) => !request.category || summary.category === request.category)
    .filter((summary) => summary.eligibility === "eligible")
    .filter((summary) => !query || searchable(summary).includes(query))
    .slice(0, limit);
  return {
    format: "studio.tool-pool.discovery.v1",
    query: {
      query: request.query,
      type: request.type,
      category: request.category,
      id: request.id,
      name: request.name,
      limit,
    },
    matches,
  };
}

export async function resolveTools(env: Env, request: ToolResolveRequest): Promise<ToolResolveResponse> {
  const projection = await buildProjection(env, request);
  const [registryInventory, connectorInventory] = await Promise.all([
    safeInventory("registry", () => loadRegistryInventory(env, request)),
    safeInventory("connectors", () => loadConnectorInventory(env, request)),
  ]);
  const memoryInventory = loadMemoryInventory(request);
  const tools = [...projection.defaultTools, ...registryInventory.tools, ...connectorInventory.tools, ...memoryInventory.tools];
  const summaries = projection.summaries
    .filter((summary) => !request.type || summary.type === request.type)
    .filter((summary) => !request.id || summary.id === request.id || summary.parentId === request.id)
    .filter((summary) => !request.name || summary.name === request.name || summary.toolName === request.name)
    .filter((summary) => summary.eligibility === "eligible");
  return {
    format: "studio.tool-pool.resolve.v1",
    matches: summaries.map((summary) => ({
      summary: { ...summary, tier: "materialized" },
      tool: tools.find((tool) => tool.name === summary.toolName || tool.name === summary.name),
      details: { resolvedAt: new Date().toISOString() },
    })),
  };
}

function summaryFromTool(tool: StudioToolDescriptor, type: CapabilitySummary["type"], source: string, tier: CapabilitySummary["tier"]): CapabilitySummary {
  return {
    id: tool.name,
    type,
    name: tool.name,
    description: tool.description,
    availability: "available",
    scope: tool.capabilityRef.scope ?? "system",
    source,
    expandable: true,
    executable: true,
    category: type,
    tags: [type, tool.family, `effect:${tool.policy.effect ?? "none"}`],
    toolName: tool.name,
    parentId: tool.capabilityRef.id,
    tier,
    eligibility: "eligible",
    conflict: { canonicalName: tool.name, strategy: "unchanged" },
  };
}

function applyEligibility(scope: ToolPoolScope, summaries: CapabilitySummary[]): CapabilitySummary[] {
  return summaries.map((summary) => {
    if (summary.scope === "user" && !scope.userId) return ineligible(summary, "missing_user_scope");
    if (scope.consumer === "planner" && summary.executable && summary.type !== "internal-tool") {
      const effect = summary.tags?.find((tag) => tag.startsWith("effect:"))?.slice("effect:".length);
      if (effect === "write" || effect === "destructive") return ineligible(summary, "planner_read_only");
    }
    if (summary.source === "native-local" || summary.tags?.includes("native-local")) return ineligible(summary, "cloud_runtime_only");
    if (summary.availability !== "available") return ineligible(summary, summary.availability);
    return { ...summary, eligibility: "eligible" as const, ineligibleReason: undefined };
  });
}

function ineligible(summary: CapabilitySummary, reason: string): CapabilitySummary {
  return { ...summary, eligibility: "ineligible", ineligibleReason: reason, executable: false };
}

function applyConflictMetadata(summaries: CapabilitySummary[]): CapabilitySummary[] {
  const counts = new Map<string, number>();
  for (const summary of summaries) {
    const key = summary.toolName ?? summary.name;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return summaries.map((summary) => {
    const canonicalName = summary.toolName ?? summary.name;
    const strategy = (counts.get(canonicalName) ?? 0) > 1 ? "namespaced" : "unchanged";
    return { ...summary, conflict: { canonicalName, strategy } };
  });
}

type InventoryResult = { summaries: CapabilitySummary[]; tools: StudioToolDescriptor[]; health: SourceHealth };

async function safeInventory(
  source: SourceHealth["source"],
  load: () => Promise<InventoryResult>,
): Promise<InventoryResult> {
  try {
    return await load();
  } catch (error) {
    return {
      summaries: [],
      tools: [],
      health: {
        source,
        status: "unavailable",
        checkedAt: new Date().toISOString(),
        detail: error instanceof Error ? error.message : "unknown_error",
      },
    };
  }
}

function capabilityTypeForTool(tool: StudioToolDescriptor): CapabilitySummary["type"] {
  if (tool.route.kind === "skill-library") return "skill";
  if (tool.route.kind === "agent-runtime") return "agent";
  if (tool.route.kind === "connector") return "connector";
  if (tool.route.kind === "native-cloud") return "native-tool";
  if (tool.route.kind === "memory") return "memory-tool";
  if (tool.route.kind === "remote-mcp" || tool.route.kind === "local-relay") return "mcp-tool";
  return "internal-tool";
}

function dedupeSummaries(summaries: CapabilitySummary[]): CapabilitySummary[] {
  const map = new Map<string, CapabilitySummary>();
  for (const summary of summaries) map.set(`${summary.type}:${summary.id}:${summary.toolName ?? summary.name}`, summary);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function searchable(summary: CapabilitySummary): string {
  return [summary.name, summary.description, summary.category, summary.type, summary.source, ...(summary.tags ?? [])].join(" ").toLowerCase();
}

function boundedLimit(input: number | undefined, fallback: number): number {
  if (!input || !Number.isFinite(input)) return fallback;
  return Math.max(1, Math.min(Math.floor(input), 50));
}
