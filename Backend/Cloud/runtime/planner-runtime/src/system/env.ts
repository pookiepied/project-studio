import type { RuntimeEnv } from "@studio/v2-runtime";

/**
 * Planner Runtime bindings. The shared engine needs GATEWAY, CONTEXT, DATA,
 * and MCP (RuntimeEnv — the planner uses read-only cloud tools to inspect the
 * task); this worker adds its own Durable Object namespace.
 */
export interface Env extends RuntimeEnv {
  /** One planning session per conversation. */
  PLANNER_SESSION: DurableObjectNamespace;
}
