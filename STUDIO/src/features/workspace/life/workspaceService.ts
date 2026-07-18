import { apiManager } from "@/core/network/apiManager";
import { logger } from "@/core/logging/logger";
import { tokenManager } from "@/lib/tokenManager";
import { chat } from "@/features/chat/services/chatService";
import type {
  LifeWorkspace,
  OrganizedCapture,
  WorkspaceContextPreview,
  WorkspaceNote,
  WorkspaceNoteRevision,
  WorkspaceProject,
  WorkspaceSnapshot,
  WorkspaceSource,
  WorkspaceTask,
} from "./types";

const STORAGE_KEY = "studio.workspace.local.v1";

type LocalStore = WorkspaceSnapshot & { source: WorkspaceSource; noteRevisions: Record<string, WorkspaceNoteRevision[]> };

function nowIso() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function excerpt(markdown: string) {
  return markdown.replace(/[#>*_`[\]()!-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 220);
}

function slug(value: string) {
  const base = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "note";
  return base.endsWith(".md") ? base : `${base}.md`;
}

function seedStore(userId: string): LocalStore {
  const t = nowIso();
  const workspace: LifeWorkspace = {
    id: "local_workspace",
    ownerUserId: userId || "local_user",
    name: "Personal Workspace",
    createdAt: t,
    updatedAt: t,
  };
  const project: WorkspaceProject = {
    id: "local_project_studio",
    workspaceId: workspace.id,
    name: "STUDIO",
    description: "A place to shape the workspace system without polluting production data.",
    icon: "S",
    accent: "#4f7cff",
    status: "active",
    priority: "medium",
    isFavorite: true,
    isArchived: false,
    defaultAiInstructions: "Preserve meaning. Organize thoughts into portable Markdown and clear next actions.",
    defaultContextMarkdown: "This is local test data. Cloud remains the intended source of truth.",
    sortOrder: 0,
    createdAt: t,
    updatedAt: t,
    lastOpenedAt: t,
  };
  const note: WorkspaceNote = {
    id: "local_note_intent",
    workspaceId: workspace.id,
    projectId: project.id,
    title: "Workspace Intent",
    filename: "workspace-intent.md",
    contentMarkdown: "# Workspace Intent\n\nBuild a calm personal workspace for projects, Markdown notes, tasks, and AI-assisted organization.\n\n- Markdown is the recoverable source.\n- Cloud is source of truth.\n- Local storage is only a test and recovery layer.",
    excerpt: "Build a calm personal workspace for projects, Markdown notes, tasks, and AI-assisted organization.",
    noteType: "decision",
    isPinned: true,
    isFavorite: false,
    revisionNumber: 1,
    createdAt: t,
    updatedAt: t,
  };
  const task: WorkspaceTask = {
    id: "local_task_first",
    workspaceId: workspace.id,
    projectId: project.id,
    title: "Test project, note, task, and capture flow",
    descriptionMarkdown: "Use the local adapter until the Workspace worker is deployed.",
    status: "planned",
    priority: "medium",
    noteIds: ["local_note_intent"],
    createdAt: t,
    updatedAt: t,
  };
  return {
    source: "local",
    workspace,
    projects: [project],
    notes: [note],
    tasks: [task],
    noteRevisions: {
      [note.id]: [{
        id: "local_rev_intent_1",
        noteId: note.id,
        revisionNumber: 1,
        contentMarkdown: note.contentMarkdown,
        changeSource: "seed",
        createdAt: t,
      }],
    },
  };
}

function readLocal(userId: string): LocalStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalStore;
      if (!parsed.noteRevisions) {
        parsed.noteRevisions = Object.fromEntries(parsed.notes.map((note) => [note.id, [{
          id: id("local_rev"),
          noteId: note.id,
          revisionNumber: note.revisionNumber,
          contentMarkdown: note.contentMarkdown,
          changeSource: "migration",
          createdAt: note.updatedAt,
        }]]));
        writeLocal(parsed);
      }
      return parsed;
    }
  } catch {
    /* ignore corrupt local test state */
  }
  const seeded = seedStore(userId);
  writeLocal(seeded);
  return seeded;
}

