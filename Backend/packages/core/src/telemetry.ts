/**
 * App workers emit structured lines; the telemetry worker picks them up through
 * its `tail()` handler. Nothing here talks to the network, so adopting the
 * umbrella costs an app worker no extra binding — just `tail_consumers`.
 */
export interface TelemetryEvent {
  evt: string;
  [field: string]: unknown;
}

export interface Tracker {
  (event: string, fields?: Record<string, unknown>): void;
}

export function createTracker(base: Record<string, unknown>): Tracker {
  return (event, fields = {}) => {
    const line: TelemetryEvent = { evt: event, ...base, ...fields };
    console.log(JSON.stringify(line));
  };
}
