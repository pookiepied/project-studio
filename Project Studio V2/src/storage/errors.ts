import { StudioError } from "../contracts/errors.js";

export type StorageErrorKind =
  /** The database file could not be opened, created, or locked. */
  | "unavailable"
  /** A migration failed, or the file is at an unknown schema version. */
  | "migration"
  /** A write violated a uniqueness or referential constraint. */
  | "conflict"
  /** A required row does not exist. */
  | "not_found"
  /** A value was rejected before it reached the database. */
  | "invalid"
  /** The database failed for an unclassified reason. */
  | "internal";

const MESSAGE_BY_KIND: Record<StorageErrorKind, string> = {
  unavailable: "The Project Studio database could not be opened.",
  migration: "The Project Studio database schema could not be prepared.",
  conflict: "That record already exists.",
  not_found: "That record does not exist.",
  invalid: "The value is not valid for the Project Studio database.",
  internal: "The Project Studio database failed unexpectedly.",
};

/**
 * SQLite error messages quote the offending value, so a raw driver message is
 * only safe here because nothing secret is ever stored in this database — see
 * `assertNoSecretColumns`. Driver text is still not attached by default.
 */
export class StorageError extends StudioError {
  readonly domain = "storage" as const;
  declare readonly kind: StorageErrorKind;

  constructor(
    kind: StorageErrorKind,
    options: { message?: string; cause?: unknown } = {},
  ) {
    super(kind, options.message ?? MESSAGE_BY_KIND[kind], {
      // A locked or busy database can clear on its own; a constraint violation
      // or a bad schema version cannot.
      retryable: kind === "unavailable",
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
    });
    this.name = "StorageError";
  }
}

/** Maps a driver failure onto the taxonomy without echoing the driver's text. */
export function storageErrorFrom(
  error: unknown,
  fallback: StorageErrorKind = "internal",
): StorageError {
  const message = error instanceof Error ? error.message : "";

  if (/UNIQUE constraint|PRIMARY KEY|constraint failed/i.test(message)) {
    return new StorageError("conflict", { cause: error });
  }
  if (/database is locked|SQLITE_BUSY/i.test(message)) {
    return new StorageError("unavailable", { cause: error });
  }

  return new StorageError(fallback, { cause: error });
}
