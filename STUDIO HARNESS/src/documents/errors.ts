import { StudioError } from "../contracts/errors.js";

/**
 * A document could not be read as text. Two kinds:
 *
 * - `malformed`: the bytes are not the format the name claims, or the
 *   format is damaged or encrypted. Nothing to retry; the person picks
 *   another file.
 * - `too-large`: past the ceiling the reader will open. The sentence says
 *   the size and the ceiling.
 */
export class DocumentError extends StudioError {
  readonly domain = "documents" as const;

  constructor(kind: "malformed" | "too-large", message: string) {
    super(kind, message, { retryable: false });
    this.name = "DocumentError";
  }
}
