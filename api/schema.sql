-- ============================================================
-- API Worker — Complete Schema                    (studio-jobs)
-- ============================================================
--
-- SETUP (run once after creating the D1 database):
--
--   1. Create the database:
--        wrangler d1 create studio-jobs
--      Copy the returned database_id into wrangler.toml.
--
--   2. Apply this schema:
--        wrangler d1 execute studio-jobs --remote --file=./schema.sql
--
--   3. Set secrets:
--        wrangler secret put JWT_SECRET
--        wrangler secret put ENGINE_API_KEY
--
--   4. Deploy:
--        npm run deploy
--
-- ============================================================


-- ── Jobs ──────────────────────────────────────────────────────────────────────
--
-- Central job queue. Jobs are created by the API and claimed by either the
-- Cloudflare Worker (cloud jobs) or a registered local engine (local jobs).
--
-- execution_target:
--   'cloud'  — Cloudflare Worker handles the job directly
--   'local'  — must be claimed by a registered local engine
--   'any'    — any engine may claim it
--
-- heartbeat_at: updated by the local engine every few seconds while processing.
--   If stale (null or older than the timeout threshold), the job may be reset
--   to 'queued' by the stale-job reaper cron.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id               TEXT    PRIMARY KEY,
  task_id          TEXT    NOT NULL,
  user_id          TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'queued'
                           CHECK(status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  execution_target TEXT    NOT NULL DEFAULT 'any'
                           CHECK(execution_target IN ('cloud', 'local', 'any')),
  inputs           TEXT    NOT NULL,   -- JSON
  options          TEXT,               -- JSON
  result           TEXT,               -- JSON
  progress         TEXT,               -- JSON
  error            TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  completed_at     INTEGER,
  heartbeat_at     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_jobs_status           ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_user             ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_created          ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_execution_target ON jobs(execution_target);


-- ── System State ──────────────────────────────────────────────────────────────
--
-- Key-value store for runtime flags: engine heartbeat, feature toggles, etc.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_state (
  key        TEXT    PRIMARY KEY,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);


