import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CaretDownIcon as CaretDown, CheckIcon as Check } from "@phosphor-icons/react";
import { ClaudeCodeIcon } from "@/ui/primitives/ClaudeCodeIcon";
import { StudioIcon } from "@/ui/primitives/StudioIcon";
import { composerPillButton, composerPillLabel, cx } from "./composerControlStyles";
import type { ChatEngine } from "@/cliBridges/types";

const ENGINES: {
  id: ChatEngine;
  label: string;
  description: string;
}[] = [
  { id: "studio", label: "Studio AI", description: "Native - your providers, agents & tools" },
  { id: "claude", label: "Claude",    description: "Claude Code CLI bridge" },
];

function EngineIcon({ engine, size = 13 }: { engine: ChatEngine; size?: number }) {
  if (engine === "claude") return <ClaudeCodeIcon size={size} />;
  return <StudioIcon size={size} />;
}

// Claude-engine brand-warm accent (Anthropic terracotta family — matches
// ClaudeCodeIcon's #CC785C). Not a neutral surface: no design-token equivalent.
/* eslint-disable no-restricted-syntax -- §17 brand carve-out: Claude-engine warm accent, no neutral-token equivalent */
const CLAUDE_ACCENT = "bg-[#F7EFEA] dark:bg-[#3A2A22]";
/* eslint-enable no-restricted-syntax */

interface EngineSelectorProps {
  value: ChatEngine;
  disabled?: boolean;
  availableEngines?: readonly ChatEngine[];
  onChange: (engine: ChatEngine) => void;
}

export const EngineSelector = ({ value, disabled, availableEngines, onChange }: EngineSelectorProps) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const engines = ENGINES.filter((engine) => !availableEngines || availableEngines.includes(engine.id));

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const active = engines.find((e) => e.id === value) ?? ENGINES[0];
  const isClaude = value === "claude";
  const canOpen = !disabled && engines.length > 1;

  return (
    <div ref={ref} className="relative flex h-7 flex-shrink-0 items-center">
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (canOpen) setOpen((v) => !v); }}
        className={cx(
          composerPillButton,
          "disabled:opacity-80",
          isClaude
            ? "text-primary dark:text-primary hover:bg-surface-hover dark:hover:bg-surface-hover"
            : canOpen
              ? "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-surface-border"
              : "text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-surface-selected cursor-default",
          open ? (isClaude ? CLAUDE_ACCENT : "bg-gray-100 dark:bg-surface-border") : null,
        )}
      >
        <EngineIcon engine={value} />
        <span className={composerPillLabel}>{active.label}</span>
        {canOpen && (
          <motion.div className="inline-flex items-center" animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.18 }}>
            <CaretDown size={10} weight="bold" className="opacity-50" />
          </motion.div>
        )}
      </button>

      <AnimatePresence>
        {open && canOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 6 }}
            transition={{ duration: 0.13 }}
            className="absolute bottom-full left-0 mb-2 w-56 bg-white dark:bg-surface-raised border border-gray-200 dark:border-surface-border rounded-xl shadow-xl overflow-hidden z-50 p-1.5 space-y-0.5"
          >
            {engines.map((engine) => {
              const isActive = engine.id === value;
              return (
                <button
                  key={engine.id}
                  type="button"
                  onClick={() => { onChange(engine.id); setOpen(false); }}
                  className={`flex items-start gap-2.5 w-full px-2.5 py-2 rounded-lg text-left transition-colors ${
                    isActive
                      ? engine.id === "claude"
                        ? CLAUDE_ACCENT
                        : "bg-gray-50 dark:bg-surface-selected"
                      : "hover:bg-gray-50 dark:hover:bg-surface-border"
                  }`}
                >
                  <div className="mt-0.5 flex-shrink-0">
                    <EngineIcon engine={engine.id} size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium leading-tight ${
                      isActive && engine.id === "claude"
                        ? "text-primary dark:text-primary"
                        : "text-gray-800 dark:text-gray-100"
                    }`}>
                      {engine.label}
                    </p>
                    <p className="text-2xs text-gray-400 dark:text-gray-600 mt-0.5 leading-tight">
                      {engine.description}
                    </p>
                  </div>
                  {isActive && (
                    <Check size={11} weight="bold" className="mt-0.5 flex-shrink-0 text-gray-500 dark:text-gray-400" />
                  )}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
