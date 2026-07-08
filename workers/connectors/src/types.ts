/// <reference types="@cloudflare/workers-types" />

export interface Env {
  CONNECTORS_DB: D1Database;
  ENVIRONMENT?: string;

  COMPOSIO_API_KEY?: string;
  COMPOSIO_API_BASE?: string;
  COMPOSIO_AUTH_CONFIGS_JSON?: string;
  CONNECTORS_TOOL_CACHE_TTL_SECONDS?: string;
  CONNECTORS_ENCRYPTION_KEY?: string;
}

export type ConnectionStatus = "initiated" | "active" | "expired" | "revoked" | "failed";

export interface ConnectorConnectionRow {
  id: string;
  user_id: string;
  provider_key: string;
  app_key: string;
  display_name: string;
  entity_id: string;
  external_account_id: string | null;
  status: ConnectionStatus;
  scopes_json: string;
  metadata_json: string;
  encrypted_credentials: string | null;
  credentials_nonce: string | null;
  tools_json: string;
  tools_fetched_at: number | null;
  auth_expires_at: string | null;
  last_status_checked_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface ConnectorPermissionRow {
  id: string;
  user_id: string;
  provider_key: string;
  app_key: string;
  enabled: number;
  metadata_json: string;
  created_at: number;
  updated_at: number;
}

export interface ComposioAction {
  name: string;
  slug: string;
  description?: string;
  appName?: string;
  toolkit?: { slug?: string; name?: string; logo?: string };
  input_parameters?: Record<string, unknown>;
  inputParameters?: Record<string, unknown>;
  output_parameters?: Record<string, unknown>;
  version?: string;
}

export interface UpsertConnectionBody {
  provider_key?: string;
  app_key?: string;
  display_name?: string;
  entity_id?: string;
  external_account_id?: string;
  status?: ConnectionStatus;
  scopes?: string[];
  metadata?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  sync_tools?: boolean;
}

export interface UpdatePermissionBody {
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ComposioAppConfig {
  appKey: string;
  toolkitSlug: string;
  name: string;
  description: string;
  categories: string[];
  curatedCategory: string;
  authConfigId?: string;
  logo?: string;
}

export interface ComposioConnectBody {
  appKey?: string;
  callbackUrl?: string;
  alias?: string;
}
