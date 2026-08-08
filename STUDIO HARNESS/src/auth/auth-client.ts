import type { StudioAuthConfig } from "./config.js";
import { authErrorForStatus, StudioAuthError } from "./errors.js";
import type { StudioSession } from "./session.js";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface StudioUser {
  readonly id: string;
  readonly email: string;
  readonly name?: string;
  readonly role?: string;
}

export interface SignInResult {
  readonly session: StudioSession;
  readonly user: StudioUser;
}

/**
 * HTTP boundary for the Project Studio auth service.
 *
 * The auth service already supports native clients: it returns the refresh
 * token in the response body rather than only as an HttpOnly cookie, and
 * accepts it in the request body on refresh. No cookie jar is involved here.
 */
export class StudioAuthClient {
  readonly #config: StudioAuthConfig;
  readonly #fetch: FetchLike;

  constructor(config: StudioAuthConfig, fetchImpl?: FetchLike) {
    this.#config = config;
    this.#fetch = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  /** Trades a verified Google ID token for a Project Studio session. */
  async signInWithGoogle(
    idToken: string,
    signal?: AbortSignal,
  ): Promise<SignInResult> {
    const body = await this.#post("/google", { idToken }, signal);

    const accessToken = readString(body, "accessToken");
    const refreshToken = readString(body, "refreshToken");
    if (accessToken === null || refreshToken === null) {
      // A web client could continue on the cookie alone; the harness cannot,
      // so a response without a body refresh token is a contract failure here.
      throw new StudioAuthError("protocol");
    }

    const rawUser = (body as { user?: unknown }).user;
    const id = readString(rawUser, "id");
    const email = readString(rawUser, "email");
    if (id === null || email === null) throw new StudioAuthError("protocol");

    const name = readString(rawUser, "name");
    const role = readString(rawUser, "role");

    return {
      session: { accessToken, refreshToken },
      user: {
        id,
        email,
        ...(name === null ? {} : { name }),
        ...(role === null ? {} : { role }),
      },
    };
  }

  /**
   * Renews a session. The service rotates refresh tokens, so the returned one
   * replaces the old value; if it omits one, the existing token is kept rather
   * than discarding a still-valid credential.
   */
  async refresh(
    refreshToken: string,
    signal?: AbortSignal,
  ): Promise<StudioSession> {
    const body = await this.#post("/refresh", { refreshToken }, signal);

    const accessToken = readString(body, "accessToken");
    if (accessToken === null) throw new StudioAuthError("protocol");

    return {
      accessToken,
      refreshToken: readString(body, "refreshToken") ?? refreshToken,
    };
  }

  async #post(
    path: string,
    payload: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const url = `${this.#config.authBaseUrl}${path}`;

    const controller = new AbortController();
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else
        signal.addEventListener("abort", () => controller.abort(signal.reason), {
          once: true,
        });
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#config.requestTimeoutMs);

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (timedOut) throw new StudioAuthError("unavailable");
      if (isAbortError(error) || signal?.aborted) {
        throw new StudioAuthError("aborted");
      }
      throw new StudioAuthError("unavailable");
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) throw authErrorForStatus(response.status);

    try {
      return await response.json();
    } catch {
      throw new StudioAuthError("protocol");
    }
  }
}

function readString(source: unknown, key: string): string | null {
  if (!source || typeof source !== "object") return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}
