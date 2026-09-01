import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callback, exchange, start, STATE_COOKIE } from "../src/oauth.js";
import { b64url } from "../src/crypto.js";
import type { Env } from "../src/env.js";

/**
 * The flow tests. `oauth.test.ts` covers the redirect validator in isolation;
 * these cover what the three handlers do once a real request reaches them —
 * specifically the two bindings that make the flow safe: a web flow tied to the
 * browser that began it, and a desktop handoff tied to the process that did.
 */

interface Row {
  [k: string]: unknown;
}

function fakeDb() {
  const flows = new Map<string, Row>();
  const handoffs = new Map<string, Row>();
  const users = new Map<string, Row>();
  const sessions: Row[] = [];
  const audits: Row[] = [];

  function exec(sql: string, b: unknown[]): Row | null {
    if (sql.includes("INSERT INTO oauth_flows")) {
      flows.set(String(b[0]), {
        verifier: b[1],
        mode: b[2],
        redirect: b[3],
        client_challenge: b[4],
        expires_at: b[6],
      });
      return null;
    }
    if (sql.includes("DELETE FROM oauth_flows")) {
      const row = flows.get(String(b[0])) ?? null;
      flows.delete(String(b[0]));
      return row;
    }
    if (sql.includes("FROM users WHERE email")) return users.get(String(b[0])) ?? null;
    if (sql.includes("INSERT INTO handoffs")) {
      handoffs.set(String(b[0]), {
        user_id: b[1],
        client_challenge: b[2],
        expires_at: b[4],
      });
      return null;
    }
    if (sql.includes("DELETE FROM handoffs")) {
      const row = handoffs.get(String(b[0])) ?? null;
      handoffs.delete(String(b[0]));
      return row;
    }
    if (sql.includes("INSERT INTO sessions")) {
      sessions.push({ user_id: b[1] });
      return null;
    }
    if (sql.includes("INSERT INTO audit_events")) {
      audits.push({ action: b[2], target: b[3] });
      return null;
    }
    if (sql.includes("UPDATE users")) return null;
    throw new Error(`unhandled sql in fake: ${sql.slice(0, 60)}`);
  }

  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...b: unknown[]) {
          binds = b;
          return stmt;
        },
        async first() {
          return exec(sql, binds);
        },
        async run() {
          exec(sql, binds);
          return { meta: { changes: 1 } };
        },
        async all() {
          return { results: [] };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;

  return { db, flows, handoffs, users, sessions, audits };
}

function envFor(db: D1Database): Env {
  return {
    IDENTITY: db,
    SESSION_TTL_DAYS: "30",
    OAUTH_REDIRECT_URI: "https://auth.x.dev/oauth/callback",
    GOOGLE_CLIENT_ID: "cid",
    GOOGLE_CLIENT_SECRET: "secret",
  };
}

/** Google's reply. `decodeIdTokenPayload` reads the middle segment only. */
function googleReplies(email: string, verified = true) {
  const claims = b64url(
    new TextEncoder().encode(JSON.stringify({ email, email_verified: verified, name: "A" })),
  );
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({ id_token: `h.${claims}.s` }),
  }));
}

const challengeFor = async (verifier: string) =>
  b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));

const stateFrom = (res: Response) =>
  new URL(res.headers.get("location")!).searchParams.get("state")!;

