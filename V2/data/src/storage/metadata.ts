import type { Env } from "../system/env";

/**
 * D1 metadata repositories: conversations, messages, attachments, artifacts.
 * Every query is user-scoped; access control is enforced here, not in routes.
 */

export async function assertOwnership(
  _env: Env,
  _userId: string,
  _table: "conversations" | "attachments" | "artifacts",
  _id: string,
): Promise<void> {
  throw new Error("not_implemented");
}
