export interface GatewayEnv {
  ENVIRONMENT?: string;
  CF_ACCOUNT_ID: string;
  CF_AIG_GATEWAY_NAME?: string;
  CF_AIG_BYOK_ALIAS?: string;
  CF_AIG_TOKEN: string;
  CREDITS_KV?: KVNamespace;
  ADMIN_KV?: KVNamespace;
}
