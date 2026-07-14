import type { AgentContext, CapabilitySummary, ConnectorContext, ContextCacheStatus, McpContext, ProjectContext, SkillContext, StudioToolDescriptor } from "../contracts";

interface CacheEntry {
  expiresAt: number;
  snapshot: CapabilitySnapshot;
}

export interface CapabilitySnapshot {
  cacheKey: string;
  cacheStatus: ContextCacheStatus;
  assembledAt: string;
  project: ProjectContext;
  connectors: ConnectorContext[];
  mcp: McpContext[];
  tools: StudioToolDescriptor[];
  defaultTools: StudioToolDescriptor[];
  skills: SkillContext[];
  agents: AgentContext[];
  capabilityCatalog: CapabilitySummary[];
}

const CACHE = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 5 * 60 * 1000;

export function readCapabilitySnapshot(key: string): CapabilitySnapshot | null {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    CACHE.delete(key);
    return null;
  }
  return { ...entry.snapshot, cacheStatus: "hit" };
}

export function writeCapabilitySnapshot(key: string, value: CapabilitySnapshot): void {
  CACHE.set(key, { expiresAt: Date.now() + DEFAULT_TTL_MS, snapshot: { ...value, cacheStatus: "refreshed" } });
}

export function invalidateContextCache(prefix?: string): number {
  let count = 0;
  for (const key of CACHE.keys()) {
    if (!prefix || key.startsWith(prefix)) {
      CACHE.delete(key);
      count += 1;
    }
  }
  return count;
}

export function capabilityCacheKey(input: {
  userId: string;
  workspaceId?: string;
  agentId?: string;
  consumer: string;
}): string {
  return [
    "context-engine:capabilities:v1",
    input.userId,
    input.workspaceId ?? "system-workspace",
    input.agentId ?? "main-agent",
    input.consumer,
  ].join(":");
}
