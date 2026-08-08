import { Hono } from "hono";
import type { Env } from "../../system/env";
import { requireUserId } from "../identity";

type ProjectStatus = "active" | "planning" | "paused" | "completed" | "archived";
type TaskStatus = "inbox" | "planned" | "in_progress" | "blocked" | "waiting" | "completed" | "cancelled";
type TaskPriority = "none" | "low" | "medium" | "high" | "critical";

const PROJECT_STATUSES = new Set<ProjectStatus>(["active", "planning", "paused", "completed", "archived"]);
const TASK_STATUSES = new Set<TaskStatus>(["inbox", "planned", "in_progress", "blocked", "waiting", "completed", "cancelled"]);
const TASK_PRIORITIES = new Set<TaskPriority>(["none", "low", "medium", "high", "critical"]);

export const workspaceRoute = new Hono<{ Bindings: Env }>();

workspaceRoute.get("/", async (c) => {
  const userId = requireUserId(c.req.raw);
  const workspace = await ensureDefaultWorkspace(c.env, userId);
  return c.json({ workspace });
});

workspaceRoute.get("/projects", async (c) => {
  const userId = requireUserId(c.req.raw);
  const workspace = await ensureDefaultWorkspace(c.env, userId);
  const rows = await c.env.DATA_DB.prepare(
    `SELECT id, workspace_id AS workspaceId, name, description, icon, accent, status,
      priority, is_favorite AS isFavorite, is_archived AS isArchived,
      default_ai_instructions AS defaultAiInstructions,
      default_context_markdown AS defaultContextMarkdown,
      sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt,
      last_opened_at AS lastOpenedAt
     FROM workspace_projects
     WHERE user_id = ? AND workspace_id = ? AND deleted_at IS NULL
     ORDER BY is_favorite DESC, sort_order ASC, updated_at DESC`,
  ).bind(userId, workspace.id).all();
  return c.json({ projects: rows.results ?? [] });
});

workspaceRoute.post("/projects", async (c) => {
  const userId = requireUserId(c.req.raw);
  const workspace = await ensureDefaultWorkspace(c.env, userId);
  const body = await readJson(c.req.raw);
  const name = requiredText(body.name, "name");
  const now = new Date().toISOString();
  const id = optionalText(body.id) ?? `wproj_${crypto.randomUUID()}`;
  const status = parseProjectStatus(body.status);

  await c.env.DATA_DB.prepare(
    `INSERT INTO workspace_projects (
      id, workspace_id, user_id, name, description, icon, accent, status, priority,
      is_favorite, is_archived, default_ai_instructions, default_context_markdown,
      sort_order, created_at, updated_at, last_opened_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      icon = excluded.icon,
      accent = excluded.accent,
      status = excluded.status,
      priority = excluded.priority,
      updated_at = excluded.updated_at
    WHERE workspace_projects.user_id = excluded.user_id
      AND workspace_projects.workspace_id = excluded.workspace_id`,
  ).bind(
    id,
    workspace.id,
    userId,
    name,
    nullableText(body.description),
    nullableText(body.icon),
    nullableText(body.accent),
    status,
    nullableText(body.priority),
    boolInt(body.isFavorite),
    nullableText(body.defaultAiInstructions),
    nullableText(body.defaultContextMarkdown),
    numberOrZero(body.sortOrder),
    now,
    now,
    now,
  ).run();

  const project = await readProject(c.env, userId, workspace.id, id);
  return project ? c.json({ project }, 201) : c.json({ error: "id_conflict" }, 409);
});

workspaceRoute.get("/projects/:projectId", async (c) => {
  const userId = requireUserId(c.req.raw);
  const workspace = await ensureDefaultWorkspace(c.env, userId);
  const project = await readProject(c.env, userId, workspace.id, c.req.param("projectId"));
  return project ? c.json({ project }) : c.json({ error: "not_found" }, 404);
});