function writeLocal(store: LocalStore) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

async function workspaceBaseUrl() {
  const endpoints = await apiManager.getEndpoints();
  return endpoints.cloud.workspace;
}

async function cloudRequest<T>(path = "", init: RequestInit = {}): Promise<T> {
  const token = await tokenManager.getAccessToken();
  if (!token) throw new Error("not_authenticated");
  const base = await workspaceBaseUrl();
  if (!base) throw new Error("workspace_api_not_configured");
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.error === "string" ? body.error : `workspace_api_${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const workspaceService = {
  resetLocal(userId: string) {
    const seeded = seedStore(userId);
    writeLocal(seeded);
    return seeded;
  },

  async loadSnapshot(userId: string, forceLocal = false): Promise<WorkspaceSnapshot & { source: WorkspaceSource; warning?: string }> {
    if (forceLocal) return readLocal(userId);
    try {
      const [{ workspace }, { projects }] = await Promise.all([
        cloudRequest<{ workspace: LifeWorkspace }>(),
        cloudRequest<{ projects: WorkspaceProject[] }>("/projects"),
      ]);
      const projectIds = projects.map((project) => project.id);
      const noteGroups = await Promise.all(
        projectIds.map((projectId) => cloudRequest<{ notes: WorkspaceNote[] }>(`/projects/${projectId}/notes`)),
      );
      const { tasks } = await cloudRequest<{ tasks: WorkspaceTask[] }>("/tasks");
      return { source: "cloud", workspace, projects, notes: noteGroups.flatMap((group) => group.notes), tasks };
    } catch (error) {
      logger.warn("Workspace", "Using local Workspace test adapter", error);
      return { ...readLocal(userId), warning: error instanceof Error ? error.message : "cloud_unavailable" };
    }
  },

  async createProject(userId: string, draft: Pick<WorkspaceProject, "name"> & Partial<WorkspaceProject>, source: WorkspaceSource) {
    if (source === "cloud") {
      const { project } = await cloudRequest<{ project: WorkspaceProject }>("/projects", {
        method: "POST",
        body: JSON.stringify(draft),
      });
      return project;
    }
    const store = readLocal(userId);
    const t = nowIso();
    const project: WorkspaceProject = {
      id: id("local_project"),
      workspaceId: store.workspace.id,
      name: draft.name,
      description: draft.description ?? "",
      icon: draft.icon ?? draft.name.slice(0, 1).toUpperCase(),
      accent: draft.accent ?? "#4f7cff",
      status: draft.status ?? "active",
      priority: draft.priority ?? "none",
      isFavorite: false,
      isArchived: false,
      defaultAiInstructions: draft.defaultAiInstructions ?? "",
      defaultContextMarkdown: draft.defaultContextMarkdown ?? "",
      sortOrder: store.projects.length,
      createdAt: t,
      updatedAt: t,
      lastOpenedAt: t,
    };
    store.projects.unshift(project);
    writeLocal(store);
    return project;
  },

  async createNote(userId: string, projectId: string, draft: { title: string; contentMarkdown: string; noteType?: string }, source: WorkspaceSource) {
    if (source === "cloud") {
      const { note } = await cloudRequest<{ note: WorkspaceNote }>(`/projects/${projectId}/notes`, {
        method: "POST",
        body: JSON.stringify(draft),
      });
      return note;
    }
    const store = readLocal(userId);
    const t = nowIso();
    const note: WorkspaceNote = {
      id: id("local_note"),
      workspaceId: store.workspace.id,
      projectId,
      title: draft.title,
      filename: slug(draft.title),
      contentMarkdown: draft.contentMarkdown,
      excerpt: excerpt(draft.contentMarkdown),
      noteType: draft.noteType ?? "standard",
      isPinned: false,
      isFavorite: false,
      revisionNumber: 1,
      createdAt: t,
      updatedAt: t,
    };
    store.notes.unshift(note);
    store.noteRevisions[note.id] = [{
      id: id("local_rev"),
      noteId: note.id,
      revisionNumber: 1,
      contentMarkdown: note.contentMarkdown,
      changeSource: "user",
      createdAt: t,
    }];
    writeLocal(store);
    return note;
  },

  async updateNote(userId: string, note: WorkspaceNote, patch: Partial<WorkspaceNote>, source: WorkspaceSource) {
    if (source === "cloud") {
      const { note: updated } = await cloudRequest<{ note: WorkspaceNote }>(`/notes/${note.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...patch,
          expectedRevisionNumber: note.revisionNumber,
        }),
      });
      return updated;
    }
    const store = readLocal(userId);
    const t = nowIso();
    const updated = {
      ...note,
      ...patch,
      filename: patch.title && !patch.filename ? slug(patch.title) : patch.filename ?? note.filename,
      excerpt: patch.contentMarkdown ? excerpt(patch.contentMarkdown) : note.excerpt,
      revisionNumber: patch.contentMarkdown && patch.contentMarkdown !== note.contentMarkdown ? note.revisionNumber + 1 : note.revisionNumber,
      updatedAt: t,
    };
    store.notes = store.notes.map((item) => item.id === note.id ? updated : item);
    if (updated.revisionNumber !== note.revisionNumber) {
      const changeSource = (patch as { changeSource?: string }).changeSource ?? "user";
      store.noteRevisions[note.id] = [{
        id: id("local_rev"),
        noteId: note.id,
        revisionNumber: updated.revisionNumber,
        contentMarkdown: updated.contentMarkdown,
        changeSource,
        createdAt: t,
      }, ...(store.noteRevisions[note.id] ?? [])];
    }
    writeLocal(store);
    return updated;
  },

  async listNoteRevisions(userId: string, noteId: string, source: WorkspaceSource) {
    if (source === "cloud") {
      const { revisions } = await cloudRequest<{ revisions: WorkspaceNoteRevision[] }>(`/notes/${noteId}/revisions`);
      return revisions;
    }
    const store = readLocal(userId);
    return store.noteRevisions[noteId] ?? [];
  },

  async restoreNoteRevision(userId: string, note: WorkspaceNote, revision: WorkspaceNoteRevision, source: WorkspaceSource) {
    if (source === "cloud") {
      const { note: restored } = await cloudRequest<{ note: WorkspaceNote }>(`/notes/${note.id}/revisions/${revision.id}/restore`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      return restored;
    }
    return this.updateNote(userId, note, { contentMarkdown: revision.contentMarkdown, changeSource: "restore" } as Partial<WorkspaceNote>, source);
  },

  async previewContext(
    userId: string,
    primaryType: WorkspaceContextPreview["primaryItem"]["type"],
    primaryId: string,
    source: WorkspaceSource,
  ): Promise<WorkspaceContextPreview> {
    if (source === "cloud") {
      return cloudRequest<WorkspaceContextPreview>("/ai/context/preview", {
        method: "POST",
        body: JSON.stringify({ primaryType, primaryId }),
      });
    }
    const store = readLocal(userId);
    const project = primaryType === "project"
      ? store.projects.find((item) => item.id === primaryId) ?? null
      : primaryType === "note"
        ? store.projects.find((item) => item.id === store.notes.find((note) => note.id === primaryId)?.projectId) ?? null
        : store.projects.find((item) => item.id === store.tasks.find((task) => task.id === primaryId)?.projectId) ?? null;
    const primaryNote = primaryType === "note" ? store.notes.find((note) => note.id === primaryId) : null;
    const primaryTask = primaryType === "task" ? store.tasks.find((task) => task.id === primaryId) : null;
    const linkedNotes = primaryTask
      ? store.notes.filter((note) => primaryTask.noteIds?.includes(note.id))
      : primaryNote
        ? [primaryNote]
        : [];
    const projectTasks = primaryType === "project" && project
      ? store.tasks.filter((task) => task.projectId === project.id).slice(0, 20)
      : [];
    const payload = JSON.stringify({ primaryNote, primaryTask, linkedNotes, projectTasks });
    return {
      workspace: { id: store.workspace.id },
      project,
      primaryItem: {
        type: primaryType,
        id: primaryId,
        title: primaryNote?.title ?? primaryTask?.title ?? project?.name ?? null,
      },
      notes: linkedNotes,
      tasks: projectTasks,
      attachments: [],
      links: [],
      instructions: project?.defaultAiInstructions ? [{ scope: "project", content: project.defaultAiInstructions }] : [],
      tokenEstimate: Math.ceil(payload.length / 4),
      excludedItems: [],
      warnings: linkedNotes.length === 0 && primaryType === "task" ? ["No linked Markdown notes were found for this task."] : [],
    };
  },

  async createTask(userId: string, draft: { projectId: string; title: string; descriptionMarkdown?: string; dueAt?: string | null; priority?: WorkspaceTask["priority"]; noteIds?: string[] }, source: WorkspaceSource) {
    if (source === "cloud") {
      const { task } = await cloudRequest<{ task: WorkspaceTask }>("/tasks", {
        method: "POST",
        body: JSON.stringify({ status: "planned", priority: "none", ...draft }),
      });
      return { ...task, noteIds: draft.noteIds ?? task.noteIds };
    }
    const store = readLocal(userId);
    const t = nowIso();
    const task: WorkspaceTask = {
      id: id("local_task"),
      workspaceId: store.workspace.id,
      projectId: draft.projectId,
      title: draft.title,
      descriptionMarkdown: draft.descriptionMarkdown ?? "",
      status: "planned",
      priority: draft.priority ?? "none",
      dueAt: draft.dueAt,
      noteIds: draft.noteIds ?? [],
      createdAt: t,
      updatedAt: t,
    };
    store.tasks.unshift(task);
    writeLocal(store);
    return task;
  },

  async updateTask(userId: string, taskId: string, patch: Partial<WorkspaceTask>, source: WorkspaceSource) {
    if (source === "cloud") {
      const { task } = await cloudRequest<{ task: WorkspaceTask }>(`/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      return { ...task, noteIds: patch.noteIds ?? task.noteIds };
    }
    const store = readLocal(userId);
    let updated: WorkspaceTask | null = null;
    store.tasks = store.tasks.map((task) => {
      if (task.id !== taskId) return task;
      updated = { ...task, ...patch, updatedAt: nowIso() };
      return updated;
    });
    writeLocal(store);
    if (!updated) throw new Error("task_not_found");
    return updated;
  },

  async organizeCapture(input: string, projects: WorkspaceProject[]): Promise<OrganizedCapture> {
    const projectList = projects.map((project) => `- ${project.name}: ${project.description ?? ""}`).join("\n");
    const response = await chat([
      {
        role: "system",
        content: `You organize raw personal workspace captures. Preserve meaning exactly. Do not invent facts, dates, priorities, projects, or commitments. Clean wording only when it removes filler without changing intent. Return strict JSON with: title, markdown, tasks, tags, projectHint, confidence. Markdown must be portable Markdown. Tasks must be concrete actions explicitly present or strongly implied by the user. Use null for uncertain dates.`,
      },
      {
        role: "user",
        content: `Existing projects:\n${projectList || "- None"}\n\nRaw capture:\n"""${input}"""`,
      },
    ], "auto", { temperature: 0.15, max_tokens: 1800, direct: true });
    if (!response.success || !response.data) throw new Error(response.error ?? "organize_failed");
    const jsonMatch = response.data.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("organize_invalid_json");
    const parsed = JSON.parse(jsonMatch[0]) as OrganizedCapture;
    return {
      title: parsed.title || "Captured Thought",
      markdown: parsed.markdown || input,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      projectHint: parsed.projectHint ?? null,
      confidence: parsed.confidence ?? "medium",
    };
  },
};
