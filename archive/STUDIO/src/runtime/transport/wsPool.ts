/**
 * wsPool — Singleton WebSocket pool for multi-conversation support.
 *
 * Keeps one persistent WebSocket connection per conversation. Connections
 * survive conversation switches so background conversations keep streaming
 * and local tool calls keep executing — even in the Tauri desktop app.
 *
 * Lifecycle:
 *   useAgentChat calls attachHandlers() on mount   → events flow to React UI
 *   useAgentChat calls detachHandlers() on unmount → events buffer here
 *   When handlers re-attach, buffered content is flushed immediately
 *
 * Permission flow when in background:
 *   local_tools_pending arrives → stored here → status = permission_needed
 *   When handlers re-attach → onLocalToolsPending called → normal UI flow
 *   Tool results sent back via still-open WebSocket
 */

import { TAURI_CONFIG } from "@/core/config/tauriConfig";
import type {
  AgentChatHandlers,
  ChatRequestBody,
  PoolConnectionStatus,
} from "../protocol";
import type { LocalToolCall, ToolResultItem } from "@/types/chat";
import { parsePoolMessage } from "./wsMessages";
import { logger } from "@/core/logging/logger";
import { connectionManager } from "@/core/connection";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingToolRequest {
  toolCalls: LocalToolCall[];
  pendingSpecialist?: Record<string, unknown>;
}

interface PendingToolResults {
  results: ToolResultItem[];
  pendingSpecialist?: Record<string, unknown>;
}

interface PooledConnection {
  convId: string;
  ws: WebSocket | null;
  status: PoolConnectionStatus;
  bufferedText: string;
  handlers: AgentChatHandlers | null;
  pendingTools: PendingToolRequest | null;
  // Body queued to send as soon as the socket finishes connecting.
  // Stored on conn (not closure) so startTurn can set it while CONNECTING.
  pendingBody: ChatRequestBody | null;
  // Last body that was actually sent — kept so we can notify on reconnect.
  // Cleared on done/error. Never re-sent automatically; CF Agent fiber resumes.
  lastSentBody: ChatRequestBody | null;
  // Tool results queued when socket closed during executeAndSend.
  // Flushed on the next successful open.
  pendingToolResults: PendingToolResults | null;
  pendingDone: boolean;   // done arrived before handlers attached
  reconnects: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  keepaliveTimer: ReturnType<typeof setInterval> | null;
  connectTimeoutTimer: ReturnType<typeof setTimeout> | null;
}

type StatusListener = (convId: string, status: PoolConnectionStatus) => void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WS_BASE = TAURI_CONFIG.API_BASE_URL.replace(/^https?:\/\//, (m) =>
  m.startsWith("https") ? "wss://" : "ws://"
);
const MAX_RECONNECTS = 3;
const BASE_RECONNECT_MS = 500;
// How long to wait for WebSocket to finish connecting before giving up.
const CONNECT_TIMEOUT_MS = 10_000;
// Keepalive ping interval — Cloudflare closes idle WebSockets after 90s.
const KEEPALIVE_INTERVAL_MS = 25_000;

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

class WsPool {
  private connections = new Map<string, PooledConnection>();
  private statusListeners = new Set<StatusListener>();

  // ── Public API ────────────────────────────────────────────────────────────

  /** Ensure a connection exists for this conversation. Creates one if needed. */
  ensure(convId: string): void {
    if (!this.connections.has(convId)) {
      this.connections.set(convId, {
        convId,
        ws: null,
        status: "idle",
        bufferedText: "",
        handlers: null,
        pendingTools: null,
        pendingBody: null,
        lastSentBody: null,
        pendingToolResults: null,
        pendingDone: false,
        reconnects: 0,
        reconnectTimer: null,
        keepaliveTimer: null,
        connectTimeoutTimer: null,
      });
    }
    // Register with the centralized ConnectionManager so the UI can observe
    // status and call retry without importing wsPool directly.
    connectionManager.registerConversation(convId, {
      retry:    () => this.retryLastTurn(convId),
      canRetry: () => (this.connections.get(convId)?.lastSentBody ?? null) !== null,
    });
  }

  /**
   * Re-open the socket and re-send the last sent body.
   * Called by ConnectionManager when the user clicks "Retry".
   */
  retryLastTurn(convId: string): boolean {
    const conn = this.connections.get(convId);
    if (!conn?.lastSentBody) return false;
    const body = conn.lastSentBody;
    // Re-queue and reconnect — lastSentBody stays set until done/error clears it.
    conn.pendingBody = body;
    this.openSocket(conn);
    return true;
  }

