import {
  context,
  metrics,
  propagation,
  trace,
  type Meter,
  type Tracer,
} from "@opentelemetry/api";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
  type ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ObservabilityConfig } from "./config.js";
import { TelemetryError } from "./telemetry-errors.js";

export interface TelemetrySnapshot {
  readonly spans: readonly ReadableSpan[];
  readonly metrics: readonly ResourceMetrics[];
}

export interface ObservabilitySdk {
  readonly config: ObservabilityConfig;
  readonly tracer: Tracer;
  readonly meter: Meter;
  forceFlush(): Promise<void>;
  getSnapshot(): TelemetrySnapshot;
  shutdown(): Promise<void>;
}

interface FinishedSpanSource {
  getFinishedSpans(): ReadableSpan[];
}

interface FinishedMetricSource {
  getMetrics(): ResourceMetrics[];
}

interface SdkState {
  readonly config: ObservabilityConfig;
  readonly sdk: NodeSDK;
  readonly spanExporter?: FinishedSpanSource;
  readonly metricExporter?: FinishedMetricSource;
  readonly metricReader: PeriodicExportingMetricReader;
  readonly dumpWriter?: MemoryDumpWriter;
  shutdownPromise?: Promise<void>;
}

class MemoryDumpWriter {
  readonly #path: string;
  #spans: ReadableSpan[] = [];
  #metrics: ResourceMetrics[] = [];
  #writeChain: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  recordSpans(spans: readonly ReadableSpan[]): void {
    this.#spans = [...this.#spans, ...spans];
    this.#scheduleWrite();
  }

  recordMetrics(resourceMetrics: ResourceMetrics): void {
    this.#metrics = [...this.#metrics, resourceMetrics];
    this.#scheduleWrite();
  }

  async flush(): Promise<void> {
    await this.#writeChain;
    await this.#write();
  }

  #scheduleWrite(): void {
    this.#writeChain = this.#writeChain
      .then(() => this.#write())
      .catch(() => undefined);
  }

  async #write(): Promise<void> {
    const payload = {
      spans: this.#spans.map((span) => ({
        name: span.name,
        kind: span.kind,
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
        parentSpanId: span.parentSpanContext?.spanId,
        status: span.status,
        attributes: span.attributes,
        events: span.events.map((event) => ({
          name: event.name,
          attributes: event.attributes,
        })),
      })),
      metrics: this.#metrics.map((resourceMetrics) => ({
        scopeMetrics: resourceMetrics.scopeMetrics.map((scopeMetric) => ({
          scope: scopeMetric.scope.name,
          metrics: scopeMetric.metrics.map((metric) => ({
            name: metric.descriptor.name,
            dataPointCount: metric.dataPoints.length,
          })),
        })),
      })),
    };

    await mkdir(dirname(this.#path), { recursive: true });
    await writeFile(this.#path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}

class DumpingSpanExporter implements SpanExporter {
  readonly #inner: InMemorySpanExporter;
  readonly #dump: MemoryDumpWriter | undefined;

  constructor(inner: InMemorySpanExporter, dump: MemoryDumpWriter | undefined) {
    this.#inner = inner;
    this.#dump = dump;
  }

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    this.#inner.export(spans, (result) => {
      if (result.code === ExportResultCode.SUCCESS) {
        this.#dump?.recordSpans(spans);
      }
      resultCallback(result);
    });
  }

  async shutdown(): Promise<void> {
    await this.#inner.shutdown();
  }

  async forceFlush(): Promise<void> {
    await this.#inner.forceFlush();
    await this.#dump?.flush();
  }

  getFinishedSpans(): ReadableSpan[] {
    return this.#inner.getFinishedSpans();
  }
}

class DumpingMetricExporter implements PushMetricExporter {
  readonly #inner: InMemoryMetricExporter;
  readonly #dump: MemoryDumpWriter | undefined;

  constructor(
    inner: InMemoryMetricExporter,
    dump: MemoryDumpWriter | undefined,
  ) {
    this.#inner = inner;
    this.#dump = dump;
  }

  export(
    resourceMetrics: ResourceMetrics,
    resultCallback: (result: ExportResult) => void,
  ): void {
    this.#inner.export(resourceMetrics, (result) => {
      if (result.code === ExportResultCode.SUCCESS) {
        this.#dump?.recordMetrics(resourceMetrics);
      }
      resultCallback(result);
    });
  }

  async forceFlush(): Promise<void> {
    await this.#inner.forceFlush();
    await this.#dump?.flush();
  }

  async shutdown(): Promise<void> {
    await this.#inner.shutdown();
  }

  selectAggregationTemporality(
    instrumentType: Parameters<InMemoryMetricExporter["selectAggregationTemporality"]>[0],
  ) {
    return this.#inner.selectAggregationTemporality(instrumentType);
  }

  getMetrics(): ResourceMetrics[] {
    return this.#inner.getMetrics();
  }
}

let state: SdkState | undefined;
let shutdownHooksInstalled = false;

function createResource(config: ObservabilityConfig) {
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: config.serviceVersion,
    "deployment.environment": config.deploymentEnvironment,
  });
}

