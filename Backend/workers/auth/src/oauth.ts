import { SESSION_COOKIE, badRequest, json } from "@pookiepied/core";
import { b64url, decodeIdTokenPayload, randomToken, sha256 } from "./crypto.js";
import { audit, createSession, findUserByEmail } from "./sessions.js";
import type { Env } from "./env.js";

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const FLOW_TTL_MS = 10 * 60_000;
const HANDOFF_TTL_MS = 60_000;

/** Loopback only, on the documented range, with no path. Anything else is an open redirect. */
export function parseLoopback(raw: string | null): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:") return null;
  if (u.hostname !== "127.0.0.1" && u.hostname !== "[::1]") return null;
  const port = Number(u.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  if (u.pathname !== "/" && u.pathname !== "/callback") return null;
  return `${u.protocol}//${u.hostname}:${port}${u.pathname}`;
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(48);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(digest) };
}

/** GET /oauth/start?mode=web|desktop&redirect=http://127.0.0.1:PORT/ */
export async function start(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") === "desktop" ? "desktop" : "web";
  const redirect = mode === "desktop" ? parseLoopback(url.searchParams.get("redirect")) : null;
  if (mode === "desktop" && !redirect) throw badRequest("invalid_redirect");

  const state = randomToken(24);
  const { verifier, challenge } = await pkce();
  const now = Date.now();

  await env.IDENTITY.prepare(
    `INSERT INTO oauth_flows (state, verifier, mode, redirect, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(state, verifier, mode, redirect, now, now + FLOW_TTL_MS)
    .run();

  const target = new URL(AUTHORIZE);
  target.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  target.searchParams.set("redirect_uri", env.OAUTH_REDIRECT_URI);
  target.searchParams.set("response_type", "code");
  target.searchParams.set("scope", "openid email profile");
  target.searchParams.set("state", state);
  target.searchParams.set("code_challenge", challenge);
  target.searchParams.set("code_challenge_method", "S256");
  target.searchParams.set("prompt", "select_account");

  return Response.redirect(target.toString(), 302);
}

/** GET /oauth/callback?code=...&state=... — Google sends the browser here. */
export async function callback(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) throw badRequest("missing_code_or_state");

  // Single-use: consume the flow row before doing anything with it.
  const flow = await env.IDENTITY.prepare(
    `DELETE FROM oauth_flows WHERE state = ? RETURNING verifier, mode, redirect, expires_at`,
  )
    .bind(state)
    .first<{ verifier: string; mode: string; redirect: string | null; expires_at: number }>();
  if (!flow || flow.expires_at <= Date.now()) throw badRequest("unknown_state");

  const tokenRes = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.OAUTH_REDIRECT_URI,
      grant_type: "authorization_code",
      code_verifier: flow.verifier,
    }),
  });
  if (!tokenRes.ok) {
    console.error(JSON.stringify({ evt: "google_token_exchange_failed", status: tokenRes.status }));
    throw badRequest("token_exchange_failed");
  }

  const payload = (await tokenRes.json()) as { id_token?: string };
  if (!payload.id_token) throw badRequest("no_id_token");
  const claims = decodeIdTokenPayload(payload.id_token);

  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : null;
  if (!email || claims.email_verified !== true) throw badRequest("unverified_email");

  // Closed membership: no row means no account. There is no signup path.
  const user = await findUserByEmail(env, email);
  if (!user || user.status === "disabled") {
    await audit(env, "login_denied", { target: email });
    return json({ error: "not_allowed" }, 403);
  }

  const now = Date.now();
  const name = typeof claims.name === "string" ? claims.name : null;
  await env.IDENTITY.prepare(
    `UPDATE users SET status = 'active', name = COALESCE(?, name), updated_at = ? WHERE id = ?`,
  )
    .bind(name, now, user.id)
    .run();
  await audit(env, "login", { actorId: user.id, meta: { mode: flow.mode } });

  if (flow.mode === "desktop" && flow.redirect) {
    // Hand back a one-time code, never a session token. The token is minted at
    // exchange time so no credential is ever placed in a URL or stored at rest.
    const handoff = randomToken(24);
    await env.IDENTITY.prepare(
      `INSERT INTO handoffs (code_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
    )
      .bind(await sha256(handoff), user.id, now, now + HANDOFF_TTL_MS)
      .run();
    const back = new URL(flow.redirect);
    back.searchParams.set("code", handoff);
    return Response.redirect(back.toString(), 302);
  }

  const session = await createSession(env, user.id, {
    ip: req.headers.get("cf-connecting-ip"),
    ua: req.headers.get("user-agent"),
  });
  return new Response(null, {
    status: 302,
    headers: {
      location: "/",
      "set-cookie":
        `${SESSION_COOKIE}=${encodeURIComponent(session.token)}; Path=/; Secure; HttpOnly; ` +
        `SameSite=Lax; Max-Age=${Math.floor((session.expiresAt - now) / 1000)}`,
    },
  });
}

/** POST /oauth/exchange {"code": "..."} — desktop turns its handoff code into a session. */
export async function exchange(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { code?: string } | null;
  if (!body?.code) throw badRequest("missing_code");

  const row = await env.IDENTITY.prepare(
    `DELETE FROM handoffs WHERE code_hash = ? RETURNING user_id, expires_at`,
  )
    .bind(await sha256(body.code))
    .first<{ user_id: string; expires_at: number }>();
  if (!row || row.expires_at <= Date.now()) throw badRequest("invalid_code");

  const session = await createSession(env, row.user_id, {
    ip: req.headers.get("cf-connecting-ip"),
    ua: req.headers.get("user-agent"),
  });
  return json({ token: session.token, expires_at: session.expiresAt });
}
