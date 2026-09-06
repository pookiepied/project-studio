import { redactSensitiveString } from "./redaction.js";

const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|api[_-]?key|credential|cookie|prompt|tool[_-]?arg|env|stack/i;

export interface NormalizedError {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly retryable: boolean;
  readonly cause?: NormalizedError;
}

export interface SafeSerializedError {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly retryable: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sanitizeMessage(message: string): string {
  return redactSensitiveString(message).slice(0, 500);
}

export function normalizeError(
  error: unknown,
  options: { includeCause?: boolean } = {},
): NormalizedError {
  if (error instanceof Error) {
    const code = readString((error as Error & { code?: unknown }).code);
    const normalized: NormalizedError = {
      name: error.name || "Error",
      message: sanitizeMessage(error.message || "Unknown error"),
      retryable: false,
      ...(code ? { code } : {}),
    };

    if (options.includeCause && error.cause !== undefined) {
      return {
        ...normalized,
        cause: normalizeError(error.cause, options),
      };
    }

    return normalized;
  }

  if (typeof error === "string") {
    return {
      name: "Error",
      message: sanitizeMessage(error),
      retryable: false,
    };
  }

  if (isRecord(error)) {
    const name = readString(error.name) ?? "Error";
    const message =
      readString(error.message) ??
      readString(error.error) ??
      "Unknown error";
    const code = readString(error.code);
    return {
      name,
      message: sanitizeMessage(message),
      retryable: error.retryable === true,
      ...(code ? { code } : {}),
    };
  }

  return {
    name: "Error",
    message: "Unknown error",
    retryable: false,
  };
}

export function safeSerializeError(error: unknown): SafeSerializedError {
  const normalized = normalizeError(error);
  return {
    name: normalized.name,
    message: normalized.message,
    retryable: normalized.retryable,
    ...(normalized.code ? { code: normalized.code } : {}),
  };
}

export function safeSerializeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return "[truncated]";
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "string") {
    const redacted = redactSensitiveString(value);
    return redacted.length > 200 ? `${redacted.slice(0, 200)}...` : redacted;
  }

  if (value instanceof Error) {
    return safeSerializeError(value);
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((entry) => safeSerializeValue(entry, depth + 1));
  }

  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) {
        result[key] = "[REDACTED]";
        continue;
      }
      result[key] = safeSerializeValue(entry, depth + 1);
    }
    return result;
  }

  // The last resort of a function whose contract is to never throw. What
  // reaches here is a symbol, a function, or an object with no useful
  // stringification, and "[object Object]" is a truthful answer for the
  // third: this is a diagnostic serializer, not a formatter.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(value);
}
