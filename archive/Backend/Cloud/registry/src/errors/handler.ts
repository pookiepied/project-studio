import type { Context } from "hono";
import { AppError } from "./appError";
import type { AppBindings } from "../system/app";

export function handleError(error: Error, c: Context<AppBindings>): Response {
  const requestId = c.get("requestId");
  const logger = c.get("logger");

  if (error instanceof AppError) {
    logger?.warn("request.failed", {
      code: error.code,
      status: error.status,
      path: new URL(c.req.url).pathname,
      details: error.details,
    });
    return c.json({ error: { code: error.code, message: error.message, details: error.details, requestId } }, { status: error.status as 400 });
  }

  logger?.error("request.unhandled_error", {
    message: error.message,
    stack: error.stack,
    path: new URL(c.req.url).pathname,
  });
  return c.json({ error: { code: "internal_error", message: "Unexpected registry error.", requestId } }, 500);
}
