import { motion } from "framer-motion";
import {
  FolderOpenIcon as FolderOpen,
  MinusCircleIcon as MinusCircle,
  PlusIcon as Plus,
  TrashIcon as Trash,
} from "@phosphor-icons/react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { projectRegistry } from "@/core/projects";
import { useProjects } from "@/features/chat/hooks/useProjects";
import { formatDate } from "@/lib/formatters";

export function ProjectsPage() {
  const { projects, loading, refresh, removeProject, deleteProject } = useProjects();

  const openProject = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    await projectRegistry.add(selected);
    await refresh();
  };

  return (
    <div className="h-full overflow-hidden bg-white transition-colors duration-300 dark:bg-surface-page">
      <div className="flex h-full flex-col">
        <div className="flex flex-shrink-0 items-center justify-between px-5 py-3">
          <h1 className="text-xs font-semibold uppercase tracking-extra-wide text-gray-400 transition-colors duration-300 dark:text-gray-600">
            Projects
          </h1>
          <button
            type="button"
            onClick={openProject}
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-600 transition-colors duration-150 hover:bg-gray-50 dark:border-surface-border dark:text-gray-400 dark:hover:bg-surface-raised"
          >
            <Plus size={12} weight="regular" />
            Open project
          </button>
        </div>

        {!loading && projects.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-5 pb-16">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="flex w-full max-w-sm flex-col items-center text-center"
            >
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-dashed border-gray-200 text-gray-300 dark:border-surface-border dark:text-gray-700">
                <FolderOpen size={18} weight="regular" />
              </div>

              <p className="text-base font-medium text-gray-700 transition-colors duration-300 dark:text-gray-300">
                No projects yet
              </p>
              <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-gray-400 transition-colors duration-300 dark:text-gray-600">
                Open a folder to start a project. Studio keeps its own data separately — your files stay where they are.
              </p>
            </motion.div>
          </div>
        ) : (
          <div className="scrollbar-auto-hide flex-1 overflow-y-auto px-3 pb-5">
            {projects.map((project) => (
              <div
                key={project.id}
                className="group mb-1 flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-surface-raised"
              >
                <FolderOpen size={16} weight="regular" className="flex-shrink-0 text-gray-400 dark:text-gray-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-900 dark:text-gray-300">{project.name}</p>
                  <p className="truncate text-xs text-gray-400 dark:text-gray-600">{project.path}</p>
                </div>
                <span className="flex-shrink-0 text-xs text-gray-400 dark:text-gray-600">
                  {formatDate(project.lastOpenedAt)}
                </span>
                <div className="flex flex-shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    title="Remove from list (keeps all files)"
                    onClick={() => { void removeProject(project.id); }}
                    className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-200 dark:text-gray-500 dark:hover:bg-surface-border"
                  >
                    <MinusCircle size={13} weight="bold" />
                  </button>
                  <button
                    type="button"
                    title="Delete Studio's data for this project (your folder is untouched)"
                    onClick={() => { void deleteProject(project.id); }}
                    className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-200 dark:text-gray-500 dark:hover:bg-surface-border"
                  >
                    <Trash size={13} weight="bold" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
