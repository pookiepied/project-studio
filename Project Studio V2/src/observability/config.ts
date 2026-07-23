import * as v from "valibot";

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
});

export type ObservabilityConfig = v.InferOutput<typeof observabilityConfigSchema>;
export type ObservabilityExporter = ObservabilityConfig["exporter"];

export interface ObservabilityConfigInput {
  readonly serviceName?: string;
  readonly serviceVersion?: string;
  readonly deploymentEnvironment?: string;
  readonly exporter?: ObservabilityExporter;
  readonly otlpEndpoint?: string;
  readonly captureContent?: boolean;
  readonly memoryDumpPath?: string;
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
    throw new Error(
      "OTLP exporter requires PROJECT_STUDIO_OTEL_ENDPOINT or OTEL_EXPORTER_OTLP_ENDPOINT.",
    );
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
    ...(input.memoryDumpPath || readEnv("PROJECT_STUDIO_OTEL_MEMORY_DUMP_PATH")
      ? {
          memoryDumpPath:
            input.memoryDumpPath ??
            readEnv("PROJECT_STUDIO_OTEL_MEMORY_DUMP_PATH"),
        }
      : {}),
  });
}
