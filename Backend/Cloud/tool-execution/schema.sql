-- Studio Tool Execution Worker (D1)
-- Stores isolated tool-call job records. The worker is stateless; durable state
-- is keyed by user/session/conversation/execution/tool-call identifiers.

CREATE TABLE IF NOT EXISTS tool_execution_jobs (
  job_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT,
  session_id TEXT,
  conversation_id TEXT,
  agent_id TEXT,
  agent_execution_id TEXT,
  tool_call_id TEXT NOT NULL,
  source_runtime TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  route_kind TEXT,
  target_ref TEXT,
  idempotency_key TEXT,
  request_json TEXT NOT NULL,
  result_json TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_tool_execution_jobs_user_created
  ON tool_execution_jobs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_execution_jobs_scope
  ON tool_execution_jobs (user_id, workspace_id, session_id, conversation_id, agent_id, agent_execution_id);

CREATE INDEX IF NOT EXISTS idx_tool_execution_jobs_tool_call
  ON tool_execution_jobs (user_id, tool_call_id);
