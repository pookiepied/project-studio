-- Studio Context Engine (D1) - internal context construction state.
-- Studio Data owns user-facing transcript state; this database owns internal
-- baseline/snapshot metadata and context assembly records.

CREATE TABLE IF NOT EXISTS context_baselines (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  branch_id TEXT NOT NULL DEFAULT 'main',
  runtime_consumer TEXT NOT NULL,
  agent_id TEXT,
  baseline_version INTEGER NOT NULL DEFAULT 1,
  source_projection_id TEXT,
  source_last_sequence INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  payload_ref TEXT,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, user_id),
  UNIQUE (user_id, conversation_id, branch_id, runtime_consumer, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_context_baselines_lookup
  ON context_baselines(user_id, conversation_id, branch_id, runtime_consumer, status);

CREATE TABLE IF NOT EXISTS context_assemblies (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  conversation_id TEXT,
  branch_id TEXT NOT NULL DEFAULT 'main',
  runtime_consumer TEXT NOT NULL,
  task_id TEXT NOT NULL,
  source_projection_id TEXT,
  source_last_sequence INTEGER NOT NULL DEFAULT 0,
  tool_projection_generated_at TEXT,
  cache_status TEXT NOT NULL,
  payload_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_context_assemblies_user
  ON context_assemblies(user_id, conversation_id, created_at);

