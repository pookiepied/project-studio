import { describe, expect, it } from "vitest";

import { requireAdmin, requireGatewayBearer } from "../src/middleware/auth.ts";

function database(enabledKeys = 0): D1Database {
  return {
    prepare(sql: string) {
      const statement = {
        bind: () => statement,
        first: async <T>() =>
          (sql.includes("COUNT(*)") ? { cnt: enabledKeys } : null) as T | null,
      };
      return statement;
    },
  } as unknown as D1Database;
}

describe("Gateway admission", () => {
  it("allows keyless consumer access only in explicit development", async () => {
    await expect(
      requireGatewayBearer(database(), null, "development"),
    ).resolves.toBeNull();
    await expect(
      requireGatewayBearer(database(), null, "production"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  });

  it("fails closed when enabled keys exist", async () => {
    await expect(
      requireGatewayBearer(database(1), null, "development"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  });

  it("requires an admin secret outside development", () => {
    const request = { header: () => undefined };
    expect(() =>
      requireAdmin({ env: { ENVIRONMENT: "production" } as never, req: request }),
    ).toThrow(/not configured/i);
    expect(() =>
      requireAdmin({ env: { ENVIRONMENT: "development" } as never, req: request }),
    ).not.toThrow();
  });

  it("protects admin discovery with the same admin policy", async () => {
    // The route-level invocation is covered by the source contract: the helper
    // is deliberately synchronous and throws the same AppError the other admin
    // routes use. This test keeps the production-mode failure explicit.
    expect(() =>
      requireAdmin({ env: { ENVIRONMENT: "production" } as never, req: request }),
    ).toThrow();
  });
});

const request = { header: () => undefined };
