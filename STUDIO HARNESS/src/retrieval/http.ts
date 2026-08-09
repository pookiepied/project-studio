import { RetrievalError, retrievalKindForStatus } from "./errors.js";

/**
 * The one HTTP call every provider adapter makes.
 *
 * Shared so that five adapters cannot disagree about what a 429 means, what a
 * dropped connection is called, or whether a timeout is a failure or an empty
 * result. An adapter that needs different behaviour overrides the *mapping*,
 * never the call.
 */

/** Longer than a page load, shorter than a user's patience. */
const DEFAULT_TIMEOUT_MS = 30_000;

export interface ProviderRequest {
  readonly provider: string;
  readonly url: string;
  readonly method?: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly signal: AbortSignal | undefined;
  readonly timeoutMs?: number;
  /**
   * Overrides the shared status mapping where a service is unconventional —
   * Jina answers 451 for a page it may not serve, which is `blocked` and not
   * `internal`.
   */
  readonly kindForStatus?: (status: number) => ReturnType<typeof retrievalKindForStatus>;
}

/**
 * Runs the call and returns the raw body.
 *
 * The response text is returned rather than parsed, because half these services
 * answer with JSON and half with markdown, and a shared parser would have to
 * know which — that is exactly the vendor knowledge each adapter is supposed to
 * own.
 */
export async function callProvider(request: ProviderRequest): Promise<string> {
  const timeout = AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  // The caller's signal and our deadline both have to be able to stop this. Our
  // own timeout must not look like the user pressing stop, so the two are told
  // apart below rather than merged into one reason.
  const signal = request.signal
    ? AbortSignal.any([request.signal, timeout])
    : timeout;

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: request.method ?? "GET",
      headers: {
        accept: "application/json",
        ...request.headers,
      },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      signal,
      // A redirect is a new destination, and ADR 0022 says every destination is
      // checked. Following automatically would skip that check, so the caller
      // is handed the redirect instead.
      redirect: "manual",
    });
  } catch (error) {
    if (timeout.aborted) {
      throw new RetrievalError("timeout", { provider: request.provider, cause: error });
    }
    // The caller's own cancellation is not a provider failure and must not be
    // reported as one.
    if (request.signal?.aborted) throw request.signal.reason;
    throw new RetrievalError("unavailable", {
      provider: request.provider,
      cause: error,
    });
  }

  if (response.status >= 300 && response.status < 400) {
    // Providers answer at fixed endpoints. A redirect from one is a
    // misconfiguration or an interception, and following it would send the API
    // key somewhere we did not choose.
    throw new RetrievalError("unavailable", {
      provider: request.provider,
      message: `${request.provider} redirected the request, which is never expected.`,
    });
  }

  if (!response.ok) {
    const kind = (request.kindForStatus ?? retrievalKindForStatus)(response.status);
    throw new RetrievalError(kind, { provider: request.provider });
  }

  try {
    return await response.text();
  } catch (error) {
    throw new RetrievalError("unavailable", {
      provider: request.provider,
      cause: error,
    });
  }
}

/** Parses a provider's JSON body, or says which provider sent nonsense. */
export function parseProviderJson<T>(provider: string, body: string): T {
  try {
    return JSON.parse(body) as T;
  } catch (error) {
    throw new RetrievalError("unavailable", {
      provider,
      message: `${provider} returned a response that could not be read.`,
      cause: error,
    });
  }
}
