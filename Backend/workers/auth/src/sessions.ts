import type { Identity, User } from "@pookiepied/core";
import { randomToken, sha256 } from "./crypto.js";
import type { Env } from "./env.js";

interface SessionRow {
  id: string;
  user_id: string;
  expires_at: number;
  revoked_at: number | null;
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: r.role === "admin" ? "admin" : "user",
  status: r.status === "active" ? "active" : r.status === "disabled" ? "disabled" : "invited",
});

export async function createSession(
  env: Env,
  userId: string,
  meta: { ip?: string | null; ua?: string | null } = {},
): Promise<{ token: string; expiresAt: number }> {
  const token = randomToken();
  const now = Date.now();
  const ttlDays = Number(env.SESSION_TTL_DAYS) || 30;
  const expiresAt = now + ttlDays * 86_400_000;

  await env.IDENTITY.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, ip, ua)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), userId, await sha256(token), now, expiresAt, meta.ip ?? null, meta.ua ?? null)
    .run();

  return { token, expiresAt };
}

/**
 * The single source of truth for "is this caller who they say they are".
 * Every protected request in the umbrella lands here, so it does exactly one
 * indexed D1 read and nothing else.
 */
export async function validateToken(env: Env, token: string): Promise<Identity | null> {
  if (!token) return null;

  const row = await env.IDENTITY.prepare(
    `SELECT s.id, s.user_id, s.expires_at, s.revoked_at,
            u.id AS u_id, u.email, u.name, u.role, u.status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
  )
    .bind(await sha256(token))
    .first<SessionRow & UserRow & { u_id: string }>();

  if (!row) return null;
  if (row.revoked_at !== null) return null;
  if (row.expires_at <= Date.now()) return null;
  if (row.status !== "active") return null;

  return {
    user: toUser({ ...row, id: row.u_id }),
    session: { id: row.id, userId: row.user_id, expiresAt: row.expires_at },
  };
}

export async function revokeSession(env: Env, sessionId: string): Promise<boolean> {
  const res = await env.IDENTITY.prepare(
    `UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
  )
    .bind(Date.now(), sessionId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function revokeAllForUser(env: Env, userId: string): Promise<number> {
  const res = await env.IDENTITY.prepare(
    `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
  )
    .bind(Date.now(), userId)
    .run();
  return res.meta.changes ?? 0;
}

export async function findUserByEmail(env: Env, email: string): Promise<User | null> {
  const row = await env.IDENTITY.prepare(
    `SELECT id, email, name, role, status FROM users WHERE email = ?`,
  )
    .bind(email.toLowerCase())
    .first<UserRow>();
  return row ? toUser(row) : null;
}

export async function audit(
  env: Env,
  action: string,
  opts: { actorId?: string | null | undefined; target?: string | null | undefined; meta?: unknown } = {},
): Promise<void> {
  await env.IDENTITY.prepare(
    `INSERT INTO audit_events (id, actor_id, action, target, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      opts.actorId ?? null,
      action,
      opts.target ?? null,
      opts.meta === undefined ? null : JSON.stringify(opts.meta),
      Date.now(),
    )
    .run();
}
