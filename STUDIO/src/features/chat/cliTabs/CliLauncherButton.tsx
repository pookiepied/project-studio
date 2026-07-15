import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Add } from "@/ui/icons";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { CLI_TOOLS, type CliToolId } from "./cliTools";
import type { CliAvailability } from "./ChatTabBar";

const EASE = [0.16, 1, 0.3, 1] as const;

interface CliLauncherButtonProps {
  onOpenCli: (id: CliToolId) => void;
  cliInfo: Record<CliToolId, CliAvailability>;
}

export function CliLauncherButton({ onOpenCli, cliInfo }: CliLauncherButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  return (
    <div ref={menuRef} className="relative">
      <IconButton
        size="sm"
        aria-label="Open a coding agent"
        title="Open a coding agent"
        onClick={() => setMenuOpen((v) => !v)}
        className="studio-chat-icon-button flex h-7 w-7 items-center justify-center rounded-lg text-disabled transition-colors hover:bg-surface-base hover:text-secondary dark:text-secondary dark:hover:bg-surface-raised dark:hover:text-disabled"
      >
        <Add size="sm" />
      </IconButton>
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.14, ease: EASE }}
            className="absolute right-0 top-[calc(100%+6px)] z-popover w-56 rounded-xl border border-surface-border bg-surface-raised p-1.5 shadow-xl"
          >
            <p className="px-2 pb-1 pt-1 text-2xs font-semibold uppercase tracking-wider text-muted">
              Open a coding agent
            </p>
            {CLI_TOOLS.map((tool) => {
              const info = cliInfo[tool.id] ?? { available: false };
              return (
                <Button
                  key={tool.id}
                  variant="ghost"
                  disabled={!info.available}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (info.available) {
                      onOpenCli(tool.id);
                      setMenuOpen(false);
                    }
                  }}
                  title={info.available ? (info.version ? `v${info.version}` : "Available") : "Not found on PATH"}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                    info.available
                      ? "text-secondary hover:bg-surface-selected hover:text-primary dark:text-disabled"
                      : "cursor-not-allowed text-disabled/60"
                  }`}
                >
                  <tool.Icon size={16} className="flex-shrink-0" />
                  <span className="flex-1 truncate">{tool.label}</span>
                  {info.available
                    ? (info.version
                      ? <span className="text-2xs text-muted">{info.version}</span>
                      : <span className="text-2xs text-muted">ready</span>)
                    : <span className="text-2xs text-muted">not found</span>}
                </Button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
