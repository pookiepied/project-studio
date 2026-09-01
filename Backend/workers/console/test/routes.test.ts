import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@pookiepied/core";

/**
 * Access decides who reaches the console; these are the checks the console
 * makes for itself once someone has. `access.test.ts` covers the assertion, so
 * it is stubbed here — the subject is what happens after a valid one arrives.
 */
vi.mock("../src/access.js", async (orig) => ({
  ...(await orig<typeof import("../src/access.js")>()),
  verifyAccessJwt: async () => identity,
}));

let identity: { email: string; sub: string } | null = null;

const { default: worker } = await import("../src/index.js");
type Env = Parameters<typeof worker.fetch>[1];

const ORIGIN = "https://console.pookiepied.dev";

const ADMIN_USER: User = {
  id: "u1",
  email: "boss@acme.dev",
  name: "Boss",
  role: "admin",
  status: "active",
};

/** Captures every SQL string the analytics layer sends. */
let sql: string[] = [];

function envWith(operator: User | null, overrides: Partial<Env> = {}): Env {
  return {
    ACCESS_TEAM_DOMAIN: "acme.cloudflareaccess.com",
    ACCESS_AUD: "aud",
    CF_ACCOUNT_ID: "acct",
    CF_API_TOKEN: "tok",
    ANALYTICS_DATASET: "events",
    CONSOLE_ORIGIN: ORIGIN,
    ASSETS: { fetch: async () => new Response("<html>the dashboard</html>") },
    ADMIN: {
      operator: async () => operator,
      listUsers: async () => [ADMIN_USER],
      invite: async (email: string) => ({ ...ADMIN_USER, email }),
      setStatus: async () => undefined,
      setRole: async () => undefined,
      listSessions: async () => [],
      revokeSession: async () => true,
      recentAuditEvents: async () => [],
      health: async () => ({
        service: "auth",
        status: "ok" as const,
        observedAt: 0,
        durationMs: 0,
        checks: [],
      }),
    },
    ...overrides,
  } as unknown as Env;
}

const get = (path: string) => new Request(`${ORIGIN}${path}`);
const post = (path: string, body: unknown, origin: string | null = ORIGIN) =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: origin ? { origin, "content-type": "application/json" } : {},
    body: JSON.stringify(body),
  });

beforeEach(() => {
  identity = { email: "boss@acme.dev", sub: "s1" };
  sql = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body?: string }) => {
    sql.push(String(init?.body ?? ""));
    return { ok: true, json: async () => ({ data: [] }) };
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("Access is the first gate, not the only one", () => {
  it("refuses someone with no account in the identity database", async () => {
    const res = await worker.fetch(get("/api/users"), envWith(null));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "forbidden" });
  });

  it("refuses an allowlisted user who is not an admin", async () => {
    const res = await worker.fetch(get("/api/users"), envWith({ ...ADMIN_USER, role: "user" }));
    expect(res.status).toBe(403);
  });

  it("refuses an admin whose account has been disabled", async () => {
    const res = await worker.fetch(
      get("/api/users"),
      envWith({ ...ADMIN_USER, status: "disabled" }),
    );
    expect(res.status).toBe(403);
  });

  it("refuses a request with no Access assertion at all", async () => {
    identity = null;
    const res = await worker.fetch(get("/api/users"), envWith(ADMIN_USER));
    expect(res.status).toBe(401);
  });

  it("admits an active admin", async () => {
    const res = await worker.fetch(get("/api/users"), envWith(ADMIN_USER));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ users: [ADMIN_USER] });
  });

  it("gates the dashboard itself, not only the API", async () => {
    const res = await worker.fetch(get("/index.html"), envWith({ ...ADMIN_USER, role: "user" }));
    expect(res.status).toBe(403);
  });
});

describe("cross-site requests cannot mutate accounts", () => {
  it("refuses a POST from another origin", async () => {
    const res = await worker.fetch(
      post("/api/users/invite", { email: "x@y.dev" }, "https://evil.example"),
      envWith(ADMIN_USER),
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "bad_origin" });
  });

  it("refuses a POST with no Origin header, which a form post would send", async () => {
    const res = await worker.fetch(
      post("/api/users/invite", { email: "x@y.dev" }, null),
      envWith(ADMIN_USER),
    );
    expect(res.status).toBe(403);
  });

  it("allows a POST from the console's own origin", async () => {
    const res = await worker.fetch(
      post("/api/users/invite", { email: "x@y.dev" }),
      envWith(ADMIN_USER),
    );
    expect(res.status).toBe(200);
  });

  it("does not require an Origin on reads", async () => {
    const res = await worker.fetch(get("/api/audit"), envWith(ADMIN_USER));
    expect(res.status).toBe(200);
  });
});

describe("query parameters fall back to their stated defaults", () => {
  it("asks for 24 hours and 200 rows when the caller says nothing", async () => {
    // `Number(null)` is 0 and 0 is finite, so an absent parameter used to slip
    // past the fallback, get clamped up to 1, and return one row from one hour.
    const res = await worker.fetch(get("/api/activity"), envWith(ADMIN_USER));
    expect(res.status).toBe(200);
    expect(sql[0]).toContain("INTERVAL '24' HOUR");
    expect(sql[0]).toContain("LIMIT 200");
  });

  it("still honours a parameter that is given", async () => {
    await worker.fetch(get("/api/activity?hours=6&limit=10"), envWith(ADMIN_USER));
    expect(sql[0]).toContain("INTERVAL '6' HOUR");
    expect(sql[0]).toContain("LIMIT 10");
  });

  it("falls back for garbage rather than failing", async () => {
    await worker.fetch(get("/api/activity?hours=abc&limit="), envWith(ADMIN_USER));
    expect(sql[0]).toContain("INTERVAL '24' HOUR");
    expect(sql[0]).toContain("LIMIT 200");
  });

  it("drops a filter that could rewrite the query", async () => {
    await worker.fetch(get("/api/activity?source=' OR 1=1 --"), envWith(ADMIN_USER));
    expect(sql[0]).not.toContain("OR 1=1");
  });
});

describe("deliberate refusals are answers, not faults", () => {
  it("reports the last-admin guard as 409 rather than a 500", async () => {
    const env = envWith(ADMIN_USER, {
      ADMIN: {
        ...envWith(ADMIN_USER).ADMIN,
        setRole: async () => {
          throw new Error("last_active_admin");
        },
      },
    } as Partial<Env>);
    const res = await worker.fetch(
      post("/api/users/role", { user_id: "u1", role: "user" }),
      env,
    );
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "last_active_admin" });
  });

  it("rejects an invalid status without reaching the binding", async () => {
    const res = await worker.fetch(
      post("/api/users/status", { user_id: "u1", status: "banished" }),
      envWith(ADMIN_USER),
    );
    expect(res.status).toBe(400);
  });
});
