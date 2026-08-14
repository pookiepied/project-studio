/**
 * Rate limit - centralized, per gateway key.
 * Uses D1 sliding window (simple, no KV needed for v1).
 * For high scale, swap to KV/DO without changing call sites.
 */

export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_WINDOW_SECONDS = RATE_LIMIT_WINDOW_MS / 1000;
export const MILLISECONDS_PER_SECOND = 1000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

export async function checkRateLimit(
  db: D1Database,
  keyId: string,
  rpm: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  // Per-key cleanup — scoped to key_id to avoid global contention and full table scan
  // Existing index idx_usage_key_time (key_id, timestamp) makes this efficient
  await db
    .prepare("DELETE FROM gateway_key_usage WHERE key_id = ? AND timestamp < ?")
    .bind(keyId, windowStart)
    .run();

  const countRow = await db
    .prepare("SELECT COUNT(*) as cnt FROM gateway_key_usage WHERE key_id = ? AND timestamp > ?")
    .bind(keyId, windowStart)
    .first<{ cnt: number }>();

  const count = countRow?.cnt ?? 0;

  // Compute resetAt from oldest entry in current window (correct sliding window)
  // If no entries, resetAt is now + window (next window)
  let resetAt: number;
  if (count === 0) {
    resetAt = now + RATE_LIMIT_WINDOW_MS;
  } else {
    const oldestRow = await db
      .prepare("SELECT MIN(timestamp) as oldest FROM gateway_key_usage WHERE key_id = ? AND timestamp > ?")
      .bind(keyId, windowStart)
      .first<{ oldest: number | null }>();
    const oldest = oldestRow?.oldest ?? now;
    resetAt = oldest + RATE_LIMIT_WINDOW_MS;
  }

  if (rpm < 1 || count >= rpm) {
    return { allowed: false, remaining: 0, resetAt, limit: rpm };
  }

  // Re-check the count inside the write statement. The earlier SELECT is
  // useful for remaining-count reporting, but this conditional INSERT closes
  // the check-then-insert race when requests arrive concurrently.
  const inserted = await db
    .prepare(
      "INSERT INTO gateway_key_usage (key_id, timestamp) " +
        "SELECT ?, ? WHERE (SELECT COUNT(*) FROM gateway_key_usage WHERE key_id = ? AND timestamp > ?) < ?",
    )
    .bind(keyId, now, keyId, windowStart, rpm)
    .run();
  if (inserted.meta.changes === 0) {
    // Lost race — recompute resetAt as above (already computed)
    return { allowed: false, remaining: 0, resetAt, limit: rpm };
  }

  return { allowed: true, remaining: rpm - count - 1, resetAt, limit: rpm };
}
