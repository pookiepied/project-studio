import { Entry } from "@napi-rs/keyring";

import {
  assertValidKey,
  assertValidSecret,
  credentialAccount,
  CredentialStoreError,
  type CredentialKey,
  type SecureCredentialStore,
} from "./credential-store.js";

/**
 * Service name registered in the platform store. It appears in Windows
 * Credential Manager, Keychain Access, and Seahorse, so it is a user-facing
 * label and should stay stable across releases.
 */
export const CREDENTIAL_SERVICE = "Project Studio";

/**
 * Backed by the operating system's own secret store: Windows Credential
 * Manager, macOS Keychain, or Linux Secret Service. `@napi-rs/keyring` ships
 * prebuilt binaries for every platform Studio targets, so installing it does
 * not require a local toolchain.
 *
 * Verified against the real Windows store: reading a missing entry returns
 * `null` rather than throwing, and deleting a missing entry reports `false`
 * rather than failing.
 */
export class KeyringCredentialStore implements SecureCredentialStore {
  readonly #service: string;

  constructor(service: string = CREDENTIAL_SERVICE) {
    this.#service = service;
  }

  async get(key: CredentialKey): Promise<string | null> {
    const entry = this.#entry(key);
    try {
      return entry.getPassword();
    } catch (error) {
      throw translate(error);
    }
  }

  async set(key: CredentialKey, secret: string): Promise<void> {
    assertValidSecret(secret);
    const entry = this.#entry(key);
    try {
      entry.setPassword(secret);
    } catch (error) {
      throw translate(error);
    }
  }

  async delete(key: CredentialKey): Promise<boolean> {
    const entry = this.#entry(key);
    try {
      return entry.deleteCredential();
    } catch (error) {
      throw translate(error);
    }
  }

  #entry(key: CredentialKey): Entry {
    assertValidKey(key);
    try {
      return new Entry(this.#service, credentialAccount(key));
    } catch (error) {
      throw translate(error);
    }
  }
}

/**
 * Converts a platform failure into a typed error.
 *
 * The platform's own message is discarded rather than wrapped: keyring backends
 * have been observed to include the attempted value in their error text, and
 * this error may be logged.
 */
function translate(error: unknown): CredentialStoreError {
  const raw = error instanceof Error ? error.message : "";

  if (/longer than the platform limit|too long|size/i.test(raw)) {
    return new CredentialStoreError("too_large");
  }
  if (/no such|not found|no matching/i.test(raw)) {
    // Reading a missing entry normally returns null; reaching here means the
    // backend itself could not be queried.
    return new CredentialStoreError("unavailable");
  }
  if (
    /unavailable|no.*(secret service|keyring|collection)|dbus|access denied|denied|locked/i.test(
      raw,
    )
  ) {
    return new CredentialStoreError("unavailable");
  }
  return new CredentialStoreError("internal");
}

/**
 * Reports whether the platform store can actually be reached, by round-tripping
 * a probe entry. Headless Linux without a running Secret Service is the case
 * this catches. Callers use it to fail with a clear message at startup instead
 * of at the first credential read.
 */
export async function isKeyringAvailable(
  store: SecureCredentialStore = new KeyringCredentialStore(),
): Promise<boolean> {
  const probe: CredentialKey = { scope: "session", id: "availability-probe" };
  try {
    await store.set(probe, "probe");
    await store.delete(probe);
    return true;
  } catch {
    return false;
  }
}
