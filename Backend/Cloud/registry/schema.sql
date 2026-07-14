-- Studio Cloud Library Registry (D1)
-- Current behavior: internally managed, system-owned cloud library resources.
-- Future-compatible behavior: user-owned resources can be added without changing
-- table identity, query isolation, or API ownership semantics.
--
-- No connector inventories, local sync state, runtime state, files, artifacts,
-- model provider data, credentials, or execution records belong here.

CREATE TABLE IF NOT EXISTS skills (
  id TEXT NOT NULL,
  owner_type TEXT NOT NULL DEFAULT 'system' CHECK (owner_type IN ('system', 'user')),
  owner_user_id TEXT,
  owner_key TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL CHECK (origin IN ('studio', 'third-party')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'disabled', 'archived')),
  current_version TEXT NOT NULL DEFAULT '0.1.0',
  instructions_ref TEXT NOT NULL,
  config_ref TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  activation_rules TEXT NOT NULL DEFAULT '{}',
  required_tools TEXT NOT NULL DEFAULT '[]',
  required_permissions TEXT NOT NULL DEFAULT '[]',
  resources TEXT NOT NULL DEFAULT '[]',
  mcp_server_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, owner_key),
  UNIQUE (owner_key, slug),
  CHECK (
    (owner_type = 'system' AND owner_user_id IS NULL AND owner_key = 'system')
    OR
    (owner_type = 'user' AND owner_user_id IS NOT NULL AND owner_key = 'user:' || owner_user_id)
  )
);
CREATE INDEX IF NOT EXISTS idx_skills_owner_status ON skills (owner_key, status);
CREATE INDEX IF NOT EXISTS idx_skills_owner_origin ON skills (owner_key, origin);

CREATE TABLE IF NOT EXISTS skill_versions (
  skill_id TEXT NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('system', 'user')),
  owner_key TEXT NOT NULL,
  version TEXT NOT NULL,
  config_ref TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  change_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (skill_id, owner_type, owner_key, version),
  FOREIGN KEY (skill_id, owner_key) REFERENCES skills(id, owner_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT NOT NULL,
  owner_type TEXT NOT NULL DEFAULT 'system' CHECK (owner_type IN ('system', 'user')),
  owner_user_id TEXT,
  owner_key TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL CHECK (origin IN ('studio', 'third-party')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'disabled', 'archived')),
  current_version TEXT NOT NULL DEFAULT '0.1.0',
  transport TEXT NOT NULL DEFAULT 'streamable-http' CHECK (transport IN ('streamable-http', 'sse', 'http')),
  endpoint_ref TEXT,
  auth_ref TEXT,
  config_ref TEXT,
  tools TEXT NOT NULL DEFAULT '[]',
  permissions TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, owner_key),
  UNIQUE (owner_key, slug),
  CHECK (
    (owner_type = 'system' AND owner_user_id IS NULL AND owner_key = 'system')
    OR
    (owner_type = 'user' AND owner_user_id IS NOT NULL AND owner_key = 'user:' || owner_user_id)
  )
);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_owner_status ON mcp_servers (owner_key, status);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_owner_origin ON mcp_servers (owner_key, origin);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_owner_transport ON mcp_servers (owner_key, transport);

CREATE TABLE IF NOT EXISTS mcp_server_versions (
  mcp_server_id TEXT NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('system', 'user')),
  owner_key TEXT NOT NULL,
  version TEXT NOT NULL,
  config_ref TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  change_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (mcp_server_id, owner_type, owner_key, version),
  FOREIGN KEY (mcp_server_id, owner_key) REFERENCES mcp_servers(id, owner_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT NOT NULL,
  owner_type TEXT NOT NULL DEFAULT 'system' CHECK (owner_type IN ('system', 'user')),
  owner_user_id TEXT,
  owner_key TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL CHECK (origin IN ('studio', 'third-party')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'disabled', 'archived')),
  version TEXT NOT NULL DEFAULT '0.1.0',
  runtime_type TEXT NOT NULL DEFAULT 'agent-runtime' CHECK (runtime_type = 'agent-runtime'),
  definition_ref TEXT NOT NULL,
  capability_summary TEXT NOT NULL DEFAULT '{}',
  schedule_enabled INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, owner_key),
  UNIQUE (owner_key, slug),
  CHECK (
    (owner_type = 'system' AND owner_user_id IS NULL AND owner_key = 'system')
    OR
    (owner_type = 'user' AND owner_user_id IS NOT NULL AND owner_key = 'user:' || owner_user_id)
  )
);
CREATE INDEX IF NOT EXISTS idx_agents_owner_status ON agents (owner_key, status);
CREATE INDEX IF NOT EXISTS idx_agents_owner_origin ON agents (owner_key, origin);
CREATE INDEX IF NOT EXISTS idx_agents_owner_runtime ON agents (owner_key, runtime_type);
