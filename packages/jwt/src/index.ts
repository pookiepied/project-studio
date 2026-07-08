/**
 * @studio/jwt — shared HMAC-SHA256 JWT utilities for Cloudflare Workers.
 * Uses the Web Crypto API (crypto.subtle) — zero external dependencies.
 */

export const TOKEN_EXPIRY = {
  ACCESS_TOKEN:  3600,        // 1 hour  — STUDIO frontend sessions
  REFRESH_TOKEN: 604800,      // 7 days  — STUDIO auto-renew
  API_TOKEN:     2592000,     // 30 days — third-party API access, no refresh
} as const;

export const MIN_SECRET_LENGTH = 32;
const MAX_TOKEN_LENGTH = 4096;
const JWT_HEADER = { alg: 'HS256', typ: 'JWT' };

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  type: 'access';
  iat: number;
  exp: number;
}

export interface RefreshTokenPayload {
  sub: string;
  email?: string;
  type: 'refresh';
  iat: number;
  exp: number;
}

export interface ApiTokenPayload {
  sub:     string;   // user ID
  email:   string;
  role:    string;
  type:    'api';
  scope?:  string;   // optional: 'read' | 'write' | omit for full access
  jti:     string;   // unique token ID — used for per-token revocation
  iat:     number;
  exp:     number;
}

export type TokenPayload = AccessTokenPayload | RefreshTokenPayload | ApiTokenPayload;

// ── Encoding helpers ──────────────────────────────────────────────────────────

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + (4 - (normalized.length % 4)) % 4, '=');
  return Uint8Array.from(atob(padded), ch => ch.charCodeAt(0));
}

// ── Crypto primitives ─────────────────────────────────────────────────────────

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return base64UrlEncode(new Uint8Array(sig));
}

async function hmacVerify(data: string, signature: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  try {
    return await crypto.subtle.verify('HMAC', key, base64UrlDecode(signature), encoder.encode(data));
  } catch {
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function generateAccessToken(
  userId: string, email: string, role: string, secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: AccessTokenPayload = {
    sub: userId, email: email.toLowerCase(), role,
    type: 'access', iat: now, exp: now + TOKEN_EXPIRY.ACCESS_TOKEN,
  };
  const h = base64UrlEncode(encoder.encode(JSON.stringify(JWT_HEADER)));
  const p = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  return `${h}.${p}.${await hmacSign(`${h}.${p}`, secret)}`;
}

export async function generateRefreshToken(
  userId: string, email: string, secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: RefreshTokenPayload = {
    sub: userId, email: email.toLowerCase(),
    type: 'refresh', iat: now, exp: now + TOKEN_EXPIRY.REFRESH_TOKEN,
  };
  const h = base64UrlEncode(encoder.encode(JSON.stringify(JWT_HEADER)));
  const p = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  return `${h}.${p}.${await hmacSign(`${h}.${p}`, secret)}`;
}

export async function generateApiToken(
  userId: string, email: string, role: string, secret: string, scope?: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: ApiTokenPayload = {
    sub: userId, email: email.toLowerCase(), role,
    type: 'api',
    jti: crypto.randomUUID(),
    ...(scope ? { scope } : {}),
    iat: now, exp: now + TOKEN_EXPIRY.API_TOKEN,
  };
  const h = base64UrlEncode(encoder.encode(JSON.stringify(JWT_HEADER)));
  const p = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  return `${h}.${p}.${await hmacSign(`${h}.${p}`, secret)}`;
}

export async function verifyToken(token: string, secret: string): Promise<TokenPayload | null> {
  if (!token || typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, sig] = parts;
    if (!h || !p || !sig) return null;

    if (!await hmacVerify(`${h}.${p}`, sig, secret)) return null;

    const payload = JSON.parse(decoder.decode(base64UrlDecode(p))) as TokenPayload;
    if (!payload.sub || !payload.type || !payload.exp || !payload.iat) return null;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;
    if (payload.iat > now + 60) return null;

    return payload;
  } catch {
    return null;
  }
}
