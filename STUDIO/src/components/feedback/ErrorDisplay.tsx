import { motion, AnimatePresence } from "framer-motion";
import { XIcon as X, WarningCircleIcon as WarningCircle } from "@phosphor-icons/react";

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
          <WarningCircle size={18} weight="fill" className="text-muted" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm text-secondary font-normal leading-relaxed">
            {message}
          </p>

          {actionable && (
            <button
              onClick={actionable.onAction}
              className="mt-2 text-xs text-primary font-medium hover:text-secondary transition-colors duration-fast underline"
            >
              {actionable.label}
            </button>
          )}
        </div>

        <button
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="flex-shrink-0 text-muted hover:text-secondary transition-colors duration-fast"
        >
          <X size={16} weight="regular" />
        </button>
      </motion.div>
    </AnimatePresence>
  );
};
