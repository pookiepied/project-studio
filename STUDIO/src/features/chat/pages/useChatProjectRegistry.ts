import { useCallback, useEffect } from "react";
import type { ConversationStorageScope } from "@/core/conversations";
import { projectRegistry, type ProjectEntry } from "@/core/projects";
import { useProjects } from "@/features/chat/hooks/useProjects";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

type ProjectContextValue = {
  path: string;
  name: string;
  accessMode?: "review" | "autonomous";
};

interface UseChatProjectRegistryOptions {
  projectContext: ProjectContextValue | null;
  conversationStorageScope: ConversationStorageScope;
  setProjectContext: (ctx: ProjectContextValue | null) => void;
}

export function useChatProjectRegistry({
  projectContext,
  conversationStorageScope,
  setProjectContext,
}: UseChatProjectRegistryOptions) {
  const { projects, refresh: refreshProjects, removeProject, deleteProject } = useProjects();

  const handleSelectProject = useCallback(async (project: ProjectEntry) => {
    setProjectContext({
      path: project.path,
      name: project.name,
      accessMode: project.accessMode,
    });
    await projectRegistry.touch(project.id);
    await refreshProjects();
  }, [setProjectContext, refreshProjects]);

  const handleOpenProjectFolder = useCallback(async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected !== "string") return;

    const entry = await projectRegistry.add(selected);
    setProjectContext({
      path: entry.path,
      name: entry.name,
      accessMode: entry.accessMode,
    });
    await refreshProjects();
  }, [setProjectContext, refreshProjects]);

  const activeProjectPath = projectContext?.path;
  const activeProjectName = projectContext?.name;

  useEffect(() => {
    if (!activeProjectPath || conversationStorageScope !== "local") return;

    projectRegistry
      .add(activeProjectPath, { name: activeProjectName })
      .then(() => refreshProjects())
      .catch(() => {});
  }, [activeProjectPath, activeProjectName, conversationStorageScope, refreshProjects]);

  return {
    projects,
    removeProject,
    deleteProject,
    handleSelectProject,
    handleOpenProjectFolder,
  };
}
