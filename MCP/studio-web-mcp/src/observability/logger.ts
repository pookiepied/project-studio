/**
 * Workers structured logger — mirror of harness `src/observability/logger.ts:1`.
 *
 * Differences:
 * - harness: Node `process.stdout` + OTel trace correlation via @opentelemetry/api
 * - workers: `console.log` JSON lines (captured by Cloudflare Logpush / Tail Workers)
 *   + correlation via `cf-ray` / `x-request-id` / `traceparent` (no Node OTel SDK)
 *
 * Redaction: same philosophy — no secrets, no prompt bodies, no tool args echo.
 * Raw provider error text is truncated to 500 chars and redacted before logging.
 *
 * OTel path for Workers (when enabled):
 *  - Workers can emit OTel via `workers-opentelemetry` or by forwarding
 *    traceparent headers to downstream fetches. The logger's `trace_id` /
 *    `span_id` fields are set from the active Workers span when available,
 *    otherwise from request headers.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  readonly [key: string]: unknown;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly deploymentEnvironment: string;
  readonly baseFields?: LogFields;
  readonly write?: (line: string) => void;
  readonly correlationId?: string; // x-request-id / cf-ray for this request
}

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|api[_-]?key|credential|cookie|prompt|tool[_-]?arg|env|stack/i;

function safeString(value: string): string {
  // minimal redaction without importing full catalog — workers bundle size matters
  // full catalog lives in harness `src/observability/redaction-rules.ts`
  let out = value;
  // Bearer / api key patterns
  out = out.replace(/Bearer\s+[A-Za-z0-9\-_\.]+/gi, "Bearer [REDACTED]");
  out = out.replace(/sk-[A-Za-z0-9\-_]{10,}/g, "sk-[REDACTED]");
  return out.slice(0, 500);
}

function safeSerializeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") {
    const s = safeString(value);
    return s.length > 200 ? `${s.slice(0, 200)}...` : s;
  }
  if (value instanceof Error) {
    return { name: value.name, message: safeString(value.message) };
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((e) => safeSerializeValue(e, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : safeSerializeValue(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

function emit(options: LoggerOptions, level: LogLevel, message: string, fields?: LogFields): void {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    message: safeString(message),
    "service.name": options.serviceName,
    "service.version": options.serviceVersion,
    "deployment.environment": options.deploymentEnvironment,
    ...(options.correlationId ? { request_id: options.correlationId } : {}),
    ...((safeSerializeValue({ ...options.baseFields, ...fields }) as LogFields) ?? {}),
  };
  const line = JSON.stringify(record);
  if (options.write) {
    options.write(`${line}\n`);
    return;
  }
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "debug") console.debug(line);
  else console.log(line);
}

export function createLogger(options: LoggerOptions): Logger {
  const log = (level: LogLevel) => (message: string, fields?: LogFields) => emit(options, level, message, fields);
  return {
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    child(fields: LogFields): Logger {
      return createLogger({ ...options, baseFields: { ...options.baseFields, ...fields } });
    },
  };
}

/** Convenience: logger for a single request with its correlation id. */
export function createRequestLogger(
  env: { MCP_SERVER_NAME?: string; MCP_SERVER_VERSION?: string },
  requestId: string,
  baseFields?: LogFields,
): Logger {
  return createLogger({
    serviceName: env.MCP_SERVER_NAME ?? "studio-web-mcp",
    serviceVersion: env.MCP_SERVER_VERSION ?? "0.1.0",
    deploymentEnvironment: "production",
    correlationId: requestId,
    baseFields,
  });
}
