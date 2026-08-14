import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { healthRoute } from "../src/routes/system/health.ts";
import { adminProvidersRoute } from "../src/routes/admin/providers.ts";
import { adminKeysRoute } from "../src/routes/admin/keys.ts";

describe("Health", () => {
  it("GET /health returns ok", async () => {
    const app = new Hono<{ Bindings: { ENVIRONMENT: string } }>();
    app.route("/", healthRoute);
    const res = await app.request("/health", {}, { ENVIRONMENT: "test" } as never);
    expect(res.status).toBe(200);
    const json = await res.json() as { status: string };
    expect(json.status).toBe("ok");
  });
});

describe("Admin providers", () => {
  it("GET /admin/providers requires admin", async () => {
    const app = new Hono<{ Bindings: { DB: D1Database; ENVIRONMENT: string; ADMIN_TOKEN: string } }>();
    app.route("/admin", adminProvidersRoute);
    const { errorHandler } = await import("../src/middleware/errorHandler.ts");
    app.onError((err, c) => errorHandler(err as Error, c as never));
    const db = { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 1 } }) }), all: async () => ({ results: [] }), first: async () => null } as unknown as D1PreparedStatement) } as unknown as D1Database;
    const res = await app.request("/admin/providers", { headers: { "x-admin-token": "wrong" } }, { DB: db, ENVIRONMENT: "production", ADMIN_TOKEN: "secret" } as never);
    expect(res.status).toBe(403);
  });

  it("GET /ready checks DB", async () => {
    const app = new Hono<{ Bindings: { DB: D1Database; ENVIRONMENT: string } }>();
    app.route("/", healthRoute);
    const db: D1Database = { prepare: () => ({ bind: () => ({ first: async () => ({ "1": 1 }) }), first: async () => ({ "1": 1 }), all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 1 } }), bind: () => ({ first: async () => ({ "1": 1 }) }) } as unknown as D1PreparedStatement) } as unknown as D1Database;
    const res = await app.request("/ready", {}, { DB: db, ENVIRONMENT: "test" } as never);
    expect(res.status).toBe(200);
  });
});