workspaceRoute.patch("/projects/:projectId", async (c) => {
  const userId = requireUserId(c.req.raw);
  const workspace = await ensureDefaultWorkspace(c.env, userId);
  const projectId = c.req.param("projectId");
  if (!await ownsProject(c.env, userId, workspace.id, projectId)) return c.json({ error: "not_found" }, 404);
  const body = await readJson(c.req.raw);
  const now = new Date().toISOString();
  await c.env.DATA_DB.prepare(
    `UPDATE workspace_projects SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      icon = COALESCE(?, icon),
      accent = COALESCE(?, accent),
      status = COALESCE(?, status),
      priority = COALESCE(?, priority),
      is_favorite = COALESCE(?, is_favorite),
      is_archived = COALESCE(?, is_archived),
      default_ai_instructions = COALESCE(?, default_ai_instructions),
      default_context_markdown = COALESCE(?, default_context_markdown),
      updated_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
  ).bind(
    optionalText(body.name),
    nullableTextPatch(body, "description"),
    nullableTextPatch(body, "icon"),
    nullableTextPatch(body, "accent"),
    body.status === undefined ? null : parseProjectStatus(body.status),
    nullableTextPatch(body, "priority"),
    body.isFavorite === undefined ? null : boolInt(body.isFavorite),
    body.isArchived === undefined ? null : boolInt(body.isArchived),
    nullableTextPatch(body, "defaultAiInstructions"),
    nullableTextPatch(body, "defaultContextMarkdown"),
    now,
    projectId,
    userId,
    workspace.id,
  ).run();
  return c.json({ project: await readProject(c.env, userId, workspace.id, projectId) });
});

workspaceRoute.delete("/projects/:projectId", async (c) => {
  const userId = requireUserId(c.req.raw);
  const workspace = await ensureDefaultWorkspace(c.env, userId);
  const now = new Date().toISOString();
  const result = await c.env.DATA_DB.prepare(
    `UPDATE workspace_projects SET deleted_at = ?, is_archived = 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
  ).bind(now, now, c.req.param("projectId"), userId, workspace.id).run();
  return c.json({ deleted: result.meta.changes > 0 });
});

workspaceRoute.get("/projects/:projectId/overview", async (c) => {
  const userId = requireUserId(c.req.raw);
  const workspace = await ensureDefaultWorkspace(c.env, userId);
  const projectId = c.req.param("projectId");
  const project = await readProject(c.env, userId, workspace.id, projectId);
  if (!project) return c.json({ error: "not_found" }, 404);
  await c.env.DATA_DB.prepare(
    "UPDATE workspace_projects SET last_opened_at = ? WHERE id = ? AND user_id = ? AND workspace_id = ?",
  ).bind(new Date().toISOString(), projectId, userId, workspace.id).run();
  const [notes, tasks] = await Promise.all([
    c.env.DATA_DB.prepare(
      `SELECT id, title, filename, excerpt, note_type AS noteType, is_pinned AS isPinned,
        updated_at AS updatedAt
       FROM workspace_notes
       WHERE user_id = ? AND workspace_id = ? AND project_id = ? AND deleted_at IS NULL
       ORDER BY is_pinned DESC, updated_at DESC LIMIT 12`,
    ).bind(userId, workspace.id, projectId).all(),
    c.env.DATA_DB.prepare(
      `SELECT id, title, status, priority, due_at AS dueAt, updated_at AS updatedAt
       FROM workspace_tasks
       WHERE user_id = ? AND workspace_id = ? AND project_id = ? AND deleted_at IS NULL
         AND status NOT IN ('completed', 'cancelled')
       ORDER BY due_at IS NULL, due_at ASC, sort_order ASC, updated_at DESC LIMIT 12`,
    ).bind(userId, workspace.id, projectId).all(),
  ]);
  return c.json({ project, recentNotes: notes.results ?? [], openTasks: tasks.results ?? [] });
});

