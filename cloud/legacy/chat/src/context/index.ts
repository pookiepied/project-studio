/**
 * Request-scoped context — single entry point for all per-request state.
 *
 * Three mechanisms live here:
 *   1. AsyncLocalStorage  — env / baseUrl / executionContext (HTTP request tree)
 *   2. Map<requestId, threadId>    — threadId lookup (DO-safe, explicit key)
 *   3. Map<requestId, ToolRegistry> — registry lookup (DO-safe, explicit key)
 *
 * Maps are used where AsyncLocalStorage is unreliable across async boundaries
 * (Durable Object hibernation, LangGraph internal scheduling).
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Env } from "../env";
import { ToolRegistry, getToolRegistry } from "../tools";

// ---------------------------------------------------------------------------
// 1. AsyncLocalStorage — env / baseUrl / executionContext
// ---------------------------------------------------------------------------

const storage        = new AsyncLocalStorage<Env>();
const baseUrlStorage = new AsyncLocalStorage<string>();
const ctxStorage     = new AsyncLocalStorage<ExecutionContext>();

export function runWithEnv<T>(env: Env, fn: () => T): T {
  return storage.run(env, fn);
}

export function getRequestEnv(): Env | undefined {
  return storage.getStore();
}

export function runWithBaseUrl<T>(baseUrl: string, fn: () => T): T {
  return baseUrlStorage.run(baseUrl, fn);
}

export function getRequestBaseUrl(): string | undefined {
  return baseUrlStorage.getStore();
}

/** Bind an ExecutionContext to the current async call tree. */
export function runWithCtx<T>(ctx: ExecutionContext, fn: () => T): T {
  return ctxStorage.run(ctx, fn);
}

/** Returns the ExecutionContext bound by runWithCtx(), or undefined. */
export function getRequestCtx(): ExecutionContext | undefined {
  return ctxStorage.getStore();
}

// ---------------------------------------------------------------------------
// 2. Request context Map — requestId → { threadId }
// ---------------------------------------------------------------------------

interface RequestContext {
  threadId: string;
}

const requestStore = new Map<string, RequestContext>();

/** Store the thread ID for a request. */
export function setRequestContext(requestId: string, threadId: string): void {
  requestStore.set(requestId, { threadId });
}

/** Retrieve context for a request; returns safe defaults if not configured. */
export function getRequestContext(requestId: string): RequestContext {
  return requestStore.get(requestId) ?? { threadId: requestId };
}

/** Remove context after the request completes. */
export function clearRequestContext(requestId: string): void {
  requestStore.delete(requestId);
}

// ---------------------------------------------------------------------------
// 3. Agent execution context — AsyncLocalStorage scoped to one agent run
// ---------------------------------------------------------------------------

/** Identity of the agent currently executing on this async call path. */
export interface AgentExecutionContext {
  /** The parent request that owns the AgentContextDO instance. */
  requestId: string;
  /** The agentId of the specialist currently running on this call path. */
  agentId:   string;
}

const agentExecStorage = new AsyncLocalStorage<AgentExecutionContext>();

export function runWithAgentExecution<T>(
  ctx: AgentExecutionContext,
  fn:  () => Promise<T>
): Promise<T> {
  return agentExecStorage.run(ctx, fn);
}

export function getAgentExecutionContext(): AgentExecutionContext | null {
  return agentExecStorage.getStore() ?? null;
}

// ---------------------------------------------------------------------------
// 4. Registry Map — requestId → ToolRegistry
// ---------------------------------------------------------------------------

const registries = new Map<string, ToolRegistry>();

/**
 * Store a registry under a request ID, run fn, and clean up on exit.
 * Use this for short-lived request scopes.
 */
export async function runWithRegistry<T>(
  registry: ToolRegistry,
  fn: () => Promise<T>,
  requestId?: string
): Promise<T> {
  const id = requestId ?? crypto.randomUUID();
  registries.set(id, registry);
  try {
    return await fn();
  } finally {
    registries.delete(id);
  }
}

export function setRequestRegistry(requestId: string, registry: ToolRegistry): void {
  registries.set(requestId, registry);
}

export function clearRequestRegistry(requestId: string): void {
  registries.delete(requestId);
}

export function hasRequestRegistry(requestId: string): boolean {
  return registries.has(requestId);
}

export function getRegistryById(requestId: string): ToolRegistry {
  return registries.get(requestId) ?? getToolRegistry();
}

/** Falls back to the global singleton (no MCP tools). Kept for callers without a requestId. */
export function getRequestRegistry(): ToolRegistry {
  return getToolRegistry();
}
