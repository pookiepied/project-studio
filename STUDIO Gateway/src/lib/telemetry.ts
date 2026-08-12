/**
 * Telemetry - OpenTelemetry placeholder.
 * Workers have no OTEL exporter by default; this is a no-op hook
 * imported centrally so later instrumentation is one file change.
 */

export interface SpanContext {
  traceId: string;
  spanId: string;
}

export interface TelemetryEvent {
  name: string;
  attributes?: Record<string, string | number | boolean>;
  timestamp?: number;
}

function noop(): void {}

export const telemetry = {
  startSpan(name: string, _attrs?: Record<string, unknown>): { end: (attrs?: Record<string, unknown>) => void } {
    // In Workers, use console + future OTEL binding.
    // Kept as function so routes do `const span = telemetry.startSpan("chat")`
    return {
      end: noop,
    };
  },

  recordEvent(_event: TelemetryEvent): void {
    noop();
  },

  incrementCounter(_name: string, _value = 1, _attrs?: Record<string, string>): void {
    noop();
  },

  histogram(_name: string, _value: number, _attrs?: Record<string, string>): void {
    noop();
  },
};