workspaceRoute.get("/projects/:projectId/notes", async (c) => {
  const userId = requireUserId(c.req.raw);
  const workspace = await ensureDefaultWorkspace(c.env, userId);
  const projectId = c.req.param("projectId");
  if (!await ownsProject(c.env, userId, workspace.id, projectId)) return c.json({ error: "not_found" }, 404);
  const rows = await c.env.DATA_DB.prepare(
    `SELECT id, project_id AS projectId, title, filename, content_markdown AS contentMarkdown,
      excerpt, note_type AS noteType, is_pinned AS isPinned, is_favorite AS isFavorite,
      revision_number AS revisionNumber, created_at AS createdAt, updated_at AS updatedAt
     FROM workspace_notes
     WHERE user_id = ? AND workspace_id = ? AND project_id = ? AND deleted_at IS NULL
     ORDER BY is_pinned DESC, updated_at DESC`,
  ).bind(userId, workspace.id, projectId).all();
  return c.json({ notes: rows.results ?? [] });
});

workspaceRoute.post("/projects/:projectId/notes", async (c) => {
  const userId = requireUserId(c.req.raw);
  const workspace = await ensureDefaultWorkspace(c.env, userId);
  const projectId = c.req.param("projectId");
  if (!await ownsProject(c.env, userId, workspace.id, projectId)) return c.json({ error: "not_found" }, 404);
  const body = await readJson(c.req.raw);
  const title = requiredText(body.title, "title");
  const contentMarkdown = typeof body.contentMarkdown === "string" ? body.contentMarkdown : "";
  const now = new Date().toISOString();
  const id = optionalText(body.id) ?? `wnote_${crypto.randomUUID()}`;
  const filename = sanitizeFilename(optionalText(body.filename) ?? title);
  const excerpt = makeExcerpt(contentMarkdown);

  await c.env.DATA_DB.prepare(
    `INSERT INTO workspace_notes (
      id, workspace_id, project_id, user_id, title, filename, content_markdown,
      content_document_json, frontmatter_json, excerpt, note_type, properties_json,
      is_pinned, is_favorite, is_archived, revision_number, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, '{}', ?, ?, 0, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      filename = excluded.filename,
      content_markdown = excluded.content_markdown,
      excerpt = excluded.excerpt,
      revision_number = workspace_notes.revision_number + 1,
      updated_at = excluded.updated_at
    WHERE workspace_notes.user_id = excluded.user_id
      AND workspace_notes.workspace_id = excluded.workspace_id`,
  ).bind(
    id,
    workspace.id,
    projectId,
    userId,
    title,
    filename,
    contentMarkdown,
    JSON.stringify(body.frontmatter ?? {}),
    excerpt,
    optionalText(body.noteType) ?? "standard",
    boolInt(body.isPinned),
    boolInt(body.isFavorite),
    now,
    now,
  ).run();
  await insertNoteRevision(c.env, userId, id, 1, contentMarkdown, "user");
  return c.json({ note: await readNote(c.env, userId, workspace.id, id) }, 201);
});

workspaceRoute.get("/notes/:noteId", async (c) => {
  const userId = requireUserId(c.req.raw);
  const workspace = await ensureDefaultWorkspace(c.env, userId);
  const note = await readNote(c.env, userId, workspace.id, c.req.param("noteId"));
  return note ? c.json({ note }) : c.json({ error: "not_found" }, 404);
});

