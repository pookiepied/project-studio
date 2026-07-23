import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import { afterEach, describe, expect, it } from "vitest";

import {
  createLogger,
  initializeObservability,
  normalizeError,
  redactGenAiContent,
  resolveObservabilityConfig,
  safeSerializeError,
  safeSerializeValue,
  shutdownObservability,
} from "../../src/observability/index.js";

afterEach(async () => {
  await shutdownObservability();
});

describe("observability configuration", () => {
  it("defaults to no network exporter and disabled content capture", () => {
    const config = resolveObservabilityConfig({
      deploymentEnvironment: "test",
    });

    expect(config.exporter).toBe("none");
    expect(config.captureContent).toBe(false);
    expect(config.serviceName).toBe("project-studio-v2");
    expect(config.serviceVersion).toBe("0.1.0");
    expect(config.deploymentEnvironment).toBe("test");
  });

  it("selects OTLP only when an endpoint is configured", () => {
    const config = resolveObservabilityConfig({
      otlpEndpoint: "http://127.0.0.1:4318",
    });

    expect(config.exporter).toBe("otlp");
    expect(config.otlpEndpoint).toBe("http://127.0.0.1:4318");
  });

  it("rejects OTLP without an endpoint", () => {
    expect(() =>
      resolveObservabilityConfig({
        exporter: "otlp",
      }),
    ).toThrow(/OTLP exporter requires/);
  });
});

describe("observability initialization", () => {
  it("cannot initialize twice", () => {
    initializeObservability({
      exporter: "memory",
      deploymentEnvironment: "test",
    });

    expect(() =>
      initializeObservability({
        exporter: "memory",
        deploymentEnvironment: "test",
      }),
    ).toThrow(/already been initialized/);
  });

  it("records resource attributes on exported spans", async () => {
    const handle = initializeObservability({
      exporter: "memory",
      deploymentEnvironment: "test",
      serviceName: "project-studio-v2",
      serviceVersion: "0.1.0",
    });

    const span = handle.sdk.tracer.startSpan("manual-check");
    span.end();
    await handle.forceFlush();

    const finished = handle.getSnapshot().spans;
    expect(finished.length).toBeGreaterThan(0);
    const resource = finished[0]?.resource.attributes;
    expect(resource?.["service.name"]).toBe("project-studio-v2");
    expect(resource?.["service.version"]).toBe("0.1.0");
    expect(resource?.["deployment.environment"]).toBe("test");
  });
});

describe("structured logger", () => {
  it("includes trace correlation fields when a span is active", () => {
    const handle = initializeObservability({
      exporter: "memory",
      deploymentEnvironment: "test",
    });

    const lines: string[] = [];
    const logger = createLogger({
      serviceName: handle.config.serviceName,
      serviceVersion: handle.config.serviceVersion,
      deploymentEnvironment: handle.config.deploymentEnvironment,
      write: (line) => {
        lines.push(line);
      },
    });

    const span = handle.sdk.tracer.startSpan("log-correlation");
    context.with(trace.setSpan(context.active(), span), () => {
      logger.info("correlated");
    });
    span.end();

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(record.message).toBe("correlated");
    expect(typeof record.trace_id).toBe("string");
    expect(typeof record.span_id).toBe("string");
    expect(record["service.name"]).toBe("project-studio-v2");
  });

  it("keeps canonical fields authoritative and serializes bigint values", () => {
    const lines: string[] = [];
    const logger = createLogger({
      serviceName: "project-studio-v2",
      serviceVersion: "0.1.0",
      deploymentEnvironment: "test",
      write: (line) => {
        lines.push(line);
      },
    });

    logger.info("real message", {
      level: "forged",
      message: "forged",
      total: 42n,
      detail: "token=super-secret",
    });

    const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(record.level).toBe("info");
    expect(record.message).toBe("real message");
    expect(record.total).toBe("42");
    expect(record.detail).toBe("token=[REDACTED]");
  });
});

describe("error normalization", () => {
  it("omits stacks and sensitive values by default", () => {
    const error = new Error("failed api_key=super-secret");
    error.stack = "Error: failed\n    at secret.ts:1:1";

    const normalized = normalizeError(error);
    const serialized = safeSerializeError(error);
    const value = safeSerializeValue({
      password: "hunter2",
      stack: error.stack,
      ok: true,
    });

    expect(normalized.message).toContain("[REDACTED]");
    expect(serialized).not.toHaveProperty("stack");
    expect(value).toEqual({
      password: "[REDACTED]",
      stack: "[REDACTED]",
      ok: true,
    });
  });
});

describe("content redaction", () => {
  it("redacts credential-like values", () => {
    const redacted = redactGenAiContent({
      text: "Authorization: Bearer abcdef123456 token=xyz",
      apiKey: "plain-value-without-a-prefix",
      nested: [{ content: "api_key: sk-abcdefghijklmnopqrst" }],
    });

    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("abcdef123456");
    expect(serialized).not.toContain("sk-abcdefghijklmnopqrst");
    expect(serialized).not.toContain("token=xyz");
    expect(serialized).not.toContain("plain-value-without-a-prefix");
    expect(serialized).toContain("[REDACTED]");
  });
});

describe("manual span status helper", () => {
  it("can represent cancellation as an error status", async () => {
    const handle = initializeObservability({
      exporter: "memory",
      deploymentEnvironment: "test",
    });

    const span = handle.sdk.tracer.startSpan("cancelled-work");
    span.setStatus({ code: SpanStatusCode.ERROR, message: "aborted" });
    span.setAttribute("error.type", "aborted");
    span.end();

    const finished = handle.getSnapshot().spans;
    expect(finished[0]?.status.code).toBe(SpanStatusCode.ERROR);
  });
});
