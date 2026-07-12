import type { ConversationContext } from "@studio/v2-contracts";
import type { Env } from "../system/env";

/**
 * Conversation layer (§19.1): current message, relevant history, prior tool
 * results, attachments. Pulls from Studio Data — relevant slices only, never
 * the full raw history.
 */
export async function buildConversationContext(
  env: Env,
  userId: string,
  conversationId: string | undefined,
  task: string,
): Promise<ConversationContext> {
  if (!conversationId) return { currentMessage: task, relevantHistory: [], priorToolResults: [], attachments: [] };
  const response = await env.DATA.fetch(`http://data/conversations/${encodeURIComponent(conversationId)}/messages`, { headers: { "x-user-id": userId } });
  if (response.status === 404) return { currentMessage: task, relevantHistory: [], priorToolResults: [], attachments: [] };
  if (!response.ok) throw new Error(`Data conversation lookup failed (${response.status}).`);
  const body = await response.json<{ items?: Array<Record<string, unknown>>; messages?: Array<Record<string, unknown>> }>();
  const rows = (body.items ?? body.messages ?? []).slice(-100);
  const relevantHistory = rows.flatMap((row) => {
    const role = row.role;
    const content = typeof row.content === "string" ? row.content.slice(0, 32_000) : "";
    return (role === "user" || role === "assistant" || role === "system") && content
      ? [{ role: role as "user" | "assistant" | "system", content, createdAt: String(row.createdAt ?? row.created_at ?? new Date(0).toISOString()) }]
      : [];
  });
  const priorToolResults = rows.flatMap((row) => Array.isArray(row.toolResults) ? row.toolResults.flatMap((value) => {
    const item = value as Record<string, unknown>;
    return typeof item.toolName === "string" && typeof item.summary === "string" ? [{ toolName: item.toolName, summary: item.summary }] : [];
  }) : []);
  const attachments = rows.flatMap((row) => Array.isArray(row.attachments) ? row.attachments.flatMap((value) => {
    const item = value as Record<string, unknown>;
    return typeof item.attachmentId === "string" ? [{ attachmentId: item.attachmentId, contentType: String(item.contentType ?? "application/octet-stream"), name: String(item.name ?? item.attachmentId) }] : [];
  }) : []);
  return { currentMessage: task, relevantHistory, priorToolResults, attachments };
}
