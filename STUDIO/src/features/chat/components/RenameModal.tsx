import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/ui/primitives/Button";
import { Input } from "@/ui/primitives/Input";

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
          className="fixed inset-0 z-modal bg-scrim backdrop-blur-[3px]"
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
            className="pointer-events-auto w-80 bg-surface-page dark:bg-surface-raised border border-surface-border dark:border-surface-border rounded-2xl shadow-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-secondary dark:text-disabled mb-3">
              Rename chat
            </p>
            <Input
              type="text"
              size="md"
              value={titleInput}
              onChange={(e) => onTitleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSave();
                if (e.key === "Escape") onCancel();
              }}
              className="rounded-xl text-sm dark:bg-surface-selected"
              autoFocus
              placeholder="Chat name…"
            />
            <div className="flex items-center justify-end gap-2 mt-4">
              <Button
                variant="ghost"
                onClick={onCancel}
                className="px-3.5 py-1.5 text-sm font-medium text-muted dark:text-disabled hover:bg-surface-base dark:hover:bg-surface-border rounded-lg transition-colors duration-150"
              >
                Cancel
              </Button>
              <Button
                variant="ghost"
                onClick={onSave}
                className="px-3.5 py-1.5 text-sm font-medium text-primary dark:text-disabled bg-surface-base dark:bg-surface-border hover:bg-surface-raised dark:hover:bg-surface-border rounded-lg transition-colors duration-150"
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
