import type { RuntimeEnv } from "../runtime/RuntimeSession";

/**
 * Planner Runtime bindings. The local runtime session needs GATEWAY, CONTEXT, DATA,
 * and MCP (RuntimeEnv — the planner uses read-only cloud tools to inspect the
 * task); this worker adds its own Durable Object namespace.
 */
export interface Env extends RuntimeEnv {
  /** One planning session per conversation. */
  PLANNER_SESSION: DurableObjectNamespace;
}
