import type { UserContext } from "@studio/v2-contracts";
import type { Env } from "../system/env";

/**
 * User layer (§19.6): preferences, relevant long-term memories, workspace
 * configuration, permission settings.
 */
export async function buildUserContext(
  _env: Env,
  _userId: string,
  _task: string,
): Promise<UserContext> {
  throw new Error("not_implemented");
}
