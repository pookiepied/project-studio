import type { AccessTokenProvider } from "../models/studio-cloud/access-token.js";
import type { StudioAuthClient } from "./auth-client.js";
import { StudioAuthError } from "./errors.js";
import {
  assertSession,
  needsRefresh,
  type SessionStore,
  type StudioSession,
} from "./session.js";

export interface SessionAccessTokenProviderOptions {
  readonly sessions: SessionStore;
  readonly client: StudioAuthClient;
  /** How long before expiry a token is renewed. */
  readonly skewMs?: number;
}

/**
 * Supplies the Studio access token for outbound gateway calls from the stored
 * session, renewing it when it is close to expiry.
 *
 * This is the production replacement for the development bootstrap token. The
 * adapter that consumes it is unchanged: it still sees only the injected
 * `AccessTokenProvider` interface and never learns where the token came from.
 */
export class SessionAccessTokenProvider implements AccessTokenProvider {
  readonly #sessions: SessionStore;
  readonly #client: StudioAuthClient;
  readonly #skewMs: number;

  /**
   * The in-flight refresh, shared by every concurrent caller.
   *
   * Model calls run in parallel, so without this a burst of requests arriving
   * on an expiring token would each start their own refresh. The service
   * rotates refresh tokens, so the second exchange would be redeeming a token
   * the first had already invalidated, and the user would be signed out.
   */
  #refreshing: Promise<StudioSession> | undefined;

  constructor(options: SessionAccessTokenProviderOptions) {
    this.#sessions = options.sessions;
    this.#client = options.client;
    this.#skewMs = options.skewMs ?? 60_000;
  }

  async getAccessToken(signal?: AbortSignal): Promise<string> {
    const session = assertSession(await this.#sessions.load());

    if (!needsRefresh(session.accessToken, this.#skewMs)) {
      return session.accessToken;
    }

    return (await this.#refresh(session, signal)).accessToken;
  }

  async #refresh(
    session: StudioSession,
    signal?: AbortSignal,
  ): Promise<StudioSession> {
    if (this.#refreshing) return this.#refreshing;

    const attempt = (async () => {
      try {
        const renewed = await this.#client.refresh(session.refreshToken, signal);
        await this.#sessions.save(renewed);
        return renewed;
      } catch (error) {
        // A rejected refresh token cannot be recovered from, and keeping it
        // would make every later call fail the same way. Clearing it makes the
        // state honest: the user is signed out and must sign in again.
        if (
          error instanceof StudioAuthError &&
          (error.kind === "session_expired" || error.kind === "not_permitted")
        ) {
          await this.#sessions.clear();
        }
        throw error;
      } finally {
        this.#refreshing = undefined;
      }
    })();

    this.#refreshing = attempt;
    return attempt;
  }
}
