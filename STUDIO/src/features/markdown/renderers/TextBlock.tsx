import { useState, useEffect } from "react";
import { PencilSimpleIcon as PencilSimple, CheckIcon as Check } from "@phosphor-icons/react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/ui/primitives/Button";

interface TextBlockProps {
  code: string;
  onEdit?: (next: string) => void;
}

export function TextBlock({ code }: TextBlockProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(code);
  const [saved, setSaved] = useState(false);

  // Keep text in sync with the code prop during streaming (prop updates don't re-init useState)
  useEffect(() => {
    if (!editing) setText(code);
  }, [code, editing]);

  const handleSave = () => {
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="relative group/textblock">
      <AnimatePresence mode="wait">
        {editing ? (
          <motion.div
            key="edit"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === "Escape") handleSave(); }}
              autoFocus
              className="w-full px-4 py-3 text-sm text-gray-800 dark:text-gray-200
                         bg-transparent border-0 outline-none resize-none
                         leading-relaxed font-sans"
              rows={Math.max(3, text.split("\n").length + 1)}
            />
            <div className="flex justify-end px-4 pb-3">
              <Button
                variant="ghost"
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={handleSave}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                           text-gray-600 dark:text-gray-400
                           bg-gray-100 dark:bg-surface-selected
                           hover:bg-gray-200 dark:hover:bg-surface-border
                           rounded-lg transition-colors duration-100"
              >
                <Check size={14} weight="bold" />
                Done
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="view"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="px-4 py-3"
          >
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
              {text}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit button — top-right, visible on hover */}
      {!editing && (
        <Button
          variant="ghost"
          initial={{ opacity: 0 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setEditing(true)}
          aria-label="Edit text"
          title="Edit text"
          className="absolute top-2 right-2
                     opacity-0 group-hover/textblock:opacity-100
                     w-7 h-7 flex items-center justify-center rounded-lg
                     text-gray-400 dark:text-gray-600
                     hover:text-gray-600 dark:hover:text-gray-400
                     hover:bg-gray-100 dark:hover:bg-surface-raised
                     transition-all duration-100"
        >
          <AnimatePresence mode="wait">
            {saved ? (
              <motion.div key="saved" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} transition={{ duration: 0.12 }}>
                <Check size={14} weight="bold" className="text-secondary" />
              </motion.div>
            ) : (
              <motion.div key="edit" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} transition={{ duration: 0.12 }}>
                <PencilSimple size={14} weight="regular" />
              </motion.div>
            )}
          </AnimatePresence>
        </Button>
      )}
    </div>
  );
}
