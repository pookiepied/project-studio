-- ============================================================
-- studio-chat — Database Schema                   (studio-chat)
-- ============================================================
--
-- This database has ONE job: the user's persistent knowledge base.
-- Everything else that used to live here has moved to its own worker:
--   • MCP servers / connections   → studio-mcp     (external_connections)
--   • Composio config / accounts  → studio-mcp     (composio_auth)
--   • Agents (defs + run history) → studio-agents  (user_agents, agent_runs)
--   • Usage / billing events      → gateway-owned D1 (not chat's concern)
--
-- SETUP (run once after creating the D1 database):
--
--   1. Create the database:
--        wrangler d1 create studio-chat
--      Copy the returned database_id into wrangler.toml.
--
--   2. Apply this schema:
--        wrangler d1 execute studio-chat --remote --file=./schema.sql
--
--   3. Deploy the worker:
--        npm run deploy
--
-- ============================================================


-- ── Persistent Knowledge Base ─────────────────────────────────────────────────
--
-- Tracks documents that users permanently add to their KB (contrast with
-- temp/{sessionId} docs which expire after 24 h). One row per document.
--
-- r2_key      : "permanent/{user_id}/{id}" — the raw text lives in DOCS_BUCKET.
-- chunk_count : number of Vectorize vectors created; used to reconstruct
--               vector IDs ({id}-0, {id}-1, …) for deletion.
-- truncated   : 1 if the original text exceeded MAX_INDEX_CHARS (~100 pages).
-- created_at  : Unix milliseconds.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_documents (
  id          TEXT    PRIMARY KEY,
  user_id     TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  size        INTEGER NOT NULL DEFAULT 0,
  mime_type   TEXT    NOT NULL DEFAULT 'text/plain',
  r2_key      TEXT    NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  truncated   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_user_docs_user ON user_documents(user_id, created_at DESC);
