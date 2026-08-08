import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/ui/primitives/Button";
import { Collapse } from "@/ui/icons";
import type { HarnessEvent } from "@/types";
import { getToolIcon } from "./toolCardUtils";

interface HarnessStepCardProps {
  event: HarnessEvent;
}

// ── Diff badge ───────────────────────────────────────────────────────────────

function DiffBadge({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-2xs font-mono select-none flex-shrink-0">
      {added > 0 && (
        <span className="text-secondary dark:text-secondary">+{added}</span>
      )}
      {removed > 0 && (
        <span className="text-secondary dark:text-secondary">-{removed}</span>
      )}
    </span>
  );
}

// ── Diff preview renderer ────────────────────────────────────────────────────

function PreviewPane({ preview, tool }: { preview: string; tool: string }) {
  const t = tool.toLowerCase();
  const isShell = t === "bash" || t === "powershell" || t === "repl";
  const isDiff  = preview.trimStart().startsWith("-") || preview.trimStart().startsWith("+");

  if (isShell || !isDiff) {
    // Plain output
    return (
      <pre className="text-xs font-mono text-secondary dark:text-disabled leading-relaxed whitespace-pre-wrap break-all overflow-hidden max-h-48 overflow-y-auto scrollbar-auto-hide">
        {preview}
      </pre>
    );
  }

  // Diff-style: colour +/- lines
  return (
    <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-all overflow-hidden max-h-48 overflow-y-auto scrollbar-auto-hide">
      {preview.split("\n").map((line, i) => {
        let cls = "text-muted dark:text-muted";
        if (line.startsWith("+++") || line.startsWith("---")) {
          cls = "text-disabled dark:text-secondary font-semibold";
        } else if (line.startsWith("+")) {
          cls = "text-secondary dark:text-secondary bg-surface-raised/60 dark:bg-surface-raised/20";
        } else if (line.startsWith("-")) {
          cls = "text-secondary dark:text-secondary bg-surface-raised/60 dark:bg-surface-raised/20";
        } else if (line.startsWith("@@")) {
          cls = "text-secondary dark:text-secondary";
        }
        return (
          <span key={i} className={`block ${cls}`}>
            {line || " "}
          </span>
        );
      })}
    </pre>
  );
}

// ── Status indicator ─────────────────────────────────────────────────────────

function StatusDot({ status }: { status: HarnessEvent["status"] }) {
  if (status === "complete") {
    return (
      <span className="w-1.5 h-1.5 rounded-full bg-surface-selected dark:bg-secondary flex-shrink-0 mt-0.5" />
    );
  }
  if (status === "error") {
    return (
      <span className="w-1.5 h-1.5 rounded-full bg-surface-raised dark:bg-surface-raised flex-shrink-0 mt-0.5" />
    );
  }
  // running
  return (
    <motion.span
      className="w-1.5 h-1.5 rounded-full bg-surface-raised dark:bg-surface-raised flex-shrink-0 mt-0.5"
      animate={{ opacity: [1, 0.3, 1] }}
      transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

// ── Main card ────────────────────────────────────────────────────────────────

export function RuntimeStepCard({ event }: HarnessStepCardProps) {
  const [expanded, setExpanded] = useState(false);

  const isRunning  = event.status === "running";
  const isError    = event.status === "error";
  const canExpand  = !isRunning && !!event.preview;

  const handleToggle = () => {
    if (canExpand) setExpanded((v) => !v);
  };

  return (
    <div className="select-none">
      {/* ── Row ── */}
      <Button
        variant="ghost"
        onClick={handleToggle}
        disabled={!canExpand}
        className={`flex items-center gap-2 py-0.5 w-full text-left justify-start transition-colors ${
          canExpand
            ? "hover:text-secondary dark:hover:text-disabled cursor-pointer"
            : "cursor-default"
        }`}
      >
        {/* Status dot */}
        <StatusDot status={event.status} />

        {/* Tool icon */}
        <span className="flex-shrink-0 opacity-50">
          {getToolIcon(event.tool, "xs")}
        </span>

        {/* Verb */}
        <span
          className={`text-sm font-medium flex-shrink-0 ${
            isRunning
              ? "text-muted dark:text-disabled italic"
              : isError
              ? "text-secondary dark:text-secondary"
              : "text-muted dark:text-disabled"
          }`}
        >
          {event.label}
          {isRunning && (
            <motion.span
              animate={{ opacity: [1, 0, 1] }}
              transition={{ duration: 0.9, repeat: Infinity }}
            >
              …
            </motion.span>
          )}
        </span>

        {/* Target */}
        <span className="text-sm text-secondary dark:text-disabled truncate font-mono">
          {event.target}
        </span>

        {/* Line range (read_file) */}
        {event.lineRange && !isRunning && (
          <span className="text-xs text-disabled dark:text-secondary flex-shrink-0">
            ({event.lineRange})
          </span>
        )}

        {/* Diff badge */}
        {event.diffStats && !isRunning && (
          <DiffBadge
            added={event.diffStats.added}
            removed={event.diffStats.removed}
          />
        )}

        {/* Expand chevron */}
        {canExpand && (
          <Collapse
            size="xs"
            className={`flex-shrink-0 ml-auto text-disabled dark:text-secondary transition-transform duration-150 ${
              expanded ? "rotate-90" : ""
            }`}
          />
        )}
      </Button>

      {/* ── Expanded preview pane ── */}
      <AnimatePresence>
        {expanded && event.preview && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="mt-1 ml-3.5 pl-3 border-l border-surface-border dark:border-surface-border pb-1">
              <PreviewPane preview={event.preview} tool={event.tool} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
