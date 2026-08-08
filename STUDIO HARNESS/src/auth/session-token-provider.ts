import type { ErrorReporter } from "../observability/error-reporter.js";
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
  readonly reporter?: ErrorReporter;
}

/**
 * Resolves with `work`, or rejects as soon as `signal` aborts.
 *
 * `work` is left running either way. That is the point: it is shared, and one
 * caller walking away must not end it for the others.
 */
async function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    // The shared promise still needs a handler, or an eventual failure it
    // nobody is waiting on becomes an unhandled rejection.
    void work.catch(() => undefined);
    throw signal.reason;
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });

    work.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
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
   *
   * **No caller's signal governs it.** The refresh belongs to the provider, not
   * to whichever call happened to arrive first. Passing that caller's signal in
   * meant cancelling call A failed call B, which was never cancelled. Each
   * caller now races this promise against its own signal instead, so a
   * cancellation reaches only the caller who asked for it.
   *
   * The consequence is deliberate: if every caller cancels, the refresh still
   * runs to completion and the renewed session is saved. That is the useful
   * outcome — the work is nearly done and the next call needs it.
   */
  #refreshing: Promise<StudioSession> | undefined;

  readonly #reporter: ErrorReporter | undefined;

  constructor(options: SessionAccessTokenProviderOptions) {
    this.#sessions = options.sessions;
    this.#client = options.client;
    this.#skewMs = options.skewMs ?? 60_000;
    this.#reporter = options.reporter;
  }

  async getAccessToken(signal?: AbortSignal): Promise<string> {
    const session = assertSession(await this.#sessions.load());

    if (!needsRefresh(session.accessToken, this.#skewMs)) {
      return session.accessToken;
    }

    const renewed = await untilAborted(this.#refresh(session), signal);
    return renewed.accessToken;
  }

  async #refresh(session: StudioSession): Promise<StudioSession> {
    if (this.#refreshing) return this.#refreshing;

    const attempt = (async () => {
      try {
        const renewed = await this.#client.refresh(session.refreshToken);
        await this.#sessions.save(renewed);
        return renewed;
      } catch (error) {
        // Reported here because this is where the decision is made. The caller
        // sees only a failed model call, so without this the difference between
        // "the network blipped" and "the user was signed out" is invisible.
        this.#reporter?.report(error, { operation: "auth.refresh" });

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
