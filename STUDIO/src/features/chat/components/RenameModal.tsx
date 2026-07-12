import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/ui/primitives/Button";

interface RenameModalProps {
  isOpen:       boolean;
  titleInput:   string;
  onTitleChange:(v: string) => void;
  onSave:       () => void;
  onCancel:     () => void;
}

export const RenameModal = ({ isOpen, titleInput, onTitleChange, onSave, onCancel }: RenameModalProps) => (
  <AnimatePresence>
    {isOpen && (
      <>
        <motion.div
          key="rename-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onCancel}
          className="fixed inset-0 z-modal bg-black/25 backdrop-blur-[3px]"
        />
        <motion.div
          key="rename-dialog"
          initial={{ opacity: 0, scale: 0.96, y: -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -10 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-modal flex items-center justify-center pointer-events-none"
        >
          <div
            className="pointer-events-auto w-80 bg-white dark:bg-surface-raised border border-gray-200 dark:border-surface-border rounded-2xl shadow-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Rename chat
            </p>
            <input
              type="text"
              value={titleInput}
              onChange={(e) => onTitleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSave();
                if (e.key === "Escape") onCancel();
              }}
              className="w-full px-3 py-2 text-sm text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-surface-selected border border-gray-200 dark:border-surface-border rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-200 dark:focus:ring-surface-border transition-all duration-150"
              autoFocus
              placeholder="Chat name…"
            />
            <div className="flex items-center justify-end gap-2 mt-4">
              <Button
                variant="ghost"
                onClick={onCancel}
                className="px-3.5 py-1.5 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-surface-border rounded-lg transition-colors duration-150"
              >
                Cancel
              </Button>
              <Button
                variant="ghost"
                onClick={onSave}
                className="px-3.5 py-1.5 text-sm font-medium text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-surface-border hover:bg-gray-200 dark:hover:bg-surface-border rounded-lg transition-colors duration-150"
              >
                Save
              </Button>
            </div>
          </div>
        </motion.div>
      </>
    )}
  </AnimatePresence>
);
