import { motion } from "framer-motion";
import {
  Add,
  Delete,
  FolderOpen,
  Icon,
  MinusCircleIcon,
} from "@/ui/icons";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { projectRegistry } from "@/core/projects";
import { useProjects } from "@/features/chat/hooks/useProjects";
import { formatDate } from "@/lib/formatters";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";

export function ProjectsPage() {
  const { projects, loading, refresh, removeProject, deleteProject } = useProjects();

  const openProject = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    await projectRegistry.add(selected);
    await refresh();
  };

  return (
    <div className="h-full overflow-hidden bg-surface-page transition-colors duration-300 dark:bg-surface-page">
      <div className="flex h-full flex-col">
        <div className="flex flex-shrink-0 items-center justify-between px-5 py-3">
          <span className="text-xs font-semibold uppercase tracking-extra-wide text-disabled transition-colors duration-300 dark:text-secondary">
            Projects
          </span>
          <Button
            onClick={openProject}
            variant="outline"
            className="h-8 gap-2 px-3 text-xs font-medium border-surface-border text-secondary hover:bg-surface-page dark:border-surface-border dark:text-disabled dark:hover:bg-surface-raised"
          >
            <Add size="sm" weight="regular" />
            Open project
          </Button>
        </div>

        {!loading && projects.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-5 pb-16">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="flex w-full max-w-sm flex-col items-center text-center"
            >
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-dashed border-surface-border text-disabled dark:border-surface-border dark:text-secondary">
                <FolderOpen size="lg" weight="regular" />
              </div>

              <p className="text-base font-medium text-secondary transition-colors duration-300 dark:text-disabled">
                No projects yet
              </p>
              <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-disabled transition-colors duration-300 dark:text-secondary">
                Open a folder to start a project. Studio keeps its own data separately — your files stay where they are.
              </p>
            </motion.div>
          </div>
        ) : (
          <div className="scrollbar-auto-hide flex-1 overflow-y-auto px-3 pb-5">
            {projects.map((project) => (
              <div
                key={project.id}
                className="group mb-1 flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-page dark:hover:bg-surface-raised"
              >
                <FolderOpen size="md" weight="regular" className="flex-shrink-0 text-disabled dark:text-secondary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-primary dark:text-disabled">{project.name}</p>
                  <p className="truncate text-xs text-disabled dark:text-secondary">{project.path}</p>
                </div>
                <span className="flex-shrink-0 text-xs text-disabled dark:text-secondary">
                  {formatDate(project.lastOpenedAt)}
                </span>
                <div className="flex flex-shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <IconButton
                    aria-label="Remove from list (keeps all files)"
                    onClick={() => { void removeProject(project.id); }}
                    className="h-auto w-auto rounded p-1 text-muted hover:bg-surface-raised dark:text-muted dark:hover:bg-surface-border"
                  >
                    <Icon icon={MinusCircleIcon} size="sm" />
                  </IconButton>
                  <IconButton
                    aria-label="Delete Studio's data for this project (your folder is untouched)"
                    onClick={() => { void deleteProject(project.id); }}
                    className="h-auto w-auto rounded p-1 text-muted hover:bg-surface-raised dark:text-muted dark:hover:bg-surface-border"
                  >
                    <Delete size="sm" />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
