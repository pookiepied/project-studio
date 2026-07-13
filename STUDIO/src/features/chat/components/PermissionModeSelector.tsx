import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { chevronRotateTransition } from "@/design/motion";
import { useDisclosure } from "@/lib/hooks/useDisclosure";
import {
  Eye,
  Edit,
  Compass,
  ShieldCheck,
  Expand,
  Check,
  type IconSize,
} from "@/ui/icons";
import { composerPillButton, composerPillLabel, cx } from "./composerControlStyles";
import { Button } from "@/ui/primitives/Button";
import { getPermissionModesForEngine } from "@/core/permissions";
import type { PermissionIconKey, PermissionModeId } from "@/core/permissions";
import type { ChatEngine } from "@/cliBridges/types";

function PermIcon({ icon, size = "xs" }: { icon: PermissionIconKey; size?: IconSize }) {
  switch (icon) {
    case "eye":     return <Eye size={size} />;
    case "pencil":  return <Edit size={size} />;
    case "compass": return <Compass size={size} />;
    case "shield":  return <ShieldCheck size={size} />;
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
  const { open, onClose, onToggle } = useDisclosure();
  const ref = useRef<HTMLDivElement>(null);
  const modes = getPermissionModesForEngine(engine);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, open]);

  const active = modes.find((m) => m.id === value) ?? modes[0];
  if (!active) return null;

  return (
    <div ref={ref} className="relative flex h-6 flex-shrink-0 items-center">
      <Button
        variant="ghost"
        disabled={disabled}
        onClick={onToggle}
        title={active.description}
        className={cx(
          composerPillButton,
          "gap-1 disabled:opacity-40",
          open
            ? "bg-surface-base dark:bg-surface-selected text-secondary dark:text-disabled"
            : "text-muted dark:text-muted hover:bg-surface-base dark:hover:bg-surface-border hover:text-secondary dark:hover:text-disabled",
        )}
      >
        <PermIcon icon={active.icon} />
        <span className={composerPillLabel}>{active.label}</span>
        <motion.div className="inline-flex items-center" animate={{ rotate: open ? 180 : 0 }} transition={chevronRotateTransition}>
          <Expand size="xs" className="opacity-50" />
        </motion.div>
      </Button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 6 }}
            transition={{ duration: 0.13 }}
            className="absolute bottom-full left-0 mb-2 w-60 bg-surface-page dark:bg-surface-raised border border-surface-border dark:border-surface-border rounded-xl shadow-xl overflow-hidden z-50 p-1.5 space-y-0.5"
          >
            <p className="px-2 pt-1 pb-1 text-3xs font-semibold uppercase tracking-wider text-disabled dark:text-secondary">
              Permission mode
            </p>
            {modes.map((mode) => {
              const isActive = mode.id === value;
              return (
                <Button
                  key={mode.id}
                  variant="ghost"
                  onClick={() => { onChange(mode.id); onClose(); }}
                  className={`h-auto w-full items-start justify-start gap-2.5 px-2.5 py-1.5 rounded-lg text-left ${
                    isActive ? "bg-surface-page dark:bg-surface-selected" : "hover:bg-surface-page dark:hover:bg-surface-border"
                  }`}
                >
                  <div className="mt-0.5 flex-shrink-0 text-muted dark:text-disabled">
                    <PermIcon icon={mode.icon} size="sm" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium leading-tight ${
                      isActive ? "text-primary dark:text-primary" : "text-secondary dark:text-disabled"
                    }`}>
                      {mode.label}
                    </p>
                    <p className="text-2xs text-disabled dark:text-secondary mt-0.5 leading-tight">
                      {mode.description}
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
