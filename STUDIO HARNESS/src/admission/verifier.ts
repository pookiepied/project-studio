import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import type { AuthContext, ClientType } from "./context.js";
import {
  admissionCredentialFromString,
  createAdmissionCredential,
  type AdmissionCredential,
} from "./credential.js";
import { AdmissionError } from "./errors.js";
import { ALL_ADMISSION_SCOPES, type AdmissionScope } from "./scopes.js";

export interface AdmissionSessionOptions {
  readonly credential?: AdmissionCredential;
  readonly clientId?: string;
  readonly clientType?: ClientType;
  readonly sessionId?: string;
  readonly scopes?: readonly AdmissionScope[];
}

export interface AdmissionSession {
  readonly credential: AdmissionCredential;
  readonly context: AuthContext;
  readonly verifier: AdmissionVerifier;
}

export type AdmissionFailureReason = "missing" | "malformed" | "invalid" | "expired";

export type AdmissionVerification =
  | { readonly ok: true; readonly context: AuthContext }
  | { readonly ok: false; readonly reason: AdmissionFailureReason };

export interface AdmissionVerifier {
  verify(authorization: string | undefined): AdmissionVerification;
  /** Invalidates every future request for this process launch. */
  invalidate(): void;
}

export interface AdmissionVerifierOptions {
  readonly credential: AdmissionCredential;
  readonly context: AuthContext;
}

function validIdentity(value: string | undefined, fallback: string): string {
  const identity = value ?? fallback;
  if (identity.trim() === "") {
    throw new AdmissionError("configuration");
  }
  return identity;
}

function constantTimeCredentialEqual(expected: string, presented: string): boolean {
  // Hashing both values gives timingSafeEqual fixed-size inputs even when a
  // malformed caller presents a token with a different length.
  const expectedHash = createHash("sha256").update(expected).digest();
  const presentedHash = createHash("sha256").update(presented).digest();
  return timingSafeEqual(expectedHash, presentedHash);
}

function presentedCredential(authorization: string | undefined): string | undefined {
  if (authorization === undefined) return undefined;
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  return match?.[1];
}

function immutableContext(context: AuthContext): AuthContext {
  return Object.freeze({
    clientId: context.clientId,
    clientType: context.clientType,
    sessionId: context.sessionId,
    scopes: Object.freeze([...context.scopes]),
  });
}

export function createAdmissionVerifier(
  options: AdmissionVerifierOptions,
): AdmissionVerifier {
  const context = immutableContext(options.context);
  let active = true;
  let expected = options.credential;

  return {
    verify(authorization: string | undefined): AdmissionVerification {
      if (!active) return { ok: false, reason: "expired" };

      const presented = presentedCredential(authorization);
      if (presented === undefined) {
        return {
          ok: false,
          reason: authorization === undefined ? "missing" : "malformed",
        };
      }

      return constantTimeCredentialEqual(expected, presented)
        ? { ok: true, context }
        : { ok: false, reason: "invalid" };
    },

    invalidate(): void {
      active = false;
      expected = "" as AdmissionCredential;
    },
  };
}

export function createAdmissionSession(
  options: AdmissionSessionOptions = {},
): AdmissionSession {
  const clientId = validIdentity(options.clientId, "studio");
  const sessionId = validIdentity(options.sessionId, randomUUID());
  const scopes = options.scopes ?? ALL_ADMISSION_SCOPES;
  const credential = options.credential ?? createAdmissionCredential();
  const context = immutableContext({
    clientId,
    clientType: options.clientType ?? "standalone",
    sessionId,
    scopes,
  });

  return {
    credential,
    context,
    verifier: createAdmissionVerifier({ credential, context }),
  };
}

/** Reads a private bootstrap value without making it part of application state. */
export function admissionCredentialFromEnvironment(
  value: string | undefined,
): AdmissionCredential | undefined {
  return value === undefined ? undefined : admissionCredentialFromString(value);
}
