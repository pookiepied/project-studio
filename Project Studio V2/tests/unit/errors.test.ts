import { describe, expect, it } from "vitest";

import { StudioAuthError } from "../../src/auth/errors.js";
import {
  isStudioError,
  StudioError,
  type StudioErrorDomain,
} from "../../src/contracts/errors.js";
import { ModelResolutionError, ProviderConfigurationError } from "../../src/contracts/models.js";
import { CredentialStoreError } from "../../src/credentials/credential-store.js";
import {
  createErrorReporter,
  toErrorReport,
} from "../../src/observability/error-reporter.js";
import { createLogger } from "../../src/observability/logger.js";
import { StorageError } from "../../src/storage/errors.js";

function captureLogger() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    serviceName: "test",
    serviceVersion: "0",
    deploymentEnvironment: "test",
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  return { logger, lines };
}

describe("the shared error contract", () => {
  it("derives a stable code from domain and kind", () => {
    expect(new StudioAuthError("signed_out").code).toBe("auth.signed_out");
    expect(new CredentialStoreError("unavailable").code).toBe("credentials.unavailable");
    expect(new StorageError("conflict").code).toBe("storage.conflict");
    expect(new ProviderConfigurationError("x").code).toBe("models.configuration");
    expect(new ModelResolutionError("x").code).toBe("models.resolution");
  });

  it("puts every subsystem's failures under one base class", () => {
    const errors: StudioError[] = [
      new StudioAuthError("signed_out"),
      new CredentialStoreError("invalid"),
      new StorageError("not_found"),
      new ProviderConfigurationError("x"),
      new ModelResolutionError("x"),
    ];

    for (const error of errors) {
      expect(isStudioError(error)).toBe(true);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it("keeps each subsystem's own vocabulary intact", () => {
    // The point of a shared base is not a shared kind list. Sign-in does not
    // fail the way a database does.
    expect(new StudioAuthError("session_expired").kind).toBe("session_expired");
    expect(new StorageError("migration").kind).toBe("migration");
  });

  it("marks only conditions that can clear on their own as retryable", () => {
    expect(new StudioAuthError("unavailable").retryable).toBe(true);
    expect(new StudioAuthError("session_expired").retryable).toBe(false);
    expect(new CredentialStoreError("unavailable").retryable).toBe(true);
    expect(new CredentialStoreError("too_large").retryable).toBe(false);
    expect(new StorageError("unavailable").retryable).toBe(true);
    expect(new StorageError("conflict").retryable).toBe(false);
  });

  it("never exposes a stack or a cause in the reported shape", () => {
    const report = new StorageError("internal", {
      cause: new Error("driver said: key=sk-secret-value"),
    }).toReport();

    expect(Object.keys(report).sort()).toEqual([
      "code",
      "domain",
      "kind",
      "message",
      "name",
      "retryable",
    ]);
    expect(JSON.stringify(report)).not.toContain("sk-secret-value");
  });
});

describe("error reporting", () => {
  it("returns the safe projection for a classified failure", () => {
    const { logger } = captureLogger();
    const report = createErrorReporter({ logger }).report(
      new StudioAuthError("signed_out"),
    );

    expect(report.code).toBe("auth.signed_out");
    expect(report.domain).toBe("auth");
  });

  it("puts an unclassified throw in its own domain rather than guessing", () => {
    // This is the measurable gap: `unclassified` in telemetry names the code
    // that has not been onboarded onto the taxonomy.
    expect(toErrorReport(new Error("boom")).domain).toBe("unclassified");
    expect(toErrorReport("boom").domain).toBe("unclassified");
    expect(toErrorReport(undefined).domain).toBe("unclassified");
  });

  it("logs one line carrying the code, domain, and operation", () => {
    const { logger, lines } = captureLogger();
    createErrorReporter({ logger }).report(new StorageError("not_found"), {
      operation: "providers.select",
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "error",
      "error.code": "storage.not_found",
      "error.domain": "storage",
      operation: "providers.select",
    });
  });

  it("redacts caller-supplied fields", () => {
    const { logger, lines } = captureLogger();
    createErrorReporter({ logger }).report(new StorageError("internal"), {
      operation: "providers.connect",
      api_key: "sk-should-never-appear",
    });

    expect(JSON.stringify(lines[0])).not.toContain("sk-should-never-appear");
  });

  it("works with no logger, so paths that run before observability can report", () => {
    // The CLIs report before OpenTelemetry is initialized; reporting must not
    // become the thing that crashes them.
    expect(() => createErrorReporter().report(new StorageError("internal"))).not.toThrow();
  });

  it("stamps child fields onto every report", () => {
    const { logger, lines } = captureLogger();
    createErrorReporter({ logger })
      .child({ subsystem: "providers" })
      .report(new StorageError("internal"));

    expect(lines[0]).toMatchObject({ subsystem: "providers" });
  });
});

describe("the domain taxonomy", () => {
  it("has an entry for every subsystem that raises a classified failure", () => {
    const raised = new Set<StudioErrorDomain>([
      new StudioAuthError("internal").domain,
      new CredentialStoreError("internal").domain,
      new StorageError("internal").domain,
      new ProviderConfigurationError("x").domain,
    ]);

    expect([...raised].sort()).toEqual(["auth", "credentials", "models", "storage"]);
  });
});
