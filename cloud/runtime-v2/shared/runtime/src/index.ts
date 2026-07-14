/**
 * @studio/v2-runtime — the durable execution engine shared by every Studio
 * runtime worker (Execution, Planner, Agent). A worker imports RuntimeSession,
 * subclasses it with a profile and (optionally) tool-gating / finalize hooks,
 * exports the concrete DO class, and forwards its HTTP surface to it.
 *
 * The engine mechanics — state machine, event log, checkpoints, idempotency,
 * approvals, external-tool relay, recovery, WebSocket protocol — live here so
 * a correctness fix lands once for all runtimes.
 */

// The base Durable Object every runtime specializes.
export { RuntimeSession } from "./session/RuntimeSession";
export type { RuntimeEnv } from "./session/env";
export type { RuntimeProfile } from "./session/profile";

// Engine internals a subclass may need to reference.
export {
  runAgentLoop,
  type LoopInput,
  type LoopResult,
  type LoopHooks,
  type LoopObservation,
  type CheckpointData,
  type EmitFn,
} from "./agent/loop";
export {
  buildToolSet,
  wrapToolSet,
  DEFAULT_TOOL_POLICY,
  type RegisteredTool,
  type ToolRuntime,
} from "./agent/tools";
export { ToolExecutionCoordinator } from "./agent/coordinator";
export { gatewayModel } from "./gateway/client";
export { SessionStore, type EventScope } from "./state/log";
export {
  broadcast,
  closeMessage,
  pongMessage,
  parseClientMessage,
  snapshotMessage,
} from "./streaming/events";
export {
  ExecutionError,
  type ExecutionErrorCode,
} from "./system/errors";
export {
  ACTIVE_STATUSES,
  MAX_RETRY_ATTEMPTS,
  STALL_TIMEOUT_MS,
  WATCHDOG_INTERVAL_MS,
  canRetry,
  canTransition,
  isActive,
  isExecuting,
  isStalled,
  isTerminal,
  retryDelayMs,
} from "./agent/lifecycle";