workspaceRoute.patch("/notes/:noteId", async (c) => {
  const userId = requireUserId(c.req.raw);
  const workspace = await ensureDefaultWorkspace(c.env, userId);
  const noteId = c.req.param("noteId");
  const current = await readNote(c.env, userId, workspace.id, noteId);
  if (!current) return c.json({ error: "not_found" }, 404);
  const body = await readJson(c.req.raw);
  const expectedRevision = typeof body.expectedRevisionNumber === "number" ? body.expectedRevisionNumber : null;
  if (expectedRevision !== null && expectedRevision !== current.revisionNumber) {
    return c.json({ error: "revision_conflict", currentRevisionNumber: current.revisionNumber }, 409);
  }
  const contentMarkdown = typeof body.contentMarkdown === "string" ? body.contentMarkdown : current.contentMarkdown;
  const nextRevision = current.revisionNumber + (contentMarkdown !== current.contentMarkdown ? 1 : 0);
  const now = new Date().toISOString();
  await c.env.DATA_DB.prepare(
    `UPDATE workspace_notes SET
      title = COALESCE(?, title),
      filename = COALESCE(?, filename),
      content_markdown = ?,
      excerpt = ?,
      note_type = COALESCE(?, note_type),
      is_pinned = COALESCE(?, is_pinned),
      is_favorite = COALESCE(?, is_favorite),
      revision_number = ?,
      updated_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
  ).bind(
    optionalText(body.title),
    body.filename === undefined ? null : sanitizeFilename(requiredText(body.filename, "filename")),
    contentMarkdown,
    makeExcerpt(contentMarkdown),
    optionalText(body.noteType),
    body.isPinned === undefined ? null : boolInt(body.isPinned),
    body.isFavorite === undefined ? null : boolInt(body.isFavorite),
    nextRevision,
    now,
    noteId,
    userId,
    workspace.id,
  ).run();
  if (nextRevision !== current.revisionNumber) {
    await insertNoteRevision(c.env, userId, noteId, nextRevision, contentMarkdown, optionalText(body.changeSource) ?? "user");
  }
  return c.json({ note: await readNote(c.env, userId, workspace.id, noteId) });
});

workspaceRoute.delete("/notes/:noteId", async (c) => {
  const userId = requireUserId(c.req.raw);
  const workspace = await ensureDefaultWorkspace(c.env, userId);
  const now = new Date().toISOString();
  const result = await c.env.DATA_DB.prepare(
    `UPDATE workspace_notes SET deleted_at = ?, is_archived = 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
  ).bind(now, now, c.req.param("noteId"), userId, workspace.id).run();
  return c.json({ deleted: result.meta.changes > 0 });
});

workspaceRoute.get("/notes/:noteId/revisions", async (c) => {
  const userId = requireUserId(c.req.raw);
  const workspace = await ensureDefaultWorkspace(c.env, userId);
  if (!await readNote(c.env, userId, workspace.id, c.req.param("noteId"))) return c.json({ error: "not_found" }, 404);
  const rows = await c.env.DATA_DB.prepare(
    `SELECT id, revision_number AS revisionNumber, content_markdown AS contentMarkdown,
      change_source AS changeSource, created_at AS createdAt
     FROM workspace_note_revisions
     WHERE user_id = ? AND note_id = ?
     ORDER BY revision_number DESC`,
  ).bind(userId, c.req.param("noteId")).all();
  return c.json({ revisions: rows.results ?? [] });
});

