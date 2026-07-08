import { insertAudit } from "../../storage/queries";
import type { Env } from "../../env";
import type { AuditEntry } from "../../storage/d1";

/**
 * Thin wrapper around the D1 audit inserter. Audit logging is best-effort and
 * never blocks the caller — insertAudit swallows its own errors.
 */
export async function auditLog(env: Env, entry: AuditEntry): Promise<void> {
  return insertAudit(env, entry);
}
