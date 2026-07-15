import { AnimatePresence, motion } from "framer-motion";
import { Close } from "@/ui/icons";
import { StudioIcon } from "@/ui/brand";
import { CLI_TOOLS } from "./cliTools";
import type { ChatTab } from "./types";

export interface CliAvailability {
  available: boolean;
  version?: string;
}

interface ChatTabBarProps {
  tabs: ChatTab[];
  activeId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

const EASE = [0.16, 1, 0.3, 1] as const;

export function ChatTabBar({
  tabs, activeId, onSelectTab, onCloseTab,
}: ChatTabBarProps) {
  if (tabs.length <= 1) return null;

  return (
    <div className="flex h-[32px] flex-shrink-0 items-center gap-0.5 border-t border-surface-divider bg-surface-base px-2">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto scrollbar-none">
        <AnimatePresence initial={false} mode="popLayout">
          {tabs.map((tab) => {
            const active = tab.id === activeId;
            const Icon = tab.kind === "studio"
              ? StudioIcon
              : tab.kind === "cli"
                ? CLI_TOOLS.find((t) => t.id === tab.cliId)?.Icon
                : undefined;
            return (
              <motion.div
                key={tab.id}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.14, ease: EASE }}
                onClick={() => onSelectTab(tab.id)}
                className={`group/tab flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors duration-100 ${
                  active
                    ? "bg-surface-selected text-primary dark:bg-surface-raised dark:text-disabled"
                    : "text-muted hover:bg-surface-base hover:text-secondary dark:hover:bg-surface-raised"
                }`}
                title={tab.title}
              >
                {Icon && <Icon size={13} className="flex-shrink-0" />}
                <span className="max-w-[120px] truncate">{tab.title}</span>
                {tab.kind === "cli" && (
                  <span
                    role="button"
                    aria-label="Close tab"
                    onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                    className="ml-0.5 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded opacity-0 transition-opacity duration-100 hover:bg-surface-border group-hover/tab:opacity-100"
                  >
                    <Close size="xs" />
                  </span>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
