import type { Context, MiddlewareHandler } from "hono";
import type { AppBindings } from "./app";

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export function createLogger(c: Context<AppBindings>, requestId: string): Logger {
  const base = {
    service: "studio-cloud-library-registry",
    environment: c.env.ENVIRONMENT,
    requestId,
  };

  const write = (level: "info" | "warn" | "error", message: string, fields: Record<string, unknown> = {}) => {
    console[level](JSON.stringify({ level, message, ...base, ...fields }));
  };

  return {
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}

export const loggingMiddleware: MiddlewareHandler<AppBindings> = async (c, next) => {
  const requestId = crypto.randomUUID();
  const logger = createLogger(c, requestId);
  c.set("logger", logger);
  c.set("requestId", requestId);

  const started = Date.now();
  await next();

  logger.info("request.completed", {
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    status: c.res.status,
    durationMs: Date.now() - started,
    userId: c.get("userId"),
  });
  c.header("x-request-id", requestId);
};
