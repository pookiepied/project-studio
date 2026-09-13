import * as v from "valibot";
import { TelemetryError } from "./telemetry-errors.js";

const booleanFromEnv = v.pipe(
  v.string(),
  v.transform((value) => value.trim().toLowerCase()),
  v.union([
    v.literal("1"),
    v.literal("0"),
    v.literal("true"),
    v.literal("false"),
    v.literal("yes"),
    v.literal("no"),
  ]),
  v.transform((value) => value === "1" || value === "true" || value === "yes"),
);

const exporterSchema = v.union([
  v.literal("none"),
  v.literal("memory"),
  v.literal("otlp"),
]);

const observabilityConfigSchema = v.object({
  serviceName: v.pipe(v.string(), v.minLength(1)),
  serviceVersion: v.pipe(v.string(), v.minLength(1)),
  deploymentEnvironment: v.pipe(v.string(), v.minLength(1)),
  exporter: exporterSchema,
  otlpEndpoint: v.optional(v.pipe(v.string(), v.url())),
  captureContent: v.boolean(),
  memoryDumpPath: v.optional(v.pipe(v.string(), v.minLength(1))),
  /**
   * Redaction rules turned on or off by id. Anything absent keeps the default
   * declared in `redaction-rules.ts`.
   *
   * There is no "redaction off" setting, and there will not be one. A log line
   * that left the machine cannot be recalled.
   */
  redactionRules: v.record(v.string(), v.boolean()),
});

export type ObservabilityConfig = v.InferOutput<typeof observabilityConfigSchema>;
type ObservabilityExporter = ObservabilityConfig["exporter"];

export interface ObservabilityConfigInput {
  readonly serviceName?: string;
  readonly serviceVersion?: string;
  readonly deploymentEnvironment?: string;
  readonly exporter?: ObservabilityExporter;
  readonly otlpEndpoint?: string;
  readonly captureContent?: boolean;
  readonly memoryDumpPath?: string;
  readonly redactionRules?: Readonly<Record<string, boolean>>;
}

/**
 * Reads `PROJECT_STUDIO_REDACTION_RULES`, written as `email:on,jwt:off`.
 *
 * `on`/`off`, `true`/`false`, and `1`/`0` all work. A malformed entry is
 * skipped rather than thrown on, because a typo in an environment variable
 * must not stop the harness from starting — and skipping leaves the rule at its
 * default, which for every secret-shaped rule means on.
 */
function parseRedactionRules(): Record<string, boolean> {
  const raw = readEnv("PROJECT_STUDIO_REDACTION_RULES");
  if (raw === undefined) return {};

  const rules: Record<string, boolean> = {};
  for (const entry of raw.split(",")) {
    const [id, state] = entry.split(":").map((part) => part.trim().toLowerCase());
    if (!id || !state) continue;

    if (state === "on" || state === "true" || state === "1") rules[id] = true;
    else if (state === "off" || state === "false" || state === "0") rules[id] = false;
  }
  return rules;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function parseBoolean(name: string, fallback: boolean): boolean {
  const raw = readEnv(name);
  if (raw === undefined) {
    return fallback;
  }

  return v.parse(booleanFromEnv, raw);
}

export function resolveObservabilityConfig(
  input: ObservabilityConfigInput = {},
): ObservabilityConfig {
  const otlpEndpoint =
    input.otlpEndpoint ??
    readEnv("PROJECT_STUDIO_OTEL_ENDPOINT") ??
    readEnv("OTEL_EXPORTER_OTLP_ENDPOINT");

  const explicitExporter =
    input.exporter ??
    (readEnv("PROJECT_STUDIO_OTEL_EXPORTER") as ObservabilityExporter | undefined);

  let exporter: ObservabilityExporter;
  if (explicitExporter) {
    exporter = v.parse(exporterSchema, explicitExporter);
  } else if (otlpEndpoint) {
    exporter = "otlp";
  } else {
    exporter = "none";
  }

  if (exporter === "otlp" && !otlpEndpoint) {
    throw new TelemetryError("configuration", {
      message:
        "OTLP exporter requires PROJECT_STUDIO_OTEL_ENDPOINT or OTEL_EXPORTER_OTLP_ENDPOINT.",
    });
  }

  return v.parse(observabilityConfigSchema, {
    serviceName:
      input.serviceName ??
      readEnv("PROJECT_STUDIO_SERVICE_NAME") ??
      "project-studio-v2",
    serviceVersion:
      input.serviceVersion ??
      readEnv("PROJECT_STUDIO_SERVICE_VERSION") ??
      "0.1.0",
    deploymentEnvironment:
      input.deploymentEnvironment ??
      readEnv("PROJECT_STUDIO_DEPLOYMENT_ENVIRONMENT") ??
      readEnv("NODE_ENV") ??
      "development",
    exporter,
    ...(otlpEndpoint ? { otlpEndpoint } : {}),
    captureContent:
      input.captureContent ??
      parseBoolean(
        "PROJECT_STUDIO_OTEL_CAPTURE_CONTENT",
        parseBoolean("OTEL_GENAI_CAPTURE_CONTENT", false),
      ),
    redactionRules: { ...parseRedactionRules(), ...(input.redactionRules ?? {}) },
    ...(input.memoryDumpPath || readEnv("PROJECT_STUDIO_OTEL_MEMORY_DUMP_PATH")
      ? {
          memoryDumpPath:
            input.memoryDumpPath ??
            readEnv("PROJECT_STUDIO_OTEL_MEMORY_DUMP_PATH"),
        }
      : {}),
  });
}
