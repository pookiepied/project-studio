import { randomBytes } from "node:crypto";

import { AdmissionError } from "./errors.js";

const CREDENTIAL_BYTES = 32;
const BASE64_URL = /^[A-Za-z0-9_-]+$/;

declare const ADMISSION_CREDENTIAL: unique symbol;

/** Opaque bearer value owned by the process that launched one Harness. */
export type AdmissionCredential = string & {
  readonly [ADMISSION_CREDENTIAL]: "AdmissionCredential";
};

/**
 * Generates the one-launch secret. The value is never persisted or logged by
 * this module.
 */
export function createAdmissionCredential(): AdmissionCredential {
  return randomBytes(CREDENTIAL_BYTES).toString("base64url") as AdmissionCredential;
}

/**
 * Validates an injected bootstrap value without echoing it in a failure. This
 * is for a private parent/child bootstrap channel, not for an HTTP setup route.
 */
export function admissionCredentialFromString(
  value: string,
): AdmissionCredential {
  if (
    value.length < Math.ceil((CREDENTIAL_BYTES * 8) / 6) ||
    value.trim() !== value ||
    !BASE64_URL.test(value)
  ) {
    throw new AdmissionError("configuration");
  }

  return value as AdmissionCredential;
}
