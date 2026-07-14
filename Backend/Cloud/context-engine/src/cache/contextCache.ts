import type { ContextPackage } from "../contracts";

interface CacheEntry {
  expiresAt: number;
  package: ContextPackage;
}

const CACHE = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 5 * 60 * 1000;

export function readContextCache(key: string): ContextPackage | null {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    CACHE.delete(key);
    return null;
  }
  return entry.package;
}

export function writeContextCache(key: string, value: ContextPackage): void {
  CACHE.set(key, { expiresAt: Date.now() + DEFAULT_TTL_MS, package: value });
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

export function contextCacheKey(input: {
  userId: string;
  workspaceId?: string;
  agentId?: string;
  conversationId?: string;
  taskId: string;
  consumer: string;
}): string {
  return [
    "context-engine:v1",
    input.userId,
    input.workspaceId ?? "system-workspace",
    input.agentId ?? "main-agent",
    input.conversationId ?? "no-conversation",
    input.consumer,
    input.taskId,
  ].join(":");
}
