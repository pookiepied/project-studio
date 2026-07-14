-- Studio Cloud Agent Library (D1)
-- Stores full dynamic agent definitions. System definitions may also be bundled
-- with the worker and exposed by the same library interface.

CREATE TABLE IF NOT EXISTS agent_definitions (
  id TEXT NOT NULL,
  owner_type TEXT NOT NULL DEFAULT 'system' CHECK (owner_type IN ('system', 'user')),
  owner_user_id TEXT,
  owner_key TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '0.1.0',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'disabled', 'archived')),
  definition_ref TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, owner_key, version),
  UNIQUE (definition_ref),
  CHECK (
    (owner_type = 'system' AND owner_user_id IS NULL AND owner_key = 'system')
    OR
    (owner_type = 'user' AND owner_user_id IS NOT NULL AND owner_key = 'user:' || owner_user_id)
  )
);
CREATE INDEX IF NOT EXISTS idx_agent_definitions_owner_status ON agent_definitions (owner_key, status);
