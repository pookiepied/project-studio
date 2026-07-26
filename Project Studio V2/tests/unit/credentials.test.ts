import { describe, expect, it } from "vitest";

import {
  assertValidKey,
  assertValidSecret,
  credentialAccount,
  CredentialStoreError,
  MAX_SECRET_LENGTH,
  type CredentialKey,
} from "../../src/credentials/credential-store.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";

const sessionKey: CredentialKey = { scope: "session", id: "studio" };
const providerKey: CredentialKey = { scope: "provider", id: "openai" };

describe("credential keys", () => {
  it("namespaces the account by scope so ids cannot collide", () => {
    expect(credentialAccount(sessionKey)).toBe("session:studio");
    expect(credentialAccount({ scope: "provider", id: "studio" })).toBe(
      "provider:studio",
    );
  });

  it("rejects unknown scopes", () => {
    expect(() =>
      assertValidKey({ scope: "other" as never, id: "x" }),
    ).toThrow(CredentialStoreError);
  });

  it("rejects ids that could escape the account namespace", () => {
    for (const id of ["", "has space", "with:colon", "sla/sh", "..", "-leading"]) {
      expect(() => assertValidKey({ scope: "provider", id })).toThrow(
        CredentialStoreError,
      );
    }
  });

  it("accepts ordinary provider ids", () => {
    for (const id of ["openai", "azure-openai", "my.provider", "vendor_2"]) {
      expect(() => assertValidKey({ scope: "provider", id })).not.toThrow();
    }
  });
});

describe("secret validation", () => {
  it("rejects an empty secret", () => {
    expect(() => assertValidSecret("")).toThrow(CredentialStoreError);
  });

  it("accepts a secret at the platform limit", () => {
    expect(() => assertValidSecret("x".repeat(MAX_SECRET_LENGTH))).not.toThrow();
  });

  /**
   * The real Windows store rejects anything longer. Enforcing it in the
   * contract means a value that stores on macOS also stores on Windows.
   */
  it("rejects a secret past the platform limit as too_large", () => {
    try {
      assertValidSecret("x".repeat(MAX_SECRET_LENGTH + 1));
      throw new Error("expected a CredentialStoreError");
    } catch (error) {
      expect(error).toBeInstanceOf(CredentialStoreError);
      expect((error as CredentialStoreError).kind).toBe("too_large");
    }
  });

  it("never repeats the secret in the error message", () => {
    const secret = "super-secret-value-".repeat(400);
    try {
      assertValidSecret(secret);
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret-value");
    }
  });
});

describe("in-memory store", () => {
  it("round-trips a secret", async () => {
    const store = new InMemoryCredentialStore();
    await store.set(providerKey, "sk-test-123");

    expect(await store.get(providerKey)).toBe("sk-test-123");
  });

  it("returns null for a missing entry rather than throwing", async () => {
    const store = new InMemoryCredentialStore();

    expect(await store.get(providerKey)).toBeNull();
  });

  it("keeps scopes isolated", async () => {
    const store = new InMemoryCredentialStore();
    await store.set({ scope: "session", id: "shared" }, "session-secret");
    await store.set({ scope: "provider", id: "shared" }, "provider-secret");

    expect(await store.get({ scope: "session", id: "shared" })).toBe("session-secret");
    expect(await store.get({ scope: "provider", id: "shared" })).toBe("provider-secret");
  });

  it("reports whether a delete removed anything, and is idempotent", async () => {
    const store = new InMemoryCredentialStore();
    await store.set(providerKey, "sk-test-123");

    expect(await store.delete(providerKey)).toBe(true);
    expect(await store.delete(providerKey)).toBe(false);
    expect(await store.get(providerKey)).toBeNull();
    expect(store.size).toBe(0);
  });

  it("enforces the same limits as the platform store", async () => {
    const store = new InMemoryCredentialStore();

    await expect(
      store.set(providerKey, "x".repeat(MAX_SECRET_LENGTH + 1)),
    ).rejects.toThrow(CredentialStoreError);
    await expect(store.set(providerKey, "")).rejects.toThrow(CredentialStoreError);
  });
});
