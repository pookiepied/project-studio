import { WorkerEntrypoint } from "cloudflare:workers";
import {
  json,
  readToken,
  toResponse,
  type HealthReport,
  type Identity,
  type Role,
  type User,
} from "@pookiepied/core";
import { callback, exchange, start } from "./oauth.js";
import {
  audit,
  findUserByEmail,
  revokeAllForUser,
  revokeSession,
  validateToken,
} from "./sessions.js";
import { selfCheck } from "./health.js";
import type { Env } from "./env.js";

/**
 * Bound by every app worker as `AUTH`. Deliberately one method: an app can ask
 * who a caller is, and nothing else. See ADR-0001 §Identity interface.
 */
export class AuthService extends WorkerEntrypoint<Env> {
  validate(token: string): Promise<Identity | null> {
    return validateToken(this.env, token);
  }
}

/**
 * Bound only by the console worker. Kept separate from AuthService so that a
 * compromised app worker holds no capability to mutate accounts — it was never
 * given this entrypoint.
 */
export class AdminService extends WorkerEntrypoint<Env> {
  /** On-demand deep check. The console holds this binding already, and auth is
   *  the one service whose failure takes every app with it — so it is the one
   *  worth asking directly instead of waiting for the next heartbeat. */
  health(): Promise<HealthReport> {
    return selfCheck(this.env);
  }

  /**
   * The account behind a console operator's Access identity, or null.
   *
   * Access decides who may reach the console at all; this decides whether that
   * person is an administrator of the umbrella. Keeping the second question
   * here means the answer comes from the identity database rather than from a
   * Cloudflare policy nothing in this repo can see.
   */
  operator(email: string): Promise<User | null> {
    return findUserByEmail(this.env, email);
  }

  async listUsers(): Promise<User[]> {
    const { results } = await this.env.IDENTITY.prepare(
      `SELECT id, email, name, role, status FROM users ORDER BY created_at DESC`,
    ).all<{ id: string; email: string; name: string | null; role: string; status: string }>();
    return results.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role === "admin" ? "admin" : "user",
      status: r.status === "active" ? "active" : r.status === "disabled" ? "disabled" : "invited",
    }));
  }

  /** Adds an email to the allowlist. The account exists as `invited` until first login. */
  async invite(email: string, role: Role = "user", actorId?: string): Promise<User> {
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes("@")) throw new Error("invalid_email");
    const existing = await findUserByEmail(this.env, normalized);
    if (existing) return existing;

    const now = Date.now();
    const id = crypto.randomUUID();
    await this.env.IDENTITY.prepare(
      `INSERT INTO users (id, email, name, role, status, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'invited', ?, ?)`,
    )
      .bind(id, normalized, role, now, now)
      .run();
    await audit(this.env, "user_invited", { actorId, target: normalized, meta: { role } });
    return { id, email: normalized, name: null, role, status: "invited" };
  }

  /**
   * Refuses a change that would leave the umbrella with no way back in.
   *
   * There is no signup path and no password reset, so the last active admin
   * disabling or demoting themselves is not an inconvenience — it is a locked
   * door whose only key is `wrangler d1 execute` against production.
   */
  async #wouldStrandUs(userId: string): Promise<boolean> {
    const row = await this.env.IDENTITY.prepare(
      `SELECT count(*) AS n FROM users
        WHERE role = 'admin' AND status = 'active' AND id != ?`,
    )
      .bind(userId)
      .first<{ n: number }>();
    return (row?.n ?? 0) === 0;
  }

  /** Disabling revokes every live session immediately — that is the point of opaque tokens. */
  async setStatus(userId: string, status: "active" | "disabled", actorId?: string): Promise<void> {
    if (status === "disabled" && (await this.#wouldStrandUs(userId))) {
      throw new Error("last_active_admin");
    }
    await this.env.IDENTITY.prepare(`UPDATE users SET status = ?, updated_at = ? WHERE id = ?`)
      .bind(status, Date.now(), userId)
      .run();
    if (status === "disabled") await revokeAllForUser(this.env, userId);
    await audit(this.env, "user_status_changed", { actorId, target: userId, meta: { status } });
  }

  async setRole(userId: string, role: Role, actorId?: string): Promise<void> {
    if (role !== "admin" && (await this.#wouldStrandUs(userId))) {
      throw new Error("last_active_admin");
    }
    await this.env.IDENTITY.prepare(`UPDATE users SET role = ?, updated_at = ? WHERE id = ?`)
      .bind(role, Date.now(), userId)
      .run();
    await audit(this.env, "user_role_changed", { actorId, target: userId, meta: { role } });
  }

  async listSessions(userId: string) {
    const { results } = await this.env.IDENTITY.prepare(
      `SELECT id, created_at, expires_at, revoked_at, ip, ua FROM sessions
        WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
    )
      .bind(userId)
      .all();
    return results;
  }

  async revokeSession(sessionId: string, actorId?: string): Promise<boolean> {
    const ok = await revokeSession(this.env, sessionId);
    if (ok) await audit(this.env, "session_revoked", { actorId, target: sessionId });
    return ok;
  }

  async recentAuditEvents(limit = 200) {
    const { results } = await this.env.IDENTITY.prepare(
      `SELECT id, actor_id, action, target, meta_json, created_at
         FROM audit_events ORDER BY created_at DESC LIMIT ?`,
    )
      .bind(Math.min(limit, 1000))
      .all();
    return results;
  }
}

/**
 * The auth worker's own HTTP surface is public by necessity — Google redirects
 * a browser here. It therefore does NOT use withAuth: it is the thing withAuth
 * calls. Every route below is unauthenticated by design and must stay small
 * enough to audit by reading it.
 */
export default {
  async fetch(req: Request, env: Env, ec: ExecutionContext): Promise<Response> {
    const requestId = crypto.randomUUID();
    const url = new URL(req.url);
    try {
      if (req.method === "GET" && url.pathname === "/oauth/start") return await start(req, env);
      if (req.method === "GET" && url.pathname === "/oauth/callback") return await callback(req, env);
      if (req.method === "POST" && url.pathname === "/oauth/exchange") return await exchange(req, env);

      if (req.method === "POST" && url.pathname === "/oauth/logout") {
        const token = readToken(req);
        if (token) {
          const identity = await validateToken(env, token);
          if (identity) ec.waitUntil(revokeSession(env, identity.session.id));
        }
        return json({ ok: true }, 200, {
          "set-cookie": "__Host-session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0",
        });
      }

      if (req.method === "GET" && url.pathname === "/health") return json({ ok: true });

      return json({ error: "not_found" }, 404);
    } catch (err) {
      return toResponse(err, requestId);
    }
  },

  /**
   * Housekeeping, then a heartbeat.
   *
   * The heartbeat is emitted as a structured log so the telemetry worker picks
   * it up through tail() like everything else. That means the console learns
   * about this service without holding a binding to it, and — more usefully —
   * the *absence* of a heartbeat is itself the signal that it is gone.
   */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const now = Date.now();
    await env.IDENTITY.batch([
      env.IDENTITY.prepare(`DELETE FROM oauth_flows WHERE expires_at < ?`).bind(now),
      env.IDENTITY.prepare(`DELETE FROM handoffs WHERE expires_at < ?`).bind(now),
      env.IDENTITY.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(now - 7 * 86_400_000),
    ]);

    const report = await selfCheck(env);
    console.log(JSON.stringify({ evt: "health", ...report }));
  },
};