  /**
   * Attach React UI handlers to a connection.
   * Immediately flushes any buffered text/done. If a permission request was
   * stored, calls onLocalToolsPending right away so the normal approval UI appears.
   */
  attachHandlers(convId: string, handlers: AgentChatHandlers): void {
    this.ensure(convId);
    const conn = this.connections.get(convId)!;
    conn.handlers = handlers;

    // Flush buffered streaming text
    if (conn.bufferedText) {
      handlers.onChunk(conn.bufferedText);
      conn.bufferedText = "";
    }

    // Flush a done event that arrived before we had handlers
    if (conn.pendingDone) {
      conn.pendingDone = false;
      handlers.onDone();
      return;
    }

    // Resume a paused permission request
    if (conn.status === "permission_needed" && conn.pendingTools) {
      const { toolCalls, pendingSpecialist } = conn.pendingTools;
      conn.pendingTools = null;
      this.setStatus(conn, "streaming");
      this.executeAndSend(conn, toolCalls, pendingSpecialist, handlers);
    }

    // Open socket if it isn't already
    if (!conn.ws || conn.ws.readyState === WebSocket.CLOSED) {
      this.openSocket(conn);
    }
  }

  /** Detach UI handlers — connection stays alive, events buffer. */
  detachHandlers(convId: string): void {
    const conn = this.connections.get(convId);
    if (conn) conn.handlers = null;
  }

