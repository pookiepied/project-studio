import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessUnavailableError, resetKeyCache, verifyAccessJwt } from "../src/access.js";

/**
 * Cloudflare Access blocks unauthenticated traffic at the edge, so every check
 * here is the second one — the one that still refuses if the Access policy is
 * removed, misapplied, or pointed at the wrong application. It is the only
 * thing standing between a stranger and the admin panel when that happens, so
 * the forgery attempts below matter more than the happy path.
 */

const TEAM = "acme.cloudflareaccess.com";
const AUD = "aud-for-the-console";

const b64url = (b: ArrayBuffer | Uint8Array) => {
  const v = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const x of v) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const part = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

let pair: CryptoKeyPair;
let otherPair: CryptoKeyPair;
let jwks: { keys: unknown[] };

async function publicJwk(p: CryptoKeyPair, kid: string) {
  const jwk = (await crypto.subtle.exportKey("jwk", p.publicKey)) as unknown as Record<
    string,
    unknown
  >;
  return { kid, kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256" };
}

beforeAll(async () => {
  const gen = () =>
    crypto.subtle.generateKey(
      { ...RS256, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
      true,
      ["sign", "verify"],
    ) as Promise<CryptoKeyPair>;
  pair = await gen();
  otherPair = await gen();
  jwks = { keys: [await publicJwk(pair, "k1")] };
});

/** Serves the team JWKS, and counts how often it was asked. */
function serveJwks(body: () => unknown = () => jwks, ok = true) {
  const calls = { n: 0 };
  vi.stubGlobal("fetch", async () => {
    calls.n++;
    return { ok, status: ok ? 200 : 503, json: async () => body() };
  });
  return calls;
}

async function sign(
  claims: Record<string, unknown>,
  opts: { kid?: string; alg?: string; key?: CryptoKey; tamper?: boolean } = {},
) {
  const header = part({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1", typ: "JWT" });
  const payload = part({
    iss: `https://${TEAM}`,
    aud: AUD,
    sub: "sub-1",
    email: "operator@acme.dev",
    exp: Math.floor(Date.now() / 1000) + 600,
    ...claims,
  });
  const sig = await crypto.subtle.sign(
    RS256,
    opts.key ?? pair.privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  const encoded = opts.tamper ? b64url(new Uint8Array(sig).fill(0)) : b64url(sig);
  return `${header}.${payload}.${encoded}`;
}

const verify = (token: string | null) => verifyAccessJwt(token, TEAM, AUD);

// The key cache is module state; without this, one case's keys answer the next.
beforeEach(() => resetKeyCache());
afterEach(() => vi.unstubAllGlobals());

describe("a well-formed assertion", () => {
  it("returns the identity", async () => {
    serveJwks();
    await expect(verify(await sign({}))).resolves.toEqual({
      email: "operator@acme.dev",
      sub: "sub-1",
    });
  });

  it("accepts an aud array that contains ours", async () => {
    serveJwks();
    await expect(verify(await sign({ aud: ["something-else", AUD] }))).resolves.toMatchObject({
      email: "operator@acme.dev",
    });
  });

  it("caches the key material rather than fetching per request", async () => {
    const calls = serveJwks();
    await verify(await sign({}));
    await verify(await sign({}));
    await verify(await sign({}));
    expect(calls.n).toBe(1);
  });
});

describe("forgery", () => {
  it("refuses a token signed by a different key", async () => {
    serveJwks();
    await expect(verify(await sign({}, { key: otherPair.privateKey }))).resolves.toBeNull();
  });

  it("refuses a token whose signature has been replaced", async () => {
    serveJwks();
    await expect(verify(await sign({}, { tamper: true }))).resolves.toBeNull();
  });

  it("refuses alg: none before it ever looks at a key", async () => {
    const calls = serveJwks();
    const header = part({ alg: "none", kid: "k1" });
    const payload = part({ iss: `https://${TEAM}`, aud: AUD, sub: "s", email: "e@x.dev", exp: 9e9 });
    await expect(verify(`${header}.${payload}.`)).resolves.toBeNull();
    expect(calls.n).toBe(0);
  });

  it("refuses HS256, so the public key cannot be used as an HMAC secret", async () => {
    serveJwks();
    await expect(verify(await sign({}, { alg: "HS256" }))).resolves.toBeNull();
  });

  it("refuses a token with no kid", async () => {
    serveJwks();
    const header = part({ alg: "RS256" });
    const payload = part({ iss: `https://${TEAM}`, aud: AUD, sub: "s", email: "e@x.dev", exp: 9e9 });
    await expect(verify(`${header}.${payload}.sig`)).resolves.toBeNull();
  });

  it("refuses a kid the team's JWKS does not contain", async () => {
    serveJwks();
    await expect(verify(await sign({}, { kid: "not-a-real-kid" }))).resolves.toBeNull();
  });
});

describe("claims", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["an expired token", { exp: Math.floor(Date.now() / 1000) - 10 }],
    ["a token with no exp at all", { exp: undefined }],
    ["a token not valid yet", { nbf: Math.floor(Date.now() / 1000) + 3600 }],
    ["another team's issuer", { iss: "https://evil.cloudflareaccess.com" }],
    ["another application's audience", { aud: "some-other-app" }],
    ["an aud array without ours", { aud: ["a", "b"] }],
    ["a service token, which carries no email", { email: undefined }],
    ["a token with no sub", { sub: undefined }],
  ];

  for (const [name, claims] of cases) {
    it(`refuses ${name}`, async () => {
      serveJwks();
      await expect(verify(await sign(claims))).resolves.toBeNull();
    });
  }
});

describe("malformed input", () => {
  const bad = [
    ["no token", null],
    ["an empty string", ""],
    ["not a JWT", "hello"],
    ["two segments", "a.b"],
    ["four segments", "a.b.c.d"],
    ["segments that are not base64", "!!!.!!!.!!!"],
    ["base64 that is not JSON", `${b64url(new TextEncoder().encode("nope"))}.x.y`],
  ] as const;

  for (const [name, token] of bad) {
    it(`returns null for ${name}`, async () => {
      serveJwks();
      await expect(verify(token)).resolves.toBeNull();
    });
  }
});

describe("when the identity provider cannot be reached", () => {
  it("throws rather than returning a verdict", async () => {
    serveJwks(() => ({}), false);
    await expect(verify(await sign({}))).rejects.toBeInstanceOf(AccessUnavailableError);
  });

  it("refetches once for an unknown kid, so a key rotation is not an hour-long outage", async () => {
    // The cache holds k1. Access rotates to k2 and signs with it.
    serveJwks();
    await verify(await sign({}));

    const rotated = await publicJwk(otherPair, "k2");
    const calls = serveJwks(() => ({ keys: [rotated] }));
    const token = await sign({}, { kid: "k2", key: otherPair.privateKey });

    await expect(verify(token)).resolves.toMatchObject({ email: "operator@acme.dev" });
    expect(calls.n).toBe(1);
  });
});
