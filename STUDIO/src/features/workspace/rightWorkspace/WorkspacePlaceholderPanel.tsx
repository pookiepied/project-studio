import { useRef } from "react";
import {
  Conversation,
  Files,
  Close,
} from "@/ui/icons";
import { ResizeHandle } from "@/features/workspace/rightWorkspace/ResizeHandle";
import type { RightWorkspaceView } from "./types";
import { IconButton } from "@/ui/primitives/IconButton";

interface WorkspacePlaceholderPanelProps {
  view: Extract<RightWorkspaceView, "files" | "side-chat">;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
}

export function WorkspacePlaceholderPanel({
  view,
  width,
  onWidthChange,
  onClose,
}: WorkspacePlaceholderPanelProps) {
  const drag = useRef<{ sx: number; sw: number } | null>(null);
  const Icon = view === "files" ? Files : Conversation;
  const title = view === "files" ? "Files" : "Side chat";

  const onResizeDown = (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { sx: e.clientX, sw: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      if (!drag.current) return;
      // Cap at half the window so the chat side always keeps >=50% (rail + text
      // get crushed otherwise); never exceed 1000 or drop below 340.
      const maxW = Math.max(340, Math.min(1000, Math.round(window.innerWidth * 0.5)));
      onWidthChange(Math.max(340, Math.min(maxW, drag.current.sw + (drag.current.sx - ev.clientX))));
    };
    const onUp = () => {
      drag.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <div className="flex h-full transition-colors duration-300" style={{ width, minWidth: width }}>
      <ResizeHandle onMouseDown={onResizeDown} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface-page transition-colors duration-300 dark:bg-surface-page">
        <div className="flex h-10 flex-shrink-0 items-center gap-2.5 border-b border-surface-border bg-surface-page px-3 transition-colors duration-300 dark:border-surface-border dark:bg-surface-page">
          <IconButton
            size="sm"
            onClick={onClose}
            aria-label={`Close ${title.toLowerCase()}`}
            title={`Close ${title.toLowerCase()}`}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-disabled transition-colors duration-150 hover:bg-surface-base hover:text-secondary dark:text-secondary dark:hover:bg-surface-raised dark:hover:text-disabled"
          >
            <Close size="sm" />
          </IconButton>
          <Icon size="sm" className="flex-shrink-0 text-disabled dark:text-secondary" />
          <span className="truncate text-xs text-muted dark:text-muted">{title}</span>
        </div>

        <div className="flex flex-1 items-center justify-center px-8 text-center">
          <div className="max-w-[220px]">
            <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-surface-border bg-surface-page text-disabled dark:border-surface-border dark:bg-surface-raised dark:text-muted">
              <Icon size="md" />
            </div>
            <p className="text-sm font-medium text-secondary dark:text-disabled">{title}</p>
            <p className="mt-1 text-xs leading-relaxed text-disabled dark:text-secondary">
              Nothing here yet.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
