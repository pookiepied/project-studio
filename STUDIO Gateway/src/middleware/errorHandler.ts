/**
 * Centralized error handler - imported by index.ts
 * All AppError -> JSON, unknown -> 500, never leak stack in production.
 */

import { AppError, toOpenAIError } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";

export function errorHandler(err: Error, c: { env: { ENVIRONMENT?: string }; req: { path: string } }): Response {
  if (err instanceof AppError) {
    logger.warn(err.message, { code: err.code, status: err.status, provider: err.provider, path: c.req.path });
    return new Response(JSON.stringify(toOpenAIError(err)), {
      status: err.status,
      headers: { "content-type": "application/json" },
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
