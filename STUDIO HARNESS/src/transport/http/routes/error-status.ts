import type { ContentfulStatusCode } from "hono/utils/http-status";

import { StorageError } from "../../../storage/errors.js";
import { SnapshotError } from "../../../snapshots/errors.js";
import { toErrorReport } from "../../../observability/error-reporter.js";

/**
 * How a storage-shaped failure becomes an HTTP answer.
 *
 * Routes owned by the provider surface wrote this mapping inline, but the
 * conversation and project surfaces are built on `StorageError`, whose kinds
 * already say what went wrong and deserve statuses that say the same thing.
 * One mapping, then, rather than four copies that drift.
 *
 * `SnapshotError` joins the same idea from the undo surface: a snapshot id
 * nothing recorded is a missing row, an undo taken while git or the store is
 * out of action is a degraded service, and every other snapshot failure is
 * ours. Naming the codes here keeps the restore route from inventing its own
 * statuses beside the ones the rest of the file answers with.
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
  if (error instanceof SnapshotError) {
    switch (error.kind) {
      case "unknown_snapshot":
        return 404;
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
