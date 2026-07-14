// Single source of truth: re-export from chat so both workers share the
// exact same structural type. No duplication; wrangler bundles the import.
// @cloudflare/workers-types is provided by each worker's tsconfig "types" array.
export type { GatewayEnv } from "../../../legacy/chat/src/gatewayEnv";

import type { GatewayEnv } from "../../../legacy/chat/src/gatewayEnv";

/** Gateway-worker-specific env — extends shared GatewayEnv with its own DOs. */
export interface GatewayWorkerEnv extends GatewayEnv {
  RATE_TRACKER_DO?: DurableObjectNamespace;
}
