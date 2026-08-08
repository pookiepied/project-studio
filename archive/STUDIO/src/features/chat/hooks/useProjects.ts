import { useCallback, useEffect, useState } from "react";
import { projectRegistry, type ProjectEntry } from "@/core/projects";

/** Live view of the local project registry, refreshed on demand. */
export function useProjects() {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const next = await projectRegistry.list();
    setProjects(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, [refresh]);

  const removeProject = useCallback(async (id: string) => {
    await projectRegistry.remove(id);
    await refresh();
  }, [refresh]);

  const deleteProject = useCallback(async (id: string) => {
    await projectRegistry.delete(id);
    await refresh();
  }, [refresh]);

  const renameProject = useCallback(async (id: string, name: string) => {
    await projectRegistry.rename(id, name);
    await refresh();
  }, [refresh]);

  return { projects, loading, refresh, removeProject, deleteProject, renameProject };
}
