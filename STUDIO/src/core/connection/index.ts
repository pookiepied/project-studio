/**
 * Connection management — public surface
 *
 * Import everything from here. Never import from individual files inside
 * this folder — the barrel controls the public API.
 *
 * Quick start for a new subsystem:
 *   import { connectionManager, CONNECTION_TIMEOUTS } from "@/core/connection";
 *   connectionManager.emit({ type: "ws:reconnecting", timestamp: Date.now(), convId });
 */

export { connectionManager } from "./ConnectionManager";
export {
  CONNECTION_TIMEOUTS,
  MAX_RECENT_EVENTS,
} from "./types";
export type {
  ConnectionEvent,
  ConnectionEventType,
  ConversationActions,
  ConversationConnectionState,
  McpServerState,
  McpServerStatus,
  WsConnectionStatus,
} from "./types";
