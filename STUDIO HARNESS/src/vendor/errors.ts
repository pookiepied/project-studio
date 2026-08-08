import { StudioError } from "../contracts/errors.js";

export type VendorErrorKind =
  /** The binary is neither vendored nor on the system. */
  | "not_found"
  /** No vendored build exists for this platform and architecture. */
  | "unsupported_platform"
  /** A path was found but is not something we are willing to run. */
  | "invalid_binary"
  | "internal";

const MESSAGE_BY_KIND: Record<VendorErrorKind, string> = {
  not_found: "A program Project Studio needs is not available.",
  unsupported_platform: "Project Studio has no build of this program for your system.",
  invalid_binary: "A program Project Studio needs is not usable.",
  internal: "A program could not be located.",
};

/**
 * The user-facing message deliberately says *what* is missing but never how to
 * install it, because the fix differs per binary — git is installed by the
 * user, ripgrep is fetched by us. The caller that knows which one it asked for
 * supplies the actionable message.
 */
export class VendorError extends StudioError {
  readonly domain = "vendor" as const;
  declare readonly kind: VendorErrorKind;

  constructor(kind: VendorErrorKind, options: { message?: string; cause?: unknown } = {}) {
    super(kind, options.message ?? MESSAGE_BY_KIND[kind], {
      retryable: false,
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
    });
    this.name = "VendorError";
  }
}
