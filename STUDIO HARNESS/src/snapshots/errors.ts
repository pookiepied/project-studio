import { StudioError } from "../contracts/errors.js";

export type SnapshotErrorKind =
  /** Git could not be located, so no history can be kept at all. */
  | "unavailable"
  /** The shadow repository could not be created or opened. */
  | "store_failed"
  /** A snapshot could not be recorded. */
  | "capture_failed"
  /** A restore could not be completed. */
  | "restore_failed"
  /** The caller named a snapshot that is not in this project's history. */
  | "unknown_snapshot"
  | "internal";

const MESSAGE_BY_KIND: Record<SnapshotErrorKind, string> = {
  unavailable: "Git is not available, so changes cannot be made undoable.",
  store_failed: "The undo history for this project could not be opened.",
  capture_failed: "The current state of the project could not be recorded.",
  restore_failed: "The project could not be returned to that point.",
  unknown_snapshot: "That point in the history does not exist.",
  internal: "The undo history failed unexpectedly.",
};

export class SnapshotError extends StudioError {
  readonly domain = "snapshots" as const;
  declare readonly kind: SnapshotErrorKind;

  constructor(
    kind: SnapshotErrorKind,
    options: { message?: string; cause?: unknown; retryable?: boolean } = {},
  ) {
    super(kind, options.message ?? MESSAGE_BY_KIND[kind], {
      retryable: options.retryable ?? false,
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
    });
    this.name = "SnapshotError";
  }
}
