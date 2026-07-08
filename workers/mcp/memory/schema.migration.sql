-- STUDIO Memory — Migration: add source_type, decay_rate, and access tracking
-- Apply to existing deployments: wrangler d1 execute studio-memory --remote --file=./schema.migration.sql

ALTER TABLE memory_facts ADD COLUMN source_type      TEXT NOT NULL DEFAULT 'inferred';
ALTER TABLE memory_facts ADD COLUMN decay_rate       TEXT NOT NULL DEFAULT 'slow';
ALTER TABLE memory_facts ADD COLUMN last_accessed_at TEXT;
ALTER TABLE memory_facts ADD COLUMN access_count     INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_facts_access ON memory_facts (user_id, access_count DESC);

-- Note: SQLite does not support adding CHECK constraints via ALTER TABLE.
-- The source_type and decay_rate constraints are enforced at the application layer
-- and will apply to all new rows. Existing rows retain the DEFAULT values above.
