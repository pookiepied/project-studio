import { motion, AnimatePresence } from "framer-motion";
import { XIcon as X } from "@phosphor-icons/react";
import type { PendingMessage } from "@/features/chat/context/types";

interface PendingMessageQueueProps {
  messages: PendingMessage[];
  onCancel: (index: number) => void;
}

export const PendingMessageQueue = ({ messages, onCancel }: PendingMessageQueueProps) => {
  if (messages.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.18 }}
        className="px-4 pb-1.5 overflow-hidden"
      >
        <div className="rounded-lg border border-gray-200 dark:border-surface-border overflow-hidden">
          <div className="px-3 py-1.5 border-b border-gray-100 dark:border-surface-selected">
            <span className="text-2xs font-semibold text-gray-400 dark:text-gray-600 tracking-extra-wide font-sans">
              QUEUED · {messages.length} MESSAGE{messages.length > 1 ? "S" : ""}
            </span>
          </div>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -4 }}
              transition={{ duration: 0.12, delay: i * 0.04 }}
              className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 border-gray-100 dark:border-surface-selected group"
            >
              <p className="flex-1 text-sm text-gray-500 dark:text-gray-500 truncate">
                {msg.content || (msg.attachments.length > 0 ? `${msg.attachments.length} attachment(s)` : "—")}
              </p>
              <button
                onClick={() => onCancel(i)}
                className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-gray-100 dark:hover:bg-surface-border transition-smooth"
                title="Cancel"
              >
                <X size={10} weight="bold" className="text-gray-400 dark:text-gray-600" />
              </button>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
