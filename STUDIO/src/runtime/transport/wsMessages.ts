/**
 * Typed discriminated union for every message the AI worker sends over the
 * WebSocket connection. Replaces the previous `Record<string, unknown>` parse
 * which required `as any` casts on every field access in wsPool.handleMessage.
 */

import type { PoolServerMessage } from "../protocol";

// Re-export the envelope type so existing `import { PoolServerMessage } from
// "./wsMessages"` still resolves; the canonical definition lives in
// runtime/protocol.ts (audit B1).
export type { PoolServerMessage };

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
