import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { AdmissionError } from "../../src/admission/errors.js";
import {
  admissionCredentialFromString,
  createAdmissionCredential,
} from "../../src/admission/credential.js";
import {
  ADMISSION_SCOPES,
  hasAdmissionScope,
} from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";

describe("Harness admission verifier", () => {
  it("generates a fresh credential with at least 256 bits", () => {
    const first = createAdmissionCredential();
    const second = createAdmissionCredential();

    expect(Buffer.byteLength(first, "utf8")).toBeGreaterThanOrEqual(32);
    expect(first).not.toBe(second);
  });

  it("admits the exact bearer form and returns only AuthContext", () => {
    const session = createAdmissionSession({
      clientId: "desktop",
      clientType: "studio-client",
      sessionId: "session-1",
      scopes: [ADMISSION_SCOPES.AGENT_RUN],
    });

    expect(session.verifier.verify(`Bearer ${session.credential}`)).toEqual({
      ok: true,
      context: {
        clientId: "desktop",
        clientType: "studio-client",
        sessionId: "session-1",
        scopes: [ADMISSION_SCOPES.AGENT_RUN],
      },
    });
    expect(JSON.stringify(session.verifier.verify("Bearer wrong-token"))).not.toContain(
      session.credential,
    );
    expect(hasAdmissionScope(session.context, ADMISSION_SCOPES.AGENT_RUN)).toBe(true);
    expect(hasAdmissionScope(session.context, ADMISSION_SCOPES.APPROVAL)).toBe(false);
  });

  it.each([
    [undefined, "missing"],
    ["Basic credentials", "malformed"],
    ["Bearer", "malformed"],
    ["Bearer wrong-token", "invalid"],
  ] as const)("rejects %s without exposing the presented value", (authorization, reason) => {
    const session = createAdmissionSession();
    const result = session.verifier.verify(authorization);

    expect(result).toEqual({ ok: false, reason });
    if (authorization !== undefined) {
      expect(JSON.stringify(result)).not.toContain(authorization);
    }
  });

  it("invalidates the credential when the process session ends", () => {
    const session = createAdmissionSession();
    const authorization = `Bearer ${session.credential}`;

    expect(session.verifier.verify(authorization).ok).toBe(true);
    session.verifier.invalidate();
    expect(session.verifier.verify(authorization)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects short or malformed injected credentials without echoing them", () => {
    const secret = "short-secret-that-must-not-appear";

    expect(() => admissionCredentialFromString(secret)).toThrow(AdmissionError);
    try {
      admissionCredentialFromString(secret);
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });
});
