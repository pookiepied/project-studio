import { describe, expect, it } from "vitest";
import { withAuth, type UmbrellaEnv } from "../src/auth.js";
import { OwnedDb } from "../src/db.js";
import { json } from "../src/errors.js";
import type { Identity } from "../src/types.js";

/**
 * These are the tests for the failure everyone actually ships: a route that
 * forgot its check, or a query that forgot whose row it was reading. They are
 * mechanical on purpose — the point is that they keep passing in two years when
 * the code around them has been rewritten.
 */

const ALICE: Identity = {
  user: { id: "alice", email: "a@x.dev", name: null, role: "user", status: "active" },
  session: { id: "s1", userId: "alice", expiresAt: Date.now() + 60_000 },
};

function envWith(map: Record<string, Identity>): UmbrellaEnv {
  return { AUTH: { validate: async (t) => map[t] ?? null } };
}

const ec = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const call = (w: { fetch(r: Request, e: never, c: ExecutionContext): Promise<Response> }, req: Request, env: UmbrellaEnv) =>
  w.fetch(req, env as never, ec);

const worker = withAuth<UmbrellaEnv>({
  public: ["GET /health"],
  admin: ["ALL /admin/*"],
  publicFetch: async () => json({ ok: true }),
  fetch: async (_req, ctx) => json({ id: ctx.user.id }),
});

describe("deny by default", () => {
  it("rejects an undeclared route with no token", async () => {
    const res = await call(worker, new Request("https://x.dev/anything"), envWith({}));
    expect(res.status).toBe(401);
  });

  it("rejects a route nobody thought about — the forgotten-route case", async () => {
    const res = await call(worker, new Request("https://x.dev/v1/some/new/thing"), envWith({}));
    expect(res.status).toBe(401);
  });

  it("allows an explicitly public route", async () => {
    const res = await call(worker, new Request("https://x.dev/health"), envWith({}));
    expect(res.status).toBe(200);
  });

  it("does not let a public GET rule open the same path to POST", async () => {
    const res = await call(
      worker,
      new Request("https://x.dev/health", { method: "POST" }),
      envWith({}),
    );
    expect(res.status).toBe(401);
  });

  it("does not treat a public rule as a prefix unless it says so", async () => {
    const res = await call(worker, new Request("https://x.dev/health/secrets"), envWith({}));
    expect(res.status).toBe(401);
  });
});

describe("identity cannot come from the caller", () => {
  const spoofs = [
    ["x-user-id header", { "x-user-id": "alice" }],
    ["x-forwarded-user header", { "x-forwarded-user": "alice" }],
  ] as const;

  for (const [name, headers] of spoofs) {
    it(`ignores a ${name}`, async () => {
      const res = await call(worker, new Request("https://x.dev/thing", { headers }), envWith({}));
      expect(res.status).toBe(401);
    });
  }

  it("ignores a user id in the query string", async () => {
    const res = await call(worker, new Request("https://x.dev/thing?user_id=alice"), envWith({}));
    expect(res.status).toBe(401);
  });

  it("takes the user only from what AUTH.validate returned", async () => {
    const res = await call(
      worker,
      new Request("https://x.dev/thing", {
        headers: { authorization: "Bearer good", "x-user-id": "mallory" },
      }),
      envWith({ good: ALICE }),
    );
    expect(await res.json()).toEqual({ id: "alice" });
  });
});

describe("status and role gates", () => {
  it("refuses a disabled account holding a live token", async () => {
    const disabled: Identity = { ...ALICE, user: { ...ALICE.user, status: "disabled" } };
    const res = await call(
      worker,
      new Request("https://x.dev/thing", { headers: { authorization: "Bearer t" } }),
      envWith({ t: disabled }),
    );
    expect(res.status).toBe(403);
  });

  it("refuses an invited-but-never-active account", async () => {
    const invited: Identity = { ...ALICE, user: { ...ALICE.user, status: "invited" } };
    const res = await call(
      worker,
      new Request("https://x.dev/thing", { headers: { authorization: "Bearer t" } }),
      envWith({ t: invited }),
    );
    expect(res.status).toBe(403);
  });

  it("refuses an admin route to a normal user", async () => {
    const res = await call(
      worker,
      new Request("https://x.dev/admin/users", { headers: { authorization: "Bearer t" } }),
      envWith({ t: ALICE }),
    );
    expect(res.status).toBe(403);
  });

  it("allows an admin route to an admin", async () => {
    const admin: Identity = { ...ALICE, user: { ...ALICE.user, role: "admin" } };
    const res = await call(
      worker,
      new Request("https://x.dev/admin/users", { headers: { authorization: "Bearer t" } }),
      envWith({ t: admin }),
    );
    expect(res.status).toBe(200);
  });
});

describe("ownership is in the query, not the handler", () => {
  function spyDb() {
    const seen: { sql: string; binds: unknown[] }[] = [];
    const db = {
      prepare(sql: string) {
        const entry = { sql, binds: [] as unknown[] };
        seen.push(entry);
        const stmt = {
          bind(...binds: unknown[]) {
            entry.binds = binds;
            return stmt;
          },
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 0 } }),
        };
        return stmt;
      },
    } as unknown as D1Database;
    return { db, seen };
  }

  it("scopes every statement it can issue to the owner", async () => {
    const { db, seen } = spyDb();
    const owned = new OwnedDb(db, "alice");

    await owned.find("docs", "doc-owned-by-bob");
    await owned.list("docs");
    await owned.insert("docs", { id: "d1", title: "t" });
    await owned.update("docs", "doc-owned-by-bob", { title: "t" });
    await owned.remove("docs", "doc-owned-by-bob");

    expect(seen).toHaveLength(5);
    for (const { sql, binds } of seen) {
      expect(sql).toMatch(/user_id/);
      expect(binds).toContain("alice");
    }
  });

  it("404s rather than 403s for a row that is not ours", async () => {
    const { db } = spyDb();
    await expect(new OwnedDb(db, "alice").get("docs", "bobs-doc")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("refuses an unsafe table name instead of interpolating it", async () => {
    const { db } = spyDb();
    await expect(new OwnedDb(db, "alice").find("docs; DROP TABLE users", "x")).rejects.toThrow(
      /unsafe table name/,
    );
  });
});
