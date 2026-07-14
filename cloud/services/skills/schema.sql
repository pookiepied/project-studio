-- ============================================================================
-- studio-skills — local skill registrations + audit log
--
-- This database stores METADATA ONLY. Local user-created/imported skill
-- content lives on the user's machine under $HOME/.studio/skills and is
-- never uploaded to the cloud. register-local heartbeats its presence and
-- manifest here so the cloud catalog can advertise it; the content itself is
-- only readable from a local/desktop runtime (skill_read_local).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- skill_registrations
-- One row per registered local skill (per user, optionally per device).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS skill_registrations (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  device_id       TEXT,
  scope           TEXT NOT NULL CHECK(scope IN ('system', 'local')),
  key             TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  category        TEXT,
  version         TEXT,
  allowed_runtime TEXT NOT NULL CHECK(allowed_runtime IN ('cloud', 'local', 'both')),
  source_type     TEXT NOT NULL CHECK(source_type IN ('bundled', 'local_path', 'github')),
  source_url      TEXT,
  local_path      TEXT,
  manifest_json   TEXT NOT NULL DEFAULT '{}',
  content_hash    TEXT,
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_seen_at    INTEGER,
  created_at      INTEGER NOT NULL DEFAULT unixepoch(),
  updated_at      INTEGER NOT NULL DEFAULT unixepoch()
);

CREATE INDEX IF NOT EXISTS idx_skill_registrations_user    ON skill_registrations(user_id);
CREATE INDEX IF NOT EXISTS idx_skill_registrations_user_key ON skill_registrations(user_id, key);
CREATE INDEX IF NOT EXISTS idx_skill_registrations_device  ON skill_registrations(device_id);
CREATE INDEX IF NOT EXISTS idx_skill_registrations_enabled  ON skill_registrations(enabled);

-- ----------------------------------------------------------------------------
-- skill_audit_log
-- Append-only audit trail of skill lifecycle actions.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS skill_audit_log (
  id             TEXT PRIMARY KEY,
  user_id        TEXT,
  device_id      TEXT,
  skill_key      TEXT,
  action         TEXT NOT NULL,
  metadata_json  TEXT NOT NULL DEFAULT '{}',
  created_at     INTEGER NOT NULL DEFAULT unixepoch()
);

CREATE INDEX IF NOT EXISTS idx_skill_audit_log_user  ON skill_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_skill_audit_log_key   ON skill_audit_log(skill_key);
CREATE INDEX IF NOT EXISTS idx_skill_audit_log_time  ON skill_audit_log(created_at);
