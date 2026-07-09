/**
 * TierSelector - compact model-tier picker for the chat header.
 *
 * Shows Auto / Fast / Standard / Advanced as named tiers.
 * If the current model doesn't match any tier (custom model from library),
 * it shows the model name directly.
 *
 * The "Browse all" button opens ModelLibraryPanel.
 */

import { useState, useRef, useEffect } from "react";
import {
  CaretDownIcon as CaretDown,
  BookOpenIcon as BookOpen,
  CheckIcon as Check,
  BrainIcon as Brain,
} from "@phosphor-icons/react";
import { motion, AnimatePresence } from "framer-motion";
import { getAIMode, type AIMode } from "../core/config/autoMode";
import { useModes } from "../hooks/useModes";
import { composerPillButton, composerPillLabel, cx } from "@/features/chat/components/composerControlStyles";

// ---------------------------------------------------------------------------
// Reasoning budget levels
// ---------------------------------------------------------------------------

const REASONING_LEVELS: Array<{ label: string; budget: number | undefined; title: string }> = [
  { label: "Off",  budget: undefined, title: "No extended thinking" },
  { label: "Low",  budget: 4_096,     title: "Low thinking (4K tokens)" },
  { label: "Medium", budget: 8_192,   title: "Medium thinking (8K tokens)" },
  { label: "High", budget: 16_384,    title: "High thinking (16K tokens)" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TierSelectorProps {
  /** Current model ID from ChatContext */
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  onOpenLibrary: () => void;
  /** Model display name for non-tier custom models */
  customModelName?: string;
  /** Open the dropdown above the trigger instead of below (use when near bottom of screen) */
  dropUp?: boolean;
  /** Current reasoning budget (undefined = Off). When provided, adds a Reasoning section to the dropdown. */
  reasoning?: number | undefined;
  /** Called when the user picks a reasoning level. */
  onReasoningChange?: (budget: number | undefined) => void;
}

export function TierSelector({
  value,
  onChange,
  disabled = false,
  onOpenLibrary,
  customModelName,
  dropUp = false,
  reasoning,
  onReasoningChange,
}: TierSelectorProps) {
  const [open, setOpen] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { modes } = useModes();

  const activeMode = modes.find((m) => m.modelId === value || m.id === value) ?? getAIMode(value);

  const triggerLabel = activeMode?.label ?? customModelName ?? value.split(":").pop() ?? "Model";

  // Reasoning indicator
  const hasReasoning = onReasoningChange !== undefined;
  const reasoningIdx = hasReasoning
    ? REASONING_LEVELS.findIndex((l) => l.budget === reasoning)
    : -1;
  const reasoningLabel = reasoningIdx > 0 ? REASONING_LEVELS[reasoningIdx].label : null;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setReasoningOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSelect = (mode: AIMode) => {
    onChange(mode.modelId);
    setOpen(false);
    setReasoningOpen(false);
  };

  const handleOpenLibrary = () => {
    setOpen(false);
    setReasoningOpen(false);
    onOpenLibrary();
  };

  return (
    <div className="relative flex h-7 shrink-0 items-center" ref={containerRef}>
      {/* Trigger */}
      <motion.button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        whileTap={{ scale: 0.95 }}
        transition={{ duration: 0.1 }}
        className={cx(
          composerPillButton,
          "gap-1 text-gray-500 hover:bg-gray-100 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:text-gray-400 dark:hover:bg-surface-raised dark:focus-visible:ring-surface-border",
        )}
      >
        <motion.span
          key={triggerLabel}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className={cx(composerPillLabel, "max-w-[110px] truncate")}
        >
          {triggerLabel}
        </motion.span>
        {reasoningLabel && (
          <motion.span
            key={`r-${reasoningLabel}`}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.12 }}
            className={cx(composerPillLabel, "text-2xs font-medium")}
          >
            - {reasoningLabel}
          </motion.span>
        )}
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="flex-shrink-0"
        >
          <CaretDown size={10} weight="bold" className="text-gray-400 dark:text-gray-600" />
        </motion.div>
      </motion.button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: dropUp ? 6 : -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: dropUp ? 6 : -6 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className={`absolute right-0 w-[260px] z-50
              bg-white dark:bg-surface-base border border-gray-200 dark:border-surface-border
              rounded-xl shadow-xl overflow-hidden transition-colors duration-300
              ${dropUp ? "bottom-full mb-1.5" : "mt-1.5"}`}
          >
            {/* Tier items */}
            <div className="p-1.5 space-y-0.5">
              {modes.map((mode, i) => {
                const isActive = mode.modelId === value || mode.id === value;
                return (
                  <motion.button
                    key={mode.id}
                    type="button"
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.12, delay: i * 0.03, ease: "easeOut" }}
                    onClick={() => handleSelect(mode)}
                    whileTap={{ scale: 0.98 }}
                    className={`w-full flex items-start gap-2.5 px-3 py-2 rounded-lg text-left transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:focus-visible:ring-surface-border ${
                      isActive
                        ? "bg-gray-50 dark:bg-surface-raised"
                        : "hover:bg-gray-50 dark:hover:bg-surface-raised"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium leading-tight transition-colors duration-300 ${
                        isActive ? "text-gray-900 dark:text-gray-100" : "text-gray-700 dark:text-gray-300"
                      }`}>
                        {mode.label}
                      </p>
                      <p className="text-2xs text-gray-400 dark:text-gray-600 mt-0.5 leading-tight truncate">
                        {mode.description}
                      </p>
                    </div>
                    <AnimatePresence>
                      {isActive && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.5 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.5 }}
                          transition={{ duration: 0.15 }}
                          className="mt-0.5 flex-shrink-0"
                        >
                          <Check size={10} weight="bold" className="text-gray-500 dark:text-gray-400" />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.button>
                );
              })}
            </div>

            {/* Separator */}
            <div className="mx-3 border-t border-gray-100 dark:border-surface-border" />

            {/* Browse all */}
            <div className="p-1.5 pt-0">
              <motion.button
                type="button"
                onClick={handleOpenLibrary}
                whileTap={{ scale: 0.98 }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-gray-50 dark:hover:bg-surface-raised transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:focus-visible:ring-surface-border"
              >
                <BookOpen size={11} weight="regular" className="text-gray-400 dark:text-gray-600 flex-shrink-0" />
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Browse all models
                </span>
              </motion.button>
            </div>

            {/* Reasoning section only renders when onReasoningChange is provided. */}
            {hasReasoning && (
              <>
                <div className="mx-3 border-t border-gray-100 dark:border-surface-border" />
                <div className="p-1.5">
                  <button
                    type="button"
                    onClick={() => setReasoningOpen((v) => !v)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-gray-50 dark:hover:bg-surface-raised transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:focus-visible:ring-surface-border"
                  >
                    <div className="w-5 h-5 rounded-md bg-gray-100 dark:bg-surface-raised flex items-center justify-center flex-shrink-0">
                      <Brain size={11} weight="regular" className="text-gray-400 dark:text-gray-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400 leading-tight">
                        Reasoning
                      </p>
                      <p className="text-2xs text-gray-400 dark:text-gray-600 leading-tight">
                        {reasoningLabel ?? "Off"}
                      </p>
                    </div>
                    <motion.div
                      animate={{ rotate: reasoningOpen ? 180 : 0 }}
                      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                      className="flex-shrink-0"
                    >
                      <CaretDown size={10} weight="bold" className="text-gray-400 dark:text-gray-600" />
                    </motion.div>
                  </button>

                  <AnimatePresence initial={false}>
                    {reasoningOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="pt-1 grid grid-cols-4 gap-1">
                          {REASONING_LEVELS.map((level, i) => {
                            const isActive = level.budget === reasoning;
                            return (
                              <motion.button
                                key={level.label}
                                type="button"
                                initial={{ opacity: 0, y: -2 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.1, delay: i * 0.015, ease: "easeOut" }}
                                onClick={() => {
                                  onReasoningChange!(level.budget);
                                  setOpen(false);
                                  setReasoningOpen(false);
                                }}
                                title={level.title}
                                whileTap={{ scale: 0.96 }}
                                className={`h-7 rounded-md text-xs font-medium transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:focus-visible:ring-surface-border ${
                                  isActive
                                    ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900"
                                    : "text-gray-500 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-surface-raised"
                                }`}
                              >
                                {level.label}
                              </motion.button>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
