import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  EyeIcon as Eye,
  PencilSimpleIcon as Pencil,
  CompassIcon as Compass,
  ShieldCheckIcon as Shield,
  CaretDownIcon as CaretDown,
  CheckIcon as Check,
} from "@phosphor-icons/react";
import { composerPillButton, composerPillLabel, cx } from "./composerControlStyles";
import { Button } from "@/ui/primitives/Button";
import { getPermissionModesForEngine } from "@/core/permissions";
import type { PermissionIconKey, PermissionModeId } from "@/core/permissions";
import type { ChatEngine } from "@/cliBridges/types";

function PermIcon({ icon, size = 13 }: { icon: PermissionIconKey; size?: number }) {
  switch (icon) {
    case "eye":     return <Eye size={size} weight="regular" />;
    case "pencil":  return <Pencil size={size} weight="regular" />;
    case "compass": return <Compass size={size} weight="regular" />;
    case "shield":  return <Shield size={size} weight="regular" />;
  }
}

interface PermissionModeSelectorProps {
  /** Which engine's supported modes to show. */
  engine: ChatEngine;
  value: PermissionModeId;
  disabled?: boolean;
  onChange: (mode: PermissionModeId) => void;
}

/**
 * Shared permission-mode picker. Engine-agnostic: it renders whatever modes the
 * given engine opts into via the centralized catalog. Same control for Studio
 * AI and Claude (and any future CLI bridge).
 */
export const PermissionModeSelector = ({ engine, value, disabled, onChange }: PermissionModeSelectorProps) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const modes = getPermissionModesForEngine(engine);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const active = modes.find((m) => m.id === value) ?? modes[0];
  if (!active) return null;

  return (
    <div ref={ref} className="relative flex h-7 flex-shrink-0 items-center">
      <Button
        variant="ghost"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={active.description}
        className={cx(
          composerPillButton,
          "gap-1 disabled:opacity-40",
          open
            ? "bg-gray-100 dark:bg-surface-selected text-gray-700 dark:text-gray-200"
            : "text-gray-500 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-surface-border hover:text-gray-700 dark:hover:text-gray-300",
        )}
      >
        <PermIcon icon={active.icon} />
        <span className={composerPillLabel}>{active.label}</span>
        <motion.div className="inline-flex items-center" animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.18 }}>
          <CaretDown size={12} weight="bold" className="opacity-50" />
        </motion.div>
      </Button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 6 }}
            transition={{ duration: 0.13 }}
            className="absolute bottom-full left-0 mb-2 w-60 bg-white dark:bg-surface-raised border border-gray-200 dark:border-surface-border rounded-xl shadow-xl overflow-hidden z-50 p-1.5 space-y-0.5"
          >
            <p className="px-2 pt-1 pb-1 text-3xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600">
              Permission mode
            </p>
            {modes.map((mode) => {
              const isActive = mode.id === value;
              return (
                <Button
                  key={mode.id}
                  variant="ghost"
                  onClick={() => { onChange(mode.id); setOpen(false); }}
                  className={`h-auto w-full items-start justify-start gap-2.5 px-2.5 py-1.5 rounded-lg text-left ${
                    isActive ? "bg-gray-50 dark:bg-surface-selected" : "hover:bg-gray-50 dark:hover:bg-surface-border"
                  }`}
                >
                  <div className="mt-0.5 flex-shrink-0 text-gray-500 dark:text-gray-400">
                    <PermIcon icon={mode.icon} size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium leading-tight ${
                      isActive ? "text-gray-900 dark:text-gray-100" : "text-gray-700 dark:text-gray-300"
                    }`}>
                      {mode.label}
                    </p>
                    <p className="text-2xs text-gray-400 dark:text-gray-600 mt-0.5 leading-tight">
                      {mode.description}
                    </p>
                  </div>
                  {isActive && (
                    <Check size={12} weight="bold" className="mt-0.5 flex-shrink-0 text-gray-500 dark:text-gray-400" />
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
