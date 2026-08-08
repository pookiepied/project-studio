import type { Env } from "../system/env";

export function requireUserId(request: Request): string {
  const userId = request.headers.get("X-User-ID") ?? request.headers.get("x-user-id");
  if (!userId) throw new Error("X-User-ID required");
  return userId;
}

export async function ownsConversation(env: Env, userId: string, conversationId: string): Promise<boolean> {
  const row = await env.DATA_DB.prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?")
    .bind(conversationId, userId)
    .first();
  return Boolean(row);
}

export async function requireOwnedConversation(env: Env, userId: string, conversationId: string | null | undefined): Promise<string | null> {
  if (!conversationId) return null;
  if (!await ownsConversation(env, userId, conversationId)) throw new Error("conversation_not_found");
  return conversationId;
}

export async function readOwnedArtifact(
  env: Env,
  userId: string,
  artifactId: string,
): Promise<{ id: string; conversationId: string | null; currentVersion: number; currentVersionId: string | null } | null> {
  const row = await env.DATA_DB.prepare(
    `SELECT id, conversation_id AS conversationId, current_version AS currentVersion,
      current_version_id AS currentVersionId
     FROM artifact_roots WHERE id = ? AND user_id = ?`,
  ).bind(artifactId, userId).first<{ id: string; conversationId: string | null; currentVersion: number; currentVersionId: string | null }>();
  return row ?? null;
}
