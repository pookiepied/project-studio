export type WorkspaceSource = "cloud" | "local";

export interface LifeWorkspace {
  id: string;
  ownerUserId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceProject {
  id: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  accent?: string | null;
  status: "active" | "planning" | "paused" | "completed" | "archived";
  priority?: string | null;
  isFavorite: number | boolean;
  isArchived: number | boolean;
  defaultAiInstructions?: string | null;
  defaultContextMarkdown?: string | null;
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string | null;
}

export interface WorkspaceNote {
  id: string;
  workspaceId: string;
  projectId: string;
  title: string;
  filename: string;
  contentMarkdown: string;
  excerpt?: string | null;
  noteType?: string;
  isPinned?: number | boolean;
  isFavorite?: number | boolean;
  isArchived?: number | boolean;
  revisionNumber: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceTask {
  id: string;
  workspaceId: string;
  projectId: string;
  parentTaskId?: string | null;
  title: string;
  descriptionMarkdown: string;
  status: "inbox" | "planned" | "in_progress" | "blocked" | "waiting" | "completed" | "cancelled";
  priority: "none" | "low" | "medium" | "high" | "critical";
  startAt?: string | null;
  dueAt?: string | null;
  reminderAt?: string | null;
  completedAt?: string | null;
  estimatedMinutes?: number | null;
  aiExecutionState?: string | null;
  noteIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceNoteRevision {
  id: string;
  noteId?: string;
  revisionNumber: number;
  contentMarkdown: string;
  changeSource: string;
  createdAt: string;
}

export interface WorkspaceContextPreview {
  workspace: { id: string };
  project?: WorkspaceProject | null;
  primaryItem: { type: "project" | "note" | "task"; id: string; title?: string | null };
  notes: WorkspaceNote[];
  tasks: WorkspaceTask[];
  attachments: Array<Record<string, unknown>>;
  links: Array<Record<string, unknown>>;
  instructions: Array<{ scope: string; content: string }>;
  tokenEstimate: number;
  excludedItems: string[];
  warnings: string[];
}

export interface WorkspaceSnapshot {
  workspace: LifeWorkspace;
  projects: WorkspaceProject[];
  notes: WorkspaceNote[];
  tasks: WorkspaceTask[];
}

export interface OrganizedCapture {
  title: string;
  markdown: string;
  tasks: Array<{ title: string; descriptionMarkdown?: string; dueAt?: string | null; priority?: WorkspaceTask["priority"] }>;
  tags: string[];
  projectHint?: string | null;
  confidence: "low" | "medium" | "high";
}
