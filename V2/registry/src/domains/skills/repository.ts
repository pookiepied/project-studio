import type { CapabilityRecord } from "@studio/v2-contracts";

/**
 * D1 repository for skill records. Stores metadata + instructions_ref;
 * full instructions are never inlined here. Every query is user-scoped.
 */

export async function listSkills(
  _db: D1Database,
  _userId: string,
): Promise<CapabilityRecord[]> {
  throw new Error("not_implemented");
}
