import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CaretRightIcon as CaretRight,
  XIcon as X,
} from "@phosphor-icons/react";
import type { TaskItem, ActiveToolCall } from "@/features/chat/context";
import { TaskWriteCard } from "@/features/chat/components/TaskWriteCard";
import { SearchResultContent } from "./content/SearchResultContent";

// ---------------------------------------------------------------------------

interface SearchEntry {
  callId: string;
  query?: string;
  result: unknown;
}

function extractSearchEntries(toolCalls: ActiveToolCall[]): SearchEntry[] {
  return toolCalls
    .filter(
      (tc) =>
        (tc.tool === "web_search" || tc.tool.endsWith(":web_search")) &&
        tc.status === "complete" &&
        tc.result != null
    )
    .map((tc) => ({
      callId: tc.callId,
      query:  (tc.args as Record<string, unknown>).query as string | undefined,
      result: tc.result,
    }));
}

// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm font-medium text-gray-600 dark:text-gray-400 select-none">
      {children}
    </p>
  );
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-surface-selected transition-colors duration-100"
      >
        <SectionLabel>{title}</SectionLabel>
        <motion.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          className="text-gray-400 dark:text-gray-600"
        >
          <CaretRight size={12} weight="bold" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface SummaryPanelProps {
  onClose:         () => void;
  sessionTasks:    TaskItem[];
  isStreaming:     boolean;
  activeToolCalls: ActiveToolCall[];
}

export function SummaryPanel({
  onClose,
  sessionTasks,
  isStreaming,
  activeToolCalls,
}: SummaryPanelProps) {
  const searchEntries = extractSearchEntries(activeToolCalls);
  const hasTasks   = sessionTasks.length > 0;
  const hasSources = searchEntries.length > 0;

  return (
    <div className="bg-white dark:bg-surface-raised rounded-2xl shadow-xl border border-gray-100 dark:border-surface-border overflow-hidden">

      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-surface-border">
        <span className="text-2xs font-bold tracking-[0.1em] uppercase text-gray-400 dark:text-gray-600 select-none">
          Overview
        </span>
        <button
          type="button"
          onClick={onClose}
          className="w-5 h-5 flex items-center justify-center rounded-md text-gray-400 dark:text-gray-600 hover:bg-gray-100 dark:hover:bg-surface-selected hover:text-gray-600 dark:hover:text-gray-400 transition-colors duration-100"
        >
          <X size={12} weight="bold" />
        </button>
      </div>

      {/* Scrollable body */}
      <div
        className="max-h-[60vh] overflow-y-auto divide-y divide-gray-50 dark:divide-surface-border"
        style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(0,0,0,0.06) transparent" }}
      >
        {/* Tasks section */}
        {hasTasks ? (
          <CollapsibleSection title="Tasks">
            <TaskWriteCard todos={sessionTasks} isRunning={isStreaming} />
          </CollapsibleSection>
        ) : (
          <div className="px-4 py-3 space-y-1">
            <SectionLabel>Tasks</SectionLabel>
            <p className="text-xs text-gray-400 dark:text-gray-600">No tasks yet</p>
          </div>
        )}

        {/* Sources section */}
        {hasSources ? (
          <CollapsibleSection title="Sources">
            <div className="space-y-3">
              {searchEntries.map((entry) => (
                <SearchResultContent
                  key={entry.callId}
                  result={entry.result}
                  query={entry.query}
                />
              ))}
            </div>
          </CollapsibleSection>
        ) : (
          <div className="px-4 py-3 space-y-1">
            <SectionLabel>Sources</SectionLabel>
            <p className="text-xs text-gray-400 dark:text-gray-600">No sources yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
