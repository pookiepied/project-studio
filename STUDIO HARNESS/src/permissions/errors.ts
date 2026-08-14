import { StudioError } from "../contracts/errors.js";

export type PermissionErrorKind =
  /** The policy refused the call. */
  | "denied"
  /** The call needs approval and no approver was available. */
  | "approval_required"
  /** The capability is not registered, so nothing can be decided about it. */
  | "unknown_capability"
  /** The execution scope was missing or malformed. */
  | "invalid_scope"
  /** A grant could not be read or written. */
  | "grant_unavailable"
  /** The caller withdrew the request while approval was pending. */
  | "cancelled"
  | "internal";

const MESSAGE_BY_KIND: Record<PermissionErrorKind, string> = {
  denied: "That action is not permitted.",
  approval_required: "That action needs your approval before it can run.",
  unknown_capability: "That action is not registered and cannot be run.",
  invalid_scope: "The action was requested without a valid execution scope.",
  grant_unavailable: "Stored permissions could not be read.",
  cancelled: "The permission request was cancelled.",
  internal: "The permission system failed unexpectedly.",
};

/**
 * Never carries the capability's arguments. A denied call's arguments are
 * model-produced and may contain anything the model was working with,
 * including content the user pasted.
 */
export class PermissionError extends StudioError {
  readonly domain = "permissions" as const;
  declare readonly kind: PermissionErrorKind;
  /** Which capability was refused, for the caller to render. */
  readonly capability: string | undefined;

  constructor(
    kind: PermissionErrorKind,
    options: { message?: string; capability?: string } = {},
  ) {
    super(kind, options.message ?? MESSAGE_BY_KIND[kind], {
      // A denial is a decision, not a transient condition. Retrying it
      // unchanged must never be treated as worth attempting.
      retryable: kind === "grant_unavailable",
    });
    this.name = "PermissionError";
    this.capability = options.capability;
  }
}
