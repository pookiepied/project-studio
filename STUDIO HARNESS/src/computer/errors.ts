import { StudioError } from "../contracts/errors.js";

/**
 * What can go wrong driving a desktop, in the vocabulary a caller can act on.
 *
 * The same shape as the browser's errors and for the same reason: a failure
 * a model can read and recover from is a result, and one that names what to
 * do is worth more than one that names what happened.
 */
export type ComputerFailure =
  /**
   * No driver could be started. On anything but Windows this is the only
   * answer in this version, and the message says what would change it.
   */
  | "unsupported"
  /** The driver process died or would not start; the message carries why. */
  | "driver"
  /** The call did not say what to act on, or said something contradictory. */
  | "bad_input"
  /** A reference from an older observation or window, or one that has gone. */
  | "no_element"
  /** Windows refused the input, almost always an elevated window. */
  | "refused"
  /** A mistake in our own wiring, not something anyone can act on. */
  | "internal";

const MESSAGE_BY_FAILURE: Record<ComputerFailure, string> = {
  unsupported: "Computer use is not available on this machine.",
  driver: "The desktop driver stopped answering.",
  bad_input: "That call did not say what to act on.",
  no_element: "That element is not on screen.",
  refused: "Windows refused that input.",
  internal: "Something is wired incorrectly inside Project Studio's computer use.",
};

export class ComputerError extends StudioError {
  readonly domain = "computer" as const;
  declare readonly kind: ComputerFailure;

  constructor(kind: ComputerFailure, options: { message?: string } = {}) {
    // Nothing here is worth retrying unchanged: a driver that died is
    // relaunched by the next call on its own, and every other failure needs
    // a different call, not the same one again.
    super(kind, options.message ?? MESSAGE_BY_FAILURE[kind], { retryable: false });
    this.name = "ComputerError";
  }
}
