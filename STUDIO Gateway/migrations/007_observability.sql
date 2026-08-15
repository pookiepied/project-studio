-- Gateway observability and management metadata.
-- Request records intentionally store normalized metadata only. Prompt and
-- completion bodies are never persisted by the gateway telemetry layer.

ALTER TABLE gateway_keys ADD COLUMN description TEXT;

CREATE TABLE gateway_requests (
  request_id TEXT PRIMARY KEY,
  generation_id TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INTEGER NOT NULL DEFAULT 200,
  gateway_key_id TEXT REFERENCES gateway_keys(id) ON DELETE SET NULL,
  gateway_key_name TEXT,
  user_id TEXT,
  application TEXT,
  model_id TEXT,
  provider_id TEXT,
  model_category TEXT,
  streaming INTEGER NOT NULL DEFAULT 0,
  reasoning_used INTEGER NOT NULL DEFAULT 0,
  tools_called INTEGER NOT NULL DEFAULT 0,
  fallback_used INTEGER NOT NULL DEFAULT 0,
  finish_reason TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  cached_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  cost REAL,
  routing_latency_ms REAL,
  provider_latency_ms REAL,
  total_latency_ms REAL,
  time_to_first_token_ms REAL,
  tokens_per_second REAL,
  provider_response_id TEXT,
  provider_status_code INTEGER,
  error_code TEXT,
  error_message TEXT
);

CREATE INDEX idx_gateway_requests_created_at ON gateway_requests(created_at);
CREATE INDEX idx_gateway_requests_model ON gateway_requests(model_id, created_at);
CREATE INDEX idx_gateway_requests_provider ON gateway_requests(provider_id, created_at);
CREATE INDEX idx_gateway_requests_key ON gateway_requests(gateway_key_id, created_at);
