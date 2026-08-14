/**
 * Admin - provider credentials (encrypted at rest)
 */

import { Hono } from "hono";
import type { Env } from "../../index.ts";
import { requireAdmin } from "../../middleware/auth.ts";
import { encrypt } from "../../infra/encryption.ts";
import { badRequest, notFound } from "../../lib/errors.ts";

export const adminCredentialsRoute = new Hono<{ Bindings: Env }>();

adminCredentialsRoute.put("/providers/:id/credential", async (c) => {
  requireAdmin(c as never);
  const id = c.req.param("id");
  const provider = await c.env.DB.prepare("SELECT id FROM providers WHERE id = ?").bind(id).first();
  if (!provider) throw notFound(`Provider ${id} not found`);
  const body = await c.req.json().catch(() => null) as { apiKey?: string } | null;
  const key = body?.apiKey?.trim();
  if (!key) throw badRequest("apiKey required");
  const encKey = c.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!encKey) throw badRequest("CREDENTIAL_ENCRYPTION_KEY not configured");
  const encrypted = await encrypt(key, encKey);
  const hint = key.slice(-4);
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO provider_credentials (provider_id, encrypted_key, key_hint, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(provider_id) DO UPDATE SET encrypted_key=excluded.encrypted_key, key_hint=excluded.key_hint, updated_at=excluded.updated_at`,
  )
    .bind(id, encrypted, hint, now, now)
    .run();
  return c.json({ ok: true, hint: `...${hint}` });
});

adminCredentialsRoute.delete("/providers/:id/credential", async (c) => {
  requireAdmin(c as never);
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM provider_credentials WHERE provider_id = ?").bind(id).run();
  return c.json({ ok: true });
});
