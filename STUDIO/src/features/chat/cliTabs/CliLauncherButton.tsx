import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Add, ExternalLink, FolderOpen } from "@/ui/icons";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { CLI_TOOLS, type CliToolId, getCliTool } from "./cliTools";
import type { CliAvailability } from "./ChatTabBar";
import { resolveCodingProject } from "@/core/projects/codingProjectResolver";

const EASE = [0.16, 1, 0.3, 1] as const;

interface CliLauncherButtonProps {
  onOpenCli: (id: CliToolId, cwd: string | null) => void;
  cliInfo: Record<CliToolId, CliAvailability>;
  activeProjectPath?: string | null;
}

async function openExternalUrl(url: string) {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function CliLauncherButton({ onOpenCli, cliInfo, activeProjectPath }: CliLauncherButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Provisional project-picker state
  const [pendingCli, setPendingCli] = useState<CliToolId | null>(null);

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

  const anyAvailable = CLI_TOOLS.some(t => cliInfo[t.id]?.available);

  const handleSelectCli = (id: CliToolId) => {
    setMenuOpen(false);
    const resolution = resolveCodingProject({ conversationProjectPath: activeProjectPath });
    if (resolution.source !== "picker") {
      onOpenCli(id, resolution.path);
      return;
    }
    setPendingCli(id);
  };

  useEffect(() => {
    if (!pendingCli) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingCli(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pendingCli]);

  const handleProjectPrompt = async (useProject: boolean) => {
    if (!pendingCli) return;
    if (useProject) {
      try {
        const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
        const selected = await openDialog({ directory: true, multiple: false });
        if (typeof selected === "string") {
          onOpenCli(pendingCli, selected);
        }
      } catch {
        // dialog cancelled — abort
      }
    } else {
      // Use user home directory
      onOpenCli(pendingCli, null);
    }
    setPendingCli(null);
  };

  return (
    <>
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
              className="absolute right-0 top-[calc(100%+6px)] z-popover w-60 rounded-xl border border-surface-border bg-surface-raised p-1.5 shadow-xl"
            >
              <p className="px-2 pb-1 pt-1 text-2xs font-semibold uppercase tracking-wider text-muted">
                Open a coding agent
              </p>
              {!anyAvailable && (
                <div className="px-2 py-3 text-center">
                  <p className="text-xs text-muted">No coding agents detected.</p>
                  <p className="mt-1 text-2xs text-disabled">Install one to get started.</p>
                </div>
              )}
              {CLI_TOOLS.map((tool) => {
                const info = cliInfo[tool.id] ?? { available: false };
                return (
                  <Button
                    key={tool.id}
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (info.available) {
                        handleSelectCli(tool.id);
                      } else {
                        void openExternalUrl(tool.installUrl);
                        setMenuOpen(false);
                      }
                    }}
                    title={info.available
                      ? (info.version ? `v${info.version}` : "Available")
                      : "Not installed — click to install"}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                      info.available
                        ? "text-secondary hover:bg-surface-selected hover:text-primary dark:text-disabled"
                        : "text-muted hover:bg-surface-hover hover:text-primary"
                    }`}
                  >
                    <tool.Icon size={16} className="flex-shrink-0" />
                    <span className="flex-1 truncate">{tool.label}</span>
                    {info.version && info.available
                      ? <span className="text-2xs text-muted">{info.version}</span>
                      : !info.available
                        ? <ExternalLink size="xs" className="text-muted" />
                        : null}
                  </Button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Project prompt dialog */}
      <AnimatePresence>
        {pendingCli && (
          <ProjectPromptModal
            cliLabel={getCliTool(pendingCli).label}
            onUseProject={() => void handleProjectPrompt(true)}
            onUseHome={() => void handleProjectPrompt(false)}
            onCancel={() => setPendingCli(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function ProjectPromptModal({
  cliLabel,
  onUseProject,
  onUseHome,
  onCancel,
}: {
  cliLabel: string;
  onUseProject: () => void;
  onUseHome: () => void;
  onCancel: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={onCancel}
    >
      <motion.div
        initial={{ scale: 0.96, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 8 }}
        transition={{ duration: 0.18, ease: EASE }}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[380px] rounded-2xl border border-surface-border bg-surface-base p-5 shadow-2xl"
      >
        <h2 className="text-base font-semibold text-primary">
          Launch {cliLabel}
        </h2>
        <p className="mt-2 text-sm text-muted leading-relaxed">
          Do you want to work in a specific project folder?
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <Button
            variant="ghost"
            onClick={onUseProject}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-surface-selected py-2.5 text-sm font-medium text-primary hover:bg-surface-hover"
          >
            <FolderOpen size="sm" />
            Yes, pick a project folder
          </Button>
          <Button
            variant="ghost"
            onClick={onUseHome}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium text-secondary hover:bg-surface-hover hover:text-primary"
          >
            No, use default location
          </Button>
        </div>
        <Button
          variant="ghost"
          onClick={onCancel}
          className="mt-3 w-full text-center text-xs text-muted hover:text-primary transition-colors"
        >
          Cancel
        </Button>
      </motion.div>
    </motion.div>
  );
}
