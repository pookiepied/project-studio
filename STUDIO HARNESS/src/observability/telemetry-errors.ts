import { StudioError } from "../contracts/errors.js";

/**
 * Failures in the telemetry subsystem itself.
 *
 * Nearly all of these are lifecycle mistakes — initializing twice, or reading a
 * handle before it exists. They are still classified rather than left as raw
 * `Error`s, because the point of the taxonomy is that *nothing* reaches the
 * reporter unclassified. A subsystem that exempts itself from its own rule is
 * how the rule stops being true.
 */
export type TelemetryErrorKind =
  /** Initialized, registered, or started more than once. */
  | "already_initialized"
  /** Read before initialization. */
  | "not_initialized"
  /** Exporter or resource configuration is missing or invalid. */
  | "configuration";

const MESSAGE_BY_KIND: Record<TelemetryErrorKind, string> = {
  already_initialized: "Observability has already been initialized.",
  not_initialized: "Observability has not been initialized.",
  configuration: "Observability is not configured correctly.",
};

export class TelemetryError extends StudioError {
  readonly domain = "observability" as const;
  declare readonly kind: TelemetryErrorKind;

  constructor(kind: TelemetryErrorKind, options: { message?: string } = {}) {
    // None of these clear on their own: each needs a code or configuration fix.
    super(kind, options.message ?? MESSAGE_BY_KIND[kind]);
    this.name = "TelemetryError";
  }
}
