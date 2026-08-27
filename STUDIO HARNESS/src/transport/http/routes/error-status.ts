import type { ContentfulStatusCode } from "hono/utils/http-status";

import { StorageError } from "../../../storage/errors.js";
import { toErrorReport } from "../../../observability/error-reporter.js";

/**
 * How a storage-shaped failure becomes an HTTP answer.
 *
 * Routes owned by the provider surface wrote this mapping inline, but the
 * conversation and project surfaces are built on `StorageError`, whose kinds
 * already say what went wrong and deserve statuses that say the same thing.
 * One mapping, then, rather than four copies that drift.
 */
export function statusOf(error: unknown): ContentfulStatusCode {
  if (error instanceof StorageError) {
    switch (error.kind) {
      case "not_found":
        return 404;
      case "conflict":
        return 409;
      case "invalid":
        return 400;
      case "unavailable":
        return 503;
      default:
        return 500;
    }
  }
  return 400;
}

export function failure(error: unknown): { error: string; code: string } {
  const report = toErrorReport(error);
  return { error: report.message, code: report.code };
}

/** A request body that never reached the database at all. */
export function invalidBody(message: string): StorageError {
  return new StorageError("invalid", { message });
}
