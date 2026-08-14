/**
 * Centralized logger — canonical location (was `lib/logger.ts`).
 * Structured JSON, redacts secrets. Imported by every route/service.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  requestId?: string;
  provider?: string;
  model?: string;
  gatewayKeyId?: string;
  durationMs?: number;
  [key: string]: unknown;
}

const REDACT_KEYS = new Set(["authorization", "x-api-key", "api-key", "key", "credential", "encrypted_key", "x-admin-token", "admin-token", "admin_token", "admin", "ADMIN_TOKEN"]);

function redact(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "object" && v !== null) {
      out[k] = redact(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function log(level: LogLevel, message: string, ctx?: LogContext): void {
  const redacted = redact(ctx ?? {}) as Record<string, unknown>;
  const entry: Record<string, unknown> = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...redacted,
  };
  const line = JSON.stringify(entry);
  switch (level) {
    case "debug":
      console.debug(line);
      break;
    case "info":
      console.log(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "error":
      console.error(line);
      break;
  }
}

export const logger = {
  debug: (msg: string, ctx?: LogContext) => log("debug", msg, ctx),
  info: (msg: string, ctx?: LogContext) => log("info", msg, ctx),
  warn: (msg: string, ctx?: LogContext) => log("warn", msg, ctx),
  error: (msg: string, ctx?: LogContext) => log("error", msg, ctx),
};
