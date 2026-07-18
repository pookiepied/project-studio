-- Workspace domain foundation.
-- Cloud-owned personal organization: projects, Markdown notes, revisions,
-- tasks, and queryable note-task relationships.

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_user_id);

CREATE TABLE IF NOT EXISTS workspace_projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  cover_style_json TEXT NOT NULL DEFAULT '{}',
  accent TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','planning','paused','completed','archived')),
  priority TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  default_ai_instructions TEXT,
  default_context_markdown TEXT,
  start_at TEXT,
  target_at TEXT,
  review_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_opened_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_workspace_projects_scope
  ON workspace_projects(user_id, workspace_id, deleted_at, updated_at);

CREATE TABLE IF NOT EXISTS workspace_tags (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, workspace_id, name)
);

CREATE TABLE IF NOT EXISTS workspace_project_tags (
  project_id TEXT NOT NULL REFERENCES workspace_projects(id),
  tag_id TEXT NOT NULL REFERENCES workspace_tags(id),
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(project_id, tag_id)
);

CREATE TABLE IF NOT EXISTS workspace_notes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL REFERENCES workspace_projects(id),
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  content_document_json TEXT,
  frontmatter_json TEXT NOT NULL DEFAULT '{}',
  excerpt TEXT,
  note_type TEXT NOT NULL DEFAULT 'standard',
  properties_json TEXT NOT NULL DEFAULT '{}',
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  revision_number INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_workspace_notes_project
  ON workspace_notes(user_id, workspace_id, project_id, deleted_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_workspace_notes_filename
  ON workspace_notes(user_id, workspace_id, project_id, filename);

CREATE TABLE IF NOT EXISTS workspace_note_revisions (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES workspace_notes(id),
  user_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  content_markdown TEXT NOT NULL,
  content_document_json TEXT,
  frontmatter_json TEXT NOT NULL DEFAULT '{}',
  change_source TEXT NOT NULL DEFAULT 'user',
  ai_session_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, note_id, revision_number)
);
CREATE INDEX IF NOT EXISTS idx_workspace_note_revisions_note
  ON workspace_note_revisions(user_id, note_id, revision_number);

CREATE TABLE IF NOT EXISTS workspace_tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL REFERENCES workspace_projects(id),
  user_id TEXT NOT NULL,
  parent_task_id TEXT REFERENCES workspace_tasks(id),
  title TEXT NOT NULL,
  description_markdown TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('inbox','planned','in_progress','blocked','waiting','completed','cancelled')),
  priority TEXT NOT NULL DEFAULT 'none' CHECK (priority IN ('none','low','medium','high','critical')),
  start_at TEXT,
  due_at TEXT,
  reminder_at TEXT,
  completed_at TEXT,
  estimated_minutes INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  properties_json TEXT NOT NULL DEFAULT '{}',
  ai_execution_state TEXT,
  agent_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_project
  ON workspace_tasks(user_id, workspace_id, project_id, deleted_at, status, due_at);

CREATE TABLE IF NOT EXISTS workspace_task_note_links (
  task_id TEXT NOT NULL REFERENCES workspace_tasks(id),
  note_id TEXT NOT NULL REFERENCES workspace_notes(id),
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(task_id, note_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_task_note_links_note
  ON workspace_task_note_links(user_id, note_id);

CREATE TABLE IF NOT EXISTS workspace_external_links (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL REFERENCES workspace_projects(id),
  user_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_workspace_external_links_project
  ON workspace_external_links(user_id, workspace_id, project_id, deleted_at, updated_at);
