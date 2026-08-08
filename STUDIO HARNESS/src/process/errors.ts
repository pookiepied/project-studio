import { StudioError } from "../contracts/errors.js";

export type ProcessErrorKind =
  /** The argument vector itself was rejected before anything was spawned. */
  | "invalid_argument"
  /** The executable could not be started. */
  | "spawn_failed"
  /** The process exceeded its wall-clock deadline and was killed. */
  | "timeout"
  /** The caller aborted the run. */
  | "aborted"
  /** The process produced more output than the caller allowed. */
  | "output_limit"
  | "internal";

const MESSAGE_BY_KIND: Record<ProcessErrorKind, string> = {
  invalid_argument: "The command could not be run as given.",
  spawn_failed: "The command could not be started.",
  timeout: "The command took too long and was stopped.",
  aborted: "The command was cancelled.",
  output_limit: "The command produced too much output and was stopped.",
  internal: "The command failed unexpectedly.",
};

/**
 * A failure of the *supervision* of a child process, never of what the child
 * concluded.
 *
 * A non-zero exit code is not an error here. `git diff --quiet` exits 1 to mean
 * "there are differences", and `grep` exits 1 to mean "no matches" — turning
 * those into thrown errors would make every caller catch and re-interpret them,
 * which is how a normal outcome becomes an incident in telemetry.
 */
export class ProcessError extends StudioError {
  readonly domain = "process" as const;
  declare readonly kind: ProcessErrorKind;

  constructor(kind: ProcessErrorKind, options: { message?: string; cause?: unknown } = {}) {
    super(kind, options.message ?? MESSAGE_BY_KIND[kind], {
      // A timeout can plausibly succeed on a second try; a rejected argument
      // vector cannot, and retrying it just burns the same failure twice.
      retryable: kind === "timeout",
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
    });
    this.name = "ProcessError";
  }
}
