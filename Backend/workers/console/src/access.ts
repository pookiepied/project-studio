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
const REFETCH_COOLDOWN_MS = 60_000;
let cache: CachedKeys | null = null;
let lastRefetch = 0;

/** Test-only. The cache is module state and would otherwise leak between cases. */
export function resetKeyCache(): void {
  cache = null;
  lastRefetch = 0;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function fetchKeys(teamDomain: string): Promise<Jwk[]> {
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`access certs unavailable: ${res.status}`);
  const body = (await res.json()) as { keys: Jwk[] };
  cache = { keys: body.keys, fetchedAt: Date.now() };
  return body.keys;
}

async function keys(teamDomain: string): Promise<Jwk[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.keys;
  return fetchKeys(teamDomain);
}

/**
 * A `kid` we have never seen means the cache predates a key rotation. Refetch
 * once before giving up, or every token signed by the new key is refused until
 * the hour is out — an outage that looks exactly like a broken Access policy.
 */
async function keyFor(teamDomain: string, kid: string): Promise<Jwk | null> {
  const found = (await keys(teamDomain)).find((k) => k.kid === kid);
  if (found) return found;
  // Rate-limited on the *refetch*, not on the cache's age: a cache populated
  // one minute ago is the normal case, and keying the cooldown off that would
  // refuse to look for a rotated key exactly when it is most likely to be new.
  // The cooldown is what stops a stream of junk kids becoming a fetch storm.
  if (Date.now() - lastRefetch < REFETCH_COOLDOWN_MS) return null;
  lastRefetch = Date.now();
  return (await fetchKeys(teamDomain)).find((k) => k.kid === kid) ?? null;
}

/** Thrown when the identity provider cannot be reached. Never means "allow". */
export class AccessUnavailableError extends Error {}

export interface AccessIdentity {
  email: string;
  sub: string;
}

/**
 * Returns the verified identity, or null for any token that fails a check.
 *
 * Never throws for a bad token. It DOES throw `AccessUnavailableError` when the
 * team's JWKS cannot be fetched, because that is not a verdict about the token
 * — nobody may be admitted, and the caller must say so rather than treat it as
 * an ordinary refusal.
 */
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

  let jwk: Jwk | null;
  try {
    jwk = await keyFor(teamDomain, header.kid);
  } catch (err) {
    throw new AccessUnavailableError(err instanceof Error ? err.message : String(err));
  }
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
