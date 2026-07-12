import type { Env } from "../system/env";

/**
 * D1 metadata repositories: conversations, messages, attachments, artifacts.
 * Every query is user-scoped; access control is enforced here, not in routes.
 */

export async function assertOwnership(
  env: Env, userId: string,
  table: "conversations" | "attachments" | "artifacts",
  id: string,
): Promise<void> {
  const row=await env.DATA_DB.prepare(`SELECT id FROM ${table} WHERE id=? AND user_id=?`).bind(id,userId).first();
  if(!row)throw new Error("not_found");
}
