-- studio-agents-db schema
-- Setup:  wrangler d1 create studio-agents-db
-- Apply:  wrangler d1 execute studio-agents-db --remote --file=./schema.sql

-- ---------------------------------------------------------------------------
-- User-defined agent workflows (persisted definitions)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_agents (
  id            TEXT    PRIMARY KEY,
  user_id       TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  description   TEXT,
  goal          TEXT    NOT NULL,
  agent_type    TEXT    NOT NULL DEFAULT 'omni'
                          CHECK(agent_type   IN ('omni', 'coding')),
  trigger_type  TEXT    NOT NULL DEFAULT 'manual'
                          CHECK(trigger_type IN ('manual', 'cron')),
  cron_expr     TEXT,
  tools_allowed TEXT,
  status        TEXT    NOT NULL DEFAULT 'active'
                          CHECK(status       IN ('active', 'paused', 'deleted')),
  last_run_at   INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_user_agents_user ON user_agents(user_id);
CREATE INDEX IF NOT EXISTS idx_user_agents_cron ON user_agents(trigger_type, status);

-- ---------------------------------------------------------------------------
-- Individual agent run records
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_runs (
  id           TEXT    PRIMARY KEY,
  agent_id     TEXT    NOT NULL,
  user_id      TEXT    NOT NULL,
  do_id        TEXT,
  status       TEXT    NOT NULL DEFAULT 'queued'
                         CHECK(status  IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  trigger      TEXT    NOT NULL DEFAULT 'manual'
                         CHECK(trigger IN ('manual', 'cron')),
  result       TEXT,
  error        TEXT,
  started_at   INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (agent_id) REFERENCES user_agents(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_user  ON agent_runs(user_id);
