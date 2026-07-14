import type { RuntimeEnv } from "../runtime/RuntimeSession";

/**
 * Execution Runtime bindings. The shared engine needs GATEWAY, CONTEXT, DATA,
 * and MCP (RuntimeEnv); this worker adds its own Durable Object namespace and
 * the Registry binding it may consult directly.
 */
export interface Env extends RuntimeEnv {
  /** Studio Registry — capability lookups when the runtime needs a direct check. */
  REGISTRY: Fetcher;
  /** One session per active conversation/run. */
  EXECUTION_SESSION: DurableObjectNamespace;
}
