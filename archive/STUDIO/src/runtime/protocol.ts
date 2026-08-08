/**
 * runtime/protocol.ts — the Local Runtime's public wire contract.
 *
 * Single source of truth for the WebSocket envelope exchanged between the cloud
 * agent loop (`chat/src/agent/ChatAgent.ts`) and the Local Runtime, plus the
 * request body and React handler shapes the transport layer wires up. Both
 * `wsPool` and `wsMessages` import from here instead of hand-duplicating the
 * shapes (audit B1). Mirrored on the cloud side by ChatAgent.ts — see the
 * cross-reference comment there.
 *
 * Neutral message DTOs (LocalToolCall / ToolResultItem / AutoRoutedInfo /
 * APIChatMessage) live in `@/types/chat` so both runtime and chat import them
 * downward (D-9).
 */

import type {
  AutoRoutedInfo,
  LocalToolCall,
  ToolResultItem,
} from "@/types/chat";

// ---------------------------------------------------------------------------
// Turn request (client → cloud: { type: "start", body: ChatRequestBody })
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

// ---------------------------------------------------------------------------
// Handlers the React layer wires into the transport (useAgentChat)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Connection lifecycle status
// ---------------------------------------------------------------------------

export type PoolConnectionStatus =
  | "connecting"
  | "idle"
  | "streaming"
  | "permission_needed"
  | "done_unread"
  | "error"
  | "closed";

// ---------------------------------------------------------------------------
// Server → client WS envelope union
// ---------------------------------------------------------------------------

export type PoolServerMessage =
  | {
      type: "stream";
      choices: [{ delta: { content: string } }];
    }
  | {
      type: "thinking";
      vision_substitutions?: Array<{ presignedUrl: string }>;
    }
  | {
      type: "thinking_delta";
      chunk: string;
    }
  | {
      type: "vision_substitutions";
      substitutions: Array<{ presignedUrl: string }>;
    }
  | {
      type: "auto_routed";
      tier: string;
      model: string;
      usedFallback: boolean;
      usedEmergency: boolean;
    }
  | {
      type: "tool_start";
      callId: string;
      tool: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_complete";
      callId: string;
      tool: string;
      result: unknown;
    }
  | {
      type: "local_tools_pending";
      toolCalls: LocalToolCall[];
      pendingSpecialist?: Record<string, unknown>;
    }
  | { type: "done" }
  | { type: "error"; error?: string; message?: string };
