import { AnimatePresence, motion } from "framer-motion";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import {
  Add,
  Calendar,
  Check,
  Clock,
  Cloud,
  Code,
  Copy,
  Document,
  Eye,
  FolderOpen,
  List,
  More,
  Redo,
  Refresh,
  Search,
  Spinner,
  Warning,
} from "@/ui/icons";
import { Button } from "@/ui/primitives/Button";
import { Input } from "@/ui/primitives/Input";
import { Textarea } from "@/ui/primitives/Textarea";
import { useAuth } from "@/features/auth/context/AuthContext";
import { markdownComponents } from "@/features/markdown";
import { workspaceService } from "@/features/workspace/life/workspaceService";
import type {
  OrganizedCapture,
  WorkspaceContextPreview,
  WorkspaceNote,
  WorkspaceNoteRevision,
  WorkspaceSnapshot,
  WorkspaceSource,
  WorkspaceTask,
} from "@/features/workspace/life/types";
import "./workspacePage.css";

type Surface = "notes" | "tasks";
type EditorMode = "write" | "preview" | "split";
type SaveState = "saved" | "dirty" | "saving" | "conflict" | "failed";

const CAPTURE_DRAFT_KEY = "studio.workspace.captureDraft.v1";
const ProjectShaderCover = lazy(() => import("./ProjectShaderCover").then((module) => ({ default: module.ProjectShaderCover })));

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function boolish(value: unknown) {
  return value === true || value === 1;
}