workspaceRoute.post("/notes/:noteId/revisions/:revisionId/restore", async (c) => {
  const userId = requireUserId(c.req.raw);
  const workspace = await ensureDefaultWorkspace(c.env, userId);
  const noteId = c.req.param("noteId");
  const current = await readNote(c.env, userId, workspace.id, noteId);
  if (!current) return c.json({ error: "not_found" }, 404);
  const revision = await c.env.DATA_DB.prepare(
    `SELECT id, content_markdown AS contentMarkdown
     FROM workspace_note_revisions
     WHERE id = ? AND note_id = ? AND user_id = ?`,
  ).bind(c.req.param("revisionId"), noteId, userId).first<{ id: string; contentMarkdown: string }>();
  if (!revision) return c.json({ error: "revision_not_found" }, 404);
  const nextRevision = current.revisionNumber + 1;
  const now = new Date().toISOString();
  await c.env.DATA_DB.prepare(
    `UPDATE workspace_notes SET
      content_markdown = ?,
      excerpt = ?,
      revision_number = ?,
      updated_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
  ).bind(revision.contentMarkdown, makeExcerpt(revision.contentMarkdown), nextRevision, now, noteId, userId, workspace.id).run();
  await insertNoteRevision(c.env, userId, noteId, nextRevision, revision.contentMarkdown, "restore");
  return c.json({ note: await readNote(c.env, userId, workspace.id, noteId) });
});

workspaceRoute.get("/notes/:noteId/export.md", async (c) => {
  const userId = requireUserId(c.req.raw);
  const workspace = await ensureDefaultWorkspace(c.env, userId);
  const note = await readNote(c.env, userId, workspace.id, c.req.param("noteId"));
  if (!note) return c.json({ error: "not_found" }, 404);
  return new Response(note.contentMarkdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${sanitizeFilename(note.filename)}"`,
    },
  });
});

workspaceRoute.get("/tasks", async (c) => {
  const userId = requireUserId(c.req.raw);
  const workspace = await ensureDefaultWorkspace(c.env, userId);
  const projectId = c.req.query("projectId");
  const status = c.req.query("status");
  const query = projectId
    ? c.env.DATA_DB.prepare(taskSelectSql("AND project_id = ?", status)).bind(userId, workspace.id, projectId, ...(status ? [status] : []))
    : c.env.DATA_DB.prepare(taskSelectSql("", status)).bind(userId, workspace.id, ...(status ? [status] : []));
  const rows = await query.all<Record<string, unknown>>();
  return c.json({ tasks: await attachTaskNoteIds(c.env, userId, rows.results ?? []) });
});

workspaceRoute.post("/tasks", async (c) => {
  const userId = requireUserId(c.req.raw);
  const workspace = await ensureDefaultWorkspace(c.env, userId);
  const body = await readJson(c.req.raw);
  const projectId = requiredText(body.projectId, "projectId");
  if (!await ownsProject(c.env, userId, workspace.id, projectId)) return c.json({ error: "project_not_found" }, 404);
  const now = new Date().toISOString();
  const id = optionalText(body.id) ?? `wtask_${crypto.randomUUID()}`;
  await c.env.DATA_DB.prepare(
    `INSERT INTO workspace_tasks (
      id, workspace_id, project_id, user_id, parent_task_id, title, description_markdown,
      status, priority, start_at, due_at, reminder_at, estimated_minutes, sort_order,
      properties_json, ai_execution_state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
  ).bind(
    id,
    workspace.id,
    projectId,
    userId,
    nullableText(body.parentTaskId),
    requiredText(body.title, "title"),
    typeof body.descriptionMarkdown === "string" ? body.descriptionMarkdown : "",
    parseTaskStatus(body.status),
    parseTaskPriority(body.priority),
    nullableText(body.startAt),
    nullableText(body.dueAt),
    nullableText(body.reminderAt),
    body.estimatedMinutes === undefined ? null : Number(body.estimatedMinutes),
    numberOrZero(body.sortOrder),
    nullableText(body.aiExecutionState),
    now,
    now,
  ).run();
  await linkTaskNotes(c.env, userId, workspace.id, id, readStringArray(body.noteIds));
  return c.json({ task: await readTask(c.env, userId, workspace.id, id) }, 201);
});

workspaceRoute.patch("/tasks/:taskId", async (c) => {
  const userId = requireUserId(c.req.raw);
  const workspace = await ensureDefaultWorkspace(c.env, userId);
  const taskId = c.req.param("taskId");
  if (!await readTask(c.env, userId, workspace.id, taskId)) return c.json({ error: "not_found" }, 404);
  const body = await readJson(c.req.raw);
  const status = body.status === undefined ? null : parseTaskStatus(body.status);
  const now = new Date().toISOString();
  await c.env.DATA_DB.prepare(
    `UPDATE workspace_tasks SET
      title = COALESCE(?, title),
      description_markdown = COALESCE(?, description_markdown),
      status = COALESCE(?, status),
      priority = COALESCE(?, priority),
      due_at = COALESCE(?, due_at),
      reminder_at = COALESCE(?, reminder_at),
      completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, ?) WHEN ? IS NOT NULL AND ? != 'completed' THEN NULL ELSE completed_at END,
      updated_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
  ).bind(
    optionalText(body.title),
    optionalText(body.descriptionMarkdown),
    status,
    body.priority === undefined ? null : parseTaskPriority(body.priority),
    nullableTextPatch(body, "dueAt"),
    nullableTextPatch(body, "reminderAt"),
    status,
    now,
    status,
    status,
    now,
    taskId,
    userId,
    workspace.id,
  ).run();
  if (Array.isArray(body.noteIds)) await linkTaskNotes(c.env, userId, workspace.id, taskId, readStringArray(body.noteIds));
  return c.json({ task: await readTask(c.env, userId, workspace.id, taskId) });
});

