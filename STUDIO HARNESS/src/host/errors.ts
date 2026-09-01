import { StudioError } from "../contracts/errors.js";

/**
 * Failures of the harness's own host lifecycle.
 *
 * The `host/` seam owns the parts of this process the Rust supervisor talks
 * to: the admission bootstrap frame, the readiness handshake, and the unified
 * stop. Everything that can go wrong there is a lifecycle mistake - a half
 * registered twice, a stop asked before the halves were armed - and all of it
 * is classified, because the point of the taxonomy is that nothing reaches
 * the reporter unclassified.
 */
export type HostErrorKind =
  /** A stop half (runtime or drain) was registered more than once. */
  | "already_registered"
  /** A stop was requested before both halves were registered. */
  | "stop_not_armed";

const MESSAGE_BY_KIND: Record<HostErrorKind, string> = {
  already_registered: "The harness stop sequence was registered twice.",
  stop_not_armed:
    "The harness stop was requested before both of its halves were registered.",
};

export class HostError extends StudioError {
  readonly domain = "host" as const;
  declare readonly kind: HostErrorKind;

  constructor(kind: HostErrorKind, options: { message?: string } = {}) {
    // None of these clear on their own: each is a wiring defect to fix.
    super(kind, options.message ?? MESSAGE_BY_KIND[kind]);
    this.name = "HostError";
  }
}
