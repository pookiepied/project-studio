/**
 * JWT authentication middleware for the AI worker.
 *
 * The auth worker (auth.pookiepied.dev) issues HS256 JWTs signed with
 * JWT_SECRET. The AI worker uses the same secret to verify incoming
 * Bearer tokens without making an external request on every chat.
 *
 * Programmatic / CLI access (no browser, no Google account):
 *   Generate a long-lived JWT signed with JWT_SECRET using role:"admin" and
 *   a far-future expiry. Use it as a static Bearer token — this IS the API
 *   key. No separate key system is needed. To revoke, write the token's
 *   signature to REVOKED_KV under key "revoked:{signature}".
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_TOKEN_LENGTH  = 4096;
const MIN_SECRET_LENGTH = 32;   // matches @studio/jwt package requirement

function base64UrlDecode(str: string): Uint8Array {
  const normalized = str
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(str.length + ((4 - (str.length % 4)) % 4), "=");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacVerify(data: string, signature: string, secret: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const sigBytes = base64UrlDecode(signature);
    return await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(data));
  } catch {
    return false;
  }
}

export interface JWTPayload {
  sub: string;
  email: string;
  role: string;
  type: string;
  iat: number;
  exp: number;
  _sig?: string;
}

export async function verifyBearerToken(
  request: Request,
  secret: string,
  revokedKv?: KVNamespace
): Promise<JWTPayload | null> {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  const xUserJwt = request.headers.get("X-User-JWT");
  let token: string | null = null;
  if (xUserJwt) {
    token = xUserJwt.trim();
  } else {
    const authHeader = request.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) token = authHeader.slice(7);
  }
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signature] = parts;
    if (!headerB64 || !payloadB64 || !signature) return null;

    const valid = await hmacVerify(`${headerB64}.${payloadB64}`, signature, secret);
    if (!valid) return null;

    const payloadJson = decoder.decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(payloadJson) as JWTPayload;

    if (!payload.sub || payload.type !== "access" || !payload.exp || !payload.iat) return null;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;
    if (payload.iat > now + 60) return null;

    if (revokedKv) {
      const revoked = await revokedKv.get(`revoked:${signature}`);
      if (revoked !== null) return null;
    }

    return payload;
  } catch {
    return null;
  }
}
