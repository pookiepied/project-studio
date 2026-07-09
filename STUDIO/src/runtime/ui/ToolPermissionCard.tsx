import { motion } from "framer-motion";
import { formatLabel } from "@/utils/formatters";

interface ToolPermissionCardProps {
  tool: string;
  onAllow: () => void;
  onDeny: () => void;
}

const TOOL_DESCRIPTIONS: Record<string, string> = {
  shell_exec: "run shell commands on your machine",
  file_write: "write files to your filesystem",
  file_read: "read files from your filesystem",
  file_list: "list directory contents",
  ollama_inference: "run prompts through a local AI model",
};

export function ToolPermissionCard({ tool, onAllow, onDeny }: ToolPermissionCardProps) {
  const description = TOOL_DESCRIPTIONS[tool] ?? `use the ${formatLabel(tool)} tool`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-gray-200 dark:border-surface-border bg-white dark:bg-surface-base px-4 py-3.5 space-y-3 transition-colors duration-300"
    >
      <div>
        <p className="text-xs font-medium text-gray-800 dark:text-gray-200">
          Permission required
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          The agent wants to{" "}
          <span className="text-gray-700 dark:text-gray-300">{description}</span>
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onAllow}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-900 dark:bg-gray-200 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-300 transition-colors"
        >
          Allow for this chat
        </button>
        <button
          onClick={onDeny}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-surface-raised transition-colors"
        >
          Deny
        </button>
      </div>
    </motion.div>
  );
}
