/**
 * Failure categories for Project Studio sign-in.
 *
 * These describe the harness's own session, not the model gateway: a gateway
 * 401 means the token was rejected downstream, while `signed_out` here means
 * there is no usable session on this machine at all.
 */
export type StudioAuthErrorKind =
  /** No session is stored; the user has not signed in on this machine. */
  | "signed_out"
  /** A session exists but can no longer be renewed; sign-in must be repeated. */
  | "session_expired"
  /** Sign-in completed but this account is not permitted to use Studio. */
  | "not_permitted"
  /** Sign-in configuration is missing or invalid. */
  | "configuration"
  /** The auth service or Google could not be reached. */
  | "unavailable"
  /** A response did not match the expected contract. */
  | "protocol"
  /** The user cancelled, or the flow was aborted. */
  | "aborted"
  | "internal";

const MESSAGE_BY_KIND: Record<StudioAuthErrorKind, string> = {
  signed_out: "Not signed in to Project Studio. Run the sign-in flow first.",
  session_expired:
    "The Project Studio session has expired and could not be renewed. Sign in again.",
  not_permitted: "This Google account is not permitted to use Project Studio.",
  configuration: "Project Studio sign-in is not configured correctly.",
  unavailable: "The Project Studio sign-in service could not be reached.",
  protocol: "The Project Studio sign-in service returned an unreadable response.",
  aborted: "Sign-in was cancelled.",
  internal: "Project Studio sign-in hit an unexpected error.",
};

/**
 * Never carries a token, an authorization code, or a PKCE verifier. Sign-in
 * failures are logged, and every one of those values is a credential.
 */
export class StudioAuthError extends Error {
  readonly kind: StudioAuthErrorKind;

  constructor(kind: StudioAuthErrorKind, options: { message?: string } = {}) {
    super(options.message ?? MESSAGE_BY_KIND[kind]);
    this.name = "StudioAuthError";
    this.kind = kind;
  }
}

export function authErrorForStatus(status: number): StudioAuthError {
  if (status === 401) return new StudioAuthError("session_expired");
  if (status === 403) return new StudioAuthError("not_permitted");
  if (status === 429) return new StudioAuthError("unavailable");
  if (status >= 500) return new StudioAuthError("unavailable");
  return new StudioAuthError("protocol");
}
