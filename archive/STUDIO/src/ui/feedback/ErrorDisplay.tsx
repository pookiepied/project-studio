import { motion, AnimatePresence } from "framer-motion";
import { Close, Error } from "@/ui/icons";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";

interface ErrorDisplayProps {
  message: string;
  onDismiss: () => void;
  actionable?: {
    label: string;
    onAction: () => void;
  };
}

export const ErrorDisplay = ({ message, onDismiss, actionable }: ErrorDisplayProps) => {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        className="flex items-start gap-3 px-4 py-3 bg-surface-raised border border-surface-border rounded-lg transition-colors duration-fast"
      >
        <div className="flex-shrink-0 mt-0.5">
          <Error size="lg" weight="fill" className="text-muted" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm text-secondary font-normal leading-relaxed">
            {message}
          </p>

          {actionable && (
            <Button
              onClick={actionable.onAction}
              variant="ghost"
              className="mt-2 h-auto gap-2 px-0 py-0 text-xs font-medium underline hover:bg-transparent hover:text-secondary"
            >
              {actionable.label}
            </Button>
          )}
        </div>

        <IconButton
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="h-auto w-auto shrink-0 text-muted hover:bg-transparent hover:text-secondary"
        >
          <Close size="md" />
        </IconButton>
      </motion.div>
    </AnimatePresence>
  );
};
