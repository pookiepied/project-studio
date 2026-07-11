-- Studio Registry (D1) — user-scoped capability records.
-- Every table carries user_id and every query MUST filter on it.
-- Credentials never live here: config_ref points into the secure
-- connector-management / auth system.

CREATE TABLE IF NOT EXISTS connectors (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('studio', 'user', 'third-party')),
  enabled INTEGER NOT NULL DEFAULT 1,
  authenticated INTEGER NOT NULL DEFAULT 0,
  available INTEGER NOT NULL DEFAULT 0,
  capabilities TEXT NOT NULL DEFAULT '[]',   -- JSON array
  permissions TEXT NOT NULL DEFAULT '[]',    -- JSON array
  config_ref TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',       -- JSON object
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_connectors_user ON connectors (user_id);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('studio', 'user', 'third-party')),
  location TEXT NOT NULL CHECK (location IN ('cloud', 'local')),
  enabled INTEGER NOT NULL DEFAULT 1,
  available INTEGER NOT NULL DEFAULT 0,
  transport TEXT,                            -- JSON connection configuration
  auth_ref TEXT,                             -- reference, never credentials
  tools TEXT NOT NULL DEFAULT '[]',          -- JSON tool metadata
  permissions TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_user ON mcp_servers (user_id);

CREATE TABLE IF NOT EXISTS bundles (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  machine_id TEXT,
  name TEXT NOT NULL,
  bundle_type TEXT NOT NULL,
  version TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('studio', 'user', 'third-party')),
  location TEXT NOT NULL CHECK (location IN ('cloud', 'local')),
  runtime TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  available INTEGER NOT NULL DEFAULT 0,
  tools TEXT NOT NULL DEFAULT '[]',
  permissions TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_bundles_user ON bundles (user_id);

CREATE TABLE IF NOT EXISTS local_registry_sync (
  user_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, machine_id)
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('studio', 'user', 'third-party')),
  version TEXT NOT NULL DEFAULT '0.1.0',
  enabled INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL DEFAULT '',
  instructions_ref TEXT,                     -- loaded progressively, not inlined
  required_tools TEXT NOT NULL DEFAULT '[]',
  required_permissions TEXT NOT NULL DEFAULT '[]',
  environments TEXT NOT NULL DEFAULT '[]',
  activation_rules TEXT NOT NULL DEFAULT '{}',
  resources TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_skills_user ON skills (user_id);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('studio', 'user')),
  version TEXT NOT NULL DEFAULT '0.1.0',
  enabled INTEGER NOT NULL DEFAULT 1,
  location TEXT NOT NULL CHECK (location IN ('cloud', 'local')),
  definition TEXT NOT NULL,                  -- JSON AgentDefinition
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agents_user ON agents (user_id);
