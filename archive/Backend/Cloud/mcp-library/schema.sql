-- Studio Cloud MCP Library (D1)
-- Stores full MCP server definitions. The registry stores searchable
-- registration metadata and references back to these definitions.

CREATE TABLE IF NOT EXISTS mcp_server_definitions (
  id TEXT NOT NULL,
  owner_type TEXT NOT NULL DEFAULT 'system' CHECK (owner_type IN ('system', 'user')),
  owner_user_id TEXT,
  owner_key TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'disabled', 'archived')),
  config_ref TEXT NOT NULL,
  server_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, owner_key, version),
  UNIQUE (config_ref),
  CHECK (
    (owner_type = 'system' AND owner_user_id IS NULL AND owner_key = 'system')
    OR
    (owner_type = 'user' AND owner_user_id IS NOT NULL AND owner_key = 'user:' || owner_user_id)
  )
);

CREATE INDEX IF NOT EXISTS idx_mcp_server_definitions_owner_status
  ON mcp_server_definitions (owner_key, status);
