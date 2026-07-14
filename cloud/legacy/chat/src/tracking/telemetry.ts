/**
 * Cloudflare Analytics Engine telemetry.
 *
 * Writes structured data points to the "studio-errors" Analytics Engine dataset.
 * All writes are fire-and-forget — never await in a hot path.
 *
 * If the ANALYTICS binding is absent (dev/preview), all calls are no-ops.
 *
 * Query data in Cloudflare Dashboard:
 *   Workers & Pages → Analytics Engine → Query → select dataset "studio-errors"
 *
 * Or via API:
 *   GET https://api.cloudflare.com/client/v4/accounts/{accountId}/analytics_engine/sql
 *   SELECT blob1 AS event_type, blob2 AS detail, double1 AS timestamp_ms
 *   FROM studio-errors WHERE timestamp > now() - INTERVAL '1' HOUR
 */

import { GatewayEnv } from "../gatewayEnv";

export type TelemetryEventType =
  | "unhandled_error"
  | "tool_failure"
  | "provider_error"
  | "request_timeout"
  | "stream_phase1_failure"
  | "stream_phase2_failure"
  | "rate_limit_hit"
  | "auth_failure";

export interface TelemetryEvent {
  type: TelemetryEventType;
  /** Short human-readable detail (tool name, provider, error class, etc.) */
  detail?: string;
  /** Full error message if available */
  errorMessage?: string;
  /** HTTP status code from provider, if applicable */
  statusCode?: number;
  /** User ID (never log PII — only the anonymous ID) */
  userId?: string;
  /** Provider involved */
  provider?: string;
  /** Model ID */
  model?: string;
}

/**
 * Record a telemetry event. Call this synchronously — do NOT await.
 * The Analytics Engine binding is non-blocking and non-throwing.
 */
export function recordTelemetryEvent(env: GatewayEnv, event: TelemetryEvent): void {
  if (!env.ANALYTICS) return;

  try {
    env.ANALYTICS.writeDataPoint({
      // blobs: string fields (up to 20, max 1 KB each)
      blobs: [
        event.type,                         // blob1: event type
        event.detail ?? "",                 // blob2: short detail
        event.errorMessage?.slice(0, 500) ?? "", // blob3: error message (capped)
        event.userId ?? "anonymous",        // blob4: user id
        event.provider ?? "",               // blob5: provider
        event.model ?? "",                  // blob6: model
      ],
      // doubles: numeric fields (up to 20)
      doubles: [
        Date.now(),                         // double1: timestamp ms
        event.statusCode ?? 0,              // double2: HTTP status code
      ],
      // indexes: for efficient filtering (up to 1, max 32 bytes)
      indexes: [event.type.slice(0, 32)],
    });
  } catch {
    // Never throw from telemetry — it's observability, not business logic
  }
}
