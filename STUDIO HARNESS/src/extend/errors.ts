import { StudioError } from "../contracts/errors.js";

/**
 * How the extend spine fails.
 *
 * Separate from `tools` because the answers differ. "The gate refused that
 * call" is a permission question and the user answers it in an approval
 * dialog. "That server is not switched on for this project" is a scoping
 * question and the user answers it in settings. Giving both the same code
 * would send people to the wrong screen.
 */

export type ExtendFailure =
  /** A mistake in our own wiring, not something the user can act on. */
  | "internal"
  /** Named something that is not installed on this machine. */
  | "not_installed"
  /** Installed, but this project has not switched it on. */
  | "not_enabled";

const MESSAGE_BY_FAILURE: Record<ExtendFailure, string> = {
  internal: "Something is wired incorrectly inside Project Studio.",
  not_installed: "That is not installed.",
  not_enabled: "That is not switched on for this project.",
};

export class ExtendError extends StudioError {
  readonly domain = "extend" as const;
  declare readonly kind: ExtendFailure;

  constructor(kind: ExtendFailure, options: { message?: string } = {}) {
    // None of these are retryable: repeating the call cannot install
    // something, switch it on, or fix our wiring. Each needs a person.
    super(kind, options.message ?? MESSAGE_BY_FAILURE[kind], { retryable: false });
    this.name = "ExtendError";
  }
}
