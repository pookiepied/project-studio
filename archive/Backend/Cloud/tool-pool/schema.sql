-- Studio Tool Pool (D1) - durable indexes for callable capability inventory.
-- Source services remain authoritative; this database stores refresh state and
-- optional materialized inventory snapshots for fast discovery.

CREATE TABLE IF NOT EXISTS tool_inventory_snapshots (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  runtime_consumer TEXT NOT NULL,
  agent_id TEXT,
  conversation_id TEXT,
  inventory_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tool_inventory_user
  ON tool_inventory_snapshots(user_id, runtime_consumer, updated_at);

CREATE TABLE IF NOT EXISTS tool_pool_sources (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_refresh_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tool_pool_sources_user
  ON tool_pool_sources(user_id, source_kind, status);

