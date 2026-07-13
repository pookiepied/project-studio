import { NavToggleIcon } from "@/ui/icons/WorkspaceIcons";
import { EnvironmentSelector } from "@/features/chat/components/EnvironmentSelector";
import { ProjectLauncher } from "./ProjectLauncher";
import type { ProjectContextLike } from "./types";
import type { ConversationStorageScope } from "@/core/conversations";
import { IconButton } from "@/ui/primitives/IconButton";

interface RightWorkspaceControlsProps {
  isTauri: boolean;
  projectContext?: ProjectContextLike | null;
  open: boolean;
  onToggleOpen: () => void;
  scope: ConversationStorageScope;
  onScopeChange: (scope: ConversationStorageScope) => void;
}

/**
 * The top-right control cluster — the app-level counterpart to the window
 * traffic lights on the top-left. Hosts the work-environment selector, the
 * "open project in…" launcher, and the workspace-panel toggle. Pinned fixed at
 * the window's top-right corner by ChatPage (it renders just the flex row here).
 */
export function RightWorkspaceControls({
  isTauri,
  projectContext,
  open,
  onToggleOpen,
  scope,
  onScopeChange,
}: RightWorkspaceControlsProps) {
  return (
    <div className="studio-chat-right-actions flex items-center gap-1.5">
      <EnvironmentSelector scope={scope} onScopeChange={onScopeChange} placement="down" />

      <ProjectLauncher isTauri={isTauri} projectContext={projectContext} />

      <IconButton
        size="sm"
        onClick={onToggleOpen}
        aria-label={open ? "Hide workspace" : "Show workspace"}
        title={open ? "Hide workspace" : "Show workspace"}
        className={`studio-chat-icon-button flex h-7 w-7 items-center justify-center rounded-lg transition-colors duration-100 ${
          open
            ? "bg-surface-base text-secondary dark:bg-surface-raised dark:text-disabled"
            : "text-disabled hover:bg-surface-base hover:text-secondary dark:text-secondary dark:hover:bg-surface-raised dark:hover:text-disabled"
        }`}
      >
        <NavToggleIcon size={14} open={open} />
      </IconButton>
    </div>
  );
}
