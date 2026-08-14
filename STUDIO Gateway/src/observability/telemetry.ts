/**
 * Telemetry — canonical location (was `lib/telemetry.ts`).
 * OpenTelemetry placeholder. Workers have no OTEL exporter by default; no-op hook.
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
  startSpan(_name: string, _attrs?: Record<string, unknown>): { end: (attrs?: Record<string, unknown>) => void } {
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
