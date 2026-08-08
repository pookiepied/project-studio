/**
 * useConnectionManager — React binding for the centralized connection event bus.
 *
 * Subscribe React components to connection state without them knowing anything
 * about wsPool, MCP servers, or any other backend detail.
 *
 * Usage:
 *   const { wsStatus, canRetry, retry, mcpServers, recentEvents } = useConnectionManager(convId);
 *
 * For MCP-only status (e.g. a global status bar):
 *   const { mcpServers } = useConnectionManager();
 */

import { useCallback, useEffect, useReducer } from "react";
import { connectionManager } from "@/core/connection/ConnectionManager";
import type {
  ConnectionEvent,
  ConversationConnectionState,
  McpServerState,
  WsConnectionStatus,
} from "@/core/connection/types";

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

interface ConnectionManagerState {
  /** WS status for the active conversation (undefined if convId not provided). */
  wsStatus:     WsConnectionStatus | undefined;
  /** Whether manual retry is available for the active conversation. */
  canRetry:     boolean;
  /** All tracked MCP servers. */
  mcpServers:   McpServerState[];
  /** Recent events for display (last MAX_RECENT_EVENTS). */
  recentEvents: ConnectionEvent[];
}

function buildState(convId: string | undefined): ConnectionManagerState {
  const conv = convId ? connectionManager.getConversation(convId) : undefined;
  return {
    wsStatus:     conv?.status,
    canRetry:     convId ? connectionManager.canRetry(convId) : false,
    mcpServers:   connectionManager.getAllMcpServers(),
    recentEvents: connectionManager.getRecentEvents(),
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * @param convId Optional conversation ID. When provided, wsStatus and canRetry
 *               reflect that conversation's live WebSocket state.
 */
export function useConnectionManager(convId?: string): ConnectionManagerState & {
  retry: () => boolean;
  conversationState: ConversationConnectionState | undefined;
} {
  // useReducer with an incrementing tick is the simplest way to re-render on
  // external state change without storing derived state in a ref.
  const [, tick] = useReducer(n => n + 1, 0);

  useEffect(() => {
    const unsub = connectionManager.on(() => tick());
    return unsub;
  }, []);

  const retry = useCallback(() => {
    if (!convId) return false;
    return connectionManager.retry(convId);
  }, [convId]);

  return {
    ...buildState(convId),
    conversationState: convId ? connectionManager.getConversation(convId) : undefined,
    retry,
  };
}
