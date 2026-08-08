import { afterAll, describe, expect, it } from "vitest";

import {
  CredentialStoreError,
  MAX_SECRET_LENGTH,
  type CredentialKey,
} from "../../src/credentials/credential-store.js";
import {
  isKeyringAvailable,
  KeyringCredentialStore,
} from "../../src/credentials/keyring-store.js";

/**
 * Exercises the real operating system credential store.
 *
 * A test service name is used so the developer's actual Project Studio entries
 * are never touched. Where no platform store exists — headless Linux without a
 * running Secret Service is the usual case — the suite skips rather than fails,
 * because that is an environment fact and not a defect.
 */
const TEST_SERVICE = "Project Studio (test)";
const store = new KeyringCredentialStore(TEST_SERVICE);
const available = await isKeyringAvailable(store);

const key: CredentialKey = { scope: "provider", id: "keyring-test" };

afterAll(async () => {
  if (available) await store.delete(key);
});

describe.skipIf(!available)("operating system credential store", () => {
  it("round-trips a secret through the platform store", async () => {
    await store.set(key, "sk-platform-round-trip");

    // Read through a separate instance: the value must come from the OS, not
    // from anything this object is holding.
    const reader = new KeyringCredentialStore(TEST_SERVICE);
    expect(await reader.get(key)).toBe("sk-platform-round-trip");
  });

  it("overwrites an existing secret", async () => {
    await store.set(key, "first");
    await store.set(key, "second");

    expect(await store.get(key)).toBe("second");
  });

  it("returns null for a key that was never stored", async () => {
    expect(await store.get({ scope: "provider", id: "never-stored" })).toBeNull();
  });

  it("deletes idempotently", async () => {
    await store.set(key, "to-be-deleted");

    expect(await store.delete(key)).toBe(true);
    expect(await store.delete(key)).toBe(false);
    expect(await store.get(key)).toBeNull();
  });

  it("rejects an oversized secret before the platform does", async () => {
    // The contract check must fire first, so the failure is the same typed
    // error on every platform instead of a Windows-only platform message.
    await expect(
      store.set(key, "x".repeat(MAX_SECRET_LENGTH + 1)),
    ).rejects.toBeInstanceOf(CredentialStoreError);
  });

  it("stores a secret at the platform limit", async () => {
    const atLimit = "y".repeat(MAX_SECRET_LENGTH);
    await store.set(key, atLimit);

    expect(await store.get(key)).toBe(atLimit);
  });
});

describe.skipIf(available)("operating system credential store", () => {
  it("is unavailable in this environment, so platform tests were skipped", () => {
    expect(available).toBe(false);
  });
});
