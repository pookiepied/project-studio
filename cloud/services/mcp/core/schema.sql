-- MCP Registry schema
-- Apply with: wrangler d1 execute studio-mcp --file=schema.sql
--
-- external_connections — user-registered MCP servers and apps:
--   config (non-sensitive JSON):
--     mcp_local:  { command, args }
--     mcp_remote: { url, transport }   transport = "sse" | "http"
--     composio:   { appName, displayName }
--   credentials (sensitive JSON, never returned to clients):
--     mcp_local:  {}
--     mcp_remote: { apiKey } or { bearerToken }
--
-- composio_auth — per-user, per-app Composio OAuth state:
--   entity_id: user-scoped Composio entity (userId by convention)
--   connection_id: Composio connectedAccount ID (returned after OAuth)
--   tools_json: cached JSON array of Composio action schemas

CREATE TABLE IF NOT EXISTS external_connections (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id      TEXT NOT NULL,
  type         TEXT NOT NULL CHECK(type IN ('mcp_local', 'mcp_remote', 'composio')),
  name         TEXT NOT NULL,
  display_name TEXT NOT NULL,
  config       TEXT NOT NULL DEFAULT '{}',
  credentials  TEXT NOT NULL DEFAULT '{}',
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_connections_user      ON external_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_connections_user_type ON external_connections(user_id, type);
CREATE INDEX IF NOT EXISTS idx_connections_active    ON external_connections(user_id, active);

-- ---------------------------------------------------------------------------
-- Composio per-app OAuth state
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS composio_auth (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id          TEXT NOT NULL,
  app_name         TEXT NOT NULL,
  display_name     TEXT NOT NULL DEFAULT '',
  entity_id        TEXT NOT NULL,
  connection_id    TEXT,
  status           TEXT NOT NULL DEFAULT 'initiated'
                     CHECK(status IN ('initiated','active','expired','failed')),
  tools_json       TEXT NOT NULL DEFAULT '[]',
  tools_fetched_at INTEGER,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, app_name)
);

CREATE INDEX IF NOT EXISTS idx_composio_auth_user ON composio_auth(user_id);
