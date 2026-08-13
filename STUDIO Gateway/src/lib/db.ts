/**
 * D1 database client - centralized, typed helpers.
 * No ORM; raw D1 with small wrapper to keep bundle minimal for Workers.
 */

export type D1 = D1Database;

export async function getProvider(db: D1, id: string): Promise<ProviderRow | null> {
  const row = await db.prepare("SELECT * FROM providers WHERE id = ?").bind(id).first<ProviderRow>();
  return row ?? null;
}

export async function listProviders(db: D1): Promise<ProviderRow[]> {
  const res = await db.prepare("SELECT * FROM providers ORDER BY id ASC").all<ProviderRow>();
  return res.results ?? [];
}

export async function listEnabledProviders(db: D1): Promise<ProviderRow[]> {
  const res = await db.prepare("SELECT * FROM providers WHERE enabled = 1 ORDER BY id ASC").all<ProviderRow>();
  return res.results ?? [];
}

export async function getCredential(db: D1, providerId: string): Promise<CredentialRow | null> {
  const row = await db
    .prepare("SELECT * FROM provider_credentials WHERE provider_id = ?")
    .bind(providerId)
    .first<CredentialRow>();
  return row ?? null;
}

export async function getModel(db: D1, providerId: string, modelId: string): Promise<ModelRow | null> {
  const row = await db
    .prepare("SELECT * FROM models WHERE provider_id = ? AND model_id = ?")
    .bind(providerId, modelId)
    .first<ModelRow>();
  return row ?? null;
}

export async function findExposedModel(db: D1, modelId: string): Promise<ModelRow | null> {
  // Unified gateway lookup: model_id unique across providers when exposed
  // If model_id duplicates across providers, prefer first enabled provider's model.
  const row = await db
    .prepare(
      "SELECT models.* FROM models JOIN providers ON providers.id = models.provider_id " +
        "WHERE models.model_id = ? AND models.exposed = 1 AND models.enabled = 1 AND providers.enabled = 1 LIMIT 1",
    )
    .bind(modelId)
    .first<ModelRow>();
  return row ?? null;
}

export async function listExposedModels(db: D1): Promise<ModelRow[]> {
  const res = await db
    .prepare(
      "SELECT models.* FROM models JOIN providers ON providers.id = models.provider_id " +
        "WHERE models.exposed = 1 AND models.enabled = 1 AND providers.enabled = 1 " +
        "ORDER BY provider_id ASC, model_id ASC",
    )
    .all<ModelRow>();
  return res.results ?? [];
}

export async function listModelsForProvider(db: D1, providerId: string): Promise<ModelRow[]> {
  const res = await db
    .prepare("SELECT * FROM models WHERE provider_id = ? ORDER BY model_id ASC")
    .bind(providerId)
    .all<ModelRow>();
  return res.results ?? [];
}

export async function verifyGatewayKey(db: D1, hash: string): Promise<GatewayKeyRow | null> {
  const row = await db
    .prepare("SELECT * FROM gateway_keys WHERE key_hash = ? AND enabled = 1")
    .bind(hash)
    .first<GatewayKeyRow>();
  return row ?? null;
}

// Row types mirror migrations/001_init.sql

export interface ProviderRow {
  id: string;
  name: string;
  base_url: string;
  protocol: string;
  auth_mode: string;
  enabled: number;
  created_at: number;
  updated_at: number;
}

export interface CredentialRow {
  provider_id: string;
  encrypted_key: string;
  key_hint: string | null;
  created_at: number;
  updated_at: number;
}

export interface ModelRow {
  provider_id: string;
  model_id: string;
  display_name: string | null;
  category: string; // text, image, embedding, audio, video, rerank, speech, transcription
  input_modalities: string; // JSON array: ["text","image"]
  output_modalities: string; // JSON array: ["text"]
  context_window: number | null;
  max_output_tokens: number | null;
  pricing_input: number | null; // per 1M tokens USD
  pricing_output: number | null;
  pricing_cache_read: number | null;
  pricing_cache_write: number | null;
  supports_tools: number; // 0/1
  supports_parallel_tools: number;
  supports_vision: number;
  supports_reasoning: number;
  reasoning_type: string | null; // none, dynamic, selected
  reasoning_levels: string | null; // JSON array
  enabled: number; // discovered but not yet exposed = 0? or admin disabled
  exposed: number; // 1 = visible via /v1/models and usable via gateway
  raw_json: string | null;
  fetched_at: number | null;
  updated_at: number;
}

export interface GatewayKeyRow {
  id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes: string | null;
  rate_limit_rpm: number;
  enabled: number;
  created_at: number;
  last_used_at: number | null;
}
