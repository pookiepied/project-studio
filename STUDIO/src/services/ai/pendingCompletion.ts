/**
 * pendingCompletion — client for the ChatAgent DO catch-up endpoints.
 *
 * When the agent loop finishes but the client WebSocket was already closed
 * (browser closed, navigation, etc.), the DO saves the completed text to its
 * own SQLite state. These helpers let the client retrieve and clear it the
 * next time the conversation is loaded.
 *
 * Endpoints (forwarded api → ai worker via /agents/* bypass):
 *   GET    /agents/chat-agent/{id}/completed → { content: string | null }
 *   DELETE /agents/chat-agent/{id}/completed → { ok: true }
 */

import { TAURI_CONFIG } from "../../core/config/tauriConfig";
import { tokenManager } from "../../utils/tokenManager";

const AGENT_BASE = `${TAURI_CONFIG.API_BASE_URL}/agents/chat-agent`;

async function authHeaders(): Promise<Record<string, string>> {
  const token = await tokenManager.getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Returns the completed response text saved by the DO, or null if nothing
 * is pending. Safe to call on every conversation load — returns quickly.
 */
export async function fetchPendingCompletion(conversationId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${AGENT_BASE}/${encodeURIComponent(conversationId)}/completed`,
      { headers: await authHeaders() }
    );
    if (!res.ok) return null;
    const data = await res.json() as { content?: string | null };
    return data.content ?? null;
  } catch {
    return null;
  }
}

/**
 * Tells the DO to discard the saved content after the client has stored it.
 * Fire-and-forget — failure leaves stale DO state that is harmless.
 */
export async function clearPendingCompletion(conversationId: string): Promise<void> {
  try {
    await fetch(
      `${AGENT_BASE}/${encodeURIComponent(conversationId)}/completed`,
      { method: "DELETE", headers: await authHeaders() }
    );
  } catch { /* non-critical */ }
}
