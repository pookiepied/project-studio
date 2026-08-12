/**
 * Rate limit - centralized, per gateway key.
 * Uses D1 sliding window (simple, no KV needed for v1).
 * For high scale, swap to KV/DO without changing call sites.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export async function checkRateLimit(
  db: D1Database,
  keyId: string,
  rpm: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = now - 60_000;

  // Clean old entries and count current window
  // Table gateway_key_usage(key_id, timestamp)
  await db
    .prepare("DELETE FROM gateway_key_usage WHERE timestamp < ?")
    .bind(windowStart)
    .run();

  const countRow = await db
    .prepare("SELECT COUNT(*) as cnt FROM gateway_key_usage WHERE key_id = ? AND timestamp > ?")
    .bind(keyId, windowStart)
    .first<{ cnt: number }>();

  const count = countRow?.cnt ?? 0;

  if (count >= rpm) {
    return { allowed: false, remaining: 0, resetAt: windowStart + 60_000 };
  }

  await db
    .prepare("INSERT INTO gateway_key_usage (key_id, timestamp) VALUES (?, ?)")
    .bind(keyId, now)
    .run();

  return { allowed: true, remaining: rpm - count - 1, resetAt: windowStart + 60_000 };
}
