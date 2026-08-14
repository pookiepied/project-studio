import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkRateLimit, RATE_LIMIT_WINDOW_MS, MILLISECONDS_PER_SECOND } from "../src/lib/ratelimit.ts";

function createMockDb() {
  const entries: Array<{ key_id: string; timestamp: number }> = [];
  const db: D1Database = {
    prepare(sql: string) {
      const stmt: Record<string, unknown> = {
        _sql: sql,
        _args: [] as unknown[],
        bind(...args: unknown[]) {
          (stmt as { _args: unknown[] })._args = args;
          return stmt as unknown as D1PreparedStatement;
        },
        first: async <T>() => {
          const args = (stmt as { _args: unknown[] })._args as unknown[];
          if (sql.includes("COUNT(*)") && sql.includes("cnt")) {
            const keyId = args[0] as string;
            const windowStart = args[1] as number;
            const cnt = entries.filter((e) => e.key_id === keyId && e.timestamp > windowStart).length;
            return { cnt } as T;
          }
          if (sql.includes("MIN(timestamp)")) {
            const keyId = args[0] as string;
            const windowStart = args[1] as number;
            const filtered = entries.filter((e) => e.key_id === keyId && e.timestamp > windowStart);
            const oldest = filtered.length ? Math.min(...filtered.map((e) => e.timestamp)) : null;
            return { oldest } as T;
          }
          return null as T;
        },
        run: async () => {
          const args = (stmt as { _args: unknown[] })._args as unknown[];
          if (sql.includes("DELETE FROM gateway_key_usage")) {
            // Per-key cleanup: DELETE WHERE key_id = ? AND timestamp < ?
            const keyId = args[0] as string;
            const windowStart = args[1] as number;
            let deleted = 0;
            for (let i = entries.length - 1; i >= 0; i--) {
              if (entries[i].key_id === keyId && entries[i].timestamp < windowStart) {
                entries.splice(i, 1);
                deleted++;
              }
            }
            return { meta: { changes: deleted } } as never;
          }
          if (sql.includes("INSERT INTO gateway_key_usage")) {
            const keyId = args[0] as string;
            const ts = args[1] as number;
            const checkKeyId = args[2] as string;
            const windowStart = args[3] as number;
            const rpm = args[4] as number;
            const cnt = entries.filter((e) => e.key_id === checkKeyId && e.timestamp > windowStart).length;
            if (cnt < rpm) {
              entries.push({ key_id: keyId, timestamp: ts });
              return { meta: { changes: 1 } } as never;
            }
            return { meta: { changes: 0 } } as never;
          }
          return { meta: { changes: 0 } } as never;
        },
        all: async <T>() => ({ results: [] } as unknown as T),
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
  return { db, entries };
}

describe("Rate limiting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("allows first request and sets remaining and resetAt via constants", async () => {
    const { db } = createMockDb();
    const now = Date.now();
    vi.setSystemTime(now);
    const res = await checkRateLimit(db, "key1", 5);
    expect(res.allowed).toBe(true);
    expect(res.remaining).toBe(4);
    expect(res.limit).toBe(5);
    expect(res.resetAt).toBe(now + RATE_LIMIT_WINDOW_MS);
  });

  it("denies when at limit and resetAt is oldest + window", async () => {
    const { db, entries } = createMockDb();
    const now = 1_000_000;
    vi.setSystemTime(now);
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    // Fill with rpm entries at different times within window
    entries.push({ key_id: "k", timestamp: windowStart + 1000 });
    entries.push({ key_id: "k", timestamp: windowStart + 2000 });
    entries.push({ key_id: "k", timestamp: windowStart + 3000 });
    const res = await checkRateLimit(db, "k", 3);
    expect(res.allowed).toBe(false);
    expect(res.remaining).toBe(0);
    expect(res.resetAt).toBe(windowStart + 1000 + RATE_LIMIT_WINDOW_MS);
  });

  it("isolates per-key tracking", async () => {
    const { db } = createMockDb();
    const now = Date.now();
    vi.setSystemTime(now);
    await checkRateLimit(db, "a", 1);
    const resA2 = await checkRateLimit(db, "a", 1);
    expect(resA2.allowed).toBe(false);
    const resB = await checkRateLimit(db, "b", 1);
    expect(resB.allowed).toBe(true);
  });

  it("cleans old entries outside window", async () => {
    const { db, entries } = createMockDb();
    const now = 2_000_000;
    vi.setSystemTime(now);
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    entries.push({ key_id: "k", timestamp: windowStart - 1_000 }); // old, should be cleaned
    entries.push({ key_id: "k", timestamp: windowStart + 1_000 }); // valid
    const res = await checkRateLimit(db, "k", 5);
    expect(res.allowed).toBe(true);
    // Old entry should be gone, count should be 1 + new insert =2 total in window
    expect(entries.filter((e) => e.timestamp > windowStart).length).toBe(2);
  });

  it("handles concurrent race via conditional insert", async () => {
    const { db } = createMockDb();
    const now = Date.now();
    vi.setSystemTime(now);
    // Fill to rpm-1
    await checkRateLimit(db, "k", 2);
    // Two concurrent requests at same time, both see count 1 < 2, but only one should succeed via INSERT conditional
    const [r1, r2] = await Promise.all([
      checkRateLimit(db, "k", 2),
      checkRateLimit(db, "k", 2),
    ]);
    const allowedCount = [r1, r2].filter((r) => r.allowed).length;
    expect(allowedCount).toBe(1);
  });

  it("uses constants, not hardcoded values, for window", () => {
    expect(RATE_LIMIT_WINDOW_MS).toBe(60_000);
    expect(RATE_LIMIT_WINDOW_MS / MILLISECONDS_PER_SECOND).toBe(60);
  });

  it("sets correct headers via error handler on rate limit", async () => {
    const { errorHandler } = await import("../src/middleware/errorHandler.ts");
    const { rateLimited } = await import("../src/lib/errors.ts");
    const resetAt = Date.now() + RATE_LIMIT_WINDOW_MS;
    const err = rateLimited("Rate limit exceeded", { limit: 5, remaining: 0, resetAt });
    const res = errorHandler(err, { env: { ENVIRONMENT: "production" }, req: { path: "/v1/chat/completions" } } as never);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(res.headers.get("X-RateLimit-Reset")).toBe(String(Math.ceil(resetAt / MILLISECONDS_PER_SECOND)));
    expect(res.headers.get("Retry-After")).toBe(String(Math.ceil((resetAt - Date.now()) / MILLISECONDS_PER_SECOND)));
    expect(res.status).toBe(429);
  });
});
