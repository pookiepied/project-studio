/**
 * Cloudflare Access already blocks unauthenticated requests before this worker
 * runs. Verifying the assertion here anyway means the worker is not relying on
 * a route being configured correctly to be safe — if the Access policy is ever
 * removed or misapplied, this still refuses.
 */
interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

interface CachedKeys {
  keys: Jwk[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 60 * 60_000;
let cache: CachedKeys | null = null;

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function keys(teamDomain: string): Promise<Jwk[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`access certs unavailable: ${res.status}`);
  const body = (await res.json()) as { keys: Jwk[] };
  cache = { keys: body.keys, fetchedAt: Date.now() };
  return body.keys;
}

export interface AccessIdentity {
  email: string;
  sub: string;
}

/** Returns the verified identity, or null. Never throws for a bad token. */
export async function verifyAccessJwt(
  token: string | null,
  teamDomain: string,
  aud: string,
): Promise<AccessIdentity | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [rawHeader, rawPayload, rawSig] = parts as [string, string, string];

  let header: { kid?: string; alg?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(rawHeader)));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(rawPayload)));
  } catch {
    return null;
  }
  // Reject anything that is not the algorithm we expect, before touching keys.
  if (header.alg !== "RS256" || !header.kid) return null;

  const jwk = (await keys(teamDomain)).find((k) => k.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(rawSig),
    new TextEncoder().encode(`${rawHeader}.${rawPayload}`),
  );
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) return null;
  if (typeof payload.nbf === "number" && payload.nbf > now + 60) return null;
  if (payload.iss !== `https://${teamDomain}`) return null;

  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(aud)) return null;

  const email = typeof payload.email === "string" ? payload.email : null;
  const sub = typeof payload.sub === "string" ? payload.sub : null;
  if (!email || !sub) return null;
  return { email, sub };
}
