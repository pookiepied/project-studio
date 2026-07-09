import { OverviewIcon, NavToggleIcon } from "@/ui/icons/WorkspaceIcons";
import { ProjectLauncher } from "./ProjectLauncher";
import type { ProjectContextLike } from "./types";

interface RightWorkspaceControlsProps {
  isTauri: boolean;
  projectContext?: ProjectContextLike | null;
  open: boolean;
  summaryPanelOpen: boolean;
  onToggleSummaryPanel: () => void;
  onToggleOpen: () => void;
}

export function RightWorkspaceControls({
  isTauri,
  projectContext,
  open,
  summaryPanelOpen,
  onToggleSummaryPanel,
  onToggleOpen,
}: RightWorkspaceControlsProps) {
  return (
    <div className="studio-chat-right-actions flex items-center gap-1.5">
      <ProjectLauncher isTauri={isTauri} projectContext={projectContext} />

      <button
        type="button"
        onClick={onToggleSummaryPanel}
        title={summaryPanelOpen ? "Hide overview" : "Show overview"}
        className={`studio-chat-icon-button flex h-7 w-7 items-center justify-center rounded-lg transition-colors duration-100 ${
          summaryPanelOpen
            ? "bg-gray-100 text-gray-700 dark:bg-surface-raised dark:text-gray-300"
            : "text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-600 dark:hover:bg-surface-raised dark:hover:text-gray-400"
        }`}
      >
        <OverviewIcon size={14} filled={false} />
      </button>

      <button
        type="button"
        onClick={onToggleOpen}
        title={open ? "Hide workspace" : "Show workspace"}
        className={`studio-chat-icon-button flex h-7 w-7 items-center justify-center rounded-lg transition-colors duration-100 ${
          open
            ? "bg-gray-100 text-gray-700 dark:bg-surface-raised dark:text-gray-300"
            : "text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-600 dark:hover:bg-surface-raised dark:hover:text-gray-400"
        }`}
      >
        <NavToggleIcon size={14} open={open} />
      </button>
    </div>
  );
}
