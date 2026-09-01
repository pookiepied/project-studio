-- Identity schema. This database has exactly one owner: the auth worker.
-- No other worker binds to it; console reaches it through RPC. See ADR-0001.

CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT,
  -- 'admin' | 'user'
  role       TEXT NOT NULL DEFAULT 'user',
  -- 'invited' (allowlisted, never logged in) | 'active' | 'disabled'
  status     TEXT NOT NULL DEFAULT 'invited',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Only the SHA-256 of the token is stored. A dump of this table does not let
-- anyone log in as anybody.
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  ip         TEXT,
  ua         TEXT
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

-- Short-lived PKCE state for an in-flight authorization. Rows are single-use.
CREATE TABLE oauth_flows (
  state      TEXT PRIMARY KEY,
  verifier   TEXT NOT NULL,
  mode       TEXT NOT NULL,          -- 'web' | 'desktop'
  redirect   TEXT,                   -- loopback URL for 'desktop'
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Desktop handoff. Holds a user id, never a token: the session is minted at
-- exchange time, so no credential is ever at rest here or in a URL.
CREATE TABLE handoffs (
  code_hash  TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);

CREATE TABLE audit_events (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  target     TEXT,
  meta_json  TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_created_idx ON audit_events(created_at);
