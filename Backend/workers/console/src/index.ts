import { json } from "@pookiepied/core";
import type { Role, User } from "@pookiepied/core";
import { verifyAccessJwt } from "./access.js";
import { activity, facets, summary } from "./analytics.js";
import { aggregate, type HealthEnv } from "./health.js";

interface AdminBinding {
  listUsers(): Promise<User[]>;
  invite(email: string, role?: Role, actorId?: string): Promise<User>;
  setStatus(userId: string, status: "active" | "disabled", actorId?: string): Promise<void>;
  setRole(userId: string, role: Role, actorId?: string): Promise<void>;
  listSessions(userId: string): Promise<unknown[]>;
  revokeSession(sessionId: string, actorId?: string): Promise<boolean>;
  recentAuditEvents(limit?: number): Promise<unknown[]>;
  health(): Promise<import("@pookiepied/core").HealthReport>;
}

export interface Env extends HealthEnv {
  ADMIN: AdminBinding;
  /** The built SPA. Served only after the Access assertion has been verified. */
  ASSETS: Fetcher;
}

const num = (v: string | null, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * The control plane.
 *
 * The worker runs first for every request, including asset requests, so no file
 * of the dashboard is reachable without a verified Access assertion. Cloudflare
 * Access already blocks unauthenticated traffic at the edge; verifying here as
 * well means the console's safety does not depend on a route being configured
 * correctly.
 *
 * Read-only with respect to telemetry — it queries Analytics Engine and holds
 * no ingest key. Account mutations do live here, because the allowlist has to be
 * editable somewhere and this is the one surface behind Access.
 */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const identity = await verifyAccessJwt(
      req.headers.get("cf-access-jwt-assertion"),
      env.ACCESS_TEAM_DOMAIN,
      env.ACCESS_AUD,
    );
    if (!identity) return json({ error: "unauthorized" }, 401);

    const url = new URL(req.url);
    const actor = identity.email;

    if (!url.pathname.startsWith("/api/")) {
      const res = await env.ASSETS.fetch(req);
      // The dashboard loads its own bundle and talks only to itself.
      const headers = new Headers(res.headers);
      headers.set(
        "content-security-policy",
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; " +
          "form-action 'none'; frame-ancestors 'none'",
      );
      headers.set("x-frame-options", "DENY");
      headers.set("referrer-policy", "no-referrer");
      headers.set("x-content-type-options", "nosniff");
      return new Response(res.body, { status: res.status, headers });
    }

    try {
      const p = url.pathname;
      const q = url.searchParams;
      const hours = num(q.get("hours"), 24);

      if (req.method === "GET") {
        switch (p) {
          case "/api/session":
            return json({ email: identity.email });

          case "/api/health":
            return json(await aggregate(env));

          case "/api/summary":
            return json({ hours, sources: await summary(env, hours) });

          case "/api/activity":
            return json({
              hours,
              events: await activity(env, {
                hours,
                source: q.get("source"),
                event: q.get("event"),
                only: q.get("only") === "errors" ? "errors" : "all",
                limit: num(q.get("limit"), 200),
              }),
            });

          case "/api/facets":
            return json(await facets(env, hours));

          case "/api/users":
            return json({ users: await env.ADMIN.listUsers() });

          case "/api/audit":
            return json({ events: await env.ADMIN.recentAuditEvents(200) });

          case "/api/sessions": {
            const userId = q.get("user_id");
            if (!userId) return json({ error: "missing_user_id" }, 400);
            return json({ sessions: await env.ADMIN.listSessions(userId) });
          }
        }
      }

      if (req.method === "POST") {
        const body = (await req.json().catch(() => null)) as Record<string, string> | null;
        if (!body) return json({ error: "invalid_json" }, 400);

        switch (p) {
          case "/api/users/invite": {
            if (!body.email) return json({ error: "missing_email" }, 400);
            const role: Role = body.role === "admin" ? "admin" : "user";
            return json({ user: await env.ADMIN.invite(body.email, role, actor) });
          }

          case "/api/users/status": {
            if (!body.user_id) return json({ error: "missing_user_id" }, 400);
            if (body.status !== "active" && body.status !== "disabled") {
              return json({ error: "invalid_status" }, 400);
            }
            await env.ADMIN.setStatus(body.user_id, body.status, actor);
            return json({ ok: true });
          }

          case "/api/users/role": {
            if (!body.user_id) return json({ error: "missing_user_id" }, 400);
            if (body.role !== "admin" && body.role !== "user") {
              return json({ error: "invalid_role" }, 400);
            }
            await env.ADMIN.setRole(body.user_id, body.role, actor);
            return json({ ok: true });
          }

          case "/api/sessions/revoke": {
            if (!body.session_id) return json({ error: "missing_session_id" }, 400);
            return json({ revoked: await env.ADMIN.revokeSession(body.session_id, actor) });
          }
        }
      }

      return json({ error: "not_found" }, 404);
    } catch (err) {
      console.error(
        JSON.stringify({
          evt: "console_error",
          path: url.pathname,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      return json({ error: "internal_error" }, 500);
    }
  },
};
