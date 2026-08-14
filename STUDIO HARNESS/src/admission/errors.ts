import { StudioError } from "../contracts/errors.js";

export type AdmissionErrorKind = "configuration" | "internal";

const MESSAGE_BY_KIND: Record<AdmissionErrorKind, string> = {
  configuration: "Harness admission configuration is invalid.",
  internal: "Harness admission could not be initialized.",
};

/** Safe admission failures never include a credential or Authorization value. */
export class AdmissionError extends StudioError {
  readonly domain = "admission" as const;
  declare readonly kind: AdmissionErrorKind;

  constructor(kind: AdmissionErrorKind) {
    super(kind, MESSAGE_BY_KIND[kind]);
    this.name = "AdmissionError";
  }
}
