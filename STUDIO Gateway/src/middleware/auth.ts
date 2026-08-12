/**
 * Auth middleware
 * - Gateway consumers: Bearer sk-gw_* -> verify via SHA-256 hash in D1 gateway_keys
 * - Admin: Bearer admin token (future) - for now, check header x-admin-token == ADMIN_TOKEN secret
 */

import { hashGatewayKeyAsync } from "../lib/encryption.ts";
import { verifyGatewayKey } from "../lib/db.ts";
import { unauthorized, forbidden } from "../lib/errors.ts";
import type { Env } from "../index.ts";

export async function gatewayAuth(c: { env: Env; req: Request; set: (k: string, v: unknown) => void }, next: () => Promise<void>): Promise<void> {
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

export function requireAdmin(c: { env: Env; req: { header: (s: string) => string | undefined } }): void {
  // Simple admin auth for v1 - compare to secret if set, otherwise allow in dev
  const adminToken = c.env.ADMIN_TOKEN;
  if (!adminToken) return; // no admin token configured -> open in dev
  const header = c.req.header("x-admin-token") ?? c.req.header("authorization")?.replace("Bearer ", "");
  if (header !== adminToken) throw forbidden("Admin token required");
}
