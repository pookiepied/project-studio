import { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/ui/primitives/Button";
import { CheckIcon as Check, XIcon as X, CaretDownIcon as CaretDown } from "@phosphor-icons/react";
import type { ActiveToolCall } from "@/types/tools";
import { getToolIcon, toolLabel, argsPreview } from "./toolCardUtils";

interface InlineToolStepsProps {
  steps: ActiveToolCall[];
  /** Cycle number — when it increments a new group starts */
  cycle: number;
}


export function InlineToolSteps({ steps, cycle }: InlineToolStepsProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [collapsedCycles, setCollapsedCycles] = useState<Set<number>>(new Set());
  const prevCycleRef = useRef(cycle);

  // When the cycle increments, collapse the previous cycle's steps
  useEffect(() => {
    if (cycle !== prevCycleRef.current) {
      setCollapsedCycles(prev => new Set([...prev, prevCycleRef.current]));
      prevCycleRef.current = cycle;
    }
  }, [cycle]);

  // Auto-scroll to bottom when new steps arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [steps.length]);

  if (steps.length === 0) return null;

  // Group steps by cycle number — each step carries no cycle info so we track
  // boundaries by watching when the running step count resets across renders.
  // For simplicity, keep it as one flat list but collapse by cycle groups.
  const currentCycleSteps = steps;
  const completedCount = steps.filter(s => s.status === "complete").length;
  const errorCount = steps.filter(s => s.status === "error").length;
  const runningStep = steps.find(s => s.status === "running");

  const toggleCycle = () => {
    setCollapsedCycles(prev => {
      const next = new Set(prev);
      if (next.has(cycle)) next.delete(cycle); else next.add(cycle);
      return next;
    });
  };

  const isCollapsed = collapsedCycles.has(cycle) && !runningStep;

  return (
    <div className="mt-2 select-none">
      {/* Header row — always visible */}
      <Button
        variant="ghost"
        onClick={toggleCycle}
        className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400 transition-colors w-full text-left justify-start"
      >
        <CaretDown
          size={12}
          weight="bold"
          className={`flex-shrink-0 transition-transform duration-150 ${isCollapsed ? "-rotate-90" : ""}`}
        />
        <span className="font-medium">
          {runningStep
            ? `${completedCount} step${completedCount !== 1 ? "s" : ""} done…`
            : `${steps.length} step${steps.length !== 1 ? "s" : ""}`}
        </span>
        {errorCount > 0 && (
          <span className="text-secondary dark:text-secondary">· {errorCount} error{errorCount !== 1 ? "s" : ""}</span>
        )}
      </Button>

      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="mt-1.5 pl-3.5 border-l border-gray-100 dark:border-surface-border space-y-px">
              {currentCycleSteps.map(step => (
                <StepRow key={step.callId} step={step} />
              ))}
            </div>
            <div ref={bottomRef} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StepRow({ step }: { step: ActiveToolCall }) {
  const isRunning = step.status === "running";
  const isError = step.status === "error";
  const isDone = step.status === "complete";
  const preview = argsPreview(step.args);
  const label = toolLabel(step.tool);
  const icon = getToolIcon(step.tool, 11);

  return (
    <div className={`flex items-center gap-1.5 py-0.5 relative overflow-hidden ${isRunning ? "rounded" : ""}`}>
      {/* Shimmer on running row */}
      {isRunning && (
        <div
          className="absolute inset-0 pointer-events-none rounded"
          style={{
            background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 40%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 60%, transparent 100%)",
            backgroundSize: "200% 100%",
            animation: "shimmer 1.8s ease-in-out infinite",
          }}
        />
      )}

      {/* Status indicator */}
      <div className="flex-shrink-0 w-3 flex items-center justify-center">
        {isDone && <Check size={12} weight="bold" className="text-gray-400 dark:text-gray-600" />}
        {isError && <X size={12} weight="bold" className="text-secondary dark:text-secondary" />}
        {isRunning && (
          <span className="w-1.5 h-1.5 rounded-full bg-surface-raised dark:bg-surface-raised animate-pulse block" />
        )}
      </div>

      {/* Icon */}
      <div className="flex-shrink-0 opacity-60">{icon}</div>

      {/* Label */}
      <span className={`text-xs flex-shrink-0 ${
        isRunning
          ? "text-gray-600 dark:text-gray-400 font-medium"
          : isError
          ? "text-secondary dark:text-secondary"
          : "text-gray-400 dark:text-gray-600"
      }`}>
        {label}
      </span>

      {/* Preview */}
      {preview && (
        <span className="text-xs text-gray-400 dark:text-gray-600 truncate max-w-[200px]" title={preview}>
          {preview}
        </span>
      )}
    </div>
  );
}
