import type {
  CredentialKey,
  SecureCredentialStore,
} from "../credentials/credential-store.js";

export interface StudioSession {
  readonly accessToken: string;
  readonly refreshToken: string;
}

/**
 * Access and refresh tokens are stored as two separate keychain entries.
 *
 * That is a platform requirement, not a style choice: a credential entry holds
 * at most 1280 UTF-16 code units, and one JSON object containing both tokens
 * would be close to, or past, that ceiling. See ADR 0007.
 */
const ACCESS_KEY: CredentialKey = { scope: "session", id: "studio-access" };
const REFRESH_KEY: CredentialKey = { scope: "session", id: "studio-refresh" };

export class SessionStore {
  readonly #credentials: SecureCredentialStore;

  constructor(credentials: SecureCredentialStore) {
    this.#credentials = credentials;
  }

  /**
   * Returns the stored session, or `null` when the user is not signed in.
   *
   * A half-written session — one token present, the other missing — is treated
   * as no session at all. An access token with no refresh token cannot be
   * renewed, so continuing with it would only defer the same failure.
   */
  async load(): Promise<StudioSession | null> {
    const [accessToken, refreshToken] = await Promise.all([
      this.#credentials.get(ACCESS_KEY),
      this.#credentials.get(REFRESH_KEY),
    ]);

    if (accessToken === null || refreshToken === null) return null;
    return { accessToken, refreshToken };
  }

  /**
   * The refresh token is written first. If the process dies between the two
   * writes, the result is a half-written session, which `load` discards; the
   * alternative ordering could leave a live access token with no way to renew
   * it.
   */
  async save(session: StudioSession): Promise<void> {
    await this.#credentials.set(REFRESH_KEY, session.refreshToken);
    await this.#credentials.set(ACCESS_KEY, session.accessToken);
  }

  async clear(): Promise<void> {
    await Promise.all([
      this.#credentials.delete(ACCESS_KEY),
      this.#credentials.delete(REFRESH_KEY),
    ]);
  }
}