workspaceRoute.delete("/tasks/:taskId", async (c) => {
  const userId = requireUserId(c.req.raw);
  const workspace = await ensureDefaultWorkspace(c.env, userId);
  const now = new Date().toISOString();
  const result = await c.env.DATA_DB.prepare(
    `UPDATE workspace_tasks SET deleted_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
  ).bind(now, now, c.req.param("taskId"), userId, workspace.id).run();
  return c.json({ deleted: result.meta.changes > 0 });
});

workspaceRoute.post("/ai/context/preview", async (c) => {
  const userId = requireUserId(c.req.raw);
  const workspace = await ensureDefaultWorkspace(c.env, userId);
  const body = await readJson(c.req.raw);
  const primaryType = requiredText(body.primaryType, "primaryType");
  const primaryId = requiredText(body.primaryId, "primaryId");
  const item = primaryType === "task"
    ? await readTask(c.env, userId, workspace.id, primaryId)
    : primaryType === "note"
      ? await readNote(c.env, userId, workspace.id, primaryId)
      : primaryType === "project"
        ? await readProject(c.env, userId, workspace.id, primaryId)
        : null;
  if (!item) return c.json({ error: "not_found" }, 404);
  const projectId = "projectId" in item ? String(item.projectId) : "id" in item ? String(item.id) : null;
  const project = projectId ? await readProject(c.env, userId, workspace.id, projectId) : null;
  const linkedNotes = primaryType === "task"
    ? await readLinkedNotes(c.env, userId, workspace.id, primaryId)
    : primaryType === "note"
      ? [item]
      : [];
  return c.json({
    workspace: { id: workspace.id },
    project,
    primaryItem: { type: primaryType, id: primaryId, title: "title" in item ? item.title : project?.name },
    notes: linkedNotes,
    tasks: primaryType === "project" && projectId ? (await readProjectTasks(c.env, userId, workspace.id, projectId)).slice(0, 20) : [],
    attachments: [],
    links: [],
    instructions: project?.defaultAiInstructions ? [{ scope: "project", content: project.defaultAiInstructions }] : [],
    tokenEstimate: estimateTokens(JSON.stringify({ item, linkedNotes })),
    excludedItems: [],
    warnings: linkedNotes.length === 0 && primaryType === "task" ? ["No linked Markdown notes were found for this task."] : [],
  });
});

async function ensureDefaultWorkspace(env: Env, userId: string) {
  const existing = await env.DATA_DB.prepare(
    "SELECT id, owner_user_id AS ownerUserId, name, created_at AS createdAt, updated_at AS updatedAt FROM workspaces WHERE owner_user_id = ? ORDER BY created_at ASC LIMIT 1",
  ).bind(userId).first<{ id: string; ownerUserId: string; name: string; createdAt: string; updatedAt: string }>();
  if (existing) return existing;
  const id = `wks_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await env.DATA_DB.prepare(
    "INSERT INTO workspaces (id, owner_user_id, name, settings_json, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?)",
  ).bind(id, userId, "Personal Workspace", now, now).run();
  return { id, ownerUserId: userId, name: "Personal Workspace", createdAt: now, updatedAt: now };
}

async function ownsProject(env: Env, userId: string, workspaceId: string, projectId: string): Promise<boolean> {
  const row = await env.DATA_DB.prepare(
    "SELECT id FROM workspace_projects WHERE id = ? AND user_id = ? AND workspace_id = ? AND deleted_at IS NULL",
  ).bind(projectId, userId, workspaceId).first();
  return Boolean(row);
}

function readProject(env: Env, userId: string, workspaceId: string, projectId: string) {
  return env.DATA_DB.prepare(
    `SELECT id, workspace_id AS workspaceId, name, description, icon, accent, status,
      priority, is_favorite AS isFavorite, is_archived AS isArchived,
      default_ai_instructions AS defaultAiInstructions,
      default_context_markdown AS defaultContextMarkdown,
      sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt,
      last_opened_at AS lastOpenedAt
     FROM workspace_projects
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
  ).bind(projectId, userId, workspaceId).first<Record<string, unknown>>();
}

function readNote(env: Env, userId: string, workspaceId: string, noteId: string) {
  return env.DATA_DB.prepare(
    `SELECT id, workspace_id AS workspaceId, project_id AS projectId, title, filename,
      content_markdown AS contentMarkdown, excerpt, note_type AS noteType,
      is_pinned AS isPinned, is_favorite AS isFavorite, is_archived AS isArchived,
      revision_number AS revisionNumber, created_at AS createdAt, updated_at AS updatedAt
     FROM workspace_notes
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
  ).bind(noteId, userId, workspaceId).first<{
    id: string; projectId: string; title: string; filename: string; contentMarkdown: string; revisionNumber: number;
  } & Record<string, unknown>>();
}

async function readTask(env: Env, userId: string, workspaceId: string, taskId: string) {
  const task = await env.DATA_DB.prepare(
    `SELECT id, workspace_id AS workspaceId, project_id AS projectId, parent_task_id AS parentTaskId,
      title, description_markdown AS descriptionMarkdown, status, priority, start_at AS startAt,
      due_at AS dueAt, reminder_at AS reminderAt, completed_at AS completedAt,
      estimated_minutes AS estimatedMinutes, ai_execution_state AS aiExecutionState,
      created_at AS createdAt, updated_at AS updatedAt
     FROM workspace_tasks
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
  ).bind(taskId, userId, workspaceId).first<Record<string, unknown>>();
  if (!task) return null;
  const noteIds = await readTaskNoteIds(env, userId, String(task.id));
  return { ...task, noteIds };
}

async function insertNoteRevision(env: Env, userId: string, noteId: string, revisionNumber: number, contentMarkdown: string, changeSource: string) {
  await env.DATA_DB.prepare(
    `INSERT OR IGNORE INTO workspace_note_revisions (
      id, note_id, user_id, revision_number, content_markdown, frontmatter_json, change_source, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
  ).bind(`wnrev_${crypto.randomUUID()}`, noteId, userId, revisionNumber, contentMarkdown, changeSource, userId, new Date().toISOString()).run();
}

async function linkTaskNotes(env: Env, userId: string, workspaceId: string, taskId: string, noteIds: string[]) {
  await env.DATA_DB.prepare("DELETE FROM workspace_task_note_links WHERE task_id = ? AND user_id = ?").bind(taskId, userId).run();
  for (const noteId of noteIds) {
    const note = await readNote(env, userId, workspaceId, noteId);
    if (!note) continue;
    await env.DATA_DB.prepare(
      "INSERT OR IGNORE INTO workspace_task_note_links (task_id, note_id, user_id, created_at) VALUES (?, ?, ?, ?)",
    ).bind(taskId, noteId, userId, new Date().toISOString()).run();
  }
}

async function readTaskNoteIds(env: Env, userId: string, taskId: string): Promise<string[]> {
  const rows = await env.DATA_DB.prepare(
    "SELECT note_id AS noteId FROM workspace_task_note_links WHERE task_id = ? AND user_id = ? ORDER BY created_at ASC",
  ).bind(taskId, userId).all<{ noteId: string }>();
  return (rows.results ?? []).map((row) => row.noteId);
}

async function attachTaskNoteIds(env: Env, userId: string, tasks: Record<string, unknown>[]) {
  return Promise.all(tasks.map(async (task) => ({
    ...task,
    noteIds: await readTaskNoteIds(env, userId, String(task.id)),
  })));
}

async function readLinkedNotes(env: Env, userId: string, workspaceId: string, taskId: string) {
  const rows = await env.DATA_DB.prepare(
    `SELECT n.id, n.project_id AS projectId, n.title, n.filename, n.content_markdown AS contentMarkdown,
      n.excerpt, n.revision_number AS revisionNumber, n.updated_at AS updatedAt
     FROM workspace_notes n
     JOIN workspace_task_note_links l ON l.note_id = n.id AND l.user_id = n.user_id
     WHERE l.task_id = ? AND n.user_id = ? AND n.workspace_id = ? AND n.deleted_at IS NULL
     ORDER BY n.updated_at DESC`,
  ).bind(taskId, userId, workspaceId).all();
  return rows.results ?? [];
}

async function readProjectTasks(env: Env, userId: string, workspaceId: string, projectId: string) {
  const rows = await env.DATA_DB.prepare(taskSelectSql("AND project_id = ?", undefined))
    .bind(userId, workspaceId, projectId)
    .all<Record<string, unknown>>();
  return attachTaskNoteIds(env, userId, rows.results ?? []);
}

function taskSelectSql(extra: string, status: string | undefined) {
  return `SELECT id, workspace_id AS workspaceId, project_id AS projectId, parent_task_id AS parentTaskId,
    title, description_markdown AS descriptionMarkdown, status, priority, start_at AS startAt,
    due_at AS dueAt, reminder_at AS reminderAt, completed_at AS completedAt,
    estimated_minutes AS estimatedMinutes, ai_execution_state AS aiExecutionState,
    created_at AS createdAt, updated_at AS updatedAt
   FROM workspace_tasks
   WHERE user_id = ? AND workspace_id = ? AND deleted_at IS NULL ${extra} ${status ? "AND status = ?" : ""}
   ORDER BY due_at IS NULL, due_at ASC, sort_order ASC, updated_at DESC LIMIT 200`;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => ({}));
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name}_required`);
  return value.trim();
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableTextPatch(body: Record<string, unknown>, key: string): string | null {
  return Object.hasOwn(body, key) && typeof body[key] === "string" ? body[key] : null;
}

function boolInt(value: unknown): number {
  return value === true ? 1 : 0;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseProjectStatus(value: unknown): ProjectStatus {
  return typeof value === "string" && PROJECT_STATUSES.has(value as ProjectStatus) ? value as ProjectStatus : "active";
}

function parseTaskStatus(value: unknown): TaskStatus {
  return typeof value === "string" && TASK_STATUSES.has(value as TaskStatus) ? value as TaskStatus : "planned";
}

function parseTaskPriority(value: unknown): TaskPriority {
  return typeof value === "string" && TASK_PRIORITIES.has(value as TaskPriority) ? value as TaskPriority : "none";
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function sanitizeFilename(value: string): string {
  const base = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "note";
  return base.endsWith(".md") ? base : `${base}.md`;
}

function makeExcerpt(markdown: string): string {
  return markdown.replace(/[#>*_`[\]()!-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}
