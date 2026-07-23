import { context, trace } from "@opentelemetry/api";

import { safeSerializeValue } from "./errors.js";
import { redactSensitiveString } from "./redaction.js";

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
}

function correlationFields(): LogFields {
  const span = trace.getSpan(context.active());
  if (!span) {
    return {};
  }

  const spanContext = span.spanContext();
  if (!spanContext.traceId || !spanContext.spanId) {
    return {};
  }

  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
    trace_flags: spanContext.traceFlags,
  };
}

function emit(
  options: LoggerOptions,
  level: LogLevel,
  message: string,
  fields: LogFields | undefined,
): void {
  const serializedFields = safeSerializeValue({
    ...options.baseFields,
    ...fields,
  }) as LogFields;
  const record = {
    ...serializedFields,
    timestamp: new Date().toISOString(),
    level,
    message: redactSensitiveString(message),
    "service.name": options.serviceName,
    "service.version": options.serviceVersion,
    "deployment.environment": options.deploymentEnvironment,
    ...correlationFields(),
  };

  const line = `${JSON.stringify(record)}\n`;
  if (options.write) {
    options.write(line);
    return;
  }

  if (level === "error") {
    process.stderr.write(line);
    return;
  }

  process.stdout.write(line);
}

export function createLogger(options: LoggerOptions): Logger {
  const log =
    (level: LogLevel) =>
    (message: string, fields?: LogFields): void => {
      emit(options, level, message, fields);
    };

  return {
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    child(fields: LogFields): Logger {
      return createLogger({
        ...options,
        baseFields: {
          ...options.baseFields,
          ...fields,
        },
      });
    },
  };
}
