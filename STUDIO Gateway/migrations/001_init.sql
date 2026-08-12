-- Studio Gateway D1 initial schema
-- All timestamps are INTEGER unix ms
-- Encrypted credentials: base64(iv+ciphertext+tag) via AES-GCM

CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  protocol TEXT NOT NULL CHECK(protocol IN ('openai-completions','openai-responses','anthropic-messages','google-generative-ai')),
  auth_mode TEXT NOT NULL CHECK(auth_mode IN ('apiKey','vertex-adc')),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE provider_credentials (
  provider_id TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  encrypted_key TEXT NOT NULL,
  key_hint TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Models: discovery populates all, admin toggles exposed for gateway visibility
-- Comprehensive tagging: categories, modalities, pricing, reasoning, tool flags
CREATE TABLE models (
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  display_name TEXT,
  category TEXT NOT NULL DEFAULT 'text' CHECK(category IN ('text','image','embedding','audio','speech','transcription','video','rerank')),
  input_modalities TEXT NOT NULL DEFAULT '["text"]',
  output_modalities TEXT NOT NULL DEFAULT '["text"]',
  context_window INTEGER,
  max_output_tokens INTEGER,
  pricing_input REAL,
  pricing_output REAL,
  pricing_cache_read REAL,
  pricing_cache_write REAL,
  supports_tools INTEGER NOT NULL DEFAULT 0,
  supports_parallel_tools INTEGER NOT NULL DEFAULT 0,
  supports_vision INTEGER NOT NULL DEFAULT 0,
  supports_reasoning INTEGER NOT NULL DEFAULT 0,
  reasoning_type TEXT CHECK(reasoning_type IN ('none','dynamic','selected')),
  reasoning_levels TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  exposed INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT,
  fetched_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider_id, model_id)
);
CREATE INDEX idx_models_exposed ON models(exposed);
CREATE INDEX idx_models_provider ON models(provider_id);
CREATE INDEX idx_models_category ON models(category);

-- Gateway keys: unified URL consumers use (sk-gw_...)
CREATE TABLE gateway_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  scopes TEXT,
  rate_limit_rpm INTEGER NOT NULL DEFAULT 60,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

-- Rate limit sliding window
CREATE TABLE gateway_key_usage (
  key_id TEXT NOT NULL REFERENCES gateway_keys(id) ON DELETE CASCADE,
  timestamp INTEGER NOT NULL
);
CREATE INDEX idx_usage_key_time ON gateway_key_usage(key_id, timestamp);

CREATE TABLE gateway_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Seed providers - Anthropic first as requested, others disabled until implemented
INSERT INTO providers (id, name, base_url, protocol, auth_mode, enabled, created_at, updated_at) VALUES
  ('anthropic', 'Anthropic', 'https://api.anthropic.com', 'anthropic-messages', 'apiKey', 1, unixepoch('now')*1000, unixepoch('now')*1000),
  ('openai', 'OpenAI', 'https://api.openai.com/v1', 'openai-completions', 'apiKey', 0, unixepoch('now')*1000, unixepoch('now')*1000);
