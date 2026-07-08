import type { GatewayEnv } from "../../system/infrastructure/cloudflare/env";
import { refreshCatalog } from "./catalog";

export const DISCOVERY_CRON = "0 */6 * * *";

export async function scheduledDiscovery(env: GatewayEnv): Promise<void> {
  await refreshCatalog(env);
}
