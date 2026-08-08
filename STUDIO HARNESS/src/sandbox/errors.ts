import { StudioError } from "../contracts/errors.js";

export type SandboxErrorKind =
  /** A path resolved outside every root the sandbox allows. */
  | "path_escape"
  /** The operation is not permitted by this sandbox's policy. */
  | "not_permitted"
  /** The requested capability needs isolation this sandbox cannot provide. */
  | "unsupported_isolation"
  /** The sandbox could not be created or reached. */
  | "unavailable"
  /** The policy itself is invalid. */
  | "invalid_policy"
  | "internal";

const MESSAGE_BY_KIND: Record<SandboxErrorKind, string> = {
  path_escape: "That path is outside the workspace this agent may use.",
  not_permitted: "The sandbox does not permit that operation.",
  unsupported_isolation:
    "That action needs stronger isolation than the local sandbox provides.",
  unavailable: "The sandbox could not be started.",
  invalid_policy: "The sandbox policy is not valid.",
  internal: "The sandbox failed unexpectedly.",
};

/**
 * Carries the *attempted* path only when it is safe to echo — which is never
 * for the caller-facing message. A blocked path is model-produced and may
 * embed content the model was working with, so the message names the boundary
 * rather than the attempt.
 */
export class SandboxError extends StudioError {
  readonly domain = "sandbox" as const;
  declare readonly kind: SandboxErrorKind;

  constructor(kind: SandboxErrorKind, options: { message?: string } = {}) {
    super(kind, options.message ?? MESSAGE_BY_KIND[kind], {
      retryable: kind === "unavailable",
    });
    this.name = "SandboxError";
  }
}
