import {
  assertValidKey,
  assertValidSecret,
  credentialAccount,
  type CredentialKey,
  type SecureCredentialStore,
} from "./credential-store.js";

/**
 * In-memory store for tests.
 *
 * It enforces the same key and secret validation as the keyring store, so a
 * test cannot pass with a secret the real platform store would reject. It is
 * never used in production: there is no plaintext fallback, and this holds
 * secrets only for the lifetime of the process.
 */
export class InMemoryCredentialStore implements SecureCredentialStore {
  readonly #entries = new Map<string, string>();

  async get(key: CredentialKey): Promise<string | null> {
    assertValidKey(key);
    return this.#entries.get(credentialAccount(key)) ?? null;
  }

  async set(key: CredentialKey, secret: string): Promise<void> {
    assertValidKey(key);
    assertValidSecret(secret);
    this.#entries.set(credentialAccount(key), secret);
  }

  async delete(key: CredentialKey): Promise<boolean> {
    assertValidKey(key);
    return this.#entries.delete(credentialAccount(key));
  }

  /** Test helper: how many secrets are held. Never exposes the values. */
  get size(): number {
    return this.#entries.size;
  }
}
