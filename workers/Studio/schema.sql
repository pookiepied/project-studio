-- ============================================================
-- Studio Worker — Complete Schema                (studio-prefs)
-- ============================================================
--
-- SETUP (run once after creating the D1 database):
--
--   1. Create the database:
--        wrangler d1 create studio-prefs
--      Copy the returned database_id into wrangler.toml.
--
--   2. Apply this schema:
--        wrangler d1 execute studio-prefs --remote --file=./schema.sql
--
--   3. Deploy:
--        npm run deploy
--
-- NOTE: This worker is not exposed publicly — it is reachable only via
--       service bindings from the API worker (binding: STUDIO).
--
-- ============================================================


-- ── User Preferences ─────────────────────────────────────────────────────────
--
-- One row per authenticated user. Stores every app-level setting that should
-- travel across devices (desktop ↔ browser ↔ any future platform).
--
-- Columns use JSON blobs grouped by concern rather than individual columns.
-- This lets new preference fields be added on the frontend without requiring
-- a schema migration — only the application code changes.
--
-- Conflict resolution: the client always sends updated_at (Unix ms). When
-- loading on a new device the client merges cloud vs local by taking whichever
-- value has the higher updated_at.
--
-- Groups:
--   models    — which AI model is selected for each capability
--               keys: defaultChatModel, transcriptionModel, rephraseModel,
--                     ttsModel, imageModel, videoModel
--   ui        — visual / display settings
--               keys: theme, language, showNotifications
--   behavior  — runtime behaviour toggles
--               keys: autoRephrase, rephraseTone, autopilotMode
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id    TEXT    PRIMARY KEY,           -- stable identifier (JWT sub claim)
  models     TEXT    NOT NULL DEFAULT '{}', -- JSON object — model selections
  ui         TEXT    NOT NULL DEFAULT '{}', -- JSON object — UI settings
  behavior   TEXT    NOT NULL DEFAULT '{}', -- JSON object — behavioral toggles
  updated_at INTEGER NOT NULL DEFAULT 0     -- Unix milliseconds; last-write-wins
);
