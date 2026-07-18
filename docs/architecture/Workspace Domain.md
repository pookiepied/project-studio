# Workspace Domain

## Decision

Workspace is a domain inside `studio-data`, exposed through the existing `api`
worker at:

```text
/studio/data/workspace
```

Do not create a separate `workspace.example.com` worker for the first release.
`studio-data` already owns user-scoped content, D1 metadata, R2 object records,
and the internal service-binding path from the authenticated API edge. Keeping
Workspace there avoids a second source of truth and lets notes, tasks,
attachments, artifacts, and future AI context share the same privacy boundary.

## Source of Truth

Cloud data is authoritative:

- D1 stores workspace, project, note, revision, task, tag, and relationship
  metadata.
- `workspace_notes.content_markdown` is mandatory and canonical.
- Editor JSON, local drafts, and client caches are secondary recovery and
  performance layers.
- R2 should be used for attachment bytes and large derived objects; D1 stores
  metadata and object references.

Clients may cache project lists, recent projects, recent notes, and unsaved
drafts locally. Writes should go to the cloud first, with optimistic UI and a
retry queue where the frontend supports it. Local cache must never become the
only recoverable copy of saved Workspace content.

## Synchronization

Initial synchronization should stay simple:

- Fetch from `/studio/data/workspace` through the authenticated API edge.
- Use query caching and automatic refetch for read freshness.
- Use optimistic mutations for project, note, and task updates.
- Use `expectedRevisionNumber` on Markdown note updates to prevent stale
  clients overwriting newer cloud content.
- Keep local unsaved drafts for recovery, not authority.

Server-pushed events can be added later using the existing STUDIO event or
WebSocket infrastructure. Real-time collaboration should not shape the first
schema or editor architecture.

## Domain Boundary

`studio-data` owns:

- Project CRUD
- Markdown note CRUD
- Markdown revision history
- Task CRUD
- Note-task relationships
- AI context preview assembly from Workspace records
- Future attachment metadata and Workspace activity records

It does not own:

- Provider-specific LLM calls
- Agent orchestration
- Chat conversation runtime
- Connector authentication
- External service execution

Those systems should consume Workspace through service contracts and propose
mutations instead of silently changing user content.

## First API Surface

```text
GET    /workspace
GET    /workspace/projects
POST   /workspace/projects
GET    /workspace/projects/:projectId
PATCH  /workspace/projects/:projectId
DELETE /workspace/projects/:projectId
GET    /workspace/projects/:projectId/overview

GET    /workspace/projects/:projectId/notes
POST   /workspace/projects/:projectId/notes
GET    /workspace/notes/:noteId
PATCH  /workspace/notes/:noteId
DELETE /workspace/notes/:noteId
GET    /workspace/notes/:noteId/revisions

GET    /workspace/tasks
POST   /workspace/tasks
PATCH  /workspace/tasks/:taskId
DELETE /workspace/tasks/:taskId

POST   /workspace/ai/context/preview
```

All repository queries must include authenticated `user_id`. Workspace-aware
queries also include `workspace_id`. Clients must not be trusted to prove
ownership by IDs alone.
