-- Studio Data (D1) — structured metadata for user-owned content.
-- Binary content lives in R2; these tables hold queryable records and
-- object-store references. Every query MUST filter on user_id.

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations (user_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations (id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT REFERENCES conversations (id),
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_key TEXT NOT NULL,                 -- R2 object key
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attachments_user ON attachments (user_id);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT REFERENCES conversations (id),
  kind TEXT NOT NULL,                        -- image / video / document / ...
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,                 -- R2 object key
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_artifacts_user ON artifacts (user_id);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT NOT NULL, user_id TEXT NOT NULL, conversation_id TEXT,
  goal TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_plans_conversation ON plans (user_id, conversation_id, created_at);

CREATE TABLE IF NOT EXISTS transcript_records (
  id TEXT NOT NULL, user_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
  turn_id TEXT NOT NULL, run_id TEXT NOT NULL, sequence INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('assistant_text','assistant_reasoning','tool_call','tool_result')),
  tool_call_id TEXT, tool_name TEXT, content TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transcript_sequence ON transcript_records(user_id, run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_transcript_conversation ON transcript_records(user_id, conversation_id, turn_id, sequence);
