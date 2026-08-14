/**
 * Centralized error handler - imported by index.ts
 * All AppError -> JSON, unknown -> 500, never leak stack in production.
 */

import { AppError, toOpenAIError } from "../lib/errors.ts";
import { logger } from "../observability/logger.ts";
import { MILLISECONDS_PER_SECOND } from "../lib/ratelimit.ts";

export function errorHandler(err: Error, c: { env: { ENVIRONMENT?: string }; req: { path: string } }): Response {
  if (err instanceof AppError) {
    logger.warn(err.message, { code: err.code, status: err.status, provider: err.provider, path: c.req.path });
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (err.code === "RATE_LIMITED" && err.details && typeof err.details === "object") {
      const d = err.details as { limit?: number; remaining?: number; resetAt?: number };
      if (typeof d.limit === "number") headers["X-RateLimit-Limit"] = String(d.limit);
      if (typeof d.remaining === "number") headers["X-RateLimit-Remaining"] = String(d.remaining);
      if (typeof d.resetAt === "number") {
        headers["X-RateLimit-Reset"] = String(Math.ceil(d.resetAt / MILLISECONDS_PER_SECOND));
        const retryAfter = Math.max(0, Math.ceil((d.resetAt - Date.now()) / MILLISECONDS_PER_SECOND));
        headers["Retry-After"] = String(retryAfter);
      }
    }
    return new Response(JSON.stringify(toOpenAIError(err)), {
      status: err.status,
      headers,
    });
  }
  logger.error("Unhandled error", { message: err.message, stack: err.stack, path: c.req.path });
  const isDev = c.env.ENVIRONMENT === "development";
  return new Response(
    JSON.stringify({
      error: {
        message: isDev ? err.message : "Internal server error",
        type: "internal_error",
        code: "INTERNAL_ERROR",
      },
    }),
    { status: 500, headers: { "content-type": "application/json" } },
  );
}
