/**
 * Deduplicated gateway auth helper — canonical for per-route auth.
 * Replaces 8× `requireGatewayBearer` + `checkRateLimit` + `last_used_at` blocks.
 * Sets X-RateLimit headers for both allowed and rate-limited responses.
 */

import type { Context } from "hono";
import { requireGatewayBearer } from "./auth.ts";
import { checkRateLimit, MILLISECONDS_PER_SECOND } from "../lib/ratelimit.ts";
import { rateLimited } from "../lib/errors.ts";
import type { Env } from "../index.ts";
import { updateRequestTelemetry } from "../observability/request.ts";

export async function authorizeGateway(c: Context<{ Bindings: Env }>): Promise<{ keyId: string; rpm: number } | null> {
  const authHeader = c.req.header("authorization") ?? null;
  const verified = await requireGatewayBearer(c.env.DB, authHeader, c.env.ENVIRONMENT);
  if (verified) {
    const rl = await checkRateLimit(c.env.DB, verified.keyId, verified.rpm);
    // Set rate limit headers for successful requests (visible on next response)
    c.header("X-RateLimit-Limit", String(rl.limit));
    c.header("X-RateLimit-Remaining", String(rl.remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(rl.resetAt / MILLISECONDS_PER_SECOND)));
    if (!rl.allowed) {
      const retryAfter = Math.max(0, Math.ceil((rl.resetAt - Date.now()) / MILLISECONDS_PER_SECOND));
      c.header("Retry-After", String(retryAfter));
      throw rateLimited("Rate limit exceeded", { limit: rl.limit, remaining: rl.remaining, resetAt: rl.resetAt });
    }
    c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE gateway_keys SET last_used_at = ? WHERE id = ?").bind(Date.now(), verified.keyId).run());
    updateRequestTelemetry(c as never, { gatewayKeyId: verified.keyId, gatewayKeyName: verified.keyName });
  }
  return verified;
}
