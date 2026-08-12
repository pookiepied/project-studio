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
  | "not_enabled"
  /** A request was sent and no answer came back in time. */
  | "timed_out"
  /** The caller withdrew before an answer came back. */
  | "cancelled"
  /** The connection ended with requests still waiting on it. */
  | "disconnected";

const MESSAGE_BY_FAILURE: Record<ExtendFailure, string> = {
  internal: "Something is wired incorrectly inside Project Studio.",
  not_installed: "That is not installed.",
  not_enabled: "That is not switched on for this project.",
  timed_out: "The server did not answer in time.",
  cancelled: "The request was stopped before the server answered.",
  disconnected: "The connection to the server ended before it answered.",
};

/**
 * Which failures are worth trying again.
 *
 * A timeout and a lost connection may both succeed on a second attempt; the
 * rest need a person. This is the one place that judgement is made, so a caller
 * deciding whether to retry never has to know the vocabulary.
 */
const RETRYABLE: ReadonlySet<ExtendFailure> = new Set<ExtendFailure>([
  "timed_out",
  "disconnected",
]);

export class ExtendError extends StudioError {
  readonly domain = "extend" as const;
  declare readonly kind: ExtendFailure;

  constructor(kind: ExtendFailure, options: { message?: string } = {}) {
    super(kind, options.message ?? MESSAGE_BY_FAILURE[kind], {
      retryable: RETRYABLE.has(kind),
    });
    this.name = "ExtendError";
  }
}
