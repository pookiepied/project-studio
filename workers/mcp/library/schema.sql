-- STUDIO Memory — D1 Schema
-- Apply (fresh deployment): wrangler d1 execute studio-memory --remote --file=./schema.sql
-- Apply (existing deployment): wrangler d1 execute studio-memory --remote --file=./schema.migration.sql

-- User profiles: identity + preferences, always injected on every chat request.
-- facts_json stores { identity: ProfileEntry[], preference: ProfileEntry[] }
-- where ProfileEntry = { content: string, importance: number }.
-- Sorted by importance descending; capped at 20 entries per category.
CREATE TABLE IF NOT EXISTS memory_profiles (
  user_id      TEXT PRIMARY KEY,
  facts_json   TEXT NOT NULL DEFAULT '{}',
  updated_at   TEXT NOT NULL
);

-- Conversation summaries: episodic record of every processed chat
CREATE TABLE IF NOT EXISTS memory_conversations (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  summary         TEXT NOT NULL,
  key_points      TEXT NOT NULL,   -- JSON: string[]
  topics          TEXT NOT NULL,   -- JSON: string[]
  participants    TEXT,            -- JSON: string[] (people mentioned)
  importance      INTEGER NOT NULL DEFAULT 5,
  message_count   INTEGER NOT NULL DEFAULT 0,
  embedding_id    TEXT,            -- Vectorize vector ID
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conv_user ON memory_conversations (user_id, created_at DESC);

-- Memory facts: distilled long-term knowledge extracted from conversations
CREATE TABLE IF NOT EXISTS memory_facts (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL,
  category               TEXT NOT NULL
    CHECK (category IN ('identity', 'preference', 'project', 'event', 'knowledge')),
  content                TEXT NOT NULL,
  auto_tags              TEXT NOT NULL DEFAULT '[]',  -- JSON: string[]
  importance             INTEGER NOT NULL DEFAULT 5,
  confidence             REAL NOT NULL DEFAULT 1.0,

  -- Provenance: how this fact was determined
  source_type            TEXT NOT NULL DEFAULT 'inferred'
    CHECK (source_type IN ('stated', 'inferred', 'observed')),

  -- Decay: how long this fact remains relevant
  decay_rate             TEXT NOT NULL DEFAULT 'slow'
    CHECK (decay_rate IN ('none', 'slow', 'medium', 'fast')),

  -- Access tracking: used for reinforcement and future decay calculation
  last_accessed_at       TEXT,
  access_count           INTEGER NOT NULL DEFAULT 0,

  source_conversation_id TEXT,
  embedding_id           TEXT,    -- Vectorize vector ID
  expires_at             TEXT,    -- ISO string, null = permanent
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_facts_user_cat ON memory_facts (user_id, category);
CREATE INDEX IF NOT EXISTS idx_facts_expires  ON memory_facts (expires_at)
  WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_facts_access   ON memory_facts (user_id, access_count DESC);

-- Entity relationship graph: extracted from conversations over time
CREATE TABLE IF NOT EXISTS memory_relations (
  id                      TEXT PRIMARY KEY,
  user_id                 TEXT NOT NULL,
  entity_a                TEXT NOT NULL,
  relation                TEXT NOT NULL,
  entity_b                TEXT NOT NULL,
  strength                REAL NOT NULL DEFAULT 1.0,
  last_seen               TEXT NOT NULL,
  source_conversation_ids TEXT NOT NULL DEFAULT '[]'  -- JSON: string[]
);

CREATE INDEX IF NOT EXISTS idx_rel_user     ON memory_relations (user_id);
CREATE INDEX IF NOT EXISTS idx_rel_entity_a ON memory_relations (user_id, entity_a);
CREATE INDEX IF NOT EXISTS idx_rel_entity_b ON memory_relations (user_id, entity_b);