function relative(value?: string | null) {
  if (!value) return "";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "";
  const minutes = Math.max(1, Math.round((Date.now() - time) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function formatDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function noteSignature(note: Pick<WorkspaceNote, "title" | "contentMarkdown">) {
  return `${note.title}\n\n${note.contentMarkdown}`;
}

function makeStarterMarkdown(projectName: string) {
  return `# New note\n\nProject: ${projectName}\n\n`;
}

function downloadMarkdown(note: WorkspaceNote) {
  const blob = new Blob([note.contentMarkdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = note.filename || `${note.title || "note"}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function IconButton({ title, children, onClick, active }: { title: string; children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cx(
        "flex h-9 w-9 items-center justify-center rounded-full transition-colors",
        active ? "bg-primary text-on-emphasis" : "text-muted hover:bg-surface-hover hover:text-primary",
      )}
    >
      {children}
    </button>
  );
}

function FormatButton({ title, children, onClick }: { title: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full px-2 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-primary"
    >
      {children}
    </button>
  );
}

/*
function ProjectPicker({
  projects,
  selectedProject,
  open,
  onOpenChange,
  onSelect,
}: {
  projects: WorkspaceProject[];
  selectedProject?: WorkspaceProject;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (projectId: string) => void;
}) {
  return (
    <div className="relative hidden min-w-0 md:block">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={cx(
          "flex max-w-56 items-center gap-2 rounded-full border px-3 py-1.5 text-sm shadow-sm backdrop-blur-xl transition-colors",
          open
            ? "border-surface-border bg-surface-page text-primary"
            : "border-surface-divider bg-surface-base/75 text-secondary hover:bg-surface-hover hover:text-primary",
        )}
      >
        <Project size="xs" className="shrink-0 text-disabled" />
        <span className="min-w-0 truncate">{selectedProject?.name ?? "Project"}</span>
        <span className="shrink-0 text-2xs text-disabled">⌄</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="absolute left-0 top-11 z-40 w-72 overflow-hidden rounded-2xl border border-surface-divider bg-surface-page/96 p-1.5 shadow-2xl backdrop-blur-xl"
          >
            <div className="max-h-72 overflow-y-auto [scrollbar-width:none]">
              {projects.map((project) => {
                const active = project.id === selectedProject?.id;
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => {
                      onSelect(project.id);
                      onOpenChange(false);
                    }}
                    className={cx(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                      active ? "bg-surface-base text-primary" : "text-secondary hover:bg-surface-hover hover:text-primary",
                    )}
                  >
                    <span className={cx(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold",
                      active ? "bg-primary text-on-emphasis" : "bg-surface-base text-muted",
                    )}>
                      {(project.icon || project.name.slice(0, 1)).slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{project.name}</span>
                      {project.description && <span className="block truncate text-xs text-disabled">{project.description}</span>}
                    </span>
                    {active && <Check size="xs" className="shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
*/

export const WorkspacePage = () => {
  const { user } = useAuth();
  const userId = user?.id ?? "local_user";
  const [snapshot, setSnapshot] = useState<(WorkspaceSnapshot & { source: WorkspaceSource; warning?: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [forceLocal, setForceLocal] = useState(() => localStorage.getItem("studio.workspace.forceLocal") === "1");
  const [surface, setSurface] = useState<Surface>("notes");
  const [drawerOpen, setDrawerOpen] = useState(() => window.innerWidth >= 900);
  const [quickOpen, setQuickOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedNoteId, setSelectedNoteId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [editorMode, setEditorMode] = useState<EditorMode>("write");
  const [search, setSearch] = useState("");
  const [draftProjectName, setDraftProjectName] = useState("");
  const [draftTaskTitle, setDraftTaskTitle] = useState("");
  const [captureText, setCaptureText] = useState(() => {
    try {
      return localStorage.getItem(CAPTURE_DRAFT_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [organized, setOrganized] = useState<OrganizedCapture | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [noteRevisions, setNoteRevisions] = useState<WorkspaceNoteRevision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [contextPreview, setContextPreview] = useState<WorkspaceContextPreview | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const savedNoteSignatures = useRef(new Map<string, string>());
  const noteSaveTimer = useRef<number | null>(null);

  const projects = snapshot?.projects ?? [];
  const notes = snapshot?.notes ?? [];
  const tasks = snapshot?.tasks ?? [];
  const source = snapshot?.source ?? "local";
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0];
  const projectNotes = notes.filter((note) => note.projectId === selectedProject?.id);
  const projectTasks = tasks.filter((task) => task.projectId === selectedProject?.id);
  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? projectNotes[0];
  const selectedTask = projectTasks.find((task) => task.id === selectedTaskId) ?? projectTasks[0];
  const openTasks = projectTasks.filter((task) => task.status !== "completed" && task.status !== "cancelled");
  const completedTasks = projectTasks.filter((task) => task.status === "completed");

  const filteredNotes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projectNotes;
    return projectNotes.filter((note) => `${note.title} ${note.contentMarkdown}`.toLowerCase().includes(q));
  }, [projectNotes, search]);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    const scoped = [...openTasks, ...completedTasks];
    if (!q) return scoped;
    return scoped.filter((task) => `${task.title} ${task.descriptionMarkdown}`.toLowerCase().includes(q));
  }, [completedTasks, openTasks, search]);

  const load = async (local = forceLocal) => {
    setLoading(true);
    try {
      const next = await workspaceService.loadSnapshot(userId, local);
      setSnapshot(next);
      savedNoteSignatures.current = new Map(next.notes.map((note) => [note.id, noteSignature(note)]));
      setSelectedProjectId((current) => current || next.projects[0]?.id || "");
      setSelectedNoteId((current) => current || next.notes[0]?.id || "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load Workspace");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(forceLocal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceLocal, userId]);

  useEffect(() => {
    const handleCaptureText = (event: Event) => {
      const text = (event as CustomEvent<{ text?: string }>).detail?.text?.trim();
      if (!text) return;
      setCaptureText((current) => current.trim() ? `${current.trim()}\n\n${text}` : text);
      setQuickOpen(true);
      toast.success("Added to Quick Add");
    };
    window.addEventListener("workspace-capture-text", handleCaptureText);
    return () => window.removeEventListener("workspace-capture-text", handleCaptureText);
  }, []);

  useEffect(() => {
    try {
      if (captureText.trim()) localStorage.setItem(CAPTURE_DRAFT_KEY, captureText);
      else localStorage.removeItem(CAPTURE_DRAFT_KEY);
    } catch {
      /* best effort */
    }
  }, [captureText]);

  useEffect(() => {
    setContextPreview(null);
    if (!selectedNote) {
      setNoteRevisions([]);
      return;
    }
    void loadNoteRevisions(selectedNote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNote?.id, source]);

  useEffect(() => {
    if (!selectedNote) return;
    const signature = noteSignature(selectedNote);
    const savedSignature = savedNoteSignatures.current.get(selectedNote.id);
    if (!savedSignature) {
      savedNoteSignatures.current.set(selectedNote.id, signature);
      setSaveState("saved");
      return;
    }
    if (signature === savedSignature) {
      setSaveState("saved");
      return;
    }
    setSaveState("dirty");
    if (noteSaveTimer.current) window.clearTimeout(noteSaveTimer.current);
    const noteForSave = selectedNote;
    noteSaveTimer.current = window.setTimeout(() => {
      void saveNote(noteForSave, { title: noteForSave.title, contentMarkdown: noteForSave.contentMarkdown });
    }, 650);
    return () => {
      if (noteSaveTimer.current) window.clearTimeout(noteSaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNote?.id, selectedNote?.title, selectedNote?.contentMarkdown]);

  const createProject = async () => {
    if (!draftProjectName.trim()) return;
    setSaving(true);
    try {
      const project = await workspaceService.createProject(userId, {
        name: draftProjectName.trim(),
        description: "",
        status: "active",
      }, source);
      setSnapshot((current) => current ? { ...current, projects: [project, ...current.projects] } : current);
      setSelectedProjectId(project.id);
      setDraftProjectName("");
      toast.success("Project created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create project");
    } finally {
      setSaving(false);
    }
  };

  const createNote = async (contentMarkdown?: string, title = "Untitled") => {
    if (!selectedProject) return;
    setSaving(true);
    try {
      const note = await workspaceService.createNote(userId, selectedProject.id, {
        title,
        contentMarkdown: contentMarkdown ?? makeStarterMarkdown(selectedProject.name),
      }, source);
      savedNoteSignatures.current.set(note.id, noteSignature(note));
      setSnapshot((current) => current ? { ...current, notes: [note, ...current.notes] } : current);
      setSelectedNoteId(note.id);
      setSurface("notes");
      setQuickOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create note");
    } finally {
      setSaving(false);
    }
  };

  const saveNote = async (noteToSave: WorkspaceNote, patch: Partial<WorkspaceNote>) => {
    setSaveState("saving");
    try {
      const updated = await workspaceService.updateNote(userId, noteToSave, patch, source);
      const requestedSignature = noteSignature({ ...noteToSave, ...patch });
      savedNoteSignatures.current.set(updated.id, noteSignature(updated));
      setSnapshot((current) => current ? {
        ...current,
        notes: current.notes.map((note) => note.id === updated.id && noteSignature(note) === requestedSignature ? updated : note),
      } : current);
      setSaveState((current) => current === "saving" ? "saved" : current);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save note";
      setSaveState(message.includes("revision_conflict") ? "conflict" : "failed");
      toast.error(message);
    }
  };

  const updateNoteLocal = (patch: Partial<WorkspaceNote>) => {
    if (!selectedNote) return;
    setSnapshot((current) => current ? {
      ...current,
      notes: current.notes.map((note) => note.id === selectedNote.id ? { ...note, ...patch } : note),
    } : current);
  };

  const createTask = async (title = draftTaskTitle, descriptionMarkdown = "") => {
    if (!selectedProject || !title.trim()) return;
    setSaving(true);
    try {
      const task = await workspaceService.createTask(userId, {
        projectId: selectedProject.id,
        title: title.trim(),
        descriptionMarkdown,
        priority: "none",
        noteIds: selectedNote ? [selectedNote.id] : [],
      }, source);
      setSnapshot((current) => current ? { ...current, tasks: [task, ...current.tasks] } : current);
      setSelectedTaskId(task.id);
      setDraftTaskTitle("");
      setSurface("tasks");
      setQuickOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create task");
    } finally {
      setSaving(false);
    }
  };

  const toggleTask = async (task: WorkspaceTask) => {
    const status = task.status === "completed" ? "planned" : "completed";
    const updated = await workspaceService.updateTask(userId, task.id, { status }, source);
    setSnapshot((current) => current ? {
      ...current,
      tasks: current.tasks.map((item) => item.id === task.id ? updated : item),
    } : current);
  };

  const loadNoteRevisions = async (note = selectedNote) => {
    if (!note) return;
    setRevisionsLoading(true);
    try {
      setNoteRevisions(await workspaceService.listNoteRevisions(userId, note.id, source));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load revisions");
    } finally {
      setRevisionsLoading(false);
    }
  };

  const restoreRevision = async (revision: WorkspaceNoteRevision) => {
    if (!selectedNote) return;
    setSaving(true);
    try {
      const restored = await workspaceService.restoreNoteRevision(userId, selectedNote, revision, source);
      savedNoteSignatures.current.set(restored.id, noteSignature(restored));
      setSnapshot((current) => current ? {
        ...current,
        notes: current.notes.map((note) => note.id === restored.id ? restored : note),
      } : current);
      setSaveState("saved");
      await loadNoteRevisions(restored);
      toast.success("Revision restored");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not restore revision");
    } finally {
      setSaving(false);
    }
  };

  const previewContext = async () => {
    const primaryId = selectedTask?.id ?? selectedNote?.id ?? selectedProject?.id;
    const primaryType: WorkspaceContextPreview["primaryItem"]["type"] = selectedTask ? "task" : selectedNote ? "note" : "project";
    if (!primaryId) return;
    setContextLoading(true);
    try {
      setContextPreview(await workspaceService.previewContext(userId, primaryType, primaryId, source));
      setDetailsOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not preview context");
    } finally {
      setContextLoading(false);
    }
  };

  const organizeCapture = async () => {
    if (!captureText.trim()) return;
    setOrganizing(true);
    try {
      setOrganized(await workspaceService.organizeCapture(captureText, projects));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not organize");
    } finally {
      setOrganizing(false);
    }
  };

  const acceptOrganized = async () => {
    if (!organized) return;
    await createNote(organized.markdown, organized.title);
    for (const task of organized.tasks) await createTask(task.title, task.descriptionMarkdown ?? "");
    setCaptureText("");
    setOrganized(null);
  };

  const applyMarkdown = (kind: "bold" | "italic" | "heading" | "quote" | "code" | "bullet" | "number" | "task" | "link") => {
    if (!selectedNote || !editorRef.current) return;
    const textarea = editorRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = selectedNote.contentMarkdown.slice(0, start);
    const selected = selectedNote.contentMarkdown.slice(start, end);
    const after = selectedNote.contentMarkdown.slice(end);
    const prefixLine = (prefix: string) => {
      const lineStart = before.lastIndexOf("\n") + 1;
      const blockStart = selected ? start : lineStart;
      const block = selected || selectedNote.contentMarkdown.slice(lineStart, end);
      const replaced = block.split("\n").map((line) => `${prefix}${line}`).join("\n");
      updateNoteLocal({ contentMarkdown: `${selectedNote.contentMarkdown.slice(0, blockStart)}${replaced}${selectedNote.contentMarkdown.slice(end)}` });
      requestAnimationFrame(() => textarea.focus());
    };
    if (kind === "heading") return prefixLine("## ");
    if (kind === "quote") return prefixLine("> ");
    if (kind === "bullet") return prefixLine("- ");
    if (kind === "number") return prefixLine("1. ");
    if (kind === "task") return prefixLine("- [ ] ");
    let inserted = selected;
    if (kind === "bold") inserted = `**${selected || "bold text"}**`;
    if (kind === "italic") inserted = `_${selected || "italic text"}_`;
    if (kind === "code") inserted = selected.includes("\n") ? `\`\`\`\n${selected || "code"}\n\`\`\`` : `\`${selected || "code"}\``;
    if (kind === "link") inserted = `[${selected || "link text"}](url)`;
    updateNoteLocal({ contentMarkdown: `${before}${inserted}${after}` });
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, start + inserted.length);
    });
  };

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === "b") {
      event.preventDefault();
      applyMarkdown("bold");
    }
    if (key === "i") {
      event.preventDefault();
      applyMarkdown("italic");
    }
    if (key === "k") {
      event.preventDefault();
      applyMarkdown("link");
    }
  };

  const toggleLocalMode = () => {
    const next = !forceLocal;
    localStorage.setItem("studio.workspace.forceLocal", next ? "1" : "0");
    setForceLocal(next);
  };

  const resetLocal = () => {
    const next = workspaceService.resetLocal(userId);
    savedNoteSignatures.current = new Map(next.notes.map((note) => [note.id, noteSignature(note)]));
    setSnapshot(next);
    setSelectedProjectId(next.projects[0]?.id ?? "");
    setSelectedNoteId(next.notes[0]?.id ?? "");
    toast.success("Local test data reset");
  };

  if (loading || !snapshot) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-page text-primary">
        <div className="flex items-center gap-2 text-sm text-disabled">
          <Spinner size="sm" className="animate-spin" />
          Loading Workspace
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-root">
      <div className="workspace-aurora" aria-hidden="true"><span /><span /><span /></div>

      <header className="workspace-topbar">
        <div className="workspace-topbar__path">
          <IconButton title={drawerOpen ? "Hide library" : "Show library"} onClick={() => setDrawerOpen((value) => !value)} active={drawerOpen}>
            <List size="sm" />
          </IconButton>
          <span className="workspace-topbar__crumb">{selectedProject?.name ?? "Workspace"}</span>
          {surface === "notes" && selectedNote && <><span className="workspace-topbar__slash">/</span><span className="workspace-topbar__document">{selectedNote.title || "Untitled"}</span></>}
        </div>
        <div className="workspace-topbar__actions">
          <span className={cx("workspace-save-state", saveState !== "saved" && "is-active")}>
            {saveState === "saving" ? <Spinner size="xs" className="animate-spin" /> : source === "cloud" ? <Cloud size="xs" /> : <Warning size="xs" />}
            <span>{saveState === "saved" ? (source === "cloud" ? "Saved" : "Local") : saveState}</span>
          </span>
          <IconButton title="Refresh workspace" onClick={() => void load(forceLocal)}><Refresh size="sm" /></IconButton>
          <button type="button" className="workspace-quick-button" onClick={() => setQuickOpen(true)}><Add size="sm" /><span>Quick add</span></button>
        </div>
      </header>

      <div className="workspace-stage">
        <AnimatePresence initial={false}>
          {drawerOpen && (
            <motion.aside
              key="workspace-navigation"
              initial={{ opacity: 0, x: -24, width: 0 }}
              animate={{ opacity: 1, x: 0, width: "min(500px, 42vw)" }}
              exit={{ opacity: 0, x: -20, width: 0 }}
              transition={{ type: "spring", stiffness: 360, damping: 38, mass: 0.8 }}
              className="workspace-navigation"
            >
              <div className="workspace-projects">
                <div className="workspace-project-cover">
                  <Suspense fallback={<div className="workspace-project-cover__fallback" />}>
                    <ProjectShaderCover accent={selectedProject?.accent} />
                  </Suspense>
                  <div className="workspace-project-cover__scrim" />
                  <div className="workspace-project-cover__content">
                    <span>{selectedProject?.status ?? "active"}</span>
                    <strong>{selectedProject?.name ?? "Workspace"}</strong>
                    <small>{projectNotes.length} pages · {projectTasks.length} tasks</small>
                  </div>
                </div>
                <div className="workspace-projects__heading">
                  <span className="workspace-eyebrow">Projects</span>
                  <span className="workspace-project-count">{projects.length}</span>
                </div>
                <nav className="workspace-project-list" aria-label="Projects">
                  {projects.map((project, index) => {
                    const active = selectedProject?.id === project.id;
                    return (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => {
                          setSelectedProjectId(project.id);
                          setSelectedNoteId(notes.find((note) => note.projectId === project.id)?.id ?? "");
                        }}
                        className={cx("workspace-project", active && "is-active")}
                      >
                        <span className="workspace-project__icon" style={{ "--project-accent": project.accent || ["#7b8cff", "#d99b6c", "#7bb6a7"][index % 3] } as React.CSSProperties}>
                          <FolderOpen size="sm" weight={active ? "fill" : "regular"} />
                        </span>
                        <span className="workspace-project__copy"><strong>{project.name}</strong><small>{notes.filter((note) => note.projectId === project.id).length} pages · {tasks.filter((task) => task.projectId === project.id).length} tasks</small></span>
                        {boolish(project.isFavorite) && <span className="workspace-project__favorite">•</span>}
                      </button>
                    );
                  })}
                </nav>
                <div className="workspace-new-project">
                  <Input value={draftProjectName} onChange={(event) => setDraftProjectName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createProject(); }} placeholder="New project" className="workspace-new-project__input" />
                  <button type="button" title="Create project" onClick={createProject} disabled={!draftProjectName.trim() || saving}><Add size="xs" /></button>
                </div>
                <div className="workspace-source-controls">
                  <span>{source === "cloud" ? <Cloud size="xs" /> : <Warning size="xs" />}{source === "cloud" ? "Cloud sync" : "Local workspace"}</span>
                  <div><button type="button" onClick={toggleLocalMode}>{forceLocal ? "Try cloud" : "Use local"}</button><button type="button" onClick={resetLocal}>Reset</button></div>
                </div>
              </div>

              <div className="workspace-library">
                <div className="workspace-library__intro">
                  <span className="workspace-eyebrow">Project</span>
                  <h2>{selectedProject?.name ?? "Untitled project"}</h2>
                  <p>{selectedProject?.description || "Notes, decisions and next actions in one place."}</p>
                </div>
                <div className="workspace-surface-switch" role="tablist" aria-label="Workspace view">
                  <button type="button" role="tab" aria-selected={surface === "notes"} onClick={() => setSurface("notes")} className={surface === "notes" ? "is-active" : ""}><Document size="xs" />Pages <span>{projectNotes.length}</span></button>
                  <button type="button" role="tab" aria-selected={surface === "tasks"} onClick={() => setSurface("tasks")} className={surface === "tasks" ? "is-active" : ""}><Check size="xs" />Tasks <span>{projectTasks.length}</span></button>
                </div>
                <div className="workspace-library__tools">
                  <label><Search size="sm" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${surface === "notes" ? "pages" : "tasks"}`} /></label>
                  <button type="button" title={surface === "notes" ? "New page" : "New task"} onClick={() => surface === "notes" ? void createNote() : setQuickOpen(true)}><Add size="sm" /></button>
                </div>
                <div className="workspace-node-list">
                  {surface === "notes" ? (
                    filteredNotes.length === 0 ? <LibraryEmpty label="No pages here yet" onCreate={() => void createNote()} /> : filteredNotes.map((note) => (
                      <button key={note.id} type="button" onClick={() => { setSelectedNoteId(note.id); if (window.innerWidth < 900) setDrawerOpen(false); }} className={cx("workspace-node", selectedNote?.id === note.id && "is-active")}>
                        <span className="workspace-node__glyph"><Document size="sm" /></span>
                        <span className="workspace-node__copy"><strong>{note.title || "Untitled"}</strong><small>{note.excerpt || note.filename}</small><em><Clock size="xs" />{relative(note.updatedAt)} ago</em></span>
                      </button>
                    ))
                  ) : (
                    filteredTasks.length === 0 ? <LibraryEmpty label="No tasks here yet" onCreate={() => setQuickOpen(true)} /> : filteredTasks.map((task) => (
                      <button key={task.id} type="button" onClick={() => { setSelectedTaskId(task.id); if (window.innerWidth < 900) setDrawerOpen(false); }} className={cx("workspace-node workspace-task-node", selectedTask?.id === task.id && "is-active")}>
                        <span onClick={(event) => { event.stopPropagation(); void toggleTask(task); }} className={cx("workspace-task-check", task.status === "completed" && "is-complete")}><Check size="xs" /></span>
                        <span className="workspace-node__copy"><strong className={task.status === "completed" ? "line-through opacity-50" : ""}>{task.title}</strong><small>{task.descriptionMarkdown || "No details"}</small>{task.dueAt && <em><Calendar size="xs" />{formatDate(task.dueAt)}</em>}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        <motion.main layout className="workspace-canvas-shell" transition={{ layout: { type: "spring", stiffness: 330, damping: 38 } }}>
        {surface === "notes" ? (
          selectedNote ? (
            <NoteCanvas
              note={selectedNote}
              editorMode={editorMode}
              setEditorMode={setEditorMode}
              saveState={saveState}
              updateNoteLocal={updateNoteLocal}
              saveNote={saveNote}
              applyMarkdown={applyMarkdown}
              handleEditorKeyDown={handleEditorKeyDown}
              editorRef={editorRef}
              onExport={() => downloadMarkdown(selectedNote)}
              onPreviewContext={previewContext}
              contextLoading={contextLoading}
              detailsOpen={detailsOpen}
              setDetailsOpen={setDetailsOpen}
            />
          ) : (
            <EmptyCanvas title="No note selected" action={() => void createNote()} actionLabel="New Note" />
          )
        ) : (
          <TaskCanvas
            task={selectedTask}
            notes={notes}
            draftTaskTitle={draftTaskTitle}
            setDraftTaskTitle={setDraftTaskTitle}
            createTask={createTask}
            toggleTask={toggleTask}
          />
        )}
        </motion.main>
      </div>

      <AnimatePresence>
        {detailsOpen && selectedNote && (
          <motion.aside
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            className="workspace-details-panel"
          >
            <DetailsPanel
              note={selectedNote}
              revisions={noteRevisions}
              revisionsLoading={revisionsLoading}
              onRefreshRevisions={() => void loadNoteRevisions()}
              onRestore={restoreRevision}
              contextPreview={contextPreview}
              onCopyContext={async () => {
                if (!contextPreview) return;
                await navigator.clipboard?.writeText([
                  `Primary: ${contextPreview.primaryItem.title ?? contextPreview.primaryItem.id}`,
                  `Project: ${contextPreview.project?.name ?? "None"}`,
                  `Notes: ${contextPreview.notes.map((note) => note.title).join(", ") || "None"}`,
                  `Token estimate: ${contextPreview.tokenEstimate}`,
                ].join("\n"));
                toast.success("Context copied");
              }}
              saving={saving}
            />
          </motion.aside>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {quickOpen && (
          <motion.div
            className="absolute inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/20 px-3 py-[8vh] backdrop-blur-sm sm:px-4 sm:pt-[12vh]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={() => setQuickOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
              onMouseDown={(event) => event.stopPropagation()}
              className="w-full max-w-2xl overflow-hidden rounded-[28px] border border-surface-divider bg-surface-page/96 shadow-2xl backdrop-blur-xl"
            >
              <Textarea
                value={captureText}
                onChange={(event) => setCaptureText(event.target.value)}
                autoFocus
                placeholder="Quick Add"
                className="min-h-40 resize-none rounded-none border-0 bg-transparent px-5 py-5 text-lg leading-relaxed focus-visible:ring-0 sm:min-h-44 sm:px-6 sm:py-6 sm:text-xl"
              />
              {organized && (
                <div className="mx-5 mb-4 rounded-2xl bg-surface-base p-4">
                  <p className="text-sm font-medium text-primary">{organized.title}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-secondary">{organized.markdown}</p>
                  {organized.tasks.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {organized.tasks.map((task, index) => <p key={`${task.title}-${index}`} className="text-xs text-disabled">- {task.title}</p>)}
                    </div>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-divider px-5 py-4">
                <p className="text-xs text-disabled">auto model - review before save</p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" size="sm" className="h-8 rounded-full text-xs" onClick={() => { setCaptureText(""); setOrganized(null); }}>Clear</Button>
                  <Button variant="outline" size="sm" className="h-8 rounded-full text-xs" onClick={() => void createNote(captureText, "Captured note")} disabled={!captureText.trim()}>Note</Button>
                  <Button variant="outline" size="sm" className="h-8 rounded-full text-xs" onClick={() => void createTask(captureText)} disabled={!captureText.trim()}>To Do</Button>
                  {organized ? (
                    <Button size="sm" className="h-8 rounded-full text-xs" onClick={acceptOrganized}>Save</Button>
                  ) : (
                    <Button size="sm" className="h-8 rounded-full text-xs" onClick={organizeCapture} loading={organizing} disabled={!captureText.trim()}>Organize</Button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

function NoteCanvas({
  note,
  editorMode,
  setEditorMode,
  saveState,
  updateNoteLocal,
  saveNote,
  applyMarkdown,
  handleEditorKeyDown,
  editorRef,
  onExport,
  onPreviewContext,
  contextLoading,
  detailsOpen,
  setDetailsOpen,
}: {
  note: WorkspaceNote;
  editorMode: EditorMode;
  setEditorMode: (mode: EditorMode) => void;
  saveState: SaveState;
  updateNoteLocal: (patch: Partial<WorkspaceNote>) => void;
  saveNote: (noteToSave: WorkspaceNote, patch: Partial<WorkspaceNote>) => Promise<void>;
  applyMarkdown: (kind: "bold" | "italic" | "heading" | "quote" | "code" | "bullet" | "number" | "task" | "link") => void;
  handleEditorKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  editorRef: React.RefObject<HTMLTextAreaElement | null>;
  onExport: () => void;
  onPreviewContext: () => void;
  contextLoading: boolean;
  detailsOpen: boolean;
  setDetailsOpen: (value: boolean | ((current: boolean) => boolean)) => void;
}) {
  return (
    <section className="workspace-note-canvas">
      <div className="workspace-document-header">
        <div className="workspace-document-header__title">
          <span className="workspace-eyebrow">Markdown document</span>
          <input
            value={note.title}
            onChange={(event) => updateNoteLocal({ title: event.target.value })}
            onBlur={(event) => void saveNote(note, { title: event.target.value })}
            placeholder="Untitled"
          />
        </div>
        <div className="workspace-editor-mode" aria-label="Editor layout">
          {(["write", "preview", "split"] as const).map((mode) => (
            <button key={mode} type="button" onClick={() => setEditorMode(mode)} className={editorMode === mode ? "is-active" : ""}>
              {editorMode === mode && <motion.span className="workspace-editor-mode__indicator" layoutId="workspace-editor-mode" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <span className="workspace-editor-mode__label">{mode}</span>
            </button>
          ))}
        </div>
      </div>

      <motion.div layout className={cx("workspace-editor-grid", editorMode === "split" && "is-split")}>
        <AnimatePresence initial={false} mode="popLayout">
          {(editorMode === "write" || editorMode === "split") && (
            <motion.div
              key="markdown-editor"
              layout
              initial={{ opacity: 0, x: -12, filter: "blur(4px)" }}
              animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, x: -10, filter: "blur(3px)" }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="workspace-editor-pane"
            >
              <div className="workspace-pane-label"><span>Markdown</span><span>{note.contentMarkdown.length} characters</span></div>
              <textarea
                ref={editorRef}
                value={note.contentMarkdown}
                onChange={(event) => updateNoteLocal({ contentMarkdown: event.target.value })}
                onBlur={(event) => void saveNote(note, { contentMarkdown: event.target.value })}
                onKeyDown={handleEditorKeyDown}
                spellCheck
                placeholder="Start writing…"
                className="workspace-markdown-editor"
              />
            </motion.div>
          )}
          {(editorMode === "preview" || editorMode === "split") && (
            <motion.article
              key="markdown-preview"
              layout
              initial={{ opacity: 0, x: 12, filter: "blur(4px)" }}
              animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, x: 10, filter: "blur(3px)" }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="workspace-preview-pane"
            >
              <div className="workspace-pane-label"><span>Preview</span><span>Rendered</span></div>
              <div className="workspace-prose prose prose-base max-w-none dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{note.contentMarkdown}</ReactMarkdown>
              </div>
            </motion.article>
          )}
        </AnimatePresence>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, x: "-50%", y: 14, scale: 0.98 }}
        animate={{ opacity: 1, x: "-50%", y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 360, damping: 30, delay: 0.08 }}
        className="workspace-commandbar"
      >
        <FormatButton title="Heading" onClick={() => applyMarkdown("heading")}>H2</FormatButton>
        <FormatButton title="Bold" onClick={() => applyMarkdown("bold")}><strong>B</strong></FormatButton>
        <FormatButton title="Italic" onClick={() => applyMarkdown("italic")}><em>I</em></FormatButton>
        <FormatButton title="Link" onClick={() => applyMarkdown("link")}>↗</FormatButton>
        <span className="workspace-commandbar__separator" />
        <FormatButton title="Bullet" onClick={() => applyMarkdown("bullet")}>•</FormatButton>
        <FormatButton title="Numbered" onClick={() => applyMarkdown("number")}>1.</FormatButton>
        <FormatButton title="Checklist" onClick={() => applyMarkdown("task")}><Check size="xs" /></FormatButton>
        <FormatButton title="Quote" onClick={() => applyMarkdown("quote")}>“</FormatButton>
        <FormatButton title="Code" onClick={() => applyMarkdown("code")}><Code size="xs" /></FormatButton>
        <span className="workspace-commandbar__separator" />
        <FormatButton title="Export" onClick={onExport}><Document size="xs" /></FormatButton>
        <FormatButton title="AI context" onClick={onPreviewContext}>{contextLoading ? <Spinner size="xs" className="animate-spin" /> : <Eye size="xs" />}</FormatButton>
        <FormatButton title="Details" onClick={() => setDetailsOpen((value) => !value)}><More size="xs" /></FormatButton>
        <span className="workspace-commandbar__status">{saveState === "saved" ? "Saved" : saveState}</span>
      </motion.div>

      {detailsOpen && <span className="sr-only">Details open</span>}
    </section>
  );
}

/* Legacy markup intentionally kept out of the canvas; editor panes above use layout
   motion so switching between write, preview and split preserves spatial context. */

function TaskCanvas({
  task,
  notes,
  draftTaskTitle,
  setDraftTaskTitle,
  createTask,
  toggleTask,
}: {
  task?: WorkspaceTask;
  notes: WorkspaceNote[];
  draftTaskTitle: string;
  setDraftTaskTitle: (value: string) => void;
  createTask: () => Promise<void>;
  toggleTask: (task: WorkspaceTask) => Promise<void>;
}) {
  const linkedNotes = task ? notes.filter((note) => task.noteIds?.includes(note.id)) : [];
  return (
    <section className="workspace-task-canvas">
      <div className="workspace-task-content">
        <div className="workspace-task-create">
          <Add size="sm" />
          <Input value={draftTaskTitle} onChange={(event) => setDraftTaskTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createTask(); }} placeholder="Add a next action…" />
          <button type="button" onClick={() => void createTask()} disabled={!draftTaskTitle.trim()}>Add task</button>
        </div>

        {!task ? (
          <EmptyCanvas title="No task selected" />
        ) : (
          <motion.div key={task.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .24, ease: [0.22, 1, 0.36, 1] }} className="workspace-task-detail">
            <div className="workspace-task-detail__status">
              <button type="button" onClick={() => void toggleTask(task)} className={task.status === "completed" ? "is-complete" : ""}><Check size="sm" /></button>
              <span>{task.status === "completed" ? "Completed" : task.status.replace("_", " ")}</span>
              {task.dueAt && <em><Calendar size="xs" />{formatDate(task.dueAt)}</em>}
            </div>
            <h2 className={task.status === "completed" ? "is-complete" : ""}>{task.title}</h2>
            {task.descriptionMarkdown && (
              <div className="workspace-task-description prose prose-base max-w-none dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{task.descriptionMarkdown}</ReactMarkdown>
              </div>
            )}
            <div className="workspace-linked-notes">
              <div><span className="workspace-eyebrow">Related pages</span><small>{linkedNotes.length} linked</small></div>
              {linkedNotes.length === 0 ? (
                <p className="workspace-linked-notes__empty">Link a page to give this task more context.</p>
              ) : linkedNotes.map((note) => (
                <div key={note.id} className="workspace-linked-note">
                  <span><Document size="sm" /></span>
                  <div><strong>{note.title}</strong><p>{note.excerpt}</p></div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </section>
  );
}

function DetailsPanel({
  note,
  revisions,
  revisionsLoading,
  onRefreshRevisions,
  onRestore,
  contextPreview,
  onCopyContext,
  saving,
}: {
  note: WorkspaceNote;
  revisions: WorkspaceNoteRevision[];
  revisionsLoading: boolean;
  onRefreshRevisions: () => void;
  onRestore: (revision: WorkspaceNoteRevision) => void;
  contextPreview: WorkspaceContextPreview | null;
  onCopyContext: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-extra-wide text-disabled">Document</p>
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex min-w-0 justify-between gap-3"><span className="shrink-0 text-disabled">File</span><span className="min-w-0 truncate text-secondary">{note.filename}</span></div>
          <div className="flex justify-between gap-3"><span className="text-disabled">Revision</span><span className="text-secondary">{note.revisionNumber}</span></div>
        </div>
      </div>

      <div className="border-t border-surface-divider pt-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-extra-wide text-disabled">Revisions</p>
          <button type="button" onClick={onRefreshRevisions} className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-hover hover:text-primary">
            <Redo size="sm" className={revisionsLoading ? "animate-spin" : ""} />
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {revisions.length === 0 ? <p className="text-sm text-disabled">No revisions yet.</p> : revisions.slice(0, 8).map((revision) => (
            <div key={revision.id} className="rounded-2xl bg-surface-base p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-primary">Revision {revision.revisionNumber}</p>
                  <p className="text-xs text-disabled">{revision.changeSource} - {relative(revision.createdAt)} ago</p>
                </div>
                <Button variant="ghost" size="sm" className="h-7 rounded-full px-2 text-xs" disabled={saving || revision.revisionNumber === note.revisionNumber} onClick={() => onRestore(revision)}>
                  Restore
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-surface-divider pt-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-extra-wide text-disabled">AI Context</p>
          {contextPreview && (
            <button type="button" onClick={onCopyContext} className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-hover hover:text-primary">
              <Copy size="sm" />
            </button>
          )}
        </div>
        {!contextPreview ? (
          <p className="mt-3 text-sm text-disabled">No preview yet.</p>
        ) : (
          <div className="mt-3 space-y-3 text-sm">
            <p className="text-secondary">{contextPreview.primaryItem.title ?? contextPreview.primaryItem.id}</p>
            <p className="text-xs text-disabled">~{contextPreview.tokenEstimate} tokens</p>
            {contextPreview.notes.map((item) => <p key={item.id} className="truncate text-secondary">{item.title}</p>)}
            {contextPreview.warnings.map((warning) => <p key={warning} className="rounded-2xl bg-surface-base p-3 text-xs text-disabled">{warning}</p>)}
          </div>
        )}
      </div>
    </div>
  );
}

function LibraryEmpty({ label, onCreate }: { label: string; onCreate: () => void }) {
  return (
    <div className="workspace-library-empty">
      <span><Document size="sm" /></span>
      <p>{label}</p>
      <button type="button" onClick={onCreate}><Add size="xs" />Create one</button>
    </div>
  );
}

function EmptyCanvas({ title, action, actionLabel }: { title: string; action?: () => void; actionLabel?: string }) {
  return (
    <div className="flex h-full items-center justify-center px-8 text-center">
      <div>
        <p className="font-display text-2xl text-primary">{title}</p>
        {action && actionLabel && <Button className="mt-4 rounded-full" onClick={action}>{actionLabel}</Button>}
      </div>
    </div>
  );
}