function installShutdownHooks(): void {
  if (shutdownHooksInstalled) {
    return;
  }

  shutdownHooksInstalled = true;
  const shutdownAndExit = (signal: NodeJS.Signals): void => {
    void shutdownObservabilitySdk()
      .catch(() => undefined)
      .finally(() => {
        process.exit(signal === "SIGINT" ? 130 : 143);
      });
  };

  process.once("SIGINT", () => shutdownAndExit("SIGINT"));
  process.once("SIGTERM", () => shutdownAndExit("SIGTERM"));
  process.once("beforeExit", () => {
    void shutdownObservabilitySdk().catch(() => undefined);
  });
}

export function isObservabilitySdkStarted(): boolean {
  return state !== undefined;
}

export function startObservabilitySdk(config: ObservabilityConfig): ObservabilitySdk {
  if (state) {
    throw new TelemetryError("already_initialized", {
      message: "Observability SDK has already been initialized.",
    });
  }

  const resource = createResource(config);
  let retainedSpanExporter: FinishedSpanSource | undefined;
  let retainedMetricExporter: FinishedMetricSource | undefined;
  let dumpWriter: MemoryDumpWriter | undefined;
  let spanExporter: SpanExporter;
  let pushMetricExporter: PushMetricExporter;
  let exportIntervalMillis = 60_000;

  if (config.exporter === "memory") {
    const innerSpans = new InMemorySpanExporter();
    const innerMetrics = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    dumpWriter = config.memoryDumpPath
      ? new MemoryDumpWriter(config.memoryDumpPath)
      : undefined;
    const dumpingSpans = new DumpingSpanExporter(innerSpans, dumpWriter);
    const dumpingMetrics = new DumpingMetricExporter(innerMetrics, dumpWriter);
    retainedSpanExporter = dumpingSpans;
    retainedMetricExporter = dumpingMetrics;
    spanExporter = dumpingSpans;
    pushMetricExporter = dumpingMetrics;
    // Short interval so metrics land in the dump without relying on process signals.
    exportIntervalMillis = 500;
  } else if (config.exporter === "otlp") {
    const baseUrl = config.otlpEndpoint?.replace(/\/$/, "") ?? "";
    spanExporter = new OTLPTraceExporter({
      url: `${baseUrl}/v1/traces`,
    });
    pushMetricExporter = new OTLPMetricExporter({
      url: `${baseUrl}/v1/metrics`,
    });
  } else {
    // Keep providers registered without network export. Finished data is discarded.
    spanExporter = new InMemorySpanExporter();
    pushMetricExporter = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
  }

  const spanProcessor: SpanProcessor = new SimpleSpanProcessor(spanExporter);
  const metricReader = new PeriodicExportingMetricReader({
    exporter: pushMetricExporter,
    exportIntervalMillis,
  });

  const sdk = new NodeSDK({
    resource,
    spanProcessors: [spanProcessor],
    metricReaders: [metricReader],
    instrumentations: [],
    autoDetectResources: false,
  });

  sdk.start();
  installShutdownHooks();

  state = {
    config,
    sdk,
    metricReader,
    ...(retainedSpanExporter ? { spanExporter: retainedSpanExporter } : {}),
    ...(retainedMetricExporter
      ? { metricExporter: retainedMetricExporter }
      : {}),
    ...(dumpWriter ? { dumpWriter } : {}),
  };

  return getObservabilitySdk();
}

function getObservabilitySdk(): ObservabilitySdk {
  const active = state;
  if (!active) {
    throw new TelemetryError("not_initialized", {
      message: "Observability SDK has not been initialized.",
    });
  }

  return {
    config: active.config,
    tracer: trace.getTracer(active.config.serviceName, active.config.serviceVersion),
    meter: metrics.getMeter(active.config.serviceName, active.config.serviceVersion),
    async forceFlush(): Promise<void> {
      await active.metricReader.forceFlush();
      await active.dumpWriter?.flush();
    },
    getSnapshot(): TelemetrySnapshot {
      return {
        spans: active.spanExporter?.getFinishedSpans() ?? [],
        metrics: active.metricExporter?.getMetrics() ?? [],
      };
    },
    shutdown(): Promise<void> {
      return shutdownObservabilitySdk();
    },
  };
}

export async function shutdownObservabilitySdk(): Promise<void> {
  const active = state;
  if (!active) {
    return;
  }

  if (active.shutdownPromise) {
    return active.shutdownPromise;
  }

  active.shutdownPromise = (async () => {
    const withTimeout = async <T>(
      operation: Promise<T>,
      milliseconds: number,
    ): Promise<T | undefined> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          operation,
          new Promise<undefined>((resolve) => {
            timer = setTimeout(() => resolve(undefined), milliseconds);
            timer.unref?.();
          }),
        ]);
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    };

    try {
      await withTimeout(active.metricReader.forceFlush(), 1_000);
      await withTimeout(active.dumpWriter?.flush() ?? Promise.resolve(), 1_000);
      await withTimeout(active.sdk.shutdown(), 2_000);
    } finally {
      // Allow a later initialize() in the same process (tests) to register again.
      trace.disable();
      metrics.disable();
      context.disable();
      propagation.disable();
      state = undefined;
    }
  })();

  return active.shutdownPromise;
}
