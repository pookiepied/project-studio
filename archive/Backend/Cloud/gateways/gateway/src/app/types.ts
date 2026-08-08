import type { GatewayEnv } from "@/platform/cloudflare/environment";

export type GatewayApp = {
  Bindings: GatewayEnv;
  Variables: {
    requestId: string;
  };
};
