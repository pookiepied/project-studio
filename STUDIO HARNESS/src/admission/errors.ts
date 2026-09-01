import { StudioError } from "../contracts/errors.js";

export type AdmissionErrorKind =
  | "configuration"
  | "internal"
  /**
   * The bootstrap frame the Host writes into the child over the pipe is
   * missing, unreadable, or not the three-string shape the entrypoint
   * validates. The harness refuses to start: a harness that starts without
   * admission is a harness listening with no door.
   */
  | "bootstrap_invalid";

const MESSAGE_BY_KIND: Record<AdmissionErrorKind, string> = {
  configuration: "Harness admission configuration is invalid.",
  internal: "Harness admission could not be initialized.",
  bootstrap_invalid: "The Project Studio admission bootstrap frame is invalid.",
};

/** Safe admission failures never include a credential or Authorization value. */
export class AdmissionError extends StudioError {
  readonly domain = "admission" as const;
  declare readonly kind: AdmissionErrorKind;

  constructor(
    kind: AdmissionErrorKind,
    options: { message?: string; cause?: unknown } = {},
  ) {
    super(kind, options.message ?? MESSAGE_BY_KIND[kind], {
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
    });
    this.name = "AdmissionError";
  }
}
