export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of view) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return b64url(digest);
}

/**
 * Google signs the id_token, but we receive it directly from Google's token
 * endpoint over TLS in a request we initiated — which is the case Google's own
 * docs exempt from signature verification. If this ever moves to accepting an
 * id_token from a client, it MUST start verifying against Google's JWKS.
 */
export function decodeIdTokenPayload(idToken: string): Record<string, unknown> {
  const parts = idToken.split(".");
  if (parts.length !== 3 || !parts[1]) throw new Error("malformed id_token");
  const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const json = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="));
  return JSON.parse(decodeURIComponent(escape(json))) as Record<string, unknown>;
}
