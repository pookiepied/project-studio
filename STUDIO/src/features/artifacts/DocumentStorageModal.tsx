import { motion, AnimatePresence } from "framer-motion";
import {
  FilesIcon as Files,
  CloudArrowUpIcon as CloudUp,
  ClockIcon as Clock,
  XIcon as X,
} from "@phosphor-icons/react";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";

function formatBytes(bytes: number): string {
  if (bytes < 1024)              return `${bytes} B`;
  if (bytes < 1024 * 1024)       return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface DocumentStorageModalProps {
  files:      File[];
  isOpen:     boolean;
  isUploading: boolean;
  onPermanent:  () => void;
  onTemporary:  () => void;
  onSkip:       () => void;
  onCancel:     () => void;
}

/**
 * Modal that asks the user how they want to store a document that was just
 * selected. Three options:
 *   - Keep forever (permanent R2 storage)
 *   - Just for today (24-hour TTL)
 *   - Skip (use inline only, no server upload)
 */
export function DocumentStorageModal({
  files,
  isOpen,
  isUploading,
  onPermanent,
  onTemporary,
  onSkip,
  onCancel,
}: DocumentStorageModalProps) {
  const label = files.length === 1
    ? `"${files[0].name}"`
    : `${files.length} documents`;
  const totalBytes = files.reduce((s, f) => s + f.size, 0);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
          onClick={isUploading ? undefined : onCancel}
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.94, opacity: 0, y: 12 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            className="w-full max-w-sm bg-white dark:bg-surface-base border border-gray-200 dark:border-surface-border rounded-3xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-surface-selected flex items-center justify-center flex-shrink-0">
                  <Files size={16} weight="duotone" className="text-gray-500 dark:text-gray-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Store this document?
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5 truncate max-w-[180px]">
                    {label} · {formatBytes(totalBytes)}
                  </p>
                </div>
              </div>
              {!isUploading && (
                <IconButton
                  aria-label="Close"
                  onClick={onCancel}
                  className="p-1.5 !h-auto !w-auto rounded-lg !text-gray-400 hover:!text-gray-600 dark:hover:!text-gray-400 hover:!bg-gray-100 dark:hover:!bg-surface-selected transition-colors flex-shrink-0"
                >
                  <X size={14} />
                </IconButton>
              )}
            </div>

            <div className="h-px bg-gray-100 dark:bg-surface-border" />

            {/* Options */}
            <div className="p-3 space-y-2">
              {/* Keep forever */}
              <Button
                variant="ghost"
                onClick={onPermanent}
                disabled={isUploading}
                className="w-full !h-auto flex items-center !gap-3 px-3 py-2.5 rounded-xl border border-transparent hover:!bg-gray-50 dark:hover:!bg-surface-selected hover:!border-gray-200 dark:hover:!border-surface-border transition-all text-left disabled:opacity-50"
              >
                <div className="w-8 h-8 rounded-lg bg-surface-raised dark:bg-surface-raised/30 flex items-center justify-center flex-shrink-0">
                  <CloudUp size={16} weight="duotone" className="text-secondary dark:text-secondary" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">Keep forever</div>
                  <div className="text-2xs text-gray-400 dark:text-gray-600 mt-0.5">
                    Stored permanently — accessible across conversations
                  </div>
                </div>
              </Button>

              {/* Just for today */}
              <Button
                variant="ghost"
                onClick={onTemporary}
                disabled={isUploading}
                className="w-full !h-auto flex items-center !gap-3 px-3 py-2.5 rounded-xl border border-transparent hover:!bg-gray-50 dark:hover:!bg-surface-selected hover:!border-gray-200 dark:hover:!border-surface-border transition-all text-left disabled:opacity-50"
              >
                <div className="w-8 h-8 rounded-lg bg-surface-raised dark:bg-surface-raised/30 flex items-center justify-center flex-shrink-0">
                  <Clock size={16} weight="duotone" className="text-secondary dark:text-secondary" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">Just for today</div>
                  <div className="text-2xs text-gray-400 dark:text-gray-600 mt-0.5">
                    Deleted after 24 hours automatically
                  </div>
                </div>
              </Button>
            </div>

            <div className="h-px bg-gray-100 dark:bg-surface-border" />

            {/* Footer */}
            <div className="px-5 py-3 flex items-center justify-between">
              {isUploading ? (
                <span className="text-xs text-gray-400 dark:text-gray-600 animate-pulse">Uploading…</span>
              ) : (
                <span className="text-2xs text-gray-400 dark:text-gray-600">
                  The file will also be attached to this message
                </span>
              )}
              <Button
                variant="ghost"
                onClick={onSkip}
                disabled={isUploading}
                className="!h-auto !px-0 !py-0 !rounded-none text-xs !text-gray-400 dark:!text-gray-600 hover:!text-gray-600 dark:hover:!text-gray-400 hover:bg-transparent transition-colors disabled:opacity-40"
              >
                Skip
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
