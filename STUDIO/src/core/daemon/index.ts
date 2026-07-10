/**
 * core/daemon — the local LLM proxy client (daemon = HTTP/SSE, NOT the runtime).
 *
 * Replaces the former services/local/index.ts. The localMcpControl exports that
 * used to live here moved to @/runtime (Phase 1); only the daemon client +
 * hook remain.
 */

export {
  createDaemonClient,
  type DaemonHealth,
  type LocalModel,
} from "./daemonClient";
