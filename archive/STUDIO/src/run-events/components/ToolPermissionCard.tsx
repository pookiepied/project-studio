import { motion } from "framer-motion";
import { formatLabel } from "@/lib/formatters";
import { Button } from "@/ui/primitives/Button";

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
      className="rounded-xl border border-surface-border dark:border-surface-border bg-surface-page dark:bg-surface-base px-4 py-3.5 space-y-3 transition-colors duration-300"
    >
      <div>
        <p className="text-xs font-medium text-primary dark:text-disabled">
          Permission required
        </p>
        <p className="text-xs text-muted dark:text-disabled mt-0.5">
          The agent wants to{" "}
          <span className="text-secondary dark:text-disabled">{description}</span>
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          onClick={onAllow}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary dark:bg-surface-raised text-on-emphasis dark:text-primary hover:bg-secondary dark:hover:bg-surface-selected transition-colors"
        >
          Allow for this chat
        </Button>
        <Button
          variant="ghost"
          onClick={onDeny}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted dark:text-disabled hover:bg-surface-base dark:hover:bg-surface-raised transition-colors"
        >
          Deny
        </Button>
      </div>
    </motion.div>
  );
}
