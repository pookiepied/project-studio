/**
 * useAgentChat — thin React adapter over wsPool.
 *
 * Previously managed its own WebSocket. Now delegates entirely to wsPool so
 * that background conversations keep running when the user switches chats.
 *
 * Lifecycle:
 *   mount / convId change → wsPool.attachHandlers()   (flushes any buffered content)
 *   unmount              → wsPool.detachHandlers()    (socket stays alive in pool)
 *
 * The explicit abort() call is the only thing that actually closes a socket —
 * and even then, wsPool re-opens it immediately so the DO is ready for the
 * next turn on that conversation.
 */

import { useEffect, useRef, useCallback } from "react";
import { wsPool } from "../services/conversations/wsPool";
import type { LocalToolCall, AutoRoutedInfo, ToolResultItem } from "../services/ai/types";

// ---------------------------------------------------------------------------
// Re-exported types (consumers import from here)
// ---------------------------------------------------------------------------

export interface ChatRequestBody {
  messages: unknown[];
  model: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  local_engine_connected?: boolean;
  running_mcp_servers?: string[];
  storage_scope?: "cloud" | "local";
  persistence?: "cloud" | "client_local";
  user_id?: string;
  reasoning_budget?: number;
}

export interface AgentChatHandlers {
  onChunk(text: string): void;
  onDone(): void;
  onError(message: string): void;
  onThinking?(): void;
  onThinkingDelta?(chunk: string): void;
  onAutoRouted?(info: AutoRoutedInfo): void;
  onVisionSubstitutions?(subs: Array<{ presignedUrl: string }>): void;
  onToolStart?(callId: string, tool: string, args: Record<string, unknown>): void;
  onToolComplete?(callId: string, tool: string, result: unknown): void;
  onLocalToolsPending(
    toolCalls: LocalToolCall[],
    pendingSpecialist?: Record<string, unknown>
  ): Promise<ToolResultItem[]>;
  /** Called when the WebSocket drops mid-turn and a reconnect is attempted. */
  onReconnecting?(attempt: number): void;
  /** Called when the WebSocket reconnects successfully after a mid-turn drop. */
  onReconnected?(): void;
}

export interface UseAgentChatReturn {
  startTurn(body: ChatRequestBody, explicitConvId?: string): void;
  abort(): void;
  isConnected: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgentChat(
  conversationId: string | null,
  handlers: AgentChatHandlers
): UseAgentChatReturn {
  // Keep a ref so the proxy always calls the latest handlers without needing
  // to re-attach on every render.
  const handlersRef = useRef<AgentChatHandlers>(handlers);
  handlersRef.current = handlers;

  // Stable proxy — identity never changes, always delegates to the latest ref.
  const proxy = useRef<AgentChatHandlers>({
    onChunk:               (t)    => handlersRef.current.onChunk(t),
    onDone:                ()     => handlersRef.current.onDone(),
    onError:               (m)    => handlersRef.current.onError(m),
    onThinking:            ()     => handlersRef.current.onThinking?.(),
    onThinkingDelta:       (c)    => handlersRef.current.onThinkingDelta?.(c),
    onAutoRouted:          (i)    => handlersRef.current.onAutoRouted?.(i),
    onVisionSubstitutions: (s)    => handlersRef.current.onVisionSubstitutions?.(s),
    onToolStart:           (i,t,a)=> handlersRef.current.onToolStart?.(i,t,a),
    onToolComplete:        (i,t,r)=> handlersRef.current.onToolComplete?.(i,t,r),
    onLocalToolsPending:   (tc,ps)=> handlersRef.current.onLocalToolsPending(tc,ps),
    onReconnecting:        (n)    => handlersRef.current.onReconnecting?.(n),
    onReconnected:         ()     => handlersRef.current.onReconnected?.(),
  });

  // Attach / detach handlers when the active conversation changes.
  useEffect(() => {
    if (!conversationId) return;
    wsPool.attachHandlers(conversationId, proxy.current);
    return () => {
      wsPool.detachHandlers(conversationId);
      // Socket intentionally stays alive in the pool.
    };
  }, [conversationId]);

  const startTurn = useCallback(
    (body: ChatRequestBody, explicitConvId?: string) => {
      const id = explicitConvId ?? conversationId;
      if (!id) return;
      wsPool.startTurn(id, body);
    },
    [conversationId]
  );

  const abort = useCallback(() => {
    if (conversationId) wsPool.abort(conversationId);
  }, [conversationId]);

  return {
    startTurn,
    abort,
    get isConnected() {
      return conversationId ? wsPool.isConnected(conversationId) : false;
    },
  };
}