  /** Send a new chat turn. */
  startTurn(convId: string, body: ChatRequestBody): void {
    this.ensure(convId);
    const conn = this.connections.get(convId)!;
    const ws = conn.ws;
    conn.lastSentBody = body;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "start", body }));
    } else if (ws?.readyState === WebSocket.CONNECTING) {
      // Socket is still opening — store body on conn so onopen can send it.
      conn.pendingBody = body;
    } else {
      // No socket yet (or closed) — open one; pendingBody will be sent in onopen.
      conn.pendingBody = body;
      this.openSocket(conn);
    }
  }

  /** Explicitly abort a conversation's connection (user pressed stop). */
  abort(convId: string): void {
    const conn = this.connections.get(convId);
    if (!conn) return;
    // Clear all queued state so nothing from the aborted turn leaks into the next one.
    conn.pendingBody = null;
    conn.lastSentBody = null;
    conn.pendingToolResults = null;
    this.closeSocket(conn, true);
    this.setStatus(conn, "idle");
    // Reconnect so the DO is ready for the next turn
    this.openSocket(conn);
  }

  /** Release a connection entirely (conversation deleted). */
  release(convId: string): void {
    const conn = this.connections.get(convId);
    if (!conn) return;
    this.closeSocket(conn, true);
    this.connections.delete(convId);
  }

  getStatus(convId: string): PoolConnectionStatus | null {
    return this.connections.get(convId)?.status ?? null;
  }

  isConnected(convId: string): boolean {
    const ws = this.connections.get(convId)?.ws;
    return ws?.readyState === WebSocket.OPEN;
  }

  subscribe(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private openSocket(conn: PooledConnection): void {
    if (conn.ws && conn.ws.readyState !== WebSocket.CLOSED) {
      // Already open or connecting — if OPEN, flush any queued state now.
      if (conn.ws.readyState === WebSocket.OPEN) {
        if (conn.pendingBody) {
          conn.ws.send(JSON.stringify({ type: "start", body: conn.pendingBody }));
          conn.pendingBody = null;
        }
        if (conn.pendingToolResults) {
          const { results, pendingSpecialist } = conn.pendingToolResults;
          conn.pendingToolResults = null;
          conn.ws.send(JSON.stringify({
            type: "tool_results",
            results,
            ...(pendingSpecialist ? { pending_specialist: pendingSpecialist } : {}),
          }));
        }
      }
      return;
    }

    if (conn.reconnectTimer) {
      clearTimeout(conn.reconnectTimer);
      conn.reconnectTimer = null;
    }

    const url = `${WS_BASE}/agents/chat-agent/${encodeURIComponent(conn.convId)}`;
    const ws = new WebSocket(url);
    conn.ws = ws;

    // Fail fast if the server never accepts the connection.
    conn.connectTimeoutTimer = setTimeout(() => {
      if (conn.ws?.readyState === WebSocket.CONNECTING) {
        logger.warn("wsPool", `Connect timeout for ${conn.convId} — server not responding`);
        conn.ws.onclose = null;
        conn.ws.close();
        conn.ws = null;
        conn.connectTimeoutTimer = null;
        if (conn.reconnects < MAX_RECONNECTS) {
          const delay = BASE_RECONNECT_MS * 2 ** conn.reconnects * (0.5 + Math.random() * 0.5);
          conn.reconnects++;
          connectionManager.emit({ type: "ws:connect_timeout", timestamp: Date.now(), convId: conn.convId, attempt: conn.reconnects, error: "Socket stuck in CONNECTING" });
          conn.reconnectTimer = setTimeout(() => this.openSocket(conn), delay);
        } else {
          connectionManager.emit({ type: "ws:failed", timestamp: Date.now(), convId: conn.convId, error: "Connection timed out after max attempts" });
          this.setStatus(conn, "error");
          conn.handlers?.onError("Connection timed out. Please check your network and try again.");
        }
      }
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      conn.reconnects = 0;

      if (conn.connectTimeoutTimer) {
        clearTimeout(conn.connectTimeoutTimer);
        conn.connectTimeoutTimer = null;
      }

      // Start keepalive pings to prevent Cloudflare's 90s idle close.
      conn.keepaliveTimer = setInterval(() => {
        if (conn.ws?.readyState === WebSocket.OPEN) {
          conn.ws.send(JSON.stringify({ type: "ping" }));
        }
      }, KEEPALIVE_INTERVAL_MS);

      // Flush queued turn body (new turn queued while connecting).
      if (conn.pendingBody) {
        ws.send(JSON.stringify({ type: "start", body: conn.pendingBody }));
        conn.pendingBody = null;
      }

      // Flush queued tool results (results were ready but socket was closed).
      // Sent after pendingBody so the DO processes them in the right order.
      if (conn.pendingToolResults) {
        const { results, pendingSpecialist } = conn.pendingToolResults;
        conn.pendingToolResults = null;
        ws.send(JSON.stringify({
          type: "tool_results",
          results,
          ...(pendingSpecialist ? { pending_specialist: pendingSpecialist } : {}),
        }));
      }

      // If we were mid-turn when the connection dropped, notify the UI and
      // the centralized ConnectionManager — the CF Agent fiber resumes automatically.
      if (conn.lastSentBody) {
        logger.warn("wsPool", `Reconnected mid-turn for ${conn.convId} — CF fiber should resume`);
        connectionManager.emit({ type: "ws:reconnected", timestamp: Date.now(), convId: conn.convId });
        conn.handlers?.onReconnected?.();
      }
    };

    ws.onmessage = (event) => {
      this.handleMessage(conn, event.data as string);
    };

    ws.onerror = () => {
      // onerror is always followed by onclose — handle there
    };

    ws.onclose = (event) => {
      conn.ws = null;

      if (conn.keepaliveTimer) {
        clearInterval(conn.keepaliveTimer);
        conn.keepaliveTimer = null;
      }
      if (conn.connectTimeoutTimer) {
        clearTimeout(conn.connectTimeoutTimer);
        conn.connectTimeoutTimer = null;
      }

      if (event.code !== 1000 && conn.reconnects < MAX_RECONNECTS) {
        const delay = BASE_RECONNECT_MS * 2 ** conn.reconnects * (0.5 + Math.random() * 0.5);
        conn.reconnects++;
        logger.warn("wsPool", `WS closed for ${conn.convId} (code ${event.code}), reconnect attempt ${conn.reconnects}`);
        if (conn.lastSentBody) {
          connectionManager.emit({ type: "ws:reconnecting", timestamp: Date.now(), convId: conn.convId, attempt: conn.reconnects });
          conn.handlers?.onReconnecting?.(conn.reconnects);
        }
        conn.reconnectTimer = setTimeout(() => this.openSocket(conn), delay);
      } else if (event.code !== 1000) {
        logger.warn("wsPool", `WS permanently closed for ${conn.convId} after ${conn.reconnects} attempts`);
        connectionManager.emit({ type: "ws:failed", timestamp: Date.now(), convId: conn.convId, error: `Closed with code ${event.code} after ${conn.reconnects} attempts` });
        this.setStatus(conn, "error");
        conn.handlers?.onError("Connection failed after multiple attempts. Please check your network and try again.");
      }
    };
  }

  private closeSocket(conn: PooledConnection, intentional = false): void {
    if (conn.reconnectTimer) {
      clearTimeout(conn.reconnectTimer);
      conn.reconnectTimer = null;
    }
    if (conn.keepaliveTimer) {
      clearInterval(conn.keepaliveTimer);
      conn.keepaliveTimer = null;
    }
    if (conn.connectTimeoutTimer) {
      clearTimeout(conn.connectTimeoutTimer);
      conn.connectTimeoutTimer = null;
    }
    if (conn.ws) {
      if (intentional) conn.ws.onclose = null;
      conn.ws.close(intentional ? 1000 : undefined, intentional ? "intentional" : undefined);
      conn.ws = null;
    }
  }

  private setStatus(conn: PooledConnection, status: PoolConnectionStatus): void {
    if (conn.status === status) return;
    conn.status = status;
    for (const l of this.statusListeners) l(conn.convId, status);
  }

  private async handleMessage(conn: PooledConnection, raw: string): Promise<void> {
    const msg = parsePoolMessage(raw);
    if (!msg) return;

    const h = conn.handlers;

    switch (msg.type) {
      case "stream": {
        const text = msg.choices[0]?.delta?.content;
        if (typeof text !== "string") break;
        if (h) {
          h.onChunk(text);
        } else {
          conn.bufferedText += text;
        }
        if (conn.status !== "streaming") this.setStatus(conn, "streaming");
        break;
      }

      case "thinking":
        h?.onThinking?.();
        if (msg.vision_substitutions?.length) {
          h?.onVisionSubstitutions?.(msg.vision_substitutions);
        }
        break;

      case "thinking_delta":
        h?.onThinkingDelta?.(msg.chunk);
        break;

      case "vision_substitutions":
        h?.onVisionSubstitutions?.(msg.substitutions);
        break;

      case "auto_routed":
        h?.onAutoRouted?.(msg);
        break;

      case "tool_start":
        h?.onToolStart?.(msg.callId, msg.tool, msg.args);
        break;

      case "tool_complete":
        h?.onToolComplete?.(msg.callId, msg.tool, msg.result);
        break;

      case "local_tools_pending": {
        const { toolCalls, pendingSpecialist } = msg;
        if (h) {
          // Handlers are attached — normal flow
          this.executeAndSend(conn, toolCalls, pendingSpecialist, h);
        } else {
          // Background — store and notify
          conn.pendingTools = { toolCalls, pendingSpecialist };
          this.setStatus(conn, "permission_needed");
        }
        break;
      }

      case "done":
        conn.lastSentBody = null;  // turn complete — no longer mid-turn
        if (h) {
          h.onDone();
          this.setStatus(conn, "idle");
        } else {
          // Handlers not attached yet — buffer so attachHandlers can flush it.
          conn.pendingDone = true;
          this.setStatus(conn, "done_unread");
          connectionManager.emit({ type: "task:completed_unread", timestamp: Date.now(), convId: conn.convId });
        }
        break;

      case "error": {
        const errMsg = msg.error ?? msg.message ?? "Unknown agent error";
        // "Unknown message type" is sent by older backend versions when they
        // receive a keepalive ping that they don't recognise. It is NOT a real
        // error — the backend fix adds ping handling, but this guard protects
        // against mismatched deploys while the backend propagates.
        if (errMsg === "Unknown message type") {
          logger.warn("wsPool", `Ignoring stale ping-echo error for ${conn.convId}`);
          break;
        }
        conn.lastSentBody = null;  // turn ended in error
        connectionManager.emit({ type: "task:error", timestamp: Date.now(), convId: conn.convId, error: errMsg });
        h?.onError(errMsg);
        this.setStatus(conn, "error");
        break;
      }
    }
  }

  private async executeAndSend(
    conn: PooledConnection,
    toolCalls: LocalToolCall[],
    pendingSpecialist: Record<string, unknown> | undefined,
    handlers: AgentChatHandlers
  ): Promise<void> {
    let results: ToolResultItem[] = [];
    try {
      results = await handlers.onLocalToolsPending(toolCalls, pendingSpecialist);
    } catch (err) {
      results = toolCalls.map((tc) => ({
        call_id: tc.callId,
        content: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
        name: tc.tool,
      }));
    }

    if (conn.ws?.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify({
        type: "tool_results",
        results,
        ...(pendingSpecialist ? { pending_specialist: pendingSpecialist } : {}),
      }));
    } else {
      // Socket closed while tools were executing — queue results so they are
      // delivered on the next successful reconnect instead of being silently dropped.
      logger.warn("wsPool", `Socket closed during tool execution for ${conn.convId} — queuing results`);
      conn.pendingToolResults = { results, pendingSpecialist };
      if (!conn.ws || conn.ws.readyState === WebSocket.CLOSED) {
        this.openSocket(conn);
      }
    }
  }
}

export const wsPool = new WsPool();
