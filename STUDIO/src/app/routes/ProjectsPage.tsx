import { motion } from "framer-motion";
import {
  FolderOpenIcon as FolderOpen,
  PlusIcon as Plus,
} from "@phosphor-icons/react";

export function ProjectsPage() {
  return (
    <div className="h-full overflow-hidden bg-white transition-colors duration-300 dark:bg-surface-page">
      <div className="flex h-full flex-col">
        <div className="flex-shrink-0 px-5 py-3">
          <h1 className="text-xs font-semibold uppercase tracking-extra-wide text-gray-400 transition-colors duration-300 dark:text-gray-600">
            Projects
          </h1>
        </div>

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
              Project conversations will appear here once project storage is connected.
            </p>

            <button
              type="button"
              disabled
              className="mt-5 inline-flex h-8 items-center gap-2 rounded-lg border border-dashed border-gray-200 px-3 text-xs font-medium text-gray-400 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-70 dark:border-surface-border dark:text-gray-600"
            >
              <Plus size={12} weight="regular" />
              New project
            </button>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
