/**
 * ConnectionManager — Centralized connection event bus + state authority.
 *
 * Every subsystem that deals with connectivity (WebSocket pool, MCP server
 * lifecycle, tool execution, future cloud workers) emits events here.
 * Nothing else in the app needs to know where those events come from.
 *
 * Two responsibilities:
 *   1. Event bus — receive and fan out ConnectionEvents to all subscribers
 *   2. State authority — maintain the authoritative view of every
 *      conversation's WS status and every MCP server's health
 *
 * How to add a new event source (e.g. a new agent worker):
 *   1. Import connectionManager in your service
 *   2. Call connectionManager.emit({ type: 'your:event', ... })
 *   3. Done — all subscribers (React UI, logger, future analytics) get it
 *
 * Retry coordination:
 *   wsPool registers per-conversation retry callbacks via registerConversation().
 *   The UI calls connectionManager.retry(convId) — never imports wsPool directly.
 */

import { logger } from "../logging/logger";
import {
  type ConnectionEvent,
  type ConnectionEventType,
  type ConversationActions,
  type ConversationConnectionState,
  type McpServerState,
  type McpServerStatus,
  MAX_RECENT_EVENTS,
} from "./types";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type EventListener = (event: ConnectionEvent) => void;

// ---------------------------------------------------------------------------
// Manager class
// ---------------------------------------------------------------------------

class ConnectionManagerClass {
  private listeners    = new Set<EventListener>();
  private conversations= new Map<string, ConversationConnectionState>();
  private mcpServers   = new Map<string, McpServerState>();
  private recentEvents : ConnectionEvent[] = [];
  private convActions  = new Map<string, ConversationActions>();

  // ── Event bus ──────────────────────────────────────────────────────────────

  /**
   * Emit an event from any subsystem. Applies state transitions, logs the
   * event, then fans it out to every subscriber.
   *
   * Never throws — listener errors are caught so one bad subscriber can't
   * crash the bus.
   */
  emit(event: ConnectionEvent): void {
    this.applyStateTransition(event);

    this.recentEvents.push(event);
    if (this.recentEvents.length > MAX_RECENT_EVENTS) {
      this.recentEvents.shift();
    }

    this.log(event);

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error("ConnectionManager", "Listener threw", err);
      }
    }
  }

  /**
   * Subscribe to all events. Returns an unsubscribe function.
   *
   * Usage:
   *   const unsub = connectionManager.on(event => { ... });
   *   // later:
   *   unsub();
   */
  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Registration ───────────────────────────────────────────────────────────

  /**
   * Register a conversation with optional retry actions (provided by wsPool).
   * Safe to call multiple times for the same convId (idempotent).
   */
  registerConversation(convId: string, actions?: ConversationActions): void {
    if (actions) this.convActions.set(convId, actions);
    if (!this.conversations.has(convId)) {
      this.conversations.set(convId, {
        convId,
        status:           "idle",
        reconnectAttempt: 0,
        lastError:        null,
        canRetry:         false,
      });
    }
  }

  /**
   * Unregister a conversation (called when conversation is deleted/released).
   */
  unregisterConversation(convId: string): void {
    this.convActions.delete(convId);
    this.conversations.delete(convId);
  }

  // ── Retry coordination ─────────────────────────────────────────────────────

  /**
   * True if there is a saved turn body that can be retried for this conversation.
   * Used by the UI to decide whether to show the Retry button.
   */
  canRetry(convId: string): boolean {
    return this.convActions.get(convId)?.canRetry() ?? false;
  }

  /**
   * Retry the last turn for a conversation. Called from the UI when the user
   * clicks "Retry" after a failed connection. Returns false if nothing to retry.
   */
  retry(convId: string): boolean {
    const actions = this.convActions.get(convId);
    if (!actions?.canRetry()) return false;
    const ok = actions.retry();
    if (ok) {
      this.emit({
        type: "ws:reconnecting",
        timestamp: Date.now(),
        convId,
        attempt: 1,
      });
    }
    return ok;
  }

  // ── State accessors ────────────────────────────────────────────────────────

  getConversation(convId: string): ConversationConnectionState | undefined {
    return this.conversations.get(convId);
  }

  getAllConversations(): ConversationConnectionState[] {
    return Array.from(this.conversations.values());
  }

  getMcpServer(name: string): McpServerState | undefined {
    return this.mcpServers.get(name);
  }

  getAllMcpServers(): McpServerState[] {
    return Array.from(this.mcpServers.values());
  }

  getRecentEvents(type?: ConnectionEventType): ConnectionEvent[] {
    if (type) return this.recentEvents.filter(e => e.type === type);
    return [...this.recentEvents];
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private applyStateTransition(event: ConnectionEvent): void {
    const { type, convId, serverName } = event;

    // ── WS / task events → update conversation state ─────────────────────
    if (convId) {
      const existing = this.conversations.get(convId);
      const base: ConversationConnectionState = existing ?? {
        convId,
        status:           "idle",
        reconnectAttempt: 0,
        lastError:        null,
        canRetry:         false,
      };

      let next: ConversationConnectionState | null = null;

      switch (type) {
        case "ws:reconnecting":
          next = { ...base, status: "reconnecting", reconnectAttempt: event.attempt ?? 1, lastError: null };
          break;
        case "ws:reconnected":
          next = { ...base, status: "connected", reconnectAttempt: 0, lastError: null };
          break;
        case "ws:failed":
        case "ws:connect_timeout":
          next = { ...base, status: "failed", lastError: event.error ?? "Connection failed" };
          break;
        case "task:completed_unread":
          next = { ...base, status: "idle" };
          break;
        case "task:error":
          next = { ...base, lastError: event.error ?? null };
          break;
      }

      if (next) {
        // Refresh canRetry from the registered callback
        next.canRetry = this.convActions.get(convId)?.canRetry() ?? false;
        this.conversations.set(convId, next);
      }
    }

    // ── MCP events → update server state ──────────────────────────────────
    if (serverName) {
      const existing = this.mcpServers.get(serverName);
      const base: McpServerState = existing ?? {
        name:         serverName,
        status:       "running",
        restartCount: 0,
        lastEventAt:  0,
      };

      let nextStatus: McpServerStatus | null = null;
      let restartDelta = 0;

      switch (type) {
        case "mcp:crashed":       nextStatus = "crashed";    break;
        case "mcp:restarting":    nextStatus = "restarting"; restartDelta = 1; break;
        case "mcp:restored":      nextStatus = "running";    break;
        case "mcp:restart_failed":nextStatus = "crashed";    break;
      }

      if (nextStatus !== null) {
        this.mcpServers.set(serverName, {
          ...base,
          status:       nextStatus,
          restartCount: base.restartCount + restartDelta,
          lastEventAt:  event.timestamp,
        });
      }
    }
  }

  private log(event: ConnectionEvent): void {
    const parts: string[] = [`[${event.type}]`];
    if (event.convId)     parts.push(`conv=${event.convId.slice(0, 8)}`);
    if (event.serverName) parts.push(`server=${event.serverName}`);
    if (event.toolName)   parts.push(`tool=${event.toolName}`);
    if (event.attempt)    parts.push(`attempt=${event.attempt}`);
    if (event.error)      parts.push(`err=${event.error}`);
    logger.info("ConnectionManager", parts.join(" "));
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const connectionManager = new ConnectionManagerClass();
