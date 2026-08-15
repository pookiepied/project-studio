import type { StudioDatabase } from "../storage/database.js";
import type { SecureCredentialStore } from "../credentials/credential-store.js";
import type { McpServerRecord } from "../extend/mcp/registry.js";
import type { McpServerStatus } from "../extend/mcp/supervisor.js";

/**
 * Typed ports for 008.3 — transport and agents must consume these, not StudioRuntime concrete.
 * Each port is the single owner for its table(s) and the only way to touch them.
 * New cross-domain behavior must go through a port, event, or application service.
 */

export interface McpManagementPort {
  list(): readonly McpServerRecord[];
  get(id: string): McpServerRecord | undefined;
  save(record: McpServerRecord, auth: unknown): void;
  remove(id: string, auth: unknown): Promise<boolean>;
  setEnabled(projectId: string, serverId: string, enabled: boolean, auth: unknown): void;
  isEnabled(projectId: string, serverId: string): boolean;
  status(id: string): McpServerStatus | undefined;
  statuses(): readonly McpServerStatus[];
}

export interface PermissionPort {
  // Grants are owned by PermissionGrantStore; kernel is the decider, not the store.
  // This port exposes only grant inspection/management, never raw SQL.
  listGrants(): ReturnType<import("../permissions/grant-store.js").PermissionGrantStore["list"]>;
  revokeGrant(id: string): boolean;
}

export interface StoragePort {
  // Opaque — no handle exposure. Only the storage domain may call DatabaseSync.
  readonly db: StudioDatabase;
  transaction<T>(fn: () => T): T;
}

export interface HarnessPorts {
  readonly mcp: McpManagementPort;
  readonly permissions: PermissionPort;
  readonly storage: StoragePort;
  readonly credentials: SecureCredentialStore;
}

/**
 * Transaction / compensation helper for 008.3-05.
 * Cross-domain ops that touch mcp_server + permission_grant + selection + keychain + supervisor
 * must be in `db.transaction()` or have explicit compensation. This helper documents the rule.
 * Usage:
 *   db.transaction(() => {
 *     registry.save(record);
 *     selection.set(projectId, id, true);
 *   });
 * If keychain fails after DB commit, compensation is `registry.remove(id)` + log.
 */
export function withCompensation<T>(db: StudioDatabase, work: () => T, compensate: () => void): T {
  try {
    return db.transaction(work);
  } catch (error) {
    try {
      compensate();
    } catch {}
    throw error;
  }
}
