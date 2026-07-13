import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Expand,
  Check,
  Icon,
  CloudCheckIcon,
  DesktopTowerIcon,
  Terminal,
  Add,
  BroadcastIcon,
} from "@/ui/icons";
import type { ConversationStorageScope } from "@/core/conversations";
import { Button } from "@/ui/primitives/Button";
import { useDisclosure } from "@/lib/hooks/useDisclosure";

interface EnvironmentSelectorProps {
  scope: ConversationStorageScope;
  onScopeChange: (scope: ConversationStorageScope) => void;
  disabled?: boolean;
  /** "up" anchors the menu above the trigger (composer); "down" below it (header). */
  placement?: "up" | "down";
}

export function EnvironmentSelector({ scope, onScopeChange, disabled, placement = "up" }: EnvironmentSelectorProps) {
  const { open, onClose, onToggle } = useDisclosure();
  const [dropPos, setDropPos] = useState<{ bottom?: number; top?: number; left: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  const scopeGlyph = scope === "cloud" ? CloudCheckIcon : DesktopTowerIcon;
  const label = scope === "cloud" ? "Cloud" : "Local";

  return (
    <div className="relative flex-shrink-0">
      <Button
        variant="ghost"
        disabled={disabled}
        onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect();
          const left = Math.min(rect.left, window.innerWidth - 272);
          setDropPos(
            placement === "down"
              ? { top: rect.bottom + 8, left }
              : { bottom: window.innerHeight - rect.top + 8, left },
          );
          onToggle();
        }}
        className="gap-1.5 px-2 h-6 rounded-md text-xs text-secondary hover:bg-surface-hover disabled:opacity-60 disabled:cursor-default"
      >
        <Icon icon={scopeGlyph} size="sm" weight={open ? "fill" : "regular"} />
        <span>{label}</span>
        {!disabled && (
          <Expand size="xs" className={`opacity-50 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
        )}
      </Button>

      {createPortal(
        <AnimatePresence>
        {open && dropPos && (
          <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onMouseDown={onClose}
            className="fixed inset-0 z-popover"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{ duration: 0.13 }}
            style={{ position: "fixed", bottom: dropPos.bottom, top: dropPos.top, left: dropPos.left, zIndex: 9999 }}
            className="w-64 bg-surface-base border border-surface-border rounded-xl shadow-xl overflow-hidden p-1.5"
          >
            <p className="px-2 pt-1 pb-1.5 text-2xs font-semibold tracking-wide text-muted">
              WORK ENVIRONMENT
            </p>

            <EnvOption
              icon={<Icon icon={DesktopTowerIcon} size="sm" weight={scope === "local" ? "fill" : "regular"} />}
              title="Local"
              description="Runs on this machine, full file access"
              active={scope === "local"}
              onClick={() => { onScopeChange("local"); onClose(); }}
            />
            <EnvOption
              icon={<Icon icon={CloudCheckIcon} size="sm" weight={scope === "cloud" ? "fill" : "regular"} />}
              title="Cloud"
              description="Chat and research, no file access"
              active={scope === "cloud"}
              onClick={() => { onScopeChange("cloud"); onClose(); }}
            />
            <AddRow icon={<Add size="sm" />} label="Add Cloud Environment" />

            <div className="my-1.5 mx-2 h-px bg-surface-divider" />

            <p className="px-2 pt-0.5 pb-1.5 text-2xs font-semibold tracking-wide text-muted">
              REMOTE CONTROL
            </p>
            <AddRow icon={<Icon icon={BroadcastIcon} size="sm" />} label="Setup Remote Control" />

            <div className="my-1.5 mx-2 h-px bg-surface-divider" />

            <p className="px-2 pt-0.5 pb-1.5 text-2xs font-semibold tracking-wide text-muted">
              SSH
            </p>
            <AddRow icon={<Terminal size="sm" />} label="Add SSH Host" />
          </motion.div>
          </>
        )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

function EnvOption({
  icon, title, description, active, onClick,
}: { icon: React.ReactNode; title: string; description: string; active: boolean; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className={`h-auto w-full justify-start gap-2.5 px-2.5 py-2 rounded-lg text-left ${
        active ? "bg-surface-selected" : "hover:bg-surface-hover"
      }`}
    >
      <span className="flex-shrink-0 text-secondary">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium leading-tight text-primary">{title}</p>
        <p className="text-2xs text-muted mt-0.5 leading-tight">{description}</p>
      </div>
      {active && <Check size="xs" className="flex-shrink-0 text-secondary" />}
    </Button>
  );
}

function AddRow({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-left text-muted cursor-default">
      <span className="flex-shrink-0">{icon}</span>
      <span className="flex-1 text-xs font-medium">{label}</span>
      <span className="text-2xs font-medium tracking-wide text-disabled border border-surface-border rounded px-1.5 py-0.5">
        Soon
      </span>
    </div>
  );
}
