import { forbidden, toResponse, unauthorized } from "./errors.js";
import { matches, type Rule } from "./routes.js";
import { createTracker } from "./telemetry.js";
import { toAppContext, type AppContext, type BaseContext } from "./context.js";
import type { AuthService } from "./types.js";

/** The binding every umbrella worker declares. */
export interface UmbrellaEnv {
  AUTH: AuthService;
}

export const SESSION_COOKIE = "__Host-session";

export interface WithAuthOptions<Env extends UmbrellaEnv> {
  /** Routes reachable without a session. Everything not listed here is protected. */
  public?: readonly Rule[];
  /** Routes that additionally require `role === "admin"`. */
  admin?: readonly Rule[];
  /** Handler for public routes. Required if `public` is non-empty. */
  publicFetch?: (req: Request, ctx: BaseContext<Env>) => Promise<Response>;
  /** Handler for everything else. `ctx.user` is guaranteed. */
  fetch: (req: Request, ctx: AppContext<Env>) => Promise<Response>;
  /** Name reported in telemetry. Defaults to the worker's own hostname. */
  service?: string;
}

/**
 * Deny by default.
 *
 * A request is authenticated unless it matches an explicit `public` rule. The
 * consequence of forgetting to configure a route is a locked door, not an open
 * one — which is the failure mode that actually shows up in practice.
 *
 * Identity comes only from `AUTH.validate()`. There is no code path here that
 * reads a user id from a header, body, or query parameter, so no handler
 * downstream can be handed a caller-supplied identity.
 */
export function withAuth<Env extends UmbrellaEnv>(opts: WithAuthOptions<Env>) {
  const publicRules = opts.public ?? [];
  const adminRules = opts.admin ?? [];
  if (publicRules.length > 0 && !opts.publicFetch) {
    throw new Error("withAuth: `public` rules declared without a `publicFetch` handler");
  }
  // Fail at module load, not at 3am on a request.
  for (const r of [...publicRules, ...adminRules]) {
    if (typeof r !== "string") throw new Error("withAuth: rules must be strings");
  }

  return {
    async fetch(req: Request, env: Env, ec: ExecutionContext): Promise<Response> {
      const requestId = crypto.randomUUID();
      const url = new URL(req.url);
      const service = opts.service ?? url.hostname;
      const started = Date.now();

      const base: BaseContext<Env> = {
        env,
        url,
        requestId,
        track: createTracker({ request_id: requestId, service, path: url.pathname }),
        waitUntil: (p) => ec.waitUntil(p),
      };

      let res: Response;
      try {
        if (matches(publicRules, req.method, url.pathname)) {
          res = await opts.publicFetch!(req, base);
        } else {
          const token = readToken(req);
          if (!token) throw unauthorized();

          const identity = await env.AUTH.validate(token);
          if (!identity) throw unauthorized();
          if (identity.user.status !== "active") throw forbidden();

          if (
            matches(adminRules, req.method, url.pathname) &&
            identity.user.role !== "admin"
          ) {
            base.track("authz_denied", { user_id: identity.user.id, reason: "not_admin" });
            throw forbidden();
          }

          res = await opts.fetch(req, toAppContext(base, identity));
        }
      } catch (err) {
        res = toResponse(err, requestId);
      }

      base.track("request", {
        method: req.method,
        status: res.status,
        duration_ms: Date.now() - started,
      });
      return res;
    },
  };
}

/** Bearer token, or the session cookie. Nothing else is accepted. */
export function readToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim()) || null;
    }
  }
  return null;
}
