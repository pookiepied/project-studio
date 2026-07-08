-- Studio Connectors schema
-- Apply with: wrangler d1 execute studio-connectors --remote --file=./schema.sql
--
-- Ownership:
--   connectors owns first-party app integrations such as Composio.
--   mcp owns generic MCP registry state.
--   studio-data owns user content, not OAuth/provider credentials.

CREATE TABLE IF NOT EXISTS connector_connections (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id               TEXT NOT NULL,
  provider_key          TEXT NOT NULL, -- composio, google, slack, github, etc.
  app_key               TEXT NOT NULL, -- gmail, calendar, slack, etc.
  display_name          TEXT NOT NULL DEFAULT '',
  entity_id             TEXT NOT NULL,
  external_account_id   TEXT,
  status                TEXT NOT NULL DEFAULT 'initiated'
                          CHECK(status IN ('initiated', 'active', 'expired', 'revoked', 'failed')),
  scopes_json           TEXT NOT NULL DEFAULT '[]',
  metadata_json         TEXT NOT NULL DEFAULT '{}',
  encrypted_credentials TEXT,
  credentials_nonce     TEXT,
  tools_json            TEXT NOT NULL DEFAULT '[]',
  tools_fetched_at      INTEGER,
  auth_expires_at        TEXT,
  last_status_checked_at INTEGER,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, provider_key, app_key)
);

CREATE INDEX IF NOT EXISTS idx_connector_connections_user
  ON connector_connections(user_id);

CREATE INDEX IF NOT EXISTS idx_connector_connections_user_provider
  ON connector_connections(user_id, provider_key);

CREATE INDEX IF NOT EXISTS idx_connector_connections_active
  ON connector_connections(user_id, status);

CREATE TABLE IF NOT EXISTS connector_permissions (
  id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id            TEXT NOT NULL,
  provider_key       TEXT NOT NULL,
  app_key            TEXT NOT NULL,
  enabled            INTEGER NOT NULL DEFAULT 1,
  metadata_json      TEXT NOT NULL DEFAULT '{}',
  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, provider_key, app_key)
);

CREATE INDEX IF NOT EXISTS idx_connector_permissions_user
  ON connector_permissions(user_id);

CREATE TABLE IF NOT EXISTS connector_auth_sessions (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id               TEXT NOT NULL,
  provider_key          TEXT NOT NULL,
  app_key               TEXT NOT NULL,
  connection_id         TEXT,
  link_token_ciphertext TEXT,
  link_token_nonce      TEXT,
  redirect_url          TEXT NOT NULL,
  callback_url          TEXT,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK(status IN ('pending', 'completed', 'expired', 'failed')),
  expires_at            TEXT,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_connector_auth_sessions_user
  ON connector_auth_sessions(user_id, created_at);

CREATE TABLE IF NOT EXISTS connector_audit_events (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id      TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  app_key      TEXT,
  action       TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_connector_audit_user_created
  ON connector_audit_events(user_id, created_at);
