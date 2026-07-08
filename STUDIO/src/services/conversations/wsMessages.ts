/**
 * Typed discriminated union for every message the AI worker sends over the
 * WebSocket connection. Replaces the previous `Record<string, unknown>` parse
 * which required `as any` casts on every field access in wsPool.handleMessage.
 */

import type { LocalToolCall } from "../ai/types";

// ---------------------------------------------------------------------------
// Server → client message union
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

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parsePoolMessage(raw: string): PoolServerMessage | null {
  try {
    return JSON.parse(raw) as PoolServerMessage;
  } catch {
    return null;
  }
}
