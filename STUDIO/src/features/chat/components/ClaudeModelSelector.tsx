import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CaretDownIcon as CaretDown,
  CheckIcon as Check,
  GaugeIcon as Gauge,
} from "@phosphor-icons/react";
import { CLAUDE_MODELS, CLAUDE_EFFORT_LEVELS } from "@/cliBridges";
import type { ClaudeEffortLevel } from "@/cliBridges/types";
import { Button } from "@/ui/primitives/Button";
import { composerPillButton, composerPillLabel, cx } from "./composerControlStyles";

/**
 * Claude model + effort picker.
 *
 * Deliberately mirrors TierSelector's structure and styling so the composer
 * feels native when you flip engines: the model rows sit where the Studio tiers
 * were, and the "Effort" section sits exactly where Studio's "Reasoning" section
 * lives. Only the data and the flag name differ.
 */
interface ClaudeModelSelectorProps {
  model: string;
  effort: ClaudeEffortLevel;
  disabled?: boolean;
  onModelChange: (id: string) => void;
  onEffortChange: (level: ClaudeEffortLevel) => void;
}

export function ClaudeModelSelector({
  model,
  effort,
  disabled = false,
  onModelChange,
  onEffortChange,
}: ClaudeModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEffortOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeModel = CLAUDE_MODELS.find((m) => m.id === model);
  const triggerLabel = activeModel?.label ?? model;
  const effortLabel = CLAUDE_EFFORT_LEVELS.find((e) => e.id === effort)?.label ?? null;

  return (
    <div className="relative flex h-7 shrink-0 items-center" ref={containerRef}>
      {/* Trigger */}
      <Button
        variant="ghost"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={cx(
          composerPillButton,
          "gap-1 text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-surface-raised",
        )}
      >
        <span className={cx(composerPillLabel, "max-w-[110px] truncate")}>
          {triggerLabel}
        </span>
        {effortLabel && (
          <span className={cx(composerPillLabel, "text-2xs font-medium")}>
            - {effortLabel}
          </span>
        )}
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="flex-shrink-0"
        >
          <CaretDown size={12} weight="bold" className="text-gray-400 dark:text-gray-600" />
        </motion.div>
      </Button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="absolute right-0 bottom-full mb-1.5 w-[260px] z-50
              bg-white dark:bg-surface-base border border-gray-200 dark:border-surface-border
              rounded-xl shadow-xl overflow-hidden"
          >
            {/* Model items */}
            <div className="p-1.5 space-y-0.5">
              {CLAUDE_MODELS.map((m) => {
                const isActive = m.id === model;
                return (
                  <Button
                    key={m.id}
                    variant="ghost"
                    onClick={() => { onModelChange(m.id); setOpen(false); setEffortOpen(false); }}
                    className={`h-auto w-full justify-start gap-2.5 px-3 py-2 rounded-lg text-left text-gray-700 dark:text-gray-300 transition-colors duration-100 ${
                      isActive ? "bg-gray-50 dark:bg-surface-raised" : "hover:bg-gray-50 dark:hover:bg-surface-raised"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium leading-tight ${
                        isActive ? "text-gray-900 dark:text-gray-100" : "text-gray-700 dark:text-gray-300"
                      }`}>
                        {m.label}
                      </p>
                      <p className="text-2xs text-gray-400 dark:text-gray-600 mt-0.5 leading-tight truncate">
                        {m.description}
                      </p>
                    </div>
                    {isActive && (
                      <Check size={12} weight="bold" className="mt-0.5 flex-shrink-0 text-gray-500 dark:text-gray-400" />
                    )}
                  </Button>
                );
              })}
            </div>

            {/* Separator */}
            <div className="mx-3 border-t border-gray-100 dark:border-surface-border" />

            {/* Effort section mirrors Studio's Reasoning section. */}
            <div className="p-1.5">
              <Button
                variant="ghost"
                onClick={() => setEffortOpen((v) => !v)}
                className="h-auto w-full justify-start gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-gray-50 dark:hover:bg-surface-raised transition-colors duration-100"
              >
                <div className="w-5 h-5 rounded-md bg-gray-100 dark:bg-surface-raised flex items-center justify-center flex-shrink-0">
                  <Gauge size={12} weight="regular" className="text-gray-400 dark:text-gray-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400 leading-tight">
                    Effort
                  </p>
                  <p className="text-2xs text-gray-400 dark:text-gray-600 leading-tight">
                    {effortLabel ?? "Medium"}
                  </p>
                </div>
                <motion.div
                  animate={{ rotate: effortOpen ? 180 : 0 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="flex-shrink-0"
                >
                  <CaretDown size={12} weight="bold" className="text-gray-400 dark:text-gray-600" />
                </motion.div>
              </Button>

              <AnimatePresence initial={false}>
                {effortOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="pt-1 grid grid-cols-4 gap-1">
                      {CLAUDE_EFFORT_LEVELS.map((level) => {
                        const isActive = level.id === effort;
                        return (
                          <Button
                            key={level.id}
                            variant="ghost"
                            onClick={() => { onEffortChange(level.id); setOpen(false); setEffortOpen(false); }}
                            title={level.title}
                            className={`h-7 rounded-md text-xs transition-colors duration-100 ${
                              isActive
                                ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900"
                                : "text-gray-500 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-surface-raised"
                            }`}
                          >
                            {level.label}
                          </Button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
