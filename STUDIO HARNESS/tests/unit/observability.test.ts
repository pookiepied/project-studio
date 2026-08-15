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
// Not re-exported from the barrel: the string form is an implementation detail
// of `redactGenAiContent`, and testing it directly is what keeps the pattern
// itself covered.
import {
  activeRedactionRuleIds,
  configureRedaction,
  redactSensitiveString,
  resetRedaction,
} from "../../src/observability/redaction.js";
import { REDACTION_RULES } from "../../src/observability/redaction-rules.js";
import {
  createChildExecutionContext,
  createRootExecutionContext,
  runWithExecutionContext,
} from "../../src/execution/context.js";

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
  it("includes execution-family and parent-operation fields", () => {
    const lines: string[] = [];
    const logger = createLogger({
      serviceName: "project-studio-v2",
      serviceVersion: "0.1.0",
      deploymentEnvironment: "test",
      write: (line) => lines.push(line),
    });
    const root = createRootExecutionContext({ clientId: "client", sessionId: "session" });
    const child = createChildExecutionContext(root, { kind: "tool" });

    runWithExecutionContext(child, () => logger.info("operation"));

    const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(record.request_id).toBe(root.requestId);
    expect(record.operation_id).toBe(child.operationId);
    expect(record.parent_operation_id).toBe(root.operationId);
    expect(record.attempt_id).toBe(child.attemptId);
    expect(record.operation_kind).toBe("tool");
    expect(record.client_id).toBe("client");
  });

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

  it("redacts a segmented key, which is the shape this product will see", () => {
    // The old pattern allowed no hyphen after `sk-`, so it stopped at the first
    // segment and the trailing word boundary then failed. An Anthropic key
    // passed through in full.
    const keys = [
      "sk-ant-api03-AbCdEfGh1234567890abcdefXYZ",
      "sk-proj-AbCdEfGh1234567890",
      "sk-abcdefghijklmnopqrst",
    ];

    for (const key of keys) {
      const redacted = redactSensitiveString(`the key is ${key} ok`);
      expect(redacted, key).not.toContain(key);
      expect(redacted, key).toContain("[REDACTED]");
    }
  });

  it("leaves an ordinary hyphenated word alone", () => {
    // A redactor that eats prose gets switched off.
    const text = "the task-manager and ask-me-anything services are fine";
    expect(redactSensitiveString(text)).toBe(text);
  });

  it("catches the token shapes a Claude product actually meets", () => {
    // Every one of these passed straight through before the catalog existed.
    const secrets = [
      "ghp_AbCdEfGh1234567890AbCdEfGh1234567890",
      "github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz",
      // AIza plus exactly 35 characters, which is the real shape.
      "AIzaSyA1234567890abcdefghijklmnopqrstuv",
      "xoxb-1234567890-abcdefghijklmnop",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl",
    ];

    for (const secret of secrets) {
      const redacted = redactSensitiveString(`value ${secret} end`);
      expect(redacted, secret).not.toContain(secret);
    }
  });

  it("removes a whole private key block, not just its first line", () => {
    const key = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEAxyz123",
      "abc456def789",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");

    const redacted = redactSensitiveString(`config:\n${key}\ndone`);
    expect(redacted).not.toContain("MIIEowIBAAKCAQEAxyz123");
    expect(redacted).not.toContain("abc456def789");
    expect(redacted).toContain("done");
  });

  it("keeps the host but drops credentials in a URL", () => {
    // Which service was reached is most of a log line's value, and it is not
    // the secret.
    const redacted = redactSensitiveString("postgres://admin:hunter2@db.example.com/app");

    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("admin");
    expect(redacted).toContain("db.example.com");
  });

  it("redacts every occurrence on a line, not only the first", () => {
    // A shared global regex keeps `lastIndex` between calls, so a rule can
    // resume mid-string and miss matches unless it is reset.
    const redacted = redactSensitiveString("sk-aaaaaaaaaaaa and sk-bbbbbbbbbbbb");

    expect(redacted).not.toContain("sk-aaaaaaaaaaaa");
    expect(redacted).not.toContain("sk-bbbbbbbbbbbb");
  });

  it("is stable when the same rule runs many times", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(redactSensitiveString("key sk-abcdefghijklmnop here")).toBe(
        "key [REDACTED] here",
      );
    }
  });
});

describe("the redaction catalog", () => {
  afterEach(() => {
    resetRedaction();
  });

  it("ships email redaction off, because a support log needs the user", () => {
    expect(activeRedactionRuleIds()).not.toContain("email");
    expect(redactSensitiveString("from user@example.com")).toContain("user@example.com");
  });

  it("turns a rule on by id without touching code", () => {
    configureRedaction({ email: true });

    expect(activeRedactionRuleIds()).toContain("email");
    expect(redactSensitiveString("from user@example.com")).not.toContain(
      "user@example.com",
    );
  });

  it("turns a rule off by id", () => {
    configureRedaction({ "sk-key": false });

    expect(redactSensitiveString("sk-abcdefghijklmnop")).toContain(
      "sk-abcdefghijklmnop",
    );
  });

  it("ignores an unknown id rather than refusing to start", () => {
    // A stale entry in someone's environment must not stop the harness. The
    // cost is that a rule they wanted off stays on, which fails safely.
    expect(() => configureRedaction({ "no-such-rule": false })).not.toThrow();
    expect(activeRedactionRuleIds()).toContain("sk-key");
  });

  it("every rule is global, or it would replace only the first match", () => {
    for (const rule of REDACTION_RULES) {
      expect(rule.pattern.flags, rule.id).toContain("g");
    }
  });

  it("every rule id is unique, because the id is how one is disabled", () => {
    const ids = REDACTION_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reads rule state from the environment", () => {
    process.env.PROJECT_STUDIO_REDACTION_RULES = "email:on,jwt:off";
    try {
      expect(resolveObservabilityConfig().redactionRules).toEqual({
        email: true,
        jwt: false,
      });
    } finally {
      delete process.env.PROJECT_STUDIO_REDACTION_RULES;
    }
  });

  it("skips a malformed environment entry instead of throwing", () => {
    process.env.PROJECT_STUDIO_REDACTION_RULES = "email,jwt:off,:on,bad:maybe";
    try {
      expect(resolveObservabilityConfig().redactionRules).toEqual({ jwt: false });
    } finally {
      delete process.env.PROJECT_STUDIO_REDACTION_RULES;
    }
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
