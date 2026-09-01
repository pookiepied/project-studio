import { describe, expect, it } from "vitest";
import { parseLoopback } from "../src/oauth.js";
import { decodeIdTokenPayload } from "../src/crypto.js";

/**
 * The desktop flow takes a redirect target from the caller, which is the exact
 * shape of an open redirect. These cases are the ones that would turn the auth
 * worker into a way to bounce a browser somewhere attacker-chosen.
 */
describe("loopback redirect validation", () => {
  it("accepts a plain loopback URL", () => {
    expect(parseLoopback("http://127.0.0.1:49215/")).toBe("http://127.0.0.1:49215/");
  });

  // The URL parser canonicalises IPv4, so a decimal-encoded address really is
  // loopback by the time we see it. Accepting it is correct, not a bypass.
  it("accepts a decimal-encoded loopback, normalised", () => {
    expect(parseLoopback("http://2130706433:49215/")).toBe("http://127.0.0.1:49215/");
  });

  it("accepts the /callback path", () => {
    expect(parseLoopback("http://127.0.0.1:49215/callback")).toBe(
      "http://127.0.0.1:49215/callback",
    );
  });

  const rejected: [string, string | null][] = [
    ["a remote host", "https://evil.example/"],
    ["a remote host on http", "http://evil.example/"],
    ["localhost by name, which can resolve anywhere", "http://localhost:49215/"],
    ["a host that merely starts with the loopback IP", "http://127.0.0.1.evil.example:49215/"],
    ["userinfo smuggling the real host", "http://127.0.0.1@evil.example:49215/"],
    ["a privileged port", "http://127.0.0.1:80/"],
    ["no port at all", "http://127.0.0.1/"],
    ["an arbitrary path", "http://127.0.0.1:49215/anything"],
    ["a path that only looks right", "http://127.0.0.1:49215/callback/../../x"],
    ["a non-http scheme", "javascript:alert(1)"],
    ["a custom scheme", "myapp://callback"],
    ["https, which a loopback listener cannot serve", "https://127.0.0.1:49215/"],
    ["garbage", "not-a-url"],
    ["nothing", null],
  ];

  for (const [name, input] of rejected) {
    it(`rejects ${name}`, () => {
      expect(parseLoopback(input)).toBeNull();
    });
  }
});

describe("id_token decoding", () => {
  it("reads the payload of a well-formed token", () => {
    const b64 = (o: unknown) =>
      btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const token = `${b64({ alg: "RS256" })}.${b64({ email: "a@x.dev", email_verified: true })}.sig`;
    expect(decodeIdTokenPayload(token)).toMatchObject({ email: "a@x.dev" });
  });

  it("throws rather than returning a partial payload", () => {
    expect(() => decodeIdTokenPayload("only.two")).toThrow(/malformed/);
  });
});
