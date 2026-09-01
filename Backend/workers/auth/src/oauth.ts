import { SESSION_COOKIE, badRequest, json } from "@pookiepied/core";
import { b64url, decodeIdTokenPayload, randomToken, sha256 } from "./crypto.js";
import { audit, createSession, findUserByEmail } from "./sessions.js";
import type { Env } from "./env.js";

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const FLOW_TTL_MS = 10 * 60_000;
const HANDOFF_TTL_MS = 60_000;

/**
 * Binds a web flow to the browser that started it.
 *
 * The `state` row alone proves a flow was started by *someone*. Without a
 * matching value on the client, an attacker can start their own flow and walk a
 * victim's browser through the callback, landing the victim in the attacker's
 * account — login CSRF. This cookie is the second half of the pair.
 */
export const STATE_COOKIE = "__Host-oauth-state";

const setStateCookie = (state: string): string =>
  `${STATE_COOKIE}=${state}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${FLOW_TTL_MS / 1000}`;

const clearStateCookie = `${STATE_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

/** Length-independent comparison, so a mismatch leaks nothing through timing. */
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

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

/** A client-supplied S256 challenge: base64url, no padding, 43 characters. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/**
 * GET /oauth/start?mode=web|desktop&redirect=http://127.0.0.1:PORT/&challenge=...
 *
 * `challenge` is the *desktop client's* own PKCE challenge, separate from the
 * one this worker sends to Google. It binds the handoff code to the process
 * that started the flow, so a local race for the loopback port cannot spend it.
 */
export async function start(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") === "desktop" ? "desktop" : "web";
  const redirect = mode === "desktop" ? parseLoopback(url.searchParams.get("redirect")) : null;
  if (mode === "desktop" && !redirect) throw badRequest("invalid_redirect");

  const clientChallenge = url.searchParams.get("challenge");
  if (mode === "desktop" && (!clientChallenge || !CHALLENGE.test(clientChallenge))) {
    throw badRequest("invalid_challenge");
  }

  const state = randomToken(24);
  const { verifier, challenge } = await pkce();
  const now = Date.now();

  await env.IDENTITY.prepare(
    `INSERT INTO oauth_flows (state, verifier, mode, redirect, client_challenge, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(state, verifier, mode, redirect, mode === "desktop" ? clientChallenge : null, now, now + FLOW_TTL_MS)
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

  // A desktop flow is bound by the client's PKCE pair, not by a cookie — the
  // system browser that runs it is not the process that finishes it.
  return new Response(null, {
    status: 302,
    headers:
      mode === "web"
        ? { location: target.toString(), "set-cookie": setStateCookie(state) }
        : { location: target.toString() },
  });
}

/** GET /oauth/callback?code=...&state=... — Google sends the browser here. */
export async function callback(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) throw badRequest("missing_code_or_state");

  // Single-use: consume the flow row before doing anything with it.
  const flow = await env.IDENTITY.prepare(
    `DELETE FROM oauth_flows
      WHERE state = ?
  RETURNING verifier, mode, redirect, client_challenge, expires_at`,
  )
    .bind(state)
    .first<{
      verifier: string;
      mode: string;
      redirect: string | null;
      client_challenge: string | null;
      expires_at: number;
    }>();
  if (!flow || flow.expires_at <= Date.now()) throw badRequest("unknown_state");

  // The state row proves a flow was started; this proves *this browser* started
  // it. Without the pair, an attacker can walk a victim through their own
  // callback and leave the victim signed in as them.
  if (flow.mode === "web") {
    const presented = readCookie(req.headers.get("cookie"), STATE_COOKIE);
    if (!presented || !safeEqual(presented, state)) throw badRequest("state_mismatch");
  }

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
      `INSERT INTO handoffs (code_hash, user_id, client_challenge, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(await sha256(handoff), user.id, flow.client_challenge, now, now + HANDOFF_TTL_MS)
      .run();
    const back = new URL(flow.redirect);
    back.searchParams.set("code", handoff);
    return Response.redirect(back.toString(), 302);
  }

  const session = await createSession(env, user.id, {
    ip: req.headers.get("cf-connecting-ip"),
    ua: req.headers.get("user-agent"),
  });
  // Two cookies, so Headers rather than an object literal: the second
  // `set-cookie` in a literal would silently replace the first.
  const headers = new Headers({ location: "/" });
  headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(session.token)}; Path=/; Secure; HttpOnly; ` +
      `SameSite=Lax; Max-Age=${Math.floor((session.expiresAt - now) / 1000)}`,
  );
  headers.append("set-cookie", clearStateCookie);
  return new Response(null, { status: 302, headers });
}

/**
 * POST /oauth/exchange {"code": "...", "verifier": "..."} — desktop turns its
 * handoff code into a session.
 *
 * The verifier proves the caller is the process that began the flow. Without
 * it, holding the code is enough, and the code travels through a loopback URL
 * that any local process can race for.
 */
export async function exchange(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as
    | { code?: string; verifier?: string }
    | null;
  if (!body?.code) throw badRequest("missing_code");
  if (!body.verifier) throw badRequest("missing_verifier");

  const row = await env.IDENTITY.prepare(
    `DELETE FROM handoffs WHERE code_hash = ? RETURNING user_id, client_challenge, expires_at`,
  )
    .bind(await sha256(body.code))
    .first<{ user_id: string; client_challenge: string | null; expires_at: number }>();
  if (!row || row.expires_at <= Date.now()) throw badRequest("invalid_code");

  // The row is already consumed, so a wrong verifier burns the code rather than
  // letting it be retried against.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.verifier));
  if (!row.client_challenge || !safeEqual(b64url(digest), row.client_challenge)) {
    throw badRequest("verifier_mismatch");
  }

  const session = await createSession(env, row.user_id, {
    ip: req.headers.get("cf-connecting-ip"),
    ua: req.headers.get("user-agent"),
  });
  return json({ token: session.token, expires_at: session.expiresAt });
}
