import type { UserContext } from "@studio/v2-contracts";
import type { Env } from "../system/env";

/**
 * User layer (§19.6): preferences, relevant long-term memories, workspace
 * configuration, permission settings.
 */
export async function buildUserContext(
  env: Env,
  userId: string,
  task: string,
): Promise<UserContext> {
  const response = await env.MCP.fetch("http://mcp/internal/native/execute", {
    method: "POST", headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ serviceId: "memory", toolName: "memory_recall", toolArgs: { user_id: userId, query: task, limit: 5 } }),
  });
  if (!response.ok) throw new Error(`Memory lookup failed (${response.status}).`);
  const payload = await response.json<Record<string, unknown>>();
  const parsed = extractMemoryPayload(payload);
  return { preferences: parsed.preferences, relevantMemories: parsed.memories, permissions: [] };
}

function extractMemoryPayload(payload: Record<string, unknown>): { preferences: Record<string, string>; memories: string[] } {
  const result = (payload.result ?? payload) as Record<string, unknown>;
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content.map((item) => (item as Record<string, unknown>).text).find((value): value is string => typeof value === "string");
  if (!text) return { preferences: {}, memories: [] };
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const profile = (data.profile ?? {}) as Record<string, unknown>;
    const preference = Array.isArray(profile.preference) ? profile.preference : [];
    const relevant = Array.isArray(data.relevant) ? data.relevant : [];
    return {
      preferences: Object.fromEntries(preference.map((value, index) => [String(index), typeof value === "string" ? value : String((value as Record<string, unknown>).content ?? "")])),
      memories: relevant.map((value) => typeof value === "string" ? value : String((value as Record<string, unknown>).content ?? "")).filter(Boolean),
    };
  } catch { return { preferences: {}, memories: [text.slice(0, 8_000)] }; }
}
