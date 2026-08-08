/**
 * Retries an async function with exponential backoff on transient failures.
 *
 * Retries on: network errors (TypeError, no response) and HTTP 5xx responses
 * if the result is a Response object.
 * Does NOT retry on: 4xx errors (auth/validation — always fatal).
 *
 * @param fn          The async function to call. Must be idempotent (safe to call multiple times).
 * @param maxAttempts Total number of attempts including the first (default: 2).
 * @param baseDelayMs Initial delay in ms; doubles on each subsequent retry (default: 1000).
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts = 2,
  baseDelayMs = 1000
): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await fn();

      // If the result is a Response-like object with a non-5xx status, accept it.
      // 5xx responses are considered transient and worth retrying.
      if (result && typeof (result as any).status === "number") {
        const status = (result as any).status as number;
        if (status >= 500 && attempt < maxAttempts - 1) {
          lastErr = new Error(`HTTP ${status}`);
          await delay(baseDelayMs * Math.pow(2, attempt));
          continue;
        }
      }

      return result;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        await delay(baseDelayMs * Math.pow(2, attempt));
      }
    }
  }

  throw lastErr;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
