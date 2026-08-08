import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { chevronRotateTransition } from "@/design/motion";
import { useDisclosure } from "@/lib/hooks/useDisclosure";
import { Expand, Check } from "@/ui/icons";
import { ClaudeCodeIcon, StudioIcon } from "@/ui/brand";
import { composerPillButton, composerPillLabel, cx } from "./composerControlStyles";
import { Button } from "@/ui/primitives/Button";
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
  const { open, onClose, onToggle } = useDisclosure();
  const ref = useRef<HTMLDivElement>(null);
  const engines = ENGINES.filter((engine) => !availableEngines || availableEngines.includes(engine.id));

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, open]);

  const active = engines.find((e) => e.id === value) ?? ENGINES[0];
  const isClaude = value === "claude";
  const canOpen = !disabled && engines.length > 1;

  return (
    <div ref={ref} className="relative flex h-6 flex-shrink-0 items-center">
      <Button
        variant="ghost"
        disabled={disabled}
        onClick={() => { if (canOpen) onToggle(); }}
        className={cx(
          composerPillButton,
          "disabled:opacity-80",
          isClaude
            ? "text-primary dark:text-primary hover:bg-surface-hover dark:hover:bg-surface-hover"
            : canOpen
              ? "text-secondary dark:text-disabled hover:bg-surface-base dark:hover:bg-surface-border"
              : "text-secondary dark:text-disabled bg-surface-page dark:bg-surface-selected cursor-default",
          open ? (isClaude ? CLAUDE_ACCENT : "bg-surface-base dark:bg-surface-border") : null,
        )}
      >
        <EngineIcon engine={value} />
        <span className={composerPillLabel}>{active.label}</span>
        {canOpen && (
          <motion.div className="inline-flex items-center" animate={{ rotate: open ? 180 : 0 }} transition={chevronRotateTransition}>
            <Expand size="xs" className="opacity-50" />
          </motion.div>
        )}
      </Button>

      <AnimatePresence>
        {open && canOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 6 }}
            transition={{ duration: 0.13 }}
            className="absolute bottom-full left-0 mb-2 w-56 bg-surface-page dark:bg-surface-raised border border-surface-border dark:border-surface-border rounded-xl shadow-xl overflow-hidden z-50 p-1.5 space-y-0.5"
          >
            {engines.map((engine) => {
              const isActive = engine.id === value;
              return (
                <Button
                  key={engine.id}
                  variant="ghost"
                  onClick={() => { onChange(engine.id); onClose(); }}
                  className={`h-auto w-full items-start justify-start gap-2.5 px-2.5 py-2 rounded-lg text-left ${
                    isActive
                      ? engine.id === "claude"
                        ? CLAUDE_ACCENT
                        : "bg-surface-page dark:bg-surface-selected"
                      : "hover:bg-surface-page dark:hover:bg-surface-border"
                  }`}
                >
                  <div className="mt-0.5 flex-shrink-0">
                    <EngineIcon engine={engine.id} size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium leading-tight ${
                      isActive && engine.id === "claude"
                        ? "text-primary dark:text-primary"
                        : "text-primary dark:text-primary"
                    }`}>
                      {engine.label}
                    </p>
                    <p className="text-2xs text-disabled dark:text-secondary mt-0.5 leading-tight">
                      {engine.description}
                    </p>
                  </div>
                  {isActive && (
                    <Check size="xs" className="mt-0.5 flex-shrink-0 text-muted dark:text-disabled" />
                  )}
                </Button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
