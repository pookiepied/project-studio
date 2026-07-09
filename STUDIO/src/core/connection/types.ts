/**
 * Connection Management — Type System
 *
 * Single source of truth for every timeout constant, event shape, and state
 * type used across the entire connection management system.
 *
 * Adding a new timeout, new event type, or new state field? Start here.
 * Nothing else in the codebase should hardcode these values.
 *
 * Layer map:
 *   Frontend (wsPool, useHarnessInit, toolExecutor)
 *     → emits ConnectionEvents to ConnectionManager
 *   ConnectionManager
 *     → maintains authoritative state, re-emits to React
 *   useConnectionManager hook
 *     → subscribes React components to connection state
 *   UI components (ConnectionStatusBar, ToastSystem)
 *     → render state, surface actions (retry, dismiss)
 */

// ---------------------------------------------------------------------------
// Timeout constants — one place, used everywhere
// ---------------------------------------------------------------------------

export const CONNECTION_TIMEOUTS = {
  // Frontend — WebSocket
  WS_KEEPALIVE_INTERVAL_MS:  25_000,  // ping to prevent CF 90s idle close
  WS_CONNECT_TIMEOUT_MS:     10_000,  // max wait for socket to open
  WS_MAX_RECONNECTS:              3,  // attempts before giving up

  // Frontend — Tool gates
  TOOL_APPROVAL_TIMEOUT_MS: 300_000,  // 5 min: waitForApproval auto-deny
  TOOL_ANSWER_TIMEOUT_MS:   300_000,  // 5 min: waitForAnswer auto-reply
  TOOL_GLOBAL_ACCESS_TIMEOUT_MS: 300_000,  // 5 min: requestGlobalAccess auto-deny

  // Frontend — MCP servers
  MCP_HEALTH_CHECK_INTERVAL_MS: 30_000,  // how often to poll for crashes
  MCP_MAX_AUTO_RESTARTS:             5,  // give up after N crashes in a session
  MCP_MANIFEST_SYNC_MAX_ATTEMPTS:    5,  // manifest push retries before deferring
  MCP_MANIFEST_SYNC_BASE_DELAY_MS: 1_000,  // exponential backoff base (jittered)

  // Cloud (documented here for reference — enforced in workers)
  CLOUD_LLM_FETCH_TIMEOUT_MS:   20_000,  // agents Worker AbortSignal for LLM calls
  CLOUD_AGENT_MAX_STEPS:            15,  // research sub-agent default loop cap
  CLOUD_TOOL_CALL_TIMEOUT_MS:   60_000,  // ServiceBindingMCPTool / HubTool fetch
} as const;

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

/**
 * Every subsystem (wsPool, useHarnessInit, toolExecutor, future workers)
 * emits one of these event types. The ConnectionManager is the single consumer.
 *
 * Naming convention: <source>:<action>
 */
export type ConnectionEventType =
  // WebSocket lifecycle
  | 'ws:reconnecting'         // socket dropped mid-turn, retrying
  | 'ws:reconnected'          // socket restored after drop
  | 'ws:failed'               // gave up after WS_MAX_RECONNECTS
  | 'ws:connect_timeout'      // socket stuck in CONNECTING state
  // MCP server lifecycle
  | 'mcp:crashed'             // Node.js process exited unexpectedly
  | 'mcp:restarting'          // auto-restart triggered
  | 'mcp:restored'            // server back online after restart
  | 'mcp:restart_failed'      // restart failed (MCP_MAX_AUTO_RESTARTS exceeded)
  // Tool execution
  | 'tool:approval_timeout'   // waitForApproval timed out
  | 'tool:answer_timeout'     // waitForAnswer timed out
  // Task lifecycle
  | 'task:completed_unread'   // done event arrived while handlers were detached
  | 'task:error';             // turn ended in error

export interface ConnectionEvent {
  type:         ConnectionEventType;
  timestamp:    number;
  convId?:      string;   // present for ws: and task: events
  serverName?:  string;   // present for mcp: events
  toolName?:    string;   // present for tool: events
  attempt?:     number;   // for ws:reconnecting — which attempt (1–N)
  error?:       string;   // human-readable error message
}

// ---------------------------------------------------------------------------
// State shapes
// ---------------------------------------------------------------------------

export type WsConnectionStatus =
  | 'idle'          // no active turn
  | 'connecting'    // socket opening
  | 'connected'     // socket open, no issues
  | 'reconnecting'  // socket dropped, retrying
  | 'failed';       // gave up — user action required

export interface ConversationConnectionState {
  convId:            string;
  status:            WsConnectionStatus;
  reconnectAttempt:  number;       // 0 when not reconnecting
  lastError:         string | null;
  canRetry:          boolean;      // true when lastSentBody is available
}

export type McpServerStatus =
  | 'running'     // healthy
  | 'crashed'     // process exited
  | 'restarting'  // auto-restart in progress
  | 'stopped';    // manually stopped or never started

export interface McpServerState {
  name:          string;
  status:        McpServerStatus;
  restartCount:  number;   // how many auto-restarts this session
  lastEventAt:   number;   // timestamp of last status change
}

// ---------------------------------------------------------------------------
// Registration interface — how subsystems plug into ConnectionManager
// ---------------------------------------------------------------------------

/**
 * Provided by wsPool when registering a conversation.
 * ConnectionManager never imports wsPool — it only calls these callbacks.
 */
export interface ConversationActions {
  /** Re-send the last sent turn body. Returns false if nothing to retry. */
  retry:    () => boolean;
  /** True if there is a saved turn body that can be retried. */
  canRetry: () => boolean;
}

// ---------------------------------------------------------------------------
// Internal ring-buffer size
// ---------------------------------------------------------------------------

export const MAX_RECENT_EVENTS = 100;
