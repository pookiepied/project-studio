/**
 * Auth middleware
 * - Gateway consumers: Bearer sk-gw_* -> verify via SHA-256 hash in D1 gateway_keys
 * - Admin: Bearer admin token (future) - for now, check header x-admin-token == ADMIN_TOKEN secret
 */

import { hashGatewayKeyAsync } from "../lib/encryption.ts";
import { verifyGatewayKey } from "../lib/db.ts";
import { unauthorized, forbidden } from "../lib/errors.ts";
import type { Env } from "../index.ts";

export async function gatewayAuth(_c: { env: Env; req: Request; set: (k: string, v: unknown) => void }, _next: () => Promise<void>): Promise<void> {
  // Placeholder - actual Hono middleware signature varies
}

export async function verifyGatewayBearer(db: D1Database, authHeader: string | null): Promise<{ keyId: string; rpm: number } | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const raw = authHeader.slice(7).trim();
  if (!raw.startsWith("sk-gw_")) return null;
  const hash = await hashGatewayKeyAsync(raw);
  const row = await verifyGatewayKey(db, hash);
  if (!row) return null;
  // Update last_used_at async (fire and forget)
  return { keyId: row.id, rpm: row.rate_limit_rpm };
}

function isDevelopment(environment: string | undefined): boolean {
  return environment === "development" || environment === "test";
}

/**
 * Consumer admission is keyless only in an explicitly local development
 * environment. Deployed environments fail closed even when the key table is
 * empty, rather than turning an empty migration into public model access.
 */
export async function requireGatewayBearer(
  db: D1Database,
  authHeader: string | null,
  environment: string | undefined,
): Promise<{ keyId: string; rpm: number } | null> {
  const verified = await verifyGatewayBearer(db, authHeader);
  const keyCount = await db
    .prepare("SELECT COUNT(*) as cnt FROM gateway_keys WHERE enabled = 1")
    .first<{ cnt: number }>();
  const hasKeys = (keyCount?.cnt ?? 0) > 0;

  if (verified) return verified;
  if (isDevelopment(environment) && !hasKeys) return null;
  throw unauthorized("Valid Gateway bearer authentication is required");
}

export function requireAdmin(c: { env: Env; req: { header: (s: string) => string | undefined } }): void {
  const adminToken = c.env.ADMIN_TOKEN;
  if (!adminToken) {
    if (isDevelopment(c.env.ENVIRONMENT)) return;
    throw unauthorized("Gateway admin authentication is not configured");
  }
  const header = c.req.header("x-admin-token") ?? c.req.header("authorization")?.replace("Bearer ", "");
  if (header !== adminToken) throw forbidden("Admin token required");
}
