import type { RuntimeEnv } from "../runtime/RuntimeSession";

/**
 * Agent Runtime bindings. The local runtime session needs GATEWAY, CONTEXT, DATA, and
 * MCP (RuntimeEnv); this worker adds its Durable Object namespace and the
 * Registry binding it loads agent definitions from.
 */
export interface Env extends RuntimeEnv {
  /** Studio Registry — agent definitions. */
  REGISTRY: Fetcher;
  /** One session per agent invocation/conversation. */
  AGENT_SESSION: DurableObjectNamespace;
}
