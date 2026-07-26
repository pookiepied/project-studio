import type {
  CredentialKey,
  SecureCredentialStore,
} from "../credentials/credential-store.js";
import { StudioAuthError } from "./errors.js";

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

/**
 * Reads the `exp` claim from a Studio JWT.
 *
 * The signature is deliberately not verified: the harness is the token's
 * holder, not its verifier. Only the auth service and the API can validate it,
 * and they do. This is used solely to decide when to refresh proactively, so a
 * token whose expiry cannot be read is treated as already expired and gets
 * refreshed rather than trusted.
 */
export function accessTokenExpiryMs(accessToken: string): number | null {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;

  try {
    const payload = parts[1] as string;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const decoded: unknown = JSON.parse(
      Buffer.from(padded, "base64").toString("utf8"),
    );

    const exp = (decoded as { exp?: unknown })?.exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Whether the token should be renewed now. The skew means a token is replaced
 * shortly before it actually expires, so a request does not start with a valid
 * token and arrive with an expired one.
 */
export function needsRefresh(
  accessToken: string,
  skewMs = 60_000,
  now = Date.now(),
): boolean {
  const expiry = accessTokenExpiryMs(accessToken);
  if (expiry === null) return true;
  return expiry - skewMs <= now;
}

export function assertSession(session: StudioSession | null): StudioSession {
  if (session === null) throw new StudioAuthError("signed_out");
  return session;
}
