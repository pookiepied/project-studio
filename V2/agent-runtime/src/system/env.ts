import type { RuntimeEnv } from "@studio/v2-runtime";

/**
 * Agent Runtime bindings. The shared engine needs GATEWAY, CONTEXT, DATA, and
 * MCP (RuntimeEnv); this worker adds its Durable Object namespace and the
 * Registry binding it loads agent definitions from.
 */
export interface Env extends RuntimeEnv {
  /** Studio Registry — agent definitions. */
  REGISTRY: Fetcher;
  /** One session per agent invocation/conversation. */
  AGENT_SESSION: DurableObjectNamespace;
}
