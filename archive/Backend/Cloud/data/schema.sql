-- Studio Data (D1) — structured metadata for user-owned content.
-- Binary content lives in R2; these tables hold queryable records and
-- object-store references. Every query MUST filter on user_id.

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations (user_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations (id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT REFERENCES conversations (id),
  object_id TEXT,
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_key TEXT NOT NULL,                 -- R2 object key
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attachments_user ON attachments (user_id);

CREATE TABLE IF NOT EXISTS artifact_roots (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  conversation_id TEXT REFERENCES conversations (id),
  turn_id TEXT,
  message_id TEXT,
  execution_id TEXT,
  tool_call_id TEXT,
  permission_request_id TEXT,
  family TEXT NOT NULL CHECK (family IN ('activity','research','generated_media','connector_record','connector_action','file','structured_data')),
  type TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  renderer_version INTEGER NOT NULL DEFAULT 1,
  current_version_id TEXT,
  current_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','proposed','awaiting_permission','running','streaming','waiting_for_input','completed','failed','cancelled','rejected','partial','superseded')),
  visibility TEXT NOT NULL DEFAULT 'user_visible' CHECK (visibility IN ('user_visible','internal','debug')),
  title TEXT NOT NULL,
  summary TEXT,
  created_by_event_id TEXT,
  updated_by_event_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  completed_at TEXT,
  failed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_artifact_roots_user ON artifact_roots (user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_artifact_roots_conversation ON artifact_roots (user_id, conversation_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_artifact_roots_tool_call ON artifact_roots (user_id, tool_call_id);

CREATE TABLE IF NOT EXISTS artifact_versions (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  conversation_id TEXT REFERENCES conversations (id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned','proposed','awaiting_permission','running','streaming','waiting_for_input','completed','failed','cancelled','rejected','partial','superseded')),
  title TEXT NOT NULL,
  summary TEXT,
  model_presentation TEXT NOT NULL DEFAULT '{}',
  runtime_data TEXT NOT NULL DEFAULT '{}',
  payload_object_id TEXT,
  preview_object_id TEXT,
  payload_ref TEXT NOT NULL DEFAULT '{}',
  preview_ref TEXT NOT NULL DEFAULT '{}',
  placement TEXT NOT NULL DEFAULT '{}',
  previous_version_id TEXT,
  created_by_event_id TEXT,
  updated_by_event_id TEXT,
  idempotency_key TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  completed_at TEXT,
  failed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, user_id),
  UNIQUE (user_id, artifact_id, version),
  UNIQUE (user_id, artifact_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact ON artifact_versions (user_id, artifact_id, version);
CREATE INDEX IF NOT EXISTS idx_artifact_versions_payload ON artifact_versions (user_id, payload_object_id);

CREATE TABLE IF NOT EXISTS artifact_events (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_version_id TEXT,
  conversation_id TEXT REFERENCES conversations (id),
  sequence INTEGER NOT NULL DEFAULT 1,
  event_type TEXT NOT NULL CHECK (event_type IN ('created','updated','progress','permission_requested','permission_decided','completed','failed','cancelled','rejected','superseded')),
  status TEXT CHECK (status IN ('planned','proposed','awaiting_permission','running','streaming','waiting_for_input','completed','failed','cancelled','rejected','partial','superseded')),
  title TEXT,
  summary TEXT,
  model_presentation TEXT NOT NULL DEFAULT '{}',
  runtime_data TEXT NOT NULL DEFAULT '{}',
  transcript_event_id TEXT,
  idempotency_key TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, user_id),
  UNIQUE (user_id, artifact_id, sequence),
  UNIQUE (user_id, artifact_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_artifact_events_artifact ON artifact_events (user_id, artifact_id, sequence);

CREATE TABLE IF NOT EXISTS artifact_permission_decisions (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  conversation_id TEXT REFERENCES conversations (id),
  tool_call_id TEXT,
  permission_request_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected','cancelled','expired')),
  decided_by TEXT NOT NULL DEFAULT 'user',
  reason TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  decided_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, user_id),
  UNIQUE (user_id, permission_request_id)
);
CREATE INDEX IF NOT EXISTS idx_artifact_permission_artifact ON artifact_permission_decisions (user_id, artifact_id, decided_at);

CREATE TABLE IF NOT EXISTS storage_objects (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  conversation_id TEXT,
  bucket TEXT NOT NULL CHECK (bucket IN ('conversations','uploads','generated')),
  storage_key TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  content_type TEXT NOT NULL,
  compression TEXT NOT NULL DEFAULT 'none' CHECK (compression IN ('none','gzip')),
  size_bytes INTEGER NOT NULL,
  compressed_size_bytes INTEGER,
  uncompressed_size_bytes INTEGER,
  content_hash TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, user_id),
  UNIQUE (user_id, bucket, storage_key)
);
CREATE INDEX IF NOT EXISTS idx_storage_objects_resource
  ON storage_objects(user_id, resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_storage_objects_conversation
  ON storage_objects(user_id, conversation_id, created_at);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT NOT NULL, user_id TEXT NOT NULL, conversation_id TEXT,
  goal TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_plans_conversation ON plans (user_id, conversation_id, created_at);

CREATE TABLE IF NOT EXISTS transcript_records (
  id TEXT NOT NULL, user_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
  turn_id TEXT NOT NULL, run_id TEXT NOT NULL, sequence INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('assistant_text','assistant_reasoning','tool_call','tool_result')),
  tool_call_id TEXT, tool_name TEXT, content TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transcript_sequence ON transcript_records(user_id, run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_transcript_conversation ON transcript_records(user_id, conversation_id, turn_id, sequence);

CREATE TABLE IF NOT EXISTS conversation_events (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations (id),
  turn_id TEXT,
  branch_id TEXT NOT NULL DEFAULT 'main',
  logical_id TEXT,
  revision_id TEXT,
  revision_number INTEGER NOT NULL DEFAULT 1,
  previous_revision_id TEXT,
  replaces_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','interrupted','failed','cancelled')),
  storage_version INTEGER NOT NULL DEFAULT 1,
  projection_version INTEGER NOT NULL DEFAULT 1,
  run_id TEXT,
  sequence INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('frontend','execution-runtime','planner-runtime','agent-runtime','context-engine','tool-execution','tool-pool','connector','system')),
  kind TEXT NOT NULL CHECK (kind IN (
    'user_message',
    'assistant_message',
    'system_message',
    'planner_message',
    'tool_call',
    'tool_result',
    'connector_call',
    'connector_result',
    'web_search_result',
    'image_generation_result',
    'artifact_reference',
    'artifact_created',
    'artifact_updated',
    'artifact_completed',
    'artifact_failed',
    'artifact_permission_requested',
    'attachment_reference',
    'memory_reference',
    'context_reference',
    'context_summary',
    'runtime_event',
    'status',
    'interruption',
    'retry',
    'edit',
    'branch_created'
  )),
  visibility TEXT NOT NULL CHECK (visibility IN ('renderable','model','internal','audit','hidden')),
  role TEXT CHECK (role IN ('system','user','assistant','tool')),
  content TEXT,
  summary TEXT,
  tool_call_id TEXT,
  tool_name TEXT,
  artifact_id TEXT,
  attachment_id TEXT,
  side_payload_id TEXT,
  segment_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_events_sequence
  ON conversation_events(user_id, conversation_id, sequence);
CREATE INDEX IF NOT EXISTS idx_conversation_events_model
  ON conversation_events(user_id, conversation_id, branch_id, status, visibility, sequence);
CREATE INDEX IF NOT EXISTS idx_conversation_events_run
  ON conversation_events(user_id, run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_conversation_events_logical
  ON conversation_events(user_id, conversation_id, logical_id, revision_number);

CREATE TABLE IF NOT EXISTS transcript_side_payloads (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations (id),
  branch_id TEXT NOT NULL DEFAULT 'main',
  event_id TEXT,
  object_id TEXT NOT NULL,
  payload_kind TEXT NOT NULL,
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_transcript_side_payloads_conversation
  ON transcript_side_payloads(user_id, conversation_id, branch_id, created_at);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations (id),
  branch_id TEXT NOT NULL DEFAULT 'main',
  segment_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','sealed')),
  first_sequence INTEGER,
  last_sequence INTEGER,
  event_count INTEGER NOT NULL DEFAULT 0,
  object_id TEXT,
  compression TEXT NOT NULL DEFAULT 'none' CHECK (compression IN ('none','gzip')),
  compressed_size_bytes INTEGER,
  uncompressed_size_bytes INTEGER,
  content_hash TEXT,
  seal_reason TEXT,
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  sealed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, user_id),
  UNIQUE (user_id, conversation_id, branch_id, segment_index)
);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_lookup
  ON transcript_segments(user_id, conversation_id, branch_id, status, segment_index);

CREATE TABLE IF NOT EXISTS active_transcript_projections (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations (id),
  branch_id TEXT NOT NULL DEFAULT 'main',
  projection_type TEXT NOT NULL CHECK (projection_type IN ('renderable','model','audit')),
  last_sequence INTEGER NOT NULL DEFAULT 0,
  event_count INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, user_id),
  UNIQUE (user_id, conversation_id, branch_id, projection_type)
);
CREATE INDEX IF NOT EXISTS idx_active_transcript_projection_lookup
  ON active_transcript_projections(user_id, conversation_id, branch_id, projection_type);

-- Workspace domain: cloud-owned personal organization with Markdown as the
-- canonical note body. Local caches may mirror these records, but these tables
-- remain the source of truth.
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
