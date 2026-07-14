-- ============================================================
-- Tracker Worker — Complete Schema              (studio-tracker)
-- ============================================================
--
-- SETUP (run once after creating the D1 database):
--
--   1. Create the database:
--        wrangler d1 create studio-tracker
--      Copy the returned database_id into wrangler.toml.
--
--   2. Apply this schema:
--        wrangler d1 execute studio-tracker --remote --file=./schema.sql
--
--   3. Deploy:
--        npm run deploy
--
--   4. Add the TRACKER service binding to every other worker's wrangler.toml:
--        [[services]]
--        binding = "TRACKER"
--        service  = "tracker"
--
--   5. Add tail consumers to each source worker's wrangler.toml:
--        [[tail_consumers]]
--        service = "tracker"
--
-- NOTE: No public domain needed — reachable only via service bindings.
--
-- ============================================================


-- ── Business Events ──────────────────────────────────────────────────────────
--
-- Every track() / emit() call from every worker lands here.
-- worker   : which worker emitted (ai, api, auth, chats, studio, tracker)
-- category : first dot-segment of event name (e.g. "auth" from "auth.login.success")
-- event    : full dot-separated event name
-- data     : JSON blob, event-specific payload
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id             TEXT    PRIMARY KEY,
  ts             INTEGER NOT NULL,
  worker         TEXT    NOT NULL,
  category       TEXT    NOT NULL,
  event          TEXT    NOT NULL,
  severity       TEXT    NOT NULL DEFAULT 'info',
  user_id        TEXT,
  session_id     TEXT,
  run_id         TEXT,
  span_id        TEXT,
  parent_span_id TEXT,
  data           TEXT              -- JSON blob, event-specific payload
);

CREATE INDEX IF NOT EXISTS idx_ev_ts       ON events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_ev_user     ON events(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_ev_run      ON events(run_id, ts ASC);
CREATE INDEX IF NOT EXISTS idx_ev_worker   ON events(worker, ts DESC);
CREATE INDEX IF NOT EXISTS idx_ev_category ON events(category, ts DESC);
CREATE INDEX IF NOT EXISTS idx_ev_event    ON events(event, ts DESC);


-- ── Agent Trace Spans ─────────────────────────────────────────────────────────
--
-- LangGraph node / LLM / tool spans with parent-child hierarchy.
-- Use run_id to reconstruct the full trace tree for one agent execution.
-- span_type : 'llm' | 'tool' | 'chain' | 'node' | 'agent'
-- status    : 'running' | 'success' | 'error'
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spans (
  span_id        TEXT    PRIMARY KEY,
  run_id         TEXT    NOT NULL,
  parent_span_id TEXT,
  span_type      TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  user_id        TEXT,
  started_at     INTEGER NOT NULL,
  ended_at       INTEGER,
  duration_ms    INTEGER,
  status         TEXT    NOT NULL DEFAULT 'running',
  input_preview  TEXT,             -- truncated to 4 000 chars
  output_preview TEXT,             -- truncated to 4 000 chars
  tokens_in      INTEGER,
  tokens_out     INTEGER,
  cost_usd       REAL,
  error          TEXT,
  metadata       TEXT              -- JSON
);

CREATE INDEX IF NOT EXISTS idx_sp_run    ON spans(run_id, started_at ASC);
CREATE INDEX IF NOT EXISTS idx_sp_user   ON spans(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sp_status ON spans(status, started_at DESC);


-- ── Infrastructure / Tail Events ──────────────────────────────────────────────
--
-- Auto-captured by Cloudflare tail workers — no code changes needed in source
-- workers. Cloudflare routes these automatically when [[tail_consumers]] is set.
-- outcome : 'ok' | 'exception' | 'exceededCpuLimit' | 'kill' | 'canceled' | 'unknown'
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tail_events (
  id         TEXT    PRIMARY KEY,
  ts         INTEGER NOT NULL,
  worker     TEXT    NOT NULL,
  outcome    TEXT    NOT NULL,
  event_type TEXT    NOT NULL DEFAULT 'fetch',  -- 'fetch' | 'scheduled'
  url        TEXT,
  method     TEXT,
  status     INTEGER,
  cpu_ms     INTEGER,
  wall_ms    INTEGER,
  logs       TEXT,             -- JSON array of { level, message, ts }
  exceptions TEXT              -- JSON array of { name, message, ts }
);

CREATE INDEX IF NOT EXISTS idx_te_ts      ON tail_events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_te_worker  ON tail_events(worker, ts DESC);
CREATE INDEX IF NOT EXISTS idx_te_outcome ON tail_events(outcome, ts DESC);


-- ── AI Usage Events ───────────────────────────────────────────────────────────
--
-- Per-request AI usage: tokens, cost, latency, provider, model.
-- run_id links to the spans table for full LangGraph trace correlation.
-- status : 'success' | 'error'
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usage_events (
  id                 TEXT    PRIMARY KEY,
  created_at         TEXT    NOT NULL,
  user_id            TEXT    NOT NULL,
  provider           TEXT    NOT NULL,
  model              TEXT    NOT NULL,
  input_tokens       INTEGER,
  output_tokens      INTEGER,
  cache_read_tokens  INTEGER,
  cache_write_tokens INTEGER,
  cost_usd           REAL,
  estimated_cost_usd REAL,
  latency_ms         INTEGER,
  input_preview      TEXT,
  generation_id      TEXT,
  request_type       TEXT    NOT NULL DEFAULT 'chat',
  status             TEXT    NOT NULL DEFAULT 'success',
  error_type         TEXT,
  source             TEXT,
  tool_call_count    INTEGER,
  iteration_count    INTEGER,
  run_id             TEXT
);

CREATE INDEX IF NOT EXISTS idx_ue_created  ON usage_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ue_user     ON usage_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ue_provider ON usage_events(provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ue_status   ON usage_events(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ue_run      ON usage_events(run_id) WHERE run_id IS NOT NULL;


-- ── Provider Credit Snapshots ─────────────────────────────────────────────────
--
-- Latest known credit balance per provider, refreshed every 15 minutes by
-- the AI worker cron. Used by the activity dashboard to display spend.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS provider_credits (
  provider      TEXT PRIMARY KEY,
  balance_usd   REAL,
  used_usd      REAL,
  purchased_usd REAL,
  raw_response  TEXT,
  updated_at    TEXT NOT NULL
);
