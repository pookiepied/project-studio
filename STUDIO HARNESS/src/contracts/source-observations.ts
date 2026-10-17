/** External source clocks and IDs remain distinct from collector receipt time. */
export interface ObservationSource {
  readonly kind: "client" | "native";
  readonly clientId: string;
  /** Proxy-verified paired record; the admission client remains the host. */
  readonly deviceId?: string;
  readonly eventId: string;
  readonly bootId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly monotonicMs: number;
}

export const CLIENT_OBSERVATION_NAMES = [
  "client.request", "client.submission", "client.stream", "client.delivery",
  "client.projection", "client.display", "client.window",
] as const;
export const CLIENT_ATTRIBUTE_KEYS = [
  "method", "status", "durationMs", "timedOut", "stage", "failure", "characters",
  "settlement", "kind", "replaying", "stopped", "failed", "streaming", "count",
] as const;