/** `getSetCookie` exists at runtime; the Workers Headers type predates it. */
const setCookies = (res: Response): string[] =>
  (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie();

let ctx: ReturnType<typeof fakeDb>;
let env: Env;

beforeEach(() => {
  ctx = fakeDb();
  env = envFor(ctx.db);
  ctx.users.set("a@x.dev", {
    id: "u1",
    email: "a@x.dev",
    name: null,
    role: "user",
    status: "invited",
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("a web flow is bound to the browser that began it", () => {
  it("sets a state cookie alongside the redirect to Google", async () => {
    const res = await start(new Request("https://auth.x.dev/oauth/start"), env);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(STATE_COOKIE);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    // The cookie carries the same state the authorize URL does.
    expect(cookie).toContain(stateFrom(res));
  });

  it("refuses a callback that presents no cookie — the login-CSRF case", async () => {
    const started = await start(new Request("https://auth.x.dev/oauth/start"), env);
    const state = stateFrom(started);
    googleReplies("a@x.dev");

    await expect(
      callback(new Request(`https://auth.x.dev/oauth/callback?code=c&state=${state}`), env),
    ).rejects.toMatchObject({ code: "state_mismatch" });
    expect(ctx.sessions).toHaveLength(0);
  });

  it("refuses a callback whose cookie is somebody else's state", async () => {
    const started = await start(new Request("https://auth.x.dev/oauth/start"), env);
    const state = stateFrom(started);
    googleReplies("a@x.dev");

    await expect(
      callback(
        new Request(`https://auth.x.dev/oauth/callback?code=c&state=${state}`, {
          headers: { cookie: `${STATE_COOKIE}=some-other-flow` },
        }),
        env,
      ),
    ).rejects.toMatchObject({ code: "state_mismatch" });
  });

  it("issues a session when the cookie matches, and clears the state cookie", async () => {
    const started = await start(new Request("https://auth.x.dev/oauth/start"), env);
    const state = stateFrom(started);
    googleReplies("a@x.dev");

    const res = await callback(
      new Request(`https://auth.x.dev/oauth/callback?code=c&state=${state}`, {
        headers: { cookie: `${STATE_COOKIE}=${state}` },
      }),
      env,
    );

    expect(res.status).toBe(302);
    expect(ctx.sessions).toHaveLength(1);
    const cookies = setCookies(res);
    expect(cookies.some((c) => c.startsWith("__Host-session="))).toBe(true);
    expect(cookies.some((c) => c.includes(`${STATE_COOKIE}=;`))).toBe(true);
  });

  it("consumes the flow, so a replayed callback finds nothing", async () => {
    const started = await start(new Request("https://auth.x.dev/oauth/start"), env);
    const state = stateFrom(started);
    googleReplies("a@x.dev");
    const req = () =>
      new Request(`https://auth.x.dev/oauth/callback?code=c&state=${state}`, {
        headers: { cookie: `${STATE_COOKIE}=${state}` },
      });

    await callback(req(), env);
    await expect(callback(req(), env)).rejects.toMatchObject({ code: "unknown_state" });
  });

  it("refuses an email with no row, and says so in the audit log", async () => {
    const started = await start(new Request("https://auth.x.dev/oauth/start"), env);
    const state = stateFrom(started);
    googleReplies("stranger@x.dev");

    const res = await callback(
      new Request(`https://auth.x.dev/oauth/callback?code=c&state=${state}`, {
        headers: { cookie: `${STATE_COOKIE}=${state}` },
      }),
      env,
    );
    expect(res.status).toBe(403);
    expect(ctx.sessions).toHaveLength(0);
    expect(ctx.audits).toContainEqual({ action: "login_denied", target: "stranger@x.dev" });
  });

  it("refuses an unverified Google email", async () => {
    const started = await start(new Request("https://auth.x.dev/oauth/start"), env);
    const state = stateFrom(started);
    googleReplies("a@x.dev", false);

    await expect(
      callback(
        new Request(`https://auth.x.dev/oauth/callback?code=c&state=${state}`, {
          headers: { cookie: `${STATE_COOKIE}=${state}` },
        }),
        env,
      ),
    ).rejects.toMatchObject({ code: "unverified_email" });
  });
});

describe("a desktop flow is bound to the process that began it", () => {
  const startDesktop = async (challenge: string) =>
    start(
      new Request(
        `https://auth.x.dev/oauth/start?mode=desktop&redirect=${encodeURIComponent(
          "http://127.0.0.1:49215/",
        )}&challenge=${challenge}`,
      ),
      env,
    );

  it("refuses to start without a client challenge", async () => {
    await expect(
      start(
        new Request(
          `https://auth.x.dev/oauth/start?mode=desktop&redirect=${encodeURIComponent(
            "http://127.0.0.1:49215/",
          )}`,
        ),
        env,
      ),
    ).rejects.toMatchObject({ code: "invalid_challenge" });
  });

  it("refuses a challenge that is not a base64url S256 digest", async () => {
    await expect(startDesktop("../../etc/passwd")).rejects.toMatchObject({
      code: "invalid_challenge",
    });
  });

  it("sets no cookie — the system browser is not the process that finishes", async () => {
    const res = await startDesktop(await challengeFor("v".repeat(43)));
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  async function handoffCode(verifier: string): Promise<string> {
    const started = await startDesktop(await challengeFor(verifier));
    const state = stateFrom(started);
    googleReplies("a@x.dev");
    const res = await callback(
      new Request(`https://auth.x.dev/oauth/callback?code=c&state=${state}`),
      env,
    );
    return new URL(res.headers.get("location")!).searchParams.get("code")!;
  }

  it("hands back a one-time code, not a session token", async () => {
    const code = await handoffCode("verifier-one");
    expect(code).toBeTruthy();
    expect(ctx.sessions).toHaveLength(0);
  });

  it("refuses an exchange with no verifier", async () => {
    const code = await handoffCode("verifier-one");
    await expect(
      exchange(
        new Request("https://auth.x.dev/oauth/exchange", {
          method: "POST",
          body: JSON.stringify({ code }),
        }),
        env,
      ),
    ).rejects.toMatchObject({ code: "missing_verifier" });
  });

  it("refuses a stolen code presented with the wrong verifier", async () => {
    const code = await handoffCode("verifier-one");
    await expect(
      exchange(
        new Request("https://auth.x.dev/oauth/exchange", {
          method: "POST",
          body: JSON.stringify({ code, verifier: "not-the-one" }),
        }),
        env,
      ),
    ).rejects.toMatchObject({ code: "verifier_mismatch" });
    expect(ctx.sessions).toHaveLength(0);
  });

  it("burns the code on a failed exchange, so it cannot be retried against", async () => {
    const code = await handoffCode("verifier-one");
    await expect(
      exchange(
        new Request("https://auth.x.dev/oauth/exchange", {
          method: "POST",
          body: JSON.stringify({ code, verifier: "wrong" }),
        }),
        env,
      ),
    ).rejects.toThrow();
    // Now with the right verifier: still refused, because the row is gone.
    await expect(
      exchange(
        new Request("https://auth.x.dev/oauth/exchange", {
          method: "POST",
          body: JSON.stringify({ code, verifier: "verifier-one" }),
        }),
        env,
      ),
    ).rejects.toMatchObject({ code: "invalid_code" });
  });

  it("mints a session for the process that holds the matching verifier", async () => {
    const code = await handoffCode("verifier-one");
    const res = await exchange(
      new Request("https://auth.x.dev/oauth/exchange", {
        method: "POST",
        body: JSON.stringify({ code, verifier: "verifier-one" }),
      }),
      env,
    );
    const body = (await res.json()) as { token: string; expires_at: number };
    expect(body.token).toBeTruthy();
    expect(body.expires_at).toBeGreaterThan(Date.now());
    expect(ctx.sessions).toHaveLength(1);
  });
});
